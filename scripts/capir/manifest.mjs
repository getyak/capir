#!/usr/bin/env node
/**
 * Canonical release manifest builder, verifier and signer for the standalone
 * `capir` release channel (repository getyak/capir; getyak/talent-signal is a
 * redirect and never used for release URLs).
 *
 * The manifest is deliberately simple multi-line JSON (one key per line) so
 * the POSIX shell bootstrap can extract fields without a JSON parser. The
 * detached signature is raw RSA-SHA256 over the exact manifest bytes:
 *
 *   node scripts/capir/manifest.mjs build  --version X.Y.Z --commit <sha> \
 *     --node-version 22.23.2 --assets assets.json --out manifest.json
 *   node scripts/capir/manifest.mjs sign   --in manifest.json --out manifest.json.sig
 *   node scripts/capir/manifest.mjs verify --in manifest.json --sig manifest.json.sig \
 *     --key scripts/capir/release-public-key.txt
 *
 * Signing reads the private key ONLY from the CAPIR_RELEASE_SIGNING_KEY
 * environment variable (provisioned by the trusted publication job). The
 * private key is never printed, written to disk or committed. `sign` refuses
 * to run anywhere the variable is absent.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { fileURLToPath } from "node:url";

export const RELEASE_REPOSITORY = "getyak/capir";
export const RELEASE_BASE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const CHANNEL_TAG = "capir-stable";
export const MANIFEST_SCHEMA_VERSION = "capir-release-manifest.v1";
export const SUPPORTED_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
export const NODE_VERSION = "22.23.2";

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;

export function archiveName(version, platform) {
  return `capir-${version}-${platform}.tar.gz`;
}

export function assetUrl(version, platform) {
  return `${RELEASE_BASE_URL}/download/capir-v${version}/${archiveName(version, platform)}`;
}

/**
 * Canonical manifest text. `assets` entries are { platform, sha256, size };
 * filename and url are DERIVED (never caller-supplied) and the platform order
 * is fixed. Output is 2-space-indented JSON: one key per line.
 *
 * `options.releaseBaseUrl` is an explicit fixture/mirror transport binding;
 * production (and every production caller) uses the immutable canonical
 * GitHub release base.
 */
export function buildManifest({ version, sourceCommit, nodeVersion, assets }, options = {}) {
  const releaseBaseUrl = options.releaseBaseUrl ?? RELEASE_BASE_URL;
  if (!SEMVER.test(version)) throw new Error("version must be strict semver X.Y.Z");
  if (!COMMIT_HEX.test(String(sourceCommit))) throw new Error("sourceCommit must be 40 lowercase hex");
  if (!SEMVER.test(String(nodeVersion))) throw new Error("nodeVersion must be strict X.Y.Z");
  const byPlatform = new Map(assets.map((asset) => [asset.platform, asset]));
  const ordered = SUPPORTED_PLATFORMS.map((platform) => {
    const asset = byPlatform.get(platform);
    if (!asset) throw new Error(`missing asset for ${platform}`);
    if (!SHA256_HEX.test(asset.sha256)) throw new Error(`bad sha256 for ${platform}`);
    if (!Number.isInteger(asset.size) || asset.size <= 0) throw new Error(`bad size for ${platform}`);
    return {
      platform,
      filename: archiveName(version, platform),
      url: `${releaseBaseUrl}/download/capir-v${version}/${archiveName(version, platform)}`,
      sha256: asset.sha256,
      size: asset.size,
    };
  });
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    version,
    tag: `capir-v${version}`,
    source_commit: String(sourceCommit),
    node_version: String(nodeVersion),
    assets: ordered,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Raw RSA-SHA256 detached signature over the exact manifest bytes. */
export function signManifest(manifestText, privateKeyPem) {
  return cryptoSign("sha256", Buffer.from(manifestText, "utf8"), privateKeyPem);
}

export function verifyManifest(manifestText, signature, publicKeyPem) {
  try {
    return cryptoVerify("sha256", Buffer.from(manifestText, "utf8"), publicKeyPem, signature);
  } catch {
    return false;
  }
}

/** Test-only keypair generation (never used in production signing). */
export function generateTestKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key || !key.startsWith("--") || value === undefined)
      throw new Error(`invalid arguments near ${key ?? "<end>"}`);
    values[key.slice(2)] = value;
  }
  return { command, values };
}

function main(argv) {
  const { command, values } = parseArgs(argv);
  if (command === "build") {
    const assets = JSON.parse(readFileSync(values.assets, "utf8"));
    const text = buildManifest({
      version: values.version,
      sourceCommit: values.commit,
      nodeVersion: values["node-version"],
      assets,
    });
    writeFileSync(values.out, text);
    process.stdout.write(`wrote ${values.out}\n`);
    return;
  }
  if (command === "sign") {
    // The private key lives ONLY in this environment variable; never printed.
    const raw = process.env.CAPIR_RELEASE_SIGNING_KEY;
    if (!raw || raw.trim() === "") {
      process.stderr.write("CAPIR_RELEASE_SIGNING_KEY is required for signing; refusing to continue.\n");
      process.exit(1);
    }
    const privateKeyPem = raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
    const signature = signManifest(readFileSync(values.in, "utf8"), privateKeyPem);
    writeFileSync(values.out, signature);
    process.stdout.write(`wrote ${values.out}\n`);
    return;
  }
  if (command === "verify") {
    const ok = verifyManifest(
      readFileSync(values.in, "utf8"),
      readFileSync(values.sig),
      readFileSync(values.key, "utf8"),
    );
    if (!ok) {
      process.stderr.write("manifest signature verification FAILED\n");
      process.exit(1);
    }
    process.stdout.write("manifest signature verified\n");
    return;
  }
  process.stderr.write("usage: manifest.mjs build|sign|verify ...\n");
  process.exit(2);
}


/** True when executed as a script (realpath comparison survives symlinked tmp paths). */
function isMainModule(metaUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMainModule(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
