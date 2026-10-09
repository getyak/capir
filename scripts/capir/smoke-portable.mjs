#!/usr/bin/env node
/**
 * Real portable-archive CLI smoke.
 *
 * Extracts a built archive through the UPDATER's own confined tar parser
 * (apps/cli/dist/update/tar.js — the same physical link-graph proof used at
 * install/update time), then runs the bundled runtime's CLI --version and
 * --help plus the native keyring smoke from a clean environment. Runs on
 * every release builder against the archive that will be published.
 *
 *   node scripts/capir/smoke-portable.mjs --archive build/capir/capir-0.2.0-linux-x64.tar.gz --version 0.2.0
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function smokeArchive(archivePath, expectedVersion) {
  const { extractTarGz } = await import(
    pathToFileURL(join(REPO_ROOT, "apps", "cli", "dist", "update", "tar.js")).href
  );
  const work = mkdtempSync(join(tmpdir(), "capir-smoke-"));
  try {
    const tree = join(work, "tree");
    mkdirSync(tree, { recursive: true });
    // The confined parser rejects escaping entries/links before writing.
    await extractTarGz(archivePath, tree);

    const node = join(tree, "node", "bin", "node");
    const cli = join(tree, "package", "dist", "cli.js");
    const smokeHome = join(work, "home");
    mkdirSync(smokeHome, { recursive: true, mode: 0o700 });
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: smokeHome,
      LANG: "C",
      TZ: "UTC",
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    };
    const run = (args) =>
      execFileSync(node, args, { cwd: tree, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const versionEnvelope = JSON.parse(run([cli, "--version"]));
    if (versionEnvelope.version !== expectedVersion)
      throw new Error(
        `archive CLI reports ${versionEnvelope.version} but the release declares ${expectedVersion}`,
      );
    const help = run([cli, "--help"]);
    if (help.trim().length === 0) throw new Error("archive CLI --help produced no output");
    const keyring = run([join(tree, "package", "dist", "update", "smokeEntry.js")]);
    if (!keyring.includes("keyring-ok")) throw new Error("native keyring smoke did not report ok");

    const buildInfo = JSON.parse(readFileSync(join(tree, "build-info.json"), "utf8"));
    if (buildInfo.version !== expectedVersion)
      throw new Error("build-info.json version does not match the release version");
    return { version: expectedVersion, buildInfo };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
  const values = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) values[argv[index].slice(2)] = argv[index + 1];
  smokeArchive(values.archive, values.version)
    .then(({ version, buildInfo }) => {
      process.stdout.write(
        `archive smoke ok: ${version} (${buildInfo.platform}, node ${buildInfo.node_version}, rev ${buildInfo.revision}, runtime ${buildInfo.runtime_source})\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
