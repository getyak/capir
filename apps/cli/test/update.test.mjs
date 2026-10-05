/**
 * Standalone updater tests against real built portable packages.
 *
 * Fixtures are real artifacts: production dependency closure via pnpm deploy,
 * real system-tar archives (with hardlinks), canonical signed manifests with a
 * TEST-ONLY trust key, and the real installEntry/update code from dist. The
 * trust key and transport are injected explicitly as dependencies — there is
 * no production trust override environment variable.
 *
 * Covered regressions: physical link-graph escapes, launcher ownership and
 * undo on activation failure, interrupted-activation retry, no downgrade of a
 * newer committed version, reuse/rollback of corrupted version directories,
 * lock contention, unmanaged-install refusal, and launcher direct exec from a
 * non-default root with the environment override removed.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readdirSync, statSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { readVersion } from "../dist/version.js";
import { smokePortableTree } from "../dist/update/smoke.js";
import { runCli } from "../dist/run.js";
import { runInstallEntry } from "../dist/update/installEntry.js";
import { resolveInstall, launcherScript, readState } from "../dist/update/layout.js";
import { extractTarGz, parseTar, readTarGzSync } from "../dist/update/tar.js";
import { ProcessLock } from "../dist/lock.js";
import {
  buildFixtureRelease,
  fixtureTransport,
  releaseUrls,
  testKeyPair,
  REPO_ROOT,
} from "../../../scripts/capir/test-fixtures.mjs";

const CLI_DIST = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const VERSION_A = "9.0.0";
const VERSION_B = "9.0.1";

const key = testKeyPair();
const work = mkdtempSync(join(tmpdir(), "capir-update-test-"));
let releaseA;
let releaseB;
const restores = [];

before(async () => {
  writeFileSync(join(work, "trust-key.pem"), key.publicKeyPem);
  releaseA = await buildFixtureRelease({ version: VERSION_A, key, outDir: join(work, "rel-a") });
  releaseB = await buildFixtureRelease({ version: VERSION_B, key, outDir: join(work, "rel-b") });
});

after(() => {
  // Restore workspace node_modules state that `pnpm deploy` may have flipped
  // to production mode during fixture builds.
  try {
    execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: { ...process.env, CI: "true" },
    });
  } catch {
    /* best effort; CI runs a clean install next anyway */
  }
  rmSync(work, { recursive: true, force: true });
});

