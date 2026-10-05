/**
 * Signed release manifest for the standalone `capir` release channel.
 *
 * Trust model: a detached RSA-SHA256 signature over the exact manifest bytes
 * is verified BEFORE the JSON is parsed or used. The only trust anchor is the
 * committed public key below (mirrored in scripts/capir/install.sh). Tests may
 * inject a different trust key explicitly as a dependency; there is no
 * production environment override that can weaken or replace it.
 *
 * The manifest format is deliberately simple multi-line JSON (one key per
 * line, fixed indentation) so the POSIX shell bootstrap can extract fields
 * without a JSON parser. `scripts/capir/manifest.mjs` emits exactly this
 * canonical shape and this module validates it strictly.
 */
import { verify as cryptoVerify } from "node:crypto";
import { CapirCliError, EXIT } from "../errors.js";

export const MANIFEST_SCHEMA_VERSION = "capir-release-manifest.v1";

/** Immutable release channel; never GitHub `releases/latest` (desktop shares the repo).
 * Canonical repository: getyak/capir (repository id 1322192683, owner id 269524475);
 * getyak/talent-signal is only a redirect and is never used for release URLs. */
export const RELEASE_REPOSITORY = "getyak/capir";
export const RELEASE_BASE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const CHANNEL_TAG = "capir-stable";
export const CHANNEL_MANIFEST_URL = `${RELEASE_BASE_URL}/download/${CHANNEL_TAG}/manifest.json`;
export const CHANNEL_SIGNATURE_URL = `${RELEASE_BASE_URL}/download/${CHANNEL_TAG}/manifest.json.sig`;
export const INSTALLER_URL = `${RELEASE_BASE_URL}/download/${CHANNEL_TAG}/install.sh`;

/** Supported standalone platforms (ordered canonically). Windows ships no native updater. */
export const SUPPORTED_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
] as const;
export type ReleasePlatform = (typeof SUPPORTED_PLATFORMS)[number];

export const ARCHIVE_NAME_PATTERN = /^capir-\d+\.\d+\.\d+-(darwin|linux)-(arm64|x64)\.tar\.gz$/;

/**
 * Committed public trust key (RSA-SHA256). The matching private key lives only
 * in the GitHub Actions `CAPIR_RELEASE_SIGNING_KEY` secret; it is never read,
 * printed or committed anywhere else.
 */
