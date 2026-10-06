#!/usr/bin/env node
/**
 * Release manifest tooling tests: canonical shape, RSA-SHA256 signing,
 * openssl CLI cross-verification, strict parsing (via the real updater
 * parser), and fail-closed signing without the private key environment.
 * Test keys are generated per run; the production private key never appears.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  buildManifest,
  generateTestKeyPair,
  signManifest,
  verifyManifest,
  SUPPORTED_PLATFORMS,
} from "./manifest.mjs";
import { parseManifest } from "../../apps/cli/dist/update/manifest.js";

const SCRIPT = fileURLToPath(new URL("./manifest.mjs", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "capir-manifest-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

const key = generateTestKeyPair();
const digestChars = { "darwin-arm64": "a", "darwin-x64": "b", "linux-arm64": "c", "linux-x64": "d" };
const assets = SUPPORTED_PLATFORMS.map((platform) => ({
  platform,
  sha256: digestChars[platform].repeat(64),
  size: 1024,
}));

describe("release manifest: canonical shape", () => {
  it("emits simple multi-line JSON with one key per line and derived urls", () => {
    const text = buildManifest({
      version: "0.2.0",
      sourceCommit: "a".repeat(40),
      nodeVersion: "22.23.2",
      assets,
    });
    for (const line of text.split("\n")) {
      if (line.trim() === "" || /^[\s{}[\],]*$/.test(line)) continue;
      assert.match(line, /^\s+"[a-z0-9_]+": /, `line is not one-key-per-line: ${line}`);
    }
    assert.match(text, /"tag": "capir-v0\.2\.0"/);
    assert.match(
      text,
      /"url": "https:\/\/github\.com\/getyak\/capir\/releases\/download\/capir-v0\.2\.0\/capir-0\.2\.0-darwin-arm64\.tar\.gz"/,
    );
    const parsed = parseManifest(text);
    assert.equal(parsed.version, "0.2.0");
    assert.equal(parsed.assets.length, 4);
    assert.deepEqual(parsed.assets.map((entry) => entry.platform), [...SUPPORTED_PLATFORMS]);
  });

  it("rejects malformed manifest fields at build time", () => {
    assert.throws(() => buildManifest({ version: "0.2", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets }), /semver/);
    assert.throws(() => buildManifest({ version: "0.2.0", sourceCommit: "short", nodeVersion: "22.23.2", assets }), /sourceCommit/);
    assert.throws(() => buildManifest({ version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets: assets.slice(1) }), /missing asset/);
    assert.throws(() => buildManifest({ version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets: assets.map((a) => ({ ...a, sha256: "zz" })) }), /sha256/);
  });
});

describe("release manifest: signing and verification", () => {
  it("verifies in node and under the openssl CLI (RSA-SHA256)", () => {
    const text = buildManifest({ version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets });
    const signature = signManifest(text, key.privateKeyPem);
    assert.equal(verifyManifest(text, signature, key.publicKeyPem), true);

    const manifestPath = join(work, "manifest.json");
    const sigPath = join(work, "manifest.json.sig");
    const keyPath = join(work, "trust.txt");
    writeFileSync(manifestPath, text);
    writeFileSync(sigPath, signature);
    writeFileSync(keyPath, key.publicKeyPem);
    const openssl = execFileSync(
      "openssl",
      ["dgst", "-sha256", "-verify", keyPath, "-signature", sigPath, manifestPath],
      { encoding: "utf8" },
    );
    assert.match(openssl, /Verified OK/);
  });

  it("rejects tampered manifest bytes and wrong keys", () => {
    const text = buildManifest({ version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets });
    const signature = signManifest(text, key.privateKeyPem);
    const tampered = text.replace("0.2.0", "0.2.1");
    assert.equal(verifyManifest(tampered, signature, key.publicKeyPem), false);
    const impostor = generateTestKeyPair();
    assert.equal(verifyManifest(text, signature, impostor.publicKeyPem), false);
    assert.throws(
      () => parseManifest(tampered),
      (error) => error.code === "CAPIR_UPDATE_SIGNATURE_INVALID" || error.code === "CAPIR_UPDATE_MANIFEST_INVALID",
    );
  });
});

describe("release manifest: strict parsing by the real updater parser", () => {
  const base = { version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets };

  it("rejects unknown keys, wrong order, wrong urls and version/tag mismatch", () => {
    const good = buildManifest(base);
    assert.doesNotThrow(() => parseManifest(good));

    assert.throws(() => parseManifest(good.replace('"tag":', '"extra": 1,\n  "tag":')), /Unknown manifest key/);
    assert.throws(
      () => parseManifest(good.replace("capir-v0.2.0/capir-0.2.0-darwin-arm64", "capir-v0.2.0/capir-0.2.1-darwin-arm64")),
      /immutable release download URL/,
    );
    assert.throws(() => parseManifest(good.replace('"tag": "capir-v0.2.0"', '"tag": "capir-v0.2.1"')), /release tag/);
    assert.throws(() => parseManifest(good.replace('"size": 1024', '"size": 0')), /byte count/);
    assert.throws(() => parseManifest(good.replace('"filename":', '"extra_key": "x",\n      "filename":')), /Unknown asset key/);
  });

  it("binds asset urls to the expected release base only via explicit dependency", () => {
    const mirror = buildManifest(base, { releaseBaseUrl: "https://mirror.example/releases" });
    assert.match(mirror, /https:\/\/mirror\.example\/releases\/download\/capir-v0\.2\.0\//);
    // The canonical parser accepts the mirror base only when told explicitly.
    assert.throws(() => parseManifest(mirror), /immutable release download URL/);
    assert.doesNotThrow(() => parseManifest(mirror, { releaseBaseUrl: "https://mirror.example/releases" }));
  });
});

describe("release manifest: signing CLI", () => {
  it("signs and verifies through the CLI and fails closed without the key", () => {
    const text = buildManifest({ version: "0.2.0", sourceCommit: "a".repeat(40), nodeVersion: "22.23.2", assets });
    const manifestPath = join(work, "cli-manifest.json");
    const sigPath = join(work, "cli-manifest.json.sig");
    const keyPath = join(work, "cli-trust.txt");
    writeFileSync(manifestPath, text);
    writeFileSync(keyPath, key.publicKeyPem);

    const refused = spawnSync(process.execPath, [SCRIPT, "sign", "--in", manifestPath, "--out", sigPath], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /CAPIR_RELEASE_SIGNING_KEY is required/);

    const signed = spawnSync(process.execPath, [SCRIPT, "sign", "--in", manifestPath, "--out", sigPath], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, CAPIR_RELEASE_SIGNING_KEY: key.privateKeyPem },
    });
    assert.equal(signed.status, 0, signed.stderr);

    const verified = spawnSync(
      process.execPath,
      [SCRIPT, "verify", "--in", manifestPath, "--sig", sigPath, "--key", keyPath],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /manifest signature verified/);
  });
});
