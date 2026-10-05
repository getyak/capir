/**
 * Automatic update notice tests: bounded check, 24h cache, eligibility
 * exclusions anywhere in argv, silent failure, deadline abort, and no
 * credential/model exposure. The trust key and transport are injected as
 * explicit dependencies (never an environment override).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { readVersion } from "../dist/version.js";
import {
  maybePrintUpdateNotice,
  updateNoticeEligible,
  UPDATE_CHECK_MAX_MS,
} from "../dist/update/notice.js";
import { fixtureTransport, testKeyPair } from "../../../scripts/capir/test-fixtures.mjs";
const { buildManifest, signManifest } = await import("../../../scripts/capir/manifest.mjs");

const key = testKeyPair();
const work = mkdtempSync(join(tmpdir(), "capir-notice-test-"));
const root = join(work, "share", "capir");
const invokedBinary = join(root, "versions", "9.0.0", "package", "dist", "cli.js");
const platform = `${process.platform}-${process.arch}`;

let freshManifest;
let freshSignature;

before(() => {
  mkdirSync(join(work, "cache"), { recursive: true });
  // Minimal managed install skeleton (strict metadata binding, launcher out).
  mkdirSync(join(root, "versions", "9.0.0", "package", "dist"), { recursive: true });
  writeFileSync(invokedBinary, "// fixture\n");
  symlinkSync(join("versions", "9.0.0"), join(root, "current"));
  const launcher = join(work, "bin", "capir");
  mkdirSync(join(work, "bin"), { recursive: true });
  writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(
    join(root, "state.json"),
    JSON.stringify({
      schema_version: "capir-install-state.v1",
      install_root: root,
      platform,
      launcher,
      current_version: "9.0.0",
      previous_version: null,
      versions: {
        "9.0.0": { sha256: "a".repeat(64), installed_at: "2026-10-01T00:00:00.000Z" },
      },
    }),
  );
  const digestChars = { "darwin-arm64": "a", "darwin-x64": "b", "linux-arm64": "c", "linux-x64": "d" };
  freshManifest = buildManifest({
    version: "9.1.0",
    sourceCommit: "a".repeat(40),
    nodeVersion: "22.23.2",
    assets: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((name) => ({
      platform: name,
      sha256: digestChars[name].repeat(64),
      size: 4096,
    })),
  });
  freshSignature = signManifest(freshManifest, key.privateKeyPem);
});

after(() => rmSync(work, { recursive: true, force: true }));

function noticeDeps(overrides = {}) {
  const notices = [];
  return {
    notices,
    deps: {
      env: {},
      fetchImpl: async () => new Response("not found", { status: 404 }),
      invokedBinary,
      interactive: true,
      platform,
      trustPublicKey: key.publicKeyPem,
      cachePath: join(work, "cache", `update-check-${Math.random().toString(36).slice(2)}.json`),
      writeStderr: (text) => notices.push(text),
      ...overrides,
    },
  };
}

describe("update notice: eligibility exclusions at any position", () => {
  it("suppresses the network check for excluded flags anywhere in argv", () => {
    const excluded = [
      ["help"],
      ["help", "update"],
      ["doctor"],
      ["doctor", "--json"],
      ["update"],
      ["update", "--check"],
      ["models", "list"],
      ["--version"],
      ["ask", "hello", "--json"], // trailing --json
      ["auth", "status", "--help"], // trailing --help
      ["auth", "login", "--noninteractive"], // trailing --noninteractive
      ["ask", "hello", "-h"],
      ["chat", "--human", "--json"],
      ["--json", "ask", "hello"],
      [],
    ];
    for (const argv of excluded) assert.equal(updateNoticeEligible(argv), false, argv.join(" "));
  });

  it("keeps ordinary interactive commands eligible and never mistakes flag values", () => {
    const eligible = [
      ["ask", "hello"],
      ["ask", "update the readme"], // literal prompt mentioning update
      ["chat"],
      ["auth", "login"],
      ["sandbox", "start", "--env", "test"],
      ["test", "create", "--env", "test"],
      ["ask", "--system", "--json"], // --json is --system's VALUE
      ["ask", "--model", "doctor"], // doctor as a model name value
    ];
    for (const argv of eligible) assert.equal(updateNoticeEligible(argv), true, argv.join(" "));
  });
});

describe("update notice: bounded check, cache and silence", () => {
  it("prints one stderr notice from a fresh cache without touching the network", async () => {
    const { notices, deps } = noticeDeps();
    writeFileSync(deps.cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest: "9.1.0",
      tag: "capir-v9.1.0",
    }));
    let called = 0;
    deps.fetchImpl = async () => {
      called += 1;
      return new Response("no", { status: 500 });
    };
    await maybePrintUpdateNotice(deps);
    assert.equal(called, 0);
    assert.equal(notices.length, 1);
    assert.ok(notices[0].includes("9.1.0"));
    assert.ok(notices[0].includes("capir update"));
  });

  it("prints nothing when the cached/latest version is the same or older", async () => {
    const current = readVersion();
    for (const latest of [current, "0.0.1"]) {
      const { notices, deps } = noticeDeps();
      writeFileSync(deps.cachePath, JSON.stringify({
        checked_at: new Date().toISOString(),
        latest,
        tag: `capir-v${latest}`,
      }));
      await maybePrintUpdateNotice(deps);
      assert.equal(notices.length, 0, `latest ${latest} must not notify`);
    }
  });

  it("checks the channel after cache TTL and caches the verified result", async () => {
    const { notices, deps } = noticeDeps();
    writeFileSync(deps.cachePath, JSON.stringify({
      checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latest: "8.0.0",
      tag: "capir-v8.0.0",
    }));
    const transport = fixtureTransport({
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json": freshManifest,
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig": freshSignature,
    });
    deps.fetchImpl = transport.fetchImpl;
    await maybePrintUpdateNotice(deps);
    assert.equal(notices.length, 1);
    assert.ok(notices[0].includes("9.1.0"));
    const cached = JSON.parse(readFileSync(deps.cachePath, "utf8"));
    assert.equal(cached.latest, "9.1.0");
    assert.equal(transport.pending.size, 0);
  });

  it("stays silent on offline failure and tampered signatures and writes no cache", async () => {
    for (const mode of ["offline", "tampered"]) {
      const { notices, deps } = noticeDeps();
      const transport = fixtureTransport({
        "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json": freshManifest,
        "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig":
          mode === "tampered" ? Buffer.from("not a signature") : freshSignature,
        ...(mode === "offline" ? {} : {}),
      });
      deps.fetchImpl = mode === "offline"
        ? async () => { throw new Error("network down"); }
        : transport.fetchImpl;
      await maybePrintUpdateNotice(deps);
      assert.equal(notices.length, 0);
      assert.equal(existsSync(deps.cachePath), false);
      assert.equal(transport.pending.size, 0);
    }
  });

  it("never auto-checks unmanaged installs or non-interactive commands", async () => {
    const unmanaged = noticeDeps({ invokedBinary: "/somewhere/apps/cli/dist/cli.js" });
    await maybePrintUpdateNotice(unmanaged.deps);
    assert.equal(unmanaged.notices.length, 0);

    const scripted = noticeDeps({ interactive: false });
    await maybePrintUpdateNotice(scripted.deps);
    assert.equal(scripted.notices.length, 0);
  });

  it("honors CAPIR_DISABLE_UPDATE_CHECK=1", async () => {
    const { notices, deps } = noticeDeps({ env: { CAPIR_DISABLE_UPDATE_CHECK: "1" } });
    writeFileSync(deps.cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest: "9.9.9",
      tag: "capir-v9.9.9",
    }));
    await maybePrintUpdateNotice(deps);
    assert.equal(notices.length, 0);
  });
});

describe("update notice: hard deadline aborts in-flight transport", () => {
  it("aborts a delayed signature request at the overall deadline and leaks nothing", async () => {
    const { notices, deps } = noticeDeps();
    const transport = fixtureTransport({
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json": freshManifest,
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig": {
        bytes: freshSignature,
        delayMs: 60_000, // never completes within the deadline
      },
    });
    deps.fetchImpl = transport.fetchImpl;
    const started = Date.now();
    await maybePrintUpdateNotice(deps);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < UPDATE_CHECK_MAX_MS + 500, `notice path took ${elapsed}ms`);
    assert.equal(notices.length, 0);
    // The delayed request is actually aborted: nothing stays pending.
    await new Promise((resolveDone) => setTimeout(resolveDone, 50));
    assert.equal(transport.pending.size, 0);
  });

  it("aborts a delayed manifest request the same way", async () => {
    const { notices, deps } = noticeDeps();
    const transport = fixtureTransport({
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json": {
        bytes: freshManifest,
        delayMs: 60_000,
      },
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig": freshSignature,
    });
    deps.fetchImpl = transport.fetchImpl;
    await maybePrintUpdateNotice(deps);
    await new Promise((resolveDone) => setTimeout(resolveDone, 50));
    assert.equal(notices.length, 0);
    assert.equal(transport.pending.size, 0);
  });
});

describe("update notice: no credential or model exposure", () => {
  it("never sends credentials and never writes them to stderr", async () => {
    const secret = "k".repeat(43);
    const { notices, deps } = noticeDeps({
      env: { CAPIR_TOKEN: secret, CAPIR_CONFIG_DIR: join(work, "config") },
    });
    writeFileSync(deps.cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest: "9.1.0",
      tag: "capir-v9.1.0",
    }));
    const seen = [];
    deps.fetchImpl = async (url, init = {}) => {
      seen.push({ url: String(url), init });
      return new Response("no", { status: 500 });
    };
    await maybePrintUpdateNotice(deps);
    for (const notice of notices) assert.ok(!notice.includes(secret));
    assert.equal(seen.length, 0, "fresh cache must not initiate any request");
    assert.equal(notices.length, 1);
  });
});