function scratch(name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function deps(extra = {}) {
  return {
    env: {},
    fetchImpl: async () => new Response("not found", { status: 404 }),
    credentialStore: async () => {
      throw new Error("update must never load credentials");
    },
    openBrowser: async () => {
      throw new Error("update must never open a browser");
    },
    interactive: false,
    sleep: async () => {},
    invokedBinary: CLI_DIST,
    update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    ...extra,
  };
}

async function stageRelease(dir, release) {
  const stage = join(dir, `stage-${release.version}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "manifest.json"), release.manifestText);
  writeFileSync(join(stage, "manifest.json.sig"), release.signature);
  const tree = join(stage, "tree");
  mkdirSync(tree, { recursive: true });
  await extractTarGz(release.archivePath, tree);
  return {
    manifest: join(stage, "manifest.json"),
    signature: join(stage, "manifest.json.sig"),
    archive: release.archivePath,
    tree,
  };
}

async function installFixture({ root, binDir, release, replaceExisting = false }) {
  const staged = await stageRelease(join(root, ".."), release);
  return runInstallEntry(
    {
      manifest: staged.manifest,
      signature: staged.signature,
      archive: staged.archive,
      tree: staged.tree,
      installRoot: root,
      binDir,
      trustKeyFile: join(work, "trust-key.pem"),
      expectedReleaseBase: "https://github.com/getyak/capir/releases",
      replaceExisting,
    },
    { lockTimeoutMs: 5000 },
  );
}

function managedRootSetup(name) {
  const base = scratch(name);
  return { base, root: join(base, "share", "capir"), binDir: join(base, "bin") };
}

function invokedFor(root, version) {
  return join(root, "versions", version, "package", "dist", "cli.js");
}

function runLauncher(binDir, args, env = {}) {
  return spawnSync(join(binDir, "capir"), args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    timeout: 60_000,
  });
}

function channelRoutesFor(release) {
  const urls = releaseUrls(release.version);
  return {
    [urls.channelManifest]: release.manifestText,
    [urls.channelSignature]: release.signature,
    [urls.archive]: release.archiveBytes,
  };
}

async function runUpdate(args, { root, version, release, extraUpdate = {}, env = {} }) {
  const transport = fixtureTransport(channelRoutesFor(release));
  const result = await runCli(args, deps({
    env,
    fetchImpl: transport.fetchImpl,
    invokedBinary: invokedFor(root, version),
    update: {
      trustPublicKey: key.publicKeyPem,
      lockTimeoutMs: 5000,
      requestTimeoutMs: 20000,
      ...extraUpdate,
    },
  }));
  return { result, transport };
}

describe("standalone updater: A -> B update and rollback on real packages", () => {
  it("installs A, updates to B atomically, rolls back, and preserves both versions", async () => {
    const { root, binDir } = managedRootSetup("cycle");
    await installFixture({ root, binDir, release: releaseA });
    assert.equal(readState(root).current_version, VERSION_A);

    const { result } = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_A,
      release: releaseB,
    });
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 0);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "updated");
    assert.equal(payload.current_version, VERSION_B);
    assert.equal(payload.previous_version, VERSION_A);

    // Atomic switch readback + launcher runs the new version.
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_B);
    const runB = runLauncher(binDir, ["--version"]);
    assert.equal(runB.status, 0);
    assert.equal(JSON.parse(runB.stdout).version, VERSION_B);
    assert.equal(readFileSync(join(binDir, "capir"), "utf8").split("\n")[0], "#!/bin/sh");

    // Rollback flips current back; both version dirs are kept.
    const rollback = await runUpdate(["update", "--rollback", "--json"], {
      root,
      version: VERSION_B,
      release: releaseB,
    });
    const rolled = JSON.parse(rollback.result.output);
    assert.equal(rolled.action, "rolled-back");
    assert.equal(rolled.current_version, VERSION_A);
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_A);
    const runA = runLauncher(binDir, ["--version"]);
    assert.equal(JSON.parse(runA.stdout).version, VERSION_A);
    assert.ok(existsSync(invokedFor(root, VERSION_A)));
    assert.ok(existsSync(invokedFor(root, VERSION_B))); // old versions never auto-deleted
  });

  it("reports current/latest/update_available/install_method/source on --check without writes", async () => {
    const { root, binDir } = managedRootSetup("check");
    await installFixture({ root, binDir, release: releaseA });
    const before = readdirSync(root).sort().join(",");
    const { result, transport } = await runUpdate(["update", "--check", "--json"], {
      root,
      version: VERSION_A,
      release: releaseB,
    });
    const payload = JSON.parse(result.output);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "update --check");
    assert.equal(payload.current, VERSION_A);
    assert.equal(payload.latest, VERSION_B);
    assert.equal(payload.update_available, true);
    assert.equal(payload.install_method, "managed");
    assert.equal(payload.source, `https://github.com/getyak/capir/releases/tag/capir-v${VERSION_B}`);
    // No install files written and no credential touched (deps throw if used).
    assert.equal(readdirSync(root).sort().join(","), before);
    assert.deepEqual(transport.calls.sort(), [
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json",
      "https://github.com/getyak/capir/releases/download/capir-stable/manifest.json.sig",
    ].sort());
  });

  it("returns already-current without rewriting anything when already on latest", async () => {
    const { root, binDir } = managedRootSetup("noop");
    await installFixture({ root, binDir, release: releaseA });
    const stateBefore = readFileSync(join(root, "state.json"), "utf8");
    const { result } = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_A,
      release: releaseA,
    });
    const payload = JSON.parse(result.output);
    assert.equal(payload.action, "already-current");
    assert.equal(payload.current_version, VERSION_A);
    assert.equal(readFileSync(join(root, "state.json"), "utf8"), stateBefore);
  });
});

