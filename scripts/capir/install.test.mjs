#!/usr/bin/env node
/**
 * install.sh bootstrap tests: real sh + curl + tar + openssl against a local
 * transport. The bootstrap runs as an ASYNC child so the in-process fixture
 * server can answer it. The production trust key is never weakened; each
 * fixture script carries a TEST-ONLY public key embedded exactly where
 * production embeds its committed key, and the transport is injected
 * explicitly via `--release-base-url`. Every failed bootstrap must write
 * nothing into the install root.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { buildManifest, signManifest } from "./manifest.mjs";
import { buildFixtureRelease } from "./test-fixtures.mjs";

const CLI_DIST = fileURLToPath(new URL("../../apps/cli/dist/cli.js", import.meta.url));

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

const key = keyPair();
const work = mkdtempSync(join(tmpdir(), "capir-install-test-"));
const platform = `${process.platform}-${process.arch}`;
const digestChars = { "darwin-arm64": "a", "darwin-x64": "b", "linux-arm64": "c", "linux-x64": "d" };
let fixtureScript;
let releaseA;
let releaseB;
let server;
let baseUrl;

before(async () => {
  // Fixture bootstrap: identical to production except for the embedded
  // TEST public key (explicit dependency substitution, no env override).
  const production = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
  const fixture = production.replace(
    /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/,
    key.publicKeyPem.trim(),
  );
  fixtureScript = join(work, "install.sh");
  writeFileSync(fixtureScript, fixture);
  releaseA = await buildFixtureRelease({ version: "9.0.0", key, outDir: join(work, "rel-a") });
  releaseB = await buildFixtureRelease({ version: "9.0.1", key, outDir: join(work, "rel-b") });

  server = createServer(() => {});
  await new Promise((resolveDone) => server.listen(0, "127.0.0.1", resolveDone));
  baseUrl = `http://127.0.0.1:${server.address().port}/releases`;
}, { timeout: 300_000 });

after(async () => {
  await new Promise((resolveDone) => server.close(resolveDone));
  try {
    execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      stdio: "pipe",
      env: { ...process.env, CI: "true" },
    });
  } catch {
    /* best effort restore of workspace node_modules state */
  }
  rmSync(work, { recursive: true, force: true });
});

function serve(routes) {
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const body = routes[request.url];
    if (!body) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-length": String(body.length) });
    response.end(body);
  });
}

function manifestFor({ release, version = release.version, sha256 = release.sha256, size = release.size, mutate }) {
  const text = buildManifest(
    {
      version,
      sourceCommit: "a".repeat(40),
      nodeVersion: "22.23.2",
      assets: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((name) => ({
        platform: name,
        sha256: name === platform ? sha256 : digestChars[name].repeat(64),
        size: name === platform ? size : 4096,
      })),
    },
    { releaseBaseUrl: baseUrl },
  );
  const finalText = mutate ? mutate(text) : text;
  return { text: finalText, signature: signManifest(finalText, key.privateKeyPem) };
}

function versionRoutes(release, manifest) {
  return {
    [`/releases/download/capir-v${release.version}/manifest.json`]: Buffer.from(manifest.text),
    [`/releases/download/capir-v${release.version}/manifest.json.sig`]: manifest.signature,
    [`/releases/download/capir-v${release.version}/capir-${release.version}-${platform}.tar.gz`]:
      release.archiveBytes,
  };
}

/** Async bootstrap run: the child never blocks the fixture server's loop. */
function runBootstrap({ root, binDir, extra = [] }) {
  return new Promise((resolveDone) => {
    const child = spawn(
      "sh",
      [
        fixtureScript,
        "--release-base-url", baseUrl,
        "--install-root", root,
        "--bin-dir", binDir,
        ...extra,
      ],
      {
        env: { PATH: process.env.PATH, HOME: work, TMPDIR: work },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    timer.unref();
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveDone({ status, stdout, stderr });
    });
  });
}

