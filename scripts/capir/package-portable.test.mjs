#!/usr/bin/env node
/**
 * Portable packaging tests: official Node runtime provenance (real download
 * and SHASUMS256.txt verification), production dependency closure, license
 * collection, confined link graph, build-info contents, and a REAL relocated
 * archive smoke executed through the updater's own confined extractor.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, lstatSync, realpathSync, readlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { verifyAgainstShasums, fetchNodeRuntime, nodeArchiveName, DEFAULT_NODE_VERSION } from "./node-runtime.mjs";
import { buildPortablePackage } from "./package-portable.mjs";
import { hostPlatform, RUNNERS, SUPPORTED_PLATFORMS } from "./platforms.mjs";
import { smokeArchive } from "./smoke-portable.mjs";


const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "capir-package-test-"));
after(async () => {
  // `pnpm deploy` flips the shared workspace node_modules state; restore it.
  try {
    execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      stdio: "pipe",
      env: { ...process.env, CI: "true" },
    });
  } catch {
    /* best effort; CI starts from a clean install */
  }
  rmSync(work, { recursive: true, force: true });
});

describe("official Node runtime provenance", () => {
  it("verifies archives against SHASUMS256.txt and rejects mismatches", () => {
    const archive = join(work, "fake-node.tar.gz");
    const bytes = Buffer.from("not really a node archive");
    writeFileSync(archive, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.throws(() => nodeArchiveName(hostPlatform(), "../../untrusted"), /invalid Node runtime version/);
    const filename = nodeArchiveName(hostPlatform(), DEFAULT_NODE_VERSION);
    const shasums = `${digest}  ${filename}\n`;
    assert.equal(verifyAgainstShasums(archive, shasums, filename).sha256, digest);
    assert.throws(() => verifyAgainstShasums(archive, `deadbeef${"0".repeat(56)}  ${filename}\n`, filename), /sha256 mismatch/);
    assert.throws(() => verifyAgainstShasums(archive, shasums, "other.tar.gz"), /exactly once/);
    assert.throws(
      () => verifyAgainstShasums(archive, `${digest}  ${filename}\n${digest}  ${filename}\n`, filename),
      /exactly once/,
    );
  });

  it("rejects a downloaded runtime whose digest the official SHASUMS do not cover", async () => {
    const archiveBytes = Buffer.from("pretend runtime");
    const filename = nodeArchiveName(hostPlatform(), DEFAULT_NODE_VERSION);
    const fetchImpl = async (url) => {
      const body = String(url).endsWith("SHASUMS256.txt")
        ? Buffer.from(`${"a".repeat(64)}  ${filename}\n`)
        : archiveBytes;
      return new Response(body, { status: 200 });
    };
    await assert.rejects(
      () => fetchNodeRuntime({
        platform: hostPlatform(),
        outDir: join(work, "node-runtime-bad"),
        fetchImpl,
      }),
      /sha256 mismatch/,
    );
    assert.deepEqual(readdirSync(join(work, "node-runtime-bad")), [], "rejected bytes never reach disk");
  });
});

describe("portable package: real official-runtime build and relocated smoke", () => {
  it("builds with the official Node runtime and smokes the relocated archive", async () => {
    const outDir = join(work, "official");
    mkdirSync(outDir, { recursive: true });
    // No --node-dir: the official download + SHASUMS256.txt path (the only
    // one a release build may use).
    const built = await buildPortablePackage({
      version: "9.9.9",
      revision: "b".repeat(40),
      outDir,
      platform: hostPlatform(),
    });

    assert.equal(built.filename, `capir-9.9.9-${hostPlatform()}.tar.gz`);
    assert.equal(built.buildInfo.runtime_source, "official-nodejs.org");
    assert.equal(built.buildInfo.node_version, DEFAULT_NODE_VERSION);
    assert.equal(built.buildInfo.revision, "b".repeat(40));
    assert.equal(built.buildInfo.platform, hostPlatform());

    // Independent digest recheck of the published archive.
    assert.equal(
      createHash("sha256").update(readFileSync(built.archivePath)).digest("hex"),
      built.sha256,
    );

    // REAL relocated archive smoke: extracted to a fresh tree and executed
    // through the updater's confined parser.
    const smoke = await smokeArchive(built.archivePath, "9.9.9");
    assert.equal(smoke.buildInfo.runtime_source, "official-nodejs.org");

    // The bundled runtime really is the official one and carries its LICENSE.
    const runtimeHome = join(work, "official-runtime-check");
    mkdirSync(runtimeHome, { recursive: true });
    execFileSync("tar", ["-xzf", built.archivePath, "-C", runtimeHome], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const nodeVersion = execFileSync(join(runtimeHome, "node", "bin", "node"), ["--version"], { encoding: "utf8" }).trim();
    assert.equal(nodeVersion, `v${DEFAULT_NODE_VERSION}`);
    assert.ok(existsSync(join(runtimeHome, "node", "LICENSE")));
    assert.ok(existsSync(join(runtimeHome, "LICENSES", "node-LICENSE")));
    assert.ok(readdirSync(join(runtimeHome, "LICENSES")).length > 2, "dependency licenses are bundled");

    // Runtime internal symlinks (npm/corepack) stay relative and confined.
    const runtimeDir = join(runtimeHome, "node");
    const runtimeRoot = resolve(runtimeDir);
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        const full = join(directory, name);
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(full);
          assert.ok(!target.startsWith("/"), `runtime symlink ${full} must stay relative: ${target}`);
          const resolved = resolve(full, "..", target);
          assert.ok(
            resolved === runtimeRoot || resolved.startsWith(runtimeRoot + sep),
            `runtime symlink ${full} escapes`,
          );
        } else if (stat.isDirectory()) {
          walk(full);
        }
      }
    };
    walk(runtimeDir);
  }, { timeout: 900_000 });
});

describe("portable package: deployment policy", () => {
  it("keeps the package private with a dist-only files whitelist", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "cli", "package.json"), "utf8"));
    assert.equal(manifest.private, true, "the npm package stays private (no npm publishing)");
    assert.deepEqual(manifest.files, ["dist"], "portable deployment ships dist only");
    assert.equal(manifest.bin.capir, "./dist/cli.js");
  });

  it("pins the monorepo pnpm version for reproducible production deploys", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(manifest.packageManager, "pnpm@11.18.0");
    const actual = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
    assert.equal(actual, "11.18.0");
  });

  it("maps every supported platform to a known hosted runner label", () => {
    assert.deepEqual([...SUPPORTED_PLATFORMS], ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    for (const platform of SUPPORTED_PLATFORMS) {
      assert.ok(RUNNERS[platform], `missing runner for ${platform}`);
    }
  });
});