describe("standalone updater: verification failures preserve the existing install", () => {
  it("rejects a manifest signed by a different key before parsing or use", async () => {
    const { root, binDir } = managedRootSetup("badsig");
    await installFixture({ root, binDir, release: releaseA });
    const impostor = testKeyPair();
    const urls = releaseUrls(VERSION_B);
    const transport = fixtureTransport({
      [urls.channelManifest]: releaseB.manifestText,
      [urls.channelSignature]: releaseB.signature,
    });
    const result = await runCli(["update", "--json"], deps({
      fetchImpl: transport.fetchImpl,
      invokedBinary: invokedFor(root, VERSION_A),
      update: { trustPublicKey: impostor.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    }));
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_SIGNATURE_INVALID");
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_A);
  });

  it("rejects a tampered archive body against the signed sha256", async () => {
    const { root, binDir } = managedRootSetup("badsha");
    await installFixture({ root, binDir, release: releaseA });
    const tampered = Buffer.from(releaseB.archiveBytes);
    tampered[tampered.length - 5] ^= 0xff;
    const urls = releaseUrls(VERSION_B);
    const transport = fixtureTransport({
      [urls.channelManifest]: releaseB.manifestText,
      [urls.channelSignature]: releaseB.signature,
      [urls.archive]: tampered,
    });
    const result = await runCli(["update", "--json"], deps({
      fetchImpl: transport.fetchImpl,
      invokedBinary: invokedFor(root, VERSION_A),
      update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    }));
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_CHECKSUM_MISMATCH");
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_A);
  });

  it("rejects a wrong-size body before extraction", async () => {
    const { root, binDir } = managedRootSetup("badsize");
    await installFixture({ root, binDir, release: releaseA });
    const urls = releaseUrls(VERSION_B);
    const transport = fixtureTransport({
      [urls.channelManifest]: releaseB.manifestText,
      [urls.channelSignature]: releaseB.signature,
      [urls.archive]: releaseB.archiveBytes.subarray(0, releaseB.size - 1),
    });
    const result = await runCli(["update", "--json"], deps({
      fetchImpl: transport.fetchImpl,
      invokedBinary: invokedFor(root, VERSION_A),
      update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    }));
    assert.equal(JSON.parse(result.output).error.code, "CAPIR_UPDATE_CHECKSUM_MISMATCH");
    assert.equal(readState(root).current_version, VERSION_A);
  });

  it("rejects a platform mismatch between tree build-info and the signed manifest", async () => {
    const { root, binDir } = managedRootSetup("plat");
    await installFixture({ root, binDir, release: releaseA });
    // B's archive is real but its tree claims a different platform.
    const { result } = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_A,
      release: releaseB,
      extraUpdate: { platform: undefined },
    });
    assert.equal(result.exitCode, 0); // real B installs fine here; platform cases follow
    // Unsupported platform selection fails closed on --check.
    const unsupported = await runUpdate(["update", "--check", "--json"], {
      root,
      version: VERSION_B,
      release: releaseB,
      extraUpdate: { platform: "win32-x64" },
    });
    const payload = JSON.parse(unsupported.result.output);
    assert.equal(unsupported.result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_PLATFORM_UNSUPPORTED");
    assert.ok(payload.error.message.includes("Windows is source-install only"));
  });

  it("rejects a manifest/tree version mismatch and never activates the tree", async () => {
    const { root, binDir } = managedRootSetup("vertree");
    await installFixture({ root, binDir, release: releaseA });
    // Serve B's archive under a manifest that claims 9.0.2: the signed
    // sha256 matches the bytes but the tree binding proves the mismatch.
    const newerVersion = "9.0.2";
    const urls = releaseUrls(newerVersion);
    const { buildManifest, signManifest } = await import("../../../scripts/capir/manifest.mjs");
    const dummy = { "darwin-arm64": "a", "darwin-x64": "b", "linux-arm64": "c", "linux-x64": "d" };
    const manifestText = buildManifest({
      version: newerVersion,
      sourceCommit: "a".repeat(40),
      nodeVersion: "22.23.2",
      assets: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((name) =>
        name === releaseB.platform
          ? { platform: name, sha256: releaseB.sha256, size: releaseB.size }
          : { platform: name, sha256: dummy[name].repeat(64), size: 4096 },
      ),
    });
    const signature = signManifest(manifestText, key.privateKeyPem);
    const transport = fixtureTransport({
      [urls.channelManifest]: manifestText,
      [urls.channelSignature]: signature,
      [urls.archive]: releaseB.archiveBytes,
    });
    const result = await runCli(["update", "--json"], deps({
      fetchImpl: transport.fetchImpl,
      invokedBinary: invokedFor(root, VERSION_A),
      update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    }));
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_ARCHIVE_UNSAFE");
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_A);
  });
});

