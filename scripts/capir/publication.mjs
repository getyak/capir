#!/usr/bin/env node
/** Verified release cohorts and monotonic stable promotion. Drafts may be
 * rebuilt; published version assets are read-only and authoritative. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, verifyManifest, RELEASE_REPOSITORY, RELEASE_BASE_URL, SUPPORTED_PLATFORMS } from './manifest.mjs';

export function strictVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) || /\s/.test(version) || !version.split('.').every(p => Number.isSafeInteger(Number(p))))
    throw new Error('version must be strict semver X.Y.Z');
  return version;
}
function compare(a, b) {
  const x = strictVersion(a).split('.').map(Number), y = strictVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export function signedManifest(bytes, signature, publicKey) {
  const text = bytes.toString('utf8');
  if (!signature || !verifyManifest(text, signature, publicKey)) throw new Error('release signature verification failed');
  const manifest = JSON.parse(text);
  strictVersion(manifest.version);
  const canonical = buildManifest({ version: manifest.version, sourceCommit: manifest.source_commit, nodeVersion: manifest.node_version, assets: manifest.assets });
  if (canonical !== text) throw new Error('release manifest is not the canonical complete cohort');
  return manifest;
}
export function verifyCohort(dir, expected) {
  const manifestBytes = readFileSync(join(dir, 'manifest.json'));
  const signature = readFileSync(join(dir, 'manifest.json.sig'));
  const manifest = signedManifest(manifestBytes, signature, expected.publicKey);
  if (manifest.version !== expected.version || manifest.source_commit !== expected.commit || manifest.node_version !== expected.nodeVersion)
    throw new Error('release cohort does not match version, validated source SHA and Node version');
  for (const asset of manifest.assets) {
    const bytes = readFileSync(join(dir, asset.filename));
    if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
      throw new Error(`release asset verification failed: ${asset.filename}`);
  }
  if (expected.installer && !readFileSync(join(dir, 'install.sh')).equals(readFileSync(expected.installer)))
    throw new Error('published installer differs from its immutable source');
  return { manifest, manifestBytes, signature };
}
async function fetchManifestPart(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('immutable channel recovery download failed'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('immutable channel recovery body is missing');
  const parts = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) throw new Error('immutable channel recovery body exceeds byte cap');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
export async function promotionDecision(candidate, current, publicKey, fetchImpl = fetch) {
  const next = signedManifest(candidate.manifestBytes, candidate.signature, publicKey);
  if (!current) return { promote: true, current: null };
  let previous;
  try { previous = signedManifest(current.manifestBytes, current.signature, publicKey); }
  catch {
    // A failed two-file channel upload can leave a mismatched pair. Authenticate
    // its manifest against the complete immutable release before comparing it.
    const version = strictVersion(JSON.parse(current.manifestBytes.toString('utf8')).version);
    const base = `${RELEASE_BASE_URL}/download/capir-v${version}`;
    const [bytes, sig] = await Promise.all([fetchManifestPart(`${base}/manifest.json`, fetchImpl), fetchManifestPart(`${base}/manifest.json.sig`, fetchImpl)]);
    previous = signedManifest(bytes, sig, publicKey);
    if (!bytes.equals(current.manifestBytes)) throw new Error('current channel does not match its verified immutable release');
  }
  const order = compare(next.version, previous.version);
  if (order === 0 && !candidate.manifestBytes.equals(current.manifestBytes)) throw new Error('same-version channel cohort conflict');
  return { promote: order >= 0, current: previous.version };
}
const CHECKPOINT_PREFIX = 'capir-channel-state: ';
function checkpointNotes(cohort) {
  return `Signed newest stable capir manifest and installer.\n\n${CHECKPOINT_PREFIX}${JSON.stringify({ schema: 1, version: cohort.manifest.version, source_commit: cohort.manifest.source_commit, manifest_sha256: createHash('sha256').update(cohort.manifestBytes).digest('hex') })}\n`;
}
async function readCheckpoint(channel, publicKey, fetchImpl) {
  const lines = (channel?.body ?? '').split('\n').filter(line => line.startsWith(CHECKPOINT_PREFIX));
  if (!lines.length) return null;
  if (lines.length !== 1) throw new Error('stable promotion checkpoint is ambiguous');
  const record = JSON.parse(lines[0].slice(CHECKPOINT_PREFIX.length));
  const version = strictVersion(record.version);
  if (record.schema !== 1 || !/^[0-9a-f]{40}$/.test(record.source_commit) || !/^[0-9a-f]{64}$/.test(record.manifest_sha256)) throw new Error('stable promotion checkpoint is malformed');
  const base = `${RELEASE_BASE_URL}/download/capir-v${version}`;
  const [manifestBytes, signature] = await Promise.all([fetchManifestPart(`${base}/manifest.json`, fetchImpl), fetchManifestPart(`${base}/manifest.json.sig`, fetchImpl)]);
  const manifest = signedManifest(manifestBytes, signature, publicKey);
  if (manifest.version !== version || manifest.source_commit !== record.source_commit || createHash('sha256').update(manifestBytes).digest('hex') !== record.manifest_sha256) throw new Error('stable promotion checkpoint does not match its verified immutable release');
  return { manifest, manifestBytes, signature };
}
function realGh(args) {
  const env = { ...process.env }; delete env.CAPIR_RELEASE_SIGNING_KEY;
  try { return { code: 0, stdout: execFileSync('gh', args, { encoding: 'utf8', env, stdio: ['ignore','pipe','pipe'], timeout: 720000 }) }; }
  catch (error) { return { code: error.status ?? 1, stdout: String(error.stdout ?? '') }; }
}
export async function publishRelease(options, { gh = realGh, fetchImpl = fetch } = {}) {
  const version = strictVersion(options.version), tag = `capir-v${version}`;
  if (options.tag !== tag || !/^[0-9a-f]{40}$/.test(options.commit)) throw new Error('publication reference mismatch');
  const repoArgs = ['--repo', RELEASE_REPOSITORY];
  const publicKey = readFileSync(options.publicKeyFile, 'utf8');
  const expected = { version, commit: options.commit, nodeVersion: options.nodeVersion, publicKey, installer: options.installer };
  const work = mkdtempSync(join(tmpdir(), 'capir-publication-'));
  const run = args => { const result = gh(args); if (result.code) throw new Error(`GitHub operation failed: ${args.slice(0,2).join(' ')} (exit ${result.code})`); return result.stdout; };
  const metadata = releaseTag => {
    const result = gh(['api', '--include', `repos/${RELEASE_REPOSITORY}/releases/tags/${releaseTag}`]);
    const status = /^HTTP\/\S+\s+(\d+)/m.exec(result.stdout)?.[1];
    if (status === '404') return null;
    if (result.code || status !== '200') throw new Error(`GitHub release metadata failed (HTTP ${status ?? 'unknown'})`);
    const separator = /\r?\n\r?\n/.exec(result.stdout);
    if (!separator) throw new Error('GitHub release metadata response is malformed');
    return JSON.parse(result.stdout.slice(separator.index + separator[0].length));
  };
  const checkRemoteTag = () => {
    let object = JSON.parse(run(['api', `repos/${RELEASE_REPOSITORY}/git/ref/tags/${tag}`])).object;
    for (let depth = 0; object?.type === 'tag' && depth < 8; depth++)
      object = JSON.parse(run(['api', `repos/${RELEASE_REPOSITORY}/git/tags/${object.sha}`])).object;
    if (object?.type !== 'commit' || object.sha !== options.commit)
      throw new Error('remote release tag moved away from the validated commit');
  };
  const archiveNames = SUPPORTED_PLATFORMS.map(platform => `capir-${version}-${platform}.tar.gz`);
  const names = ['manifest.json', 'manifest.json.sig', 'install.sh', ...archiveNames];
  const assertAssets = (release, complete) => {
    const actual = release.assets.map(asset => asset.name);
    if (new Set(actual).size !== actual.length || actual.some(name => !names.includes(name)) || (complete && names.some(name => !actual.includes(name))))
      throw new Error('version release asset set differs from its complete seven-file cohort');
  };
  const download = (releaseTag, dir, patterns) => run(['release','download',releaseTag,...repoArgs,'--dir',dir,...patterns.flatMap(pattern => ['--pattern',pattern])]);
  try {
    // Both the package job and publisher are bound to one validated commit.
    checkRemoteTag();
    const candidateDir = join(work, 'candidate');
    // Verify freshly built inputs without relying on their filenames alone.
    mkdirSync(candidateDir);
    for (const name of archiveNames) copyFileSync(join(options.archivesDir,name),join(candidateDir,name));
    for (const name of ['manifest.json','manifest.json.sig']) copyFileSync(join(options.manifestDir,name),join(candidateDir,name));
    copyFileSync(options.installer,join(candidateDir,'install.sh'));
    verifyCohort(candidateDir, expected);
    let release = metadata(tag);
    if (release) assertAssets(release, !release.draft);
    const notes = join(work,'notes.md');
    writeFileSync(notes, `# capir ${version}\n\nStandalone packages for macOS arm64/x64 and Linux glibc arm64/x64. Windows uses source installs.\n\nInstall:\n\n\`\`\`sh\ncurl -fsSL ${RELEASE_BASE_URL}/download/capir-stable/install.sh -o capir-install.sh\nsh capir-install.sh\n\`\`\`\n\nUse \`--version ${version}\` for this immutable release, or \`--replace-existing\` to retain a backup of an existing launcher.\n\nUpdate: \`capir update --check\`, \`capir update\`, \`capir update --rollback\`. Ordinary interactive commands check for newer versions; checks never install them.\n\nBundled runtime: Node ${options.nodeVersion}, official SHA256-verified archive.\nSource revision: ${options.commit}\n`);
    if (!release) {
      run(['release','create',tag,...repoArgs,'--verify-tag','--target',options.commit,'--draft','--title',`capir ${version}`,'--notes-file',notes]);
      release = metadata(tag);
      if (!release?.draft) throw new Error('new release was not read back as a draft');
    }
    if (release.draft) {
      checkRemoteTag();
      // Only an unpublished draft may be rebuilt. Replace the entire cohort,
      // then download and validate all seven files before publication.
      run(['release','upload',tag,...repoArgs,...names.map(name=>join(candidateDir,name)),'--clobber']);
    }
    const authoritative = join(work,'authoritative');
    download(tag, authoritative, names);
    const cohort = verifyCohort(authoritative, expected);
    checkRemoteTag();
    if (release.draft) run(['release','edit',tag,...repoArgs,'--draft=false','--latest=false','--notes-file',notes]);
    release = metadata(tag);
    if (!release || release.draft) throw new Error('version release is not published');
    assertAssets(release,true);
    // Published assets are authoritative even when a full rerun rebuilt
    // different archive bytes from the same immutable source revision.
    let channel = metadata('capir-stable');
    let current = null;
    const checkpoint = await readCheckpoint(channel, publicKey, fetchImpl);
    if (channel?.assets.length) {
      const currentNames = channel.assets.map(asset=>asset.name);
      if (!currentNames.includes('manifest.json') && !checkpoint) throw new Error('stable channel has no recoverable manifest or checkpoint');
      if (currentNames.includes('manifest.json')) {
      const currentDir = join(work,'current');
      const patterns = ['manifest.json', ...(currentNames.includes('manifest.json.sig') ? ['manifest.json.sig'] : [])];
      download('capir-stable',currentDir,patterns);
      current = { manifestBytes: readFileSync(join(currentDir,'manifest.json')), signature: currentNames.includes('manifest.json.sig') ? readFileSync(join(currentDir,'manifest.json.sig')) : null };
      }
    }
    const decision = await promotionDecision(cohort,current,publicKey,fetchImpl);
    const minimum = checkpoint && (!decision.current || compare(checkpoint.manifest.version, decision.current) > 0) ? checkpoint.manifest.version : decision.current;
    if (!decision.promote || (minimum && compare(version, minimum) < 0)) return { version, source_commit: options.commit, channel_promoted: false, stable: minimum };
    // Persist a verified promotion intent BEFORE clobber can delete any old
    // channel asset. A rerun authenticates it against the immutable release.
    const checkpointFile = join(work, 'channel-notes.md');
    writeFileSync(checkpointFile, checkpointNotes(cohort));
    if (!channel) run(['release','create','capir-stable',...repoArgs,'--draft','--target',options.commit,'--title','capir stable channel','--notes-file',checkpointFile]);
    else run(['release','edit','capir-stable',...repoArgs,'--notes-file',checkpointFile,'--latest=false']);
    const channelNames = ['manifest.json','manifest.json.sig','install.sh'];
    run(['release','upload','capir-stable',...repoArgs,...channelNames.map(name=>join(authoritative,name)),'--clobber']);
    const channelReadback = join(work,'channel-readback');
    download('capir-stable',channelReadback,channelNames);
    for (const name of channelNames) if (!readFileSync(join(channelReadback,name)).equals(readFileSync(join(authoritative,name)))) throw new Error('stable channel readback differs from the verified cohort');
    signedManifest(readFileSync(join(channelReadback,'manifest.json')),readFileSync(join(channelReadback,'manifest.json.sig')),publicKey);
    run(['release','edit','capir-stable',...repoArgs,'--draft=false','--latest=false']);
    channel = metadata('capir-stable');
    if (!channel || channel.draft || channelNames.some(name=>!channel.assets.some(asset=>asset.name===name))) throw new Error('stable channel publication readback failed');
    return { version, source_commit: options.commit, channel_promoted: true, stable: version };
  } finally { rmSync(work,{recursive:true,force:true}); }
}
function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (process.argv[1] && isMain()) {
  try {
    const [command,...args] = process.argv.slice(2); const values = {};
    for (let i=0;i<args.length;i+=2) values[args[i].slice(2)] = args[i+1];
    if (command === 'version') { strictVersion(process.env.CAPIR_DISPATCH_VERSION); }
    else if (command === 'publish') {
      const result = await publishRelease({version:values.version,tag:values.tag,commit:values.commit,nodeVersion:values['node-version'],archivesDir:values['archives-dir'],manifestDir:values['manifest-dir'],installer:values.installer,publicKeyFile:values['public-key']});
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else throw new Error('expected version or publish command');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
