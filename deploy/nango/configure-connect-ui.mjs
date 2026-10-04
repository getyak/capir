import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The pinned hosted SPA initializes its store with api.nango.dev. Runtime
// NANGO_SERVER_URL does not reach this prebuilt bundle. Change only that
// initial value; a Connect session capability must stay on its owning API.
const [root, rawOrigin] = process.argv.slice(2);
if (!root || !rawOrigin) throw new Error('CONNECT_UI_BUILD_INPUT_REQUIRED');
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password
  || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('CONNECT_UI_API_MUST_BE_BARE_HTTPS_ORIGIN');
}

const assets = join(root, 'assets');
const needle = 'apiURL:`https://api.nango.dev`';
const scripts = readdirSync(assets).filter(name => name.endsWith('.js'))
  .map(name => ({ name, body: readFileSync(join(assets, name), 'utf8') }));
const matches = scripts.flatMap(file =>
  Array.from({ length: file.body.split(needle).length - 1 }, () => file));
if (matches.length !== 1) throw new Error('CONNECT_UI_PINNED_STORE_SIGNATURE_CHANGED');
const file = matches[0];
if (scripts.some(other => other.name !== file.name && other.body.includes(file.name))) {
  throw new Error('CONNECT_UI_CROSS_CHUNK_REFERENCE_REQUIRES_REBUILD');
}
const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
if (!html.includes(file.name)) throw new Error('CONNECT_UI_ENTRY_REFERENCE_MISSING');
const body = file.body.replace(needle, `apiURL:${JSON.stringify(origin.origin)}`);
const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
const name = `index-local-${hash}.js`;
writeFileSync(join(assets, name), body);
writeFileSync(htmlPath, html.replaceAll(file.name, name));
unlinkSync(join(assets, file.name));
console.log(JSON.stringify({ configured_api_origin: origin.origin, asset: name,
  patched_store_count: 1, source_bundle_sha256: createHash('sha256').update(file.body).digest('hex'),
  patched_bundle_sha256: createHash('sha256').update(body).digest('hex') }));