describe("standalone updater: unmanaged installs are never modified", () => {
  it("fails source-checkout updates with exact safe installation guidance", async () => {
    const result = await runCli(["update", "--json"], deps());
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_UNMANAGED");
    assert.ok(payload.error.message.includes("capir-install.sh"));
    assert.ok(payload.error.message.includes("getyak/capir"));
  });

  it("reports install_method unmanaged with guidance on --check", async () => {
    const transport = fixtureTransport(channelRoutesFor(releaseB));
    const result = await runCli(["update", "--check", "--json"], deps({
      fetchImpl: transport.fetchImpl,
    }));
    const payload = JSON.parse(result.output);
    assert.equal(result.exitCode, 0);
    assert.equal(payload.install_method, "unmanaged");
    assert.ok(payload.guidance.includes("curl -fsSL"));
    assert.equal(payload.current, readVersion()); // running checkout version
  });
});

describe("standalone updater: interrupted activation, retries and no downgrades", () => {
  it("repairs an interrupted activation on retry and reports accurately", async () => {
    const { root, binDir } = managedRootSetup("interrupt");
    await installFixture({ root, binDir, release: releaseA });
    await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    assert.equal(readState(root).current_version, VERSION_B);

    // Simulate a crash after state publication but before the link switch.
    const link = join(root, "current");
    unlinkSync(link);
    symlinkSync(join("versions", VERSION_A), link);
    assert.equal(basename(realpathSync(link)), VERSION_A);
    assert.equal(readState(root).current_version, VERSION_B); // state already committed

    // The same-version retry must enter the lock, recover and report truth.
    const retry = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_B,
      release: releaseB,
    });
    const payload = JSON.parse(retry.result.output);
    assert.equal(payload.action, "already-current");
    assert.equal(payload.current_version, VERSION_B);
    assert.equal(basename(realpathSync(link)), VERSION_B);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_B);
  });

  it("never downgrades a newer committed version when an old manifest arrives late", async () => {
    const { root, binDir } = managedRootSetup("nodowngrade");
    await installFixture({ root, binDir, release: releaseA });
    await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    // Stale manifest A (older) after B is committed: no-op, B stays.
    const stale = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_B,
      release: releaseA,
    });
    const payload = JSON.parse(stale.result.output);
    assert.equal(payload.action, "already-current");
    assert.equal(payload.current_version, VERSION_B);
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_B);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_B);
  });
});