function runLauncher(binDir, args) {
  return new Promise((resolveDone) => {
    const child = spawn(join(binDir, "capir"), args, {
      env: { PATH: process.env.PATH, HOME: work },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (status) => resolveDone({ status, stdout, stderr }));
  });
}

function freshRoots(name) {
  const root = join(work, name, "capir");
  const binDir = join(work, name, "bin");
  mkdirSync(root, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  return { root, binDir };
}

describe("install.sh bootstrap: verified installation", () => {
  it("installs the signed immutable release selected with --version and runs the launcher directly", async () => {
    const { root, binDir } = freshRoots("happy");
    serve(versionRoutes(releaseA, manifestFor({ release: releaseA })));
    const result = await runBootstrap({ root, binDir, extra: ["--version", "9.0.0"] });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("capir installed 9.0.0"));

    for (const entry of ["node", "package", "LICENSES", "build-info.json"]) {
      assert.ok(existsSync(join(root, "versions", "9.0.0", entry)), entry);
    }
    const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
    assert.equal(state.current_version, "9.0.0");
    assert.equal(state.previous_version, null);
    assert.equal(state.platform, platform);

    // REAL direct exec of the launcher (shebang first, fixed root, no env).
    const launcher = join(binDir, "capir");
    assert.equal(readFileSync(launcher, "utf8").split("\n")[0], "#!/bin/sh");
    const run = await runLauncher(binDir, ["--version"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).version, "9.0.0");
  });

  it("defaults to the capir-stable channel and rejects non-semver --version", async () => {
    const { root, binDir } = freshRoots("stable");
    const manifest = manifestFor({ release: releaseA });
    serve({
      "/releases/download/capir-stable/manifest.json": Buffer.from(manifest.text),
      "/releases/download/capir-stable/manifest.json.sig": manifest.signature,
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: releaseA.archiveBytes,
    });
    const result = await runBootstrap({ root, binDir });
    assert.equal(result.status, 0, result.stderr);

    const bad = await runBootstrap({ root: freshRoots("badver").root, binDir: freshRoots("badver").binDir, extra: ["--version", "nope"] });
    assert.equal(bad.status, 2);
    assert.ok(bad.stderr.includes("strict semver"));
  });

  it("rejects a signed manifest whose version differs from --version", async () => {
    const { root, binDir } = freshRoots("vermismatch");
    // A 9.0.0 manifest served from the requested 9.0.1 immutable slot.
    const manifest = manifestFor({ release: releaseA });
    serve({
      "/releases/download/capir-v9.0.1/manifest.json": Buffer.from(manifest.text),
      "/releases/download/capir-v9.0.1/manifest.json.sig": manifest.signature,
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: releaseA.archiveBytes,
    });
    const result = await runBootstrap({ root, binDir, extra: ["--version", "9.0.1"] });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("does not match requested"));
    assert.equal(readdirSync(root).length, 0);
  });

  it("refuses an unrelated launcher by default and backs it up with --replace-existing", async () => {
    const { root, binDir } = freshRoots("launcher");
    serve(versionRoutes(releaseA, manifestFor({ release: releaseA })));
    assert.equal((await runBootstrap({ root, binDir, extra: ["--version", "9.0.0"] })).status, 0);

    const launcher = join(binDir, "capir");
    const custom = "#!/bin/sh\necho custom\n";
    writeFileSync(launcher, custom, { mode: 0o755 });

    const refused = await runBootstrap({ root, binDir, extra: ["--version", "9.0.0"] });
    assert.equal(refused.status, 3, refused.stderr);
    assert.ok(refused.stderr.includes("CAPIR_UPDATE_LAUNCHER_CONFLICT"));
    assert.equal(readFileSync(launcher, "utf8"), custom);

    const replaced = await runBootstrap({ root, binDir, extra: ["--version", "9.0.0", "--replace-existing"] });
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.ok(readFileSync(launcher, "utf8").includes("capir managed launcher"));
    const backups = readdirSync(binDir).filter((name) => name.startsWith("capir.capir-backup-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(binDir, backups[0]), "utf8"), custom);
  });
});

describe("install.sh bootstrap: verification failures install nothing", () => {
  it("rejects a manifest without a valid signature BEFORE parsing", async () => {
    const { root, binDir } = freshRoots("badsig");
    const impostor = keyPair();
    const { text } = manifestFor({ release: releaseA });
    serve({
      "/releases/download/capir-stable/manifest.json": Buffer.from(text),
      "/releases/download/capir-stable/manifest.json.sig": signManifest(text, impostor.privateKeyPem),
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: releaseA.archiveBytes,
    });
    const result = await runBootstrap({ root, binDir });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("manifest signature verification FAILED"));
    assert.equal(readdirSync(root).length, 0);
  });

  it("rejects a tampered archive body against the signed sha256", async () => {
    const { root, binDir } = freshRoots("badsha");
    const tampered = Buffer.from(releaseA.archiveBytes);
    tampered[tampered.length - 3] ^= 0xff;
    const manifest = manifestFor({ release: releaseA });
    serve({
      "/releases/download/capir-stable/manifest.json": Buffer.from(manifest.text),
      "/releases/download/capir-stable/manifest.json.sig": manifest.signature,
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: tampered,
    });
    const result = await runBootstrap({ root, binDir });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("archive sha256 does not match the signed manifest"));
    assert.equal(readdirSync(root).length, 0);
  });

  it("rejects an asset filename that does not bind version and platform", async () => {
    const { root, binDir } = freshRoots("badname");
    const manifest = manifestFor({
      release: releaseA,
      mutate: (t) => t.replaceAll(`capir-9.0.0-${platform}.tar.gz`, `capir-9.0.0-${platform}-evil.tar.gz`),
    });
    serve({
      "/releases/download/capir-stable/manifest.json": Buffer.from(manifest.text),
      "/releases/download/capir-stable/manifest.json.sig": manifest.signature,
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: releaseA.archiveBytes,
    });
    const result = await runBootstrap({ root, binDir });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("manifest asset filename must be"));
    assert.equal(readdirSync(root).length, 0);
  });

  it("rejects the symlink write-through archive in the preflight and extracts nothing", async () => {
    const { root, binDir } = freshRoots("attack");
    const attackPath = join(work, "attack.tar.gz");
    execFileSync("python3", ["-c", `
import tarfile, io, sys
with tarfile.open(sys.argv[1], "w:gz") as tf:
    d = tarfile.TarInfo("package/"); d.type = tarfile.DIRTYPE; d.mode = 0o755; tf.addfile(d)
    a = tarfile.TarInfo("package/a"); a.type = tarfile.SYMTYPE; a.linkname = ".."; tf.addfile(a)
    b = tarfile.TarInfo("package/b"); b.type = tarfile.SYMTYPE; b.linkname = "a/.."; tf.addfile(b)
    p = tarfile.TarInfo("package/b/pwn"); p.size = 6; p.mode = 0o644; tf.addfile(p, io.BytesIO(b"pwned\\n"))
`, attackPath]);
    const attackBytes = readFileSync(attackPath);
    const manifest = manifestFor({
      release: releaseA,
      sha256: createHash("sha256").update(attackBytes).digest("hex"),
      size: attackBytes.length,
    });
    serve({
      "/releases/download/capir-stable/manifest.json": Buffer.from(manifest.text),
      "/releases/download/capir-stable/manifest.json.sig": manifest.signature,
      [`/releases/download/capir-v9.0.0/capir-9.0.0-${platform}.tar.gz`]: attackBytes,
    });
    const result = await runBootstrap({ root, binDir });
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes("confinement preflight failed"), `stderr: ${result.stderr}`);
    assert.equal(readdirSync(root).length, 0);
    assert.equal(existsSync(join(work, "pwn")), false);
    assert.equal(existsSync(join(work, "package")), false);
  });
});

