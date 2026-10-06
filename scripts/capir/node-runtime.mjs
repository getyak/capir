#!/usr/bin/env node
/**
 * Official Node runtime acquisition for portable capir packages.
 *
 * The release builder downloads the OFFICIAL Node.js archive for the target
 * platform and verifies it against the official SHASUMS256.txt before any
 * extraction, so the bundled runtime has demonstrated provenance. Local
 * verification runs may reuse an unpacked runtime only when the caller passes
 * `--node-dir` explicitly (tests reuse the exact local Node version); the
 * final release build always goes through the download + SHASUMS path.
 *
 *   node scripts/capir/node-runtime.mjs fetch \
 *     --platform darwin-arm64 --node-version 22.23.2 --out build/node-runtime
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_PLATFORMS } from "./platforms.mjs";

export const NODE_DIST_BASE = "https://nodejs.org/dist";
export const DEFAULT_NODE_VERSION = "22.23.2";

const ARCHIVE_NAMES = {
  "darwin-arm64": (v) => `node-v${v}-darwin-arm64.tar.gz`,
  "darwin-x64": (v) => `node-v${v}-darwin-x64.tar.gz`,
  "linux-arm64": (v) => `node-v${v}-linux-arm64.tar.gz`,
  "linux-x64": (v) => `node-v${v}-linux-x64.tar.gz`,
};

export function nodeArchiveName(platform, nodeVersion) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) throw new Error(`unsupported platform ${platform}`);
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error("invalid Node runtime version");
  return ARCHIVE_NAMES[platform](nodeVersion);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Verify one archive against the official SHASUMS256.txt text: the exact
 * filename must appear with exactly one sha256 line and the digest must match.
 */
export function verifyAgainstShasums(archivePath, shasumsText, filename) {
  return verifyRuntimeBytes(readFileSync(archivePath), shasumsText, filename);
}

function verifyRuntimeBytes(archiveBytes, shasumsText, filename) {
  const lines = shasumsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const matches = lines.filter((line) => {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
    return match && match[2] === filename;
  });
  if (matches.length !== 1)
    throw new Error(`SHASUMS256.txt must name ${filename} exactly once; found ${matches.length}`);
  const expected = /^([0-9a-f]{64})/.exec(matches[0])[1];
  const actual = createHash("sha256").update(archiveBytes).digest("hex");
  if (actual !== expected)
    throw new Error(`Node archive sha256 mismatch for ${filename}: expected ${expected}, got ${actual}`);
  return { sha256: actual, expected };
}

/**
 * Download the official Node archive + SHASUMS256.txt over HTTPS, verify the
 * provenance, and extract the runtime to <out>/node. Returns the archive
 * digest so the package's build-info can record runtime provenance.
 */
export async function fetchNodeRuntime({
  platform,
  nodeVersion = DEFAULT_NODE_VERSION,
  outDir,
  fetchImpl = fetch,
  timeoutMs = 600_000,
}) {
  const filename = nodeArchiveName(platform, nodeVersion);
  const base = `${NODE_DIST_BASE}/v${nodeVersion}`;
  mkdirSync(outDir, { recursive: true });
  const download = async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`download failed (${response.status}) for ${url}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const shasumsText = (await download(`${base}/SHASUMS256.txt`)).toString("utf8");
  const archiveBytes = await download(`${base}/${filename}`);
  const archivePath = join(outDir, filename);
  const { sha256 } = verifyRuntimeBytes(archiveBytes, shasumsText, filename);
  // Intentional runtime download: requested URLs use the fixed official HTTPS
  // origin; exact filename/version and SHA256 are checked before disk writes.
  writeFileSync(archivePath, archiveBytes); // lgtm[js/http-to-file-access] Verified official Node runtime; intentional download.
  const nodeDir = extractNodeArchive(archivePath, outDir);
  return { archivePath, sha256, shasumsText, nodeDir, filename };
}

/**
 * Extract an official Node archive and return the runtime directory. The
 * official layout is one top-level node-v<version>-<platform>/ directory.
 */
export function extractNodeArchive(archivePath, outDir) {
  const stage = join(outDir, `extract-${process.pid}-${Date.now()}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", stage], { stdio: "pipe" });
  const entries = readdirSync(stage);
  if (entries.length !== 1 || !entries[0].startsWith("node-v"))
    throw new Error(`unexpected official Node archive layout: ${entries.join(", ")}`);
  const nodeDir = join(outDir, "node");
  rmSync(nodeDir, { recursive: true, force: true });
  renameSync(join(stage, entries[0]), nodeDir);
  rmSync(stage, { recursive: true, force: true });
  if (!existsSync(join(nodeDir, "bin", "node")))
    throw new Error("official Node archive has no bin/node");
  if (!existsSync(join(nodeDir, "LICENSE")))
    throw new Error("official Node archive has no LICENSE; portable packages must carry it");
  return nodeDir;
}

/** Copy a caller-provided runtime (local verification runs only). */
export function reuseNodeRuntime(nodeDir) {
  if (!statSync(join(nodeDir, "bin", "node")).isFile())
    throw new Error(`--node-dir ${nodeDir} has no executable bin/node`);
  return nodeDir;
}

function main(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    values[rest[index].slice(2)] = rest[index + 1];
  }
  if (command !== "fetch") {
    process.stderr.write("usage: node-runtime.mjs fetch --platform <p> --node-version <v> --out <dir>\n");
    process.exit(2);
  }
  fetchNodeRuntime({
    platform: values.platform,
    nodeVersion: values["node-version"] ?? DEFAULT_NODE_VERSION,
    outDir: values.out,
  })
    .then(({ sha256, filename }) => {
      process.stdout.write(`fetched and verified ${filename} sha256=${sha256}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
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
  main(process.argv.slice(2));
}