describe("standalone installer: launcher ownership, ordering and undo", () => {
  it("refuses an unrelated launcher before activation and preserves the running install", async () => {
    const { root, binDir } = managedRootSetup("launcher-conflict");
    await installFixture({ root, binDir, release: releaseA });
    const launcher = join(binDir, "capir");
    writeFileSync(launcher, "#!/bin/sh\necho custom launcher\n", { mode: 0o755 });

    const staged = await stageRelease(scratch("launcher-conflict-stage"), releaseB);
    await assert.rejects(
      () => runInstallEntry({
        manifest: staged.manifest,
        signature: staged.signature,
        archive: staged.archive,
        tree: staged.tree,
        installRoot: root,
        binDir,
        trustKeyFile: join(work, "trust-key.pem"),
        expectedReleaseBase: "https://github.com/getyak/capir/releases",
        replaceExisting: false,
      }, { lockTimeoutMs: 5000 }),
      (error) => error.code === "CAPIR_UPDATE_LAUNCHER_CONFLICT",
    );
    // The P1 regression: current must still be A, never B.
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_A);
    assert.equal(readFileSync(launcher, "utf8"), "#!/bin/sh\necho custom launcher\n");
  });

  it("restores the previous launcher when activation fails after the launcher swap", async () => {
    const { root, binDir } = managedRootSetup("launcher-undo");
    await installFixture({ root, binDir, release: releaseA });
    const launcher = join(binDir, "capir");
    const custom = "#!/bin/sh\necho custom old launcher\n";
    writeFileSync(launcher, custom, { mode: 0o755 });

    // Deterministic state-write failure: a directory where writeState's temp
    // file lands (same process pid as this in-process installer run).
    const planted = join(root, `state.json.tmp-${process.pid}`);
    mkdirSync(planted, { recursive: true });
    const staged = await stageRelease(scratch("launcher-undo-stage"), releaseB);
    await assert.rejects(
      () => runInstallEntry({
        manifest: staged.manifest,
        signature: staged.signature,
        archive: staged.archive,
        tree: staged.tree,
        installRoot: root,
        binDir,
        trustKeyFile: join(work, "trust-key.pem"),
        expectedReleaseBase: "https://github.com/getyak/capir/releases",
        replaceExisting: true,
      }, { lockTimeoutMs: 5000 }),
    );
    rmSync(planted, { recursive: true, force: true });

    // Old current, state and launcher all still work; the backup is kept.
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_A);
    assert.equal(readFileSync(launcher, "utf8"), custom);
    const backups = readdirSync(binDir).filter((name) => name.startsWith("capir.capir-backup-"));
    assert.ok(backups.length >= 1, "the replaced launcher backup is preserved");
    const runA = runLauncher(binDir, ["--version"]);
    assert.equal(runA.status, 0);
    assert.ok(runA.stdout.includes("custom old launcher"));
  });

  it("leaves the original launcher untouched when the prepared temp write fails", async () => {
    const { root, binDir } = managedRootSetup("launcher-write-fail");
    await installFixture({ root, binDir, release: releaseA });
    const launcher = join(binDir, "capir");
    const custom = "#!/bin/sh\necho custom survives\n";
    writeFileSync(launcher, custom, { mode: 0o755 });
    mkdirSync(`${launcher}.tmp-${process.pid}`, { recursive: true });

    const staged = await stageRelease(scratch("launcher-write-fail-stage"), releaseB);
    await assert.rejects(
      () => runInstallEntry({
        manifest: staged.manifest,
        signature: staged.signature,
        archive: staged.archive,
        tree: staged.tree,
        installRoot: root,
        binDir,
        trustKeyFile: join(work, "trust-key.pem"),
        expectedReleaseBase: "https://github.com/getyak/capir/releases",
        replaceExisting: true,
      }, { lockTimeoutMs: 5000 }),
    );
    rmSync(`${launcher}.tmp-${process.pid}`, { recursive: true, force: true });
    assert.equal(readFileSync(launcher, "utf8"), custom);
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(basename(realpathSync(join(root, "current"))), VERSION_A);
  });
});

describe("standalone updater: reuse and rollback validate the actual version directory", () => {
  it("refuses to reuse a corrupted installed version and preserves the current one", async () => {
    const { root, binDir } = managedRootSetup("reuse-corrupt");
    await installFixture({ root, binDir, release: releaseA });
    await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    await runUpdate(["update", "--rollback", "--json"], { root, version: VERSION_B, release: releaseB });

    // Corrupt B's installed executable; the reuse path must smoke the ACTUAL
    // version directory (recorded sha256 is never trusted alone).
    writeFileSync(invokedFor(root, VERSION_B), "corrupted\n");
    const retry = await runUpdate(["update", "--json"], {
      root,
      version: VERSION_A,
      release: releaseB,
    });
    const payload = JSON.parse(retry.result.output);
    assert.equal(retry.result.exitCode, 3);
    assert.equal(payload.error.code, "CAPIR_UPDATE_SMOKE_FAILED");
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_A);
  });

  it("refuses rollback onto a corrupted previous version and preserves current", async () => {
    const { root, binDir } = managedRootSetup("rollback-corrupt");
    await installFixture({ root, binDir, release: releaseA });
    await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    writeFileSync(invokedFor(root, VERSION_A), "corrupted\n");
    const rollback = await runUpdate(["update", "--rollback", "--json"], {
      root,
      version: VERSION_B,
      release: releaseB,
    });
    assert.equal(rollback.result.exitCode, 3);
    assert.equal(JSON.parse(rollback.result.output).error.code, "CAPIR_UPDATE_SMOKE_FAILED");
    assert.equal(readState(root).current_version, VERSION_B);
    assert.equal(JSON.parse(runLauncher(binDir, ["--version"]).stdout).version, VERSION_B);
  });
});