export const CAPIR_RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArcp5/dQcN+DhqD/gW1vY
4ZchI41DneoR1p1+yo+kA6N9SS0ksKWtKR3YABVjSmN7hsbwhsT3t96g7YkgtJtZ
DkXTNoFqg3MDOl8Dqhg0tieWQ82YrVe97n1+LYPLIFLG1sgoafagXJ+NoY19vXiT
0G80bC2Rpzy0ugrEkmCJJjBQWCfznJHRYoMto2nxu5P3YlnQrQWYf1fzUUnUQuSH
Uuov/nbRpeLNSU8RCDoMKUt2rA4vBJWHHBX7ncmuehP9vc70cw25WjNX+Qiavmka
ZpavlTx1V1PUUsyizPkK/sTIqx5y+JLGMg4199hEks8kssShEZbv4pirMgfQfRPu
SHwvtwWUdtxHIzUTMAoGRRFRERuwbbpb4qnCE2E3EtJpv+8p2w+hnpHjeqQWfbue
jhpFKsOQhDn54MwJbB3iF7quA81Kqrio0krcwVGCiB5YaegAOlspHSqPYenb1OpN
Xe9vM09OF/85HUZfh2bGRmr5koAiJVDqfxr8qUxEO7HtAgMBAAE=
-----END PUBLIC KEY-----`;

export interface ReleaseAsset {
  platform: ReleasePlatform;
  filename: string;
  url: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  schema_version: typeof MANIFEST_SCHEMA_VERSION;
  version: string;
  tag: string;
  source_commit: string;
  node_version: string;
  assets: ReleaseAsset[];
}

function manifestError(message: string): CapirCliError {
  return new CapirCliError(
    "CAPIR_UPDATE_MANIFEST_INVALID",
    EXIT.INFRASTRUCTURE,
    message,
  );
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const NODE_VERSION = /^\d+\.\d+\.\d+$/;

export function compareVersions(a: string, b: string): number {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) throw manifestError(`Version strings must be strict semver X.Y.Z.`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function isStrictVersion(value: unknown): value is string {
  return typeof value === "string" && SEMVER.test(value);
}

/**
 * Detached RSA-SHA256 signature verification over the exact manifest bytes.
 * Must run before parsing or using any manifest content.
 */
export function verifyManifestSignature(
  manifestBytes: Uint8Array | string,
  signatureBytes: Uint8Array,
  publicKeyPem: string,
): void {
  const data =
    typeof manifestBytes === "string" ? Buffer.from(manifestBytes, "utf8") : manifestBytes;
  let accepted = false;
  try {
    accepted = cryptoVerify("sha256", data, publicKeyPem, signatureBytes);
  } catch {
    accepted = false;
  }
  if (!accepted) {
    // node:crypto `verify` enforces RSA-SHA256 over the exact bytes; the
    // openssl CLI path (`openssl dgst -sha256 -verify`) is used by the shell
    // bootstrap and is exercised against the same bytes in tests.
    throw new CapirCliError(
      "CAPIR_UPDATE_SIGNATURE_INVALID",
      EXIT.INFRASTRUCTURE,
      "Release manifest signature verification failed; nothing was downloaded or installed.",
    );
  }
}

const KNOWN_KEYS = new Set([
  "schema_version",
  "version",
  "tag",
  "source_commit",
  "node_version",
  "assets",
]);
const KNOWN_ASSET_KEYS = new Set(["platform", "filename", "url", "sha256", "size"]);

/**
 * Strict manifest parsing. Runs only after signature verification. Unknown
 * keys, extra platforms, duplicate platforms, wrong ordering, or any asset
 * whose filename/url does not bind version + platform + tag are rejected.
 *
 * `options.releaseBaseUrl` is an explicit transport binding dependency used
 * only by installer tests/mirrors; production always validates against the
 * immutable canonical GitHub release base. It is never read from any
 * environment variable.
 */
export function parseManifest(
  text: string,
  options: { releaseBaseUrl?: string } = {},
): ReleaseManifest {
  const releaseBaseUrl = options.releaseBaseUrl ?? RELEASE_BASE_URL;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw manifestError("The signed release manifest is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw manifestError("The signed release manifest must be a JSON object.");
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key))
      throw manifestError(`Unknown manifest key "${key}".`);
  }
  if (record.schema_version !== MANIFEST_SCHEMA_VERSION)
    throw manifestError(
      `Unsupported manifest schema version; expected ${MANIFEST_SCHEMA_VERSION}.`,
    );
  const version = record.version;
  if (!isStrictVersion(version))
    throw manifestError("Manifest version must be strict semver X.Y.Z.");
  const tag = record.tag;
  if (tag !== `capir-v${version}`)
    throw manifestError("Manifest tag must be the immutable release tag for its version.");
  const sourceCommit = record.source_commit;
  if (typeof sourceCommit !== "string" || !COMMIT_HEX.test(sourceCommit))
    throw manifestError("Manifest source_commit must be a full lowercase git commit id.");
  const nodeVersion = record.node_version;
  if (typeof nodeVersion !== "string" || !NODE_VERSION.test(nodeVersion))
    throw manifestError("Manifest node_version must be strict X.Y.Z.");
  const assets = record.assets;
  if (!Array.isArray(assets)) throw manifestError("Manifest assets must be an ordered array.");
  if (assets.length !== SUPPORTED_PLATFORMS.length)
    throw manifestError(
      `Manifest must carry exactly one asset per supported platform (${SUPPORTED_PLATFORMS.join(", ")}).`,
    );
  const parsed: ReleaseAsset[] = [];
  for (let index = 0; index < assets.length; index++) {
    const entry = assets[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw manifestError("Every manifest asset must be an object.");
    const asset = entry as Record<string, unknown>;
    for (const key of Object.keys(asset)) {
      if (!KNOWN_ASSET_KEYS.has(key))
        throw manifestError(`Unknown asset key "${key}".`);
    }
    const expectedPlatform = SUPPORTED_PLATFORMS[index]!;
    if (asset.platform !== expectedPlatform)
      throw manifestError(
        `Assets must be ordered ${SUPPORTED_PLATFORMS.join(", ")}; position ${index + 1} must be ${expectedPlatform}.`,
      );
    const expectedFilename = `capir-${version}-${expectedPlatform}.tar.gz`;
    if (asset.filename !== expectedFilename)
      throw manifestError(`Asset filename must be ${expectedFilename}.`);
    const expectedUrl = `${releaseBaseUrl}/download/${tag}/${expectedFilename}`;
    if (asset.url !== expectedUrl)
      throw manifestError(`Asset url must be the immutable release download URL ${expectedUrl}.`);
    if (typeof asset.sha256 !== "string" || !SHA256_HEX.test(asset.sha256))
      throw manifestError("Asset sha256 must be 64 lowercase hex characters.");
    if (typeof asset.size !== "number" || !Number.isInteger(asset.size) || asset.size <= 0)
      throw manifestError("Asset size must be a positive integer byte count.");
    parsed.push({
      platform: expectedPlatform,
      filename: expectedFilename,
      url: expectedUrl,
      sha256: asset.sha256,
      size: asset.size,
    });
  }
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    version,
    tag,
    source_commit: sourceCommit,
    node_version: nodeVersion,
    assets: parsed,
  };
}

/** Strict platform selection: no fallback, no emulation, no architecture guessing. */
export function selectAsset(manifest: ReleaseManifest, platform: string): ReleaseAsset {
  const asset = manifest.assets.find((entry) => entry.platform === platform);
  if (!asset) {
    throw new CapirCliError(
      "CAPIR_UPDATE_PLATFORM_UNSUPPORTED",
      EXIT.INFRASTRUCTURE,
      `Platform "${platform}" has no release asset. Supported platforms: ${SUPPORTED_PLATFORMS.join(", ")}. Windows is source-install only and has no native updater.`,
    );
  }
  return asset;
}
