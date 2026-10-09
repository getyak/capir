/**
 * Shared release fixtures for capir packaging and updater tests.
 *
 * Everything here builds REAL artifacts with real tools: the production
 * dependency closure comes from `pnpm deploy --legacy --prod`, archives are
 * produced with system tar (including its hardlink entries), and manifests
 * are canonical output of scripts/capir/manifest.mjs signed with a
 * TEST-ONLY keypair generated per run. Tests inject the trust key and the
 * transport explicitly as dependencies; production verification is never
 * weakened (there is no production trust override environment variable).
 *
 * The bundled runtime in fixtures is a shim that execs the local Node when it
 * is exactly version-compatible; release builds always use the official
 * download + SHASUMS256.txt path instead.
 */
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, signManifest } from "./manifest.mjs";
import { buildPortablePackage } from "./package-portable.mjs";
import { hostPlatform } from "./platforms.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Test-only RSA keypair; never used for production signing. */
export function testKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Minimal bundled-runtime stand-in: an executable bin/node shim that runs the
 * exact local Node, plus a LICENSE, so real CLI smokes execute real code.
 */
export function shimNodeDir(base) {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(join(base, "bin"), { recursive: true });
  writeFileSync(join(base, "bin", "node"), "#!/bin/sh\nexec /usr/bin/env node \"$@\"\n", {
    mode: 0o755,
  });
  writeFileSync(join(base, "LICENSE"), "fixture runtime license\n");
  return base;
}

function dummyDigest(char) {
  return char.repeat(64);
}

/**
 * Build one real fixture release for `version`: archive (via the production
 * builder with the shim runtime), canonical manifest and test-key signature.
 * Only the host platform carries the real archive; the other platforms are
 * structurally valid placeholders so strict manifest validation passes.
 */
export async function buildFixtureRelease({ version, key, outDir, mutateTree }) {
  mkdirSync(outDir, { recursive: true });
  const nodeDir = shimNodeDir(join(outDir, "shim-node"));
  const built = await buildPortablePackage({
    version,
    revision: "a".repeat(40),
    outDir,
    platform: hostPlatform(),
    nodeDir,
  });
  if (mutateTree) throw new Error("mutateTree is applied through buildFixtureTree callers only");
  const platform = hostPlatform();
  const digestChars = { "darwin-arm64": "a", "darwin-x64": "b", "linux-arm64": "c", "linux-x64": "d" };
  const assets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((name) =>
    name === platform
      ? { platform: name, sha256: built.sha256, size: built.size }
      : { platform: name, sha256: dummyDigest(digestChars[name]), size: 4096 },
  );
  const manifestText = buildManifest({
    version,
    sourceCommit: "a".repeat(40),
    nodeVersion: "22.23.2",
    assets,
  });
  const signature = signManifest(manifestText, key.privateKeyPem);
  return {
    version,
    platform,
    manifestText,
    signature,
    archivePath: built.archivePath,
    archiveBytes: readFileSync(built.archivePath),
    sha256: built.sha256,
    size: built.size,
    buildInfo: built.buildInfo,
  };
}

/** Canonical channel/asset URL shapes the fixtures serve over injected fetch. */
export function releaseUrls(version) {
  const platform = hostPlatform();
  return {
    channelManifest: "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json",
    channelSignature: "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig",
    archive: `https://github.com/getyak/capir/releases/download/capir-v${version}/capir-${version}-${platform}.tar.gz`,
  };
}

/**
 * fetch-compatible transport fixture: URL -> bytes with optional per-route
 * delay/signal handling. Records every request and which are still pending so
 * tests can prove no request outlives a deadline.
 */
export function fixtureTransport(routes) {
  const calls = [];
  const pending = new Set();
  const fetchImpl = async (url, init = {}) => {
    const key = String(url);
    calls.push(key);
    const entry = pending.add(key) && routes[key];
    try {
      if (!entry) {
        return new Response("not found", { status: 404 });
      }
      const body = typeof entry === "function" ? entry() : entry;
      const bytes = body.bytes ?? body;
      const delayMs = body.delayMs ?? 0;
      if (delayMs > 0) {
        await new Promise((resolveDone, reject) => {
          const timer = setTimeout(resolveDone, delayMs);
          init.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(bytes)) },
      });
    } finally {
      pending.delete(key);
    }
  };
  return { fetchImpl, calls, pending };
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileMode(path) {
  return statSync(path).mode & 0o777;
}

export function exists(path) {
  return existsSync(path);
}

export function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

export { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, join };