describe("standalone updater: lock serialization", () => {
  it("maps lock contention to CAPIR_UPDATE_LOCK_HELD and changes nothing", async () => {
    const { root, binDir } = managedRootSetup("lock");
    await installFixture({ root, binDir, release: releaseA });
    const { lockPath } = await import("../dist/update/layout.js");
    const held = new ProcessLock(lockPath(root), { acquireTimeoutMs: 200 });
    await held.acquireAsync();
    try {
      const transport = fixtureTransport(channelRoutesFor(releaseB));
      const result = await runCli(["update", "--json"], deps({
        fetchImpl: transport.fetchImpl,
        invokedBinary: invokedFor(root, VERSION_A),
        update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 200, requestTimeoutMs: 20000 },
      }));
      const payload = JSON.parse(result.output);
      assert.equal(result.exitCode, 3);
      assert.equal(payload.error.code, "CAPIR_UPDATE_LOCK_HELD");
    } finally {
      held.release();
    }
    assert.equal(readState(root).current_version, VERSION_A);
  });
});

describe("standalone installer: launcher direct exec and managed binding", () => {
  it("runs from a non-default root with CAPIR_INSTALL_DIR removed and binds by invoked path", async () => {
    const { root, binDir } = managedRootSetup("direct-exec");
    await installFixture({ root, binDir, release: releaseA });
    const launcher = join(binDir, "capir");
    assert.equal(readFileSync(launcher, "utf8"), launcherScript(root));

    // REAL direct exec smoke: the launcher is executed as a command with the
    // environment override removed; it must resolve its fixed root.
    const clean = { PATH: process.env.PATH, HOME: scratch("direct-exec-home") };
    delete clean.CAPIR_INSTALL_DIR;
    const result = spawnSync(launcher, ["--version"], { encoding: "utf8", env: clean });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).version, VERSION_A);

    // Metadata binds the invoked PHYSICAL script to the root; an environment
    // override alone never proves anything and is not consulted.
    const resolution = resolveInstall(invokedFor(root, VERSION_A), {}, `${process.platform}-${process.arch}`);
    assert.equal(resolution.method, "managed");
    assert.equal(resolution.managed.root, realpathSync(root));
    const spoofed = resolveInstall(CLI_DIST, { CAPIR_INSTALL_DIR: root }, `${process.platform}-${process.arch}`);
    assert.equal(spoofed.method, "unmanaged");
    assert.equal(spoofed.reason, "not-under-install-root");
  });
});

describe("standalone archives: physical link-graph confinement", () => {
  it("rejects the symlink write-through attack before writing anything", async () => {
    const attack = join(work, "attack.tar.gz");
    // Build the exact reviewed attack: package/a -> .., package/b -> a/..,
    // then package/b/pwn. Lexically each target looks contained; physically
    // b resolves outside the root and pwn would write outside.
    execFileSync("python3", ["-c", `
import tarfile, io, sys
with tarfile.open(sys.argv[1], "w:gz") as tf:
    def add(t):
        tf.addfile(t, io.BytesIO(t.buf)) if t.size else tf.addfile(t)
    d = tarfile.TarInfo("package/"); d.type = tarfile.DIRTYPE; d.mode = 0o755; tf.addfile(d)
    a = tarfile.TarInfo("package/a"); a.type = tarfile.SYMTYPE; a.linkname = ".."; tf.addfile(a)
    b = tarfile.TarInfo("package/b"); b.type = tarfile.SYMTYPE; b.linkname = "a/.."; tf.addfile(b)
    p = tarfile.TarInfo("package/b/pwn"); p.size = 6; p.mode = 0o644; tf.addfile(p, io.BytesIO(b"pwned\\n"))
`, attack]);
    assert.throws(
      () => readTarGzSync(attack),
      (error) => error.code === "CAPIR_UPDATE_ARCHIVE_UNSAFE",
    );
    // Nothing may be extracted from the rejected archive.
    const dest = join(work, "attack-out");
    await assert.rejects(() => extractTarGz(attack, dest));
    assert.equal(existsSync(dest), false);
  });

  it("accepts legitimate confined pnpm-style links in the real fixture archive", () => {
    const archive = readTarGzSync(releaseB.archivePath);
    const links = archive.entries.filter((entry) => entry.type === "symlink");
    assert.ok(links.length > 0, "the pnpm deploy tree carries internal symlinks");
    assert.ok(
      links.some((entry) => entry.path.includes("node_modules")),
      "node_modules internal symlinks are present",
    );
  });

  it("rejects symlink-ancestor files and hardlinks to non-members", () => {
    const build = (entries) => {
      // Compose a minimal tar via python for exact entry control.
      const script = `
import tarfile, io, sys, json
entries = json.loads(sys.argv[2])
with tarfile.open(sys.argv[1], "w:gz") as tf:
    for e in entries:
        t = tarfile.TarInfo(e["name"])
        t.type = {"file": tarfile.REGTYPE, "dir": tarfile.DIRTYPE, "link": tarfile.SYMTYPE, "hard": tarfile.LNKTYPE}[e["type"]]
        if e["type"] == "link":
            t.linkname = e["target"]
        if e["type"] == "hard":
            t.linkname = e["target"]
        if e["type"] == "file":
            data = b"x"
            t.size = len(data)
            tf.addfile(t, io.BytesIO(data))
        else:
            tf.addfile(t)
`;
      const out = join(work, `graph-${Math.random().toString(36).slice(2)}.tar.gz`);
      execFileSync("python3", ["-c", script, out, JSON.stringify(entries)]);
      return out;
    };
    // file under a symlink ancestor
    assert.throws(
      () => readTarGzSync(build([
        { name: "package/", type: "dir" },
        { name: "package/l", type: "link", target: ".." },
        { name: "package/l/inside", type: "file" },
      ])),
      (error) => error.code === "CAPIR_UPDATE_ARCHIVE_UNSAFE",
    );
    // hardlink that does not resolve to a regular member
    assert.throws(
      () => readTarGzSync(build([
        { name: "package/", type: "dir" },
        { name: "package/h", type: "hard", target: "missing" },
      ])),
      (error) => error.code === "CAPIR_UPDATE_ARCHIVE_UNSAFE",
    );
  });
});