describe("standalone two-release acceptance: install.sh A -> update B -> rollback", () => {
  it("updates a bootstrap-installed copy to B and rolls back with the real updater", async () => {
    const { root, binDir } = freshRoots("acceptance");
    serve(versionRoutes(releaseA, manifestFor({ release: releaseA })));
    assert.equal((await runBootstrap({ root, binDir, extra: ["--version", "9.0.0"] })).status, 0);
    assert.equal((await runLauncher(binDir, ["--version"])).stdout.includes("9.0.0"), true);

    // capir update A -> B over the fixture channel with the test trust key.
    const { runCli } = await import("../../apps/cli/dist/run.js");
    const { fixtureTransport, releaseUrls } = await import("./test-fixtures.mjs");
    const urlsB = releaseUrls("9.0.1");
    const transportB = fixtureTransport({
      [urlsB.channelManifest]: releaseB.manifestText,
      [urlsB.channelSignature]: releaseB.signature,
      [urlsB.archive]: releaseB.archiveBytes,
    });
    const updateDeps = {
      env: {},
      fetchImpl: transportB.fetchImpl,
      credentialStore: async () => {
        throw new Error("update must never load credentials");
      },
      openBrowser: async () => {
        throw new Error("update must never open a browser");
      },
      interactive: false,
      sleep: async () => {},
      invokedBinary: join(root, "versions", "9.0.0", "package", "dist", "cli.js"),
      update: { trustPublicKey: key.publicKeyPem, lockTimeoutMs: 5000, requestTimeoutMs: 20000 },
    };
    const updated = await runCli(["update", "--json"], updateDeps);
    assert.equal(updated.exitCode, 0, updated.output);
    assert.equal(JSON.parse(updated.output).action, "updated");
    const runB = await runLauncher(binDir, ["--version"]);
    assert.equal(JSON.parse(runB.stdout).version, "9.0.1");

    const rolled = await runCli(["update", "--rollback", "--json"], {
      ...updateDeps,
      invokedBinary: join(root, "versions", "9.0.1", "package", "dist", "cli.js"),
    });
    assert.equal(rolled.exitCode, 0, rolled.output);
    assert.equal(JSON.parse(rolled.output).action, "rolled-back");
    const runBack = await runLauncher(binDir, ["--version"]);
    assert.equal(JSON.parse(runBack.stdout).version, "9.0.0");
    assert.ok(existsSync(join(root, "versions", "9.0.0")));
    assert.ok(existsSync(join(root, "versions", "9.0.1")));
  }, { timeout: 300_000 });
});


describe("bootstrap bounded streaming", () => {
  it("rejects an oversized chunked manifest before touching the install root", async () => {
    const { root, binDir } = freshRoots("chunked-overflow");
    server.removeAllListeners("request");
    server.on("request", (_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.end(Buffer.alloc(262144 + 65536, 120));
    });
    const result = await runBootstrap({ root, binDir });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /byte cap|download failed/);
    assert.deepEqual(readdirSync(root), []);
    assert.deepEqual(readdirSync(binDir), []);
    assert.ok(!readdirSync(work).some(name => name.startsWith("capir-install.")), "private downloads cleaned");
  });
});