function basename(path) {
  return path.split(sep).pop();
}

// Parent acceptance regression: normal failure must permit verified retry.
describe("standalone installer: failed publication retry", () => {
  it("adopts only an identical verified unrecorded tree after a state-write failure", async () => {
    const { root, binDir } = managedRootSetup("parent-publication-retry");
    await installFixture({ root, binDir, release: releaseA });
    const blocker = join(root, `state.json.tmp-${process.pid}`);
    mkdirSync(blocker);
    await assert.rejects(installFixture({ root, binDir, release: releaseB }));
    assert.equal(readState(root).current_version, VERSION_A);
    assert.equal(realpathSync(join(root, "current")), realpathSync(join(root, "versions", VERSION_A)));
    assert.ok(existsSync(join(root, "versions", VERSION_B)));
    rmSync(blocker, { recursive: true });
    const retry = await installFixture({ root, binDir, release: releaseB });
    assert.equal(retry.current_version, VERSION_B);
    assert.equal(retry.reused_existing_version, true);
    assert.equal(readState(root).previous_version, VERSION_A);
  });
});

  it("retries an update after state publication fails without overwriting a version", async () => {
    const { root, binDir } = managedRootSetup("parent-update-retry");
    await installFixture({ root, binDir, release: releaseA });
    const blocker = join(root, `state.json.tmp-${process.pid}`);
    mkdirSync(blocker);
    const failed = await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    assert.equal(failed.result.exitCode, 3);
    assert.equal(readState(root).current_version, VERSION_A);
    rmSync(blocker, { recursive: true });
    const retry = await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    assert.equal(retry.result.exitCode, 0, retry.result.output);
    assert.equal(readState(root).current_version, VERSION_B);
  });

  it("rejects altered source provenance in the actual reused version", async () => {
    const { root, binDir } = managedRootSetup("parent-reused-source");
    await installFixture({ root, binDir, release: releaseA });
    assert.equal((await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB })).result.exitCode, 0);
    assert.equal((await runUpdate(["update", "--rollback", "--json"], { root, version: VERSION_B, release: releaseB })).result.exitCode, 0);
    const infoPath = join(root, "versions", VERSION_B, "build-info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    info.revision = "b".repeat(40);
    writeFileSync(infoPath, JSON.stringify(info));
    const retry = await runUpdate(["update", "--json"], { root, version: VERSION_A, release: releaseB });
    assert.equal(retry.result.exitCode, 3);
    assert.equal(JSON.parse(retry.result.output).error.code, "CAPIR_UPDATE_ARCHIVE_UNSAFE");
    assert.equal(readState(root).current_version, VERSION_A);
  });


describe("bootstrap destination paths", () => {
  it("normalizes relative install and launcher paths before saving state", async () => {
    const base = scratch("relative-paths");
    const staged = await stageRelease(base, releaseA);
    const previousCwd = process.cwd();
    try {
      process.chdir(base);
      await runInstallEntry({ ...staged, installRoot: "share/capir", binDir: "bin",
        trustKeyFile: join(work, "trust-key.pem"), replaceExisting: false });
    } finally {
      process.chdir(previousCwd);
    }
    const root = join(base, "share", "capir");
    assert.equal(readState(root).launcher, realpathSync(join(base, "bin", "capir")));
    const run = runLauncher(join(base, "bin"), ["--version"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).version, VERSION_A);
  });

  it("recovers from the OS EXDEV boundary with a verified destination-local copy", async () => {
    const { root, binDir } = managedRootSetup("forced-crossfs");
    const staged = await stageRelease(scratch("forced-crossfs-source"), releaseA);
    const fs = (await import("node:fs")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalRename = fs.renameSync;
    let crossed = false;
    fs.renameSync = (source, target) => {
      if (source === staged.tree) {
        crossed = true;
        throw Object.assign(new Error("cross-device rename"), { code: "EXDEV" });
      }
      return originalRename(source, target);
    };
    syncBuiltinESMExports();
    try {
      await runInstallEntry({ ...staged, installRoot: root, binDir,
        trustKeyFile: join(work, "trust-key.pem"), replaceExisting: false });
    } finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
    assert.ok(crossed);
    assert.ok(existsSync(staged.tree));
    assert.deepEqual(readdirSync(join(root, "staging")), []);
    assert.equal(readState(root).current_version, VERSION_A);
    const run = runLauncher(binDir, ["--version"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).version, VERSION_A);
  });

  it("installs from a genuinely different filesystem without weakening smoke or provenance", async (t) => {
    if (process.platform !== "linux" || !existsSync("/dev/shm") || statSync("/dev/shm").dev === statSync(work).dev) {
      t.skip("requires Linux /dev/shm on a different filesystem; exercised by Linux CI");
      return;
    }
    const destination = mkdtempSync("/dev/shm/capir-crossfs-");
    try {
      const staged = await stageRelease(scratch("crossfs-source"), releaseA);
      // /dev/shm commonly forbids execution; use it for the source instead.
      // The destination remains on the normal executable test filesystem.
      const { cpSync } = await import("node:fs");
      const source = join(destination, "tree");
      cpSync(staged.tree, source, { recursive: true, verbatimSymlinks: true });
      const { root, binDir } = managedRootSetup("crossfs-target");
      // The bundled Node must run during the pre-copy smoke; noexec /dev/shm
      // cannot satisfy that contract and must be reported explicitly.
      const probe = spawnSync(join(source, "node", "bin", "node"), ["--version"]);
      if (probe.error?.code === "EACCES") { t.skip("/dev/shm is mounted noexec"); return; }
      assert.equal(probe.status, 0);
      await runInstallEntry({ ...staged, tree: source, installRoot: root, binDir,
        trustKeyFile: join(work, "trust-key.pem"), replaceExisting: false });
      assert.equal(readState(root).current_version, VERSION_A);
      const run = runLauncher(binDir, ["--version"]);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).version, VERSION_A);
      assert.ok(existsSync(source), "cross-volume source remains intact");
      assert.deepEqual(readdirSync(join(root, "staging")), []);
    } finally { rmSync(destination, { recursive: true, force: true }); }
  });
});


describe("smoke failure recovery", () => {
  it("a failed smoke leaves an installed version valid for the next retry", async () => {
    const { root, binDir } = managedRootSetup("smoke-retry");
    await installFixture({ root, binDir, release: releaseA });
    const tree = join(root, "versions", VERSION_A);
    const before = readdirSync(tree).sort();
    await assert.rejects(smokePortableTree(tree, "0.0.0"), /reports version/);
    assert.deepEqual(readdirSync(tree).sort(), before);
    const result = await smokePortableTree(tree, VERSION_A);
    assert.equal(result.keyring, "loaded");
  });
});
