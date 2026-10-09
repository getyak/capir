/**
 * Smoke verification of an extracted portable tree before it may be
 * published as a managed version.
 *
 * Everything runs with the bundled runtime from the tree itself and a clean
 * environment (a scratch HOME, no CAPIR_* variables, no credentials): the
 * new CLI must answer `--version` with exactly the expected version, answer
 * `--help` offline, and load its native keyring binding. A failing smoke
 * preserves the previous install and the staged tree is discarded.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapirCliError, EXIT } from "../errors.js";

export interface SmokeResult {
  version_output: string;
  help_bytes: number;
  keyring: "loaded";
}

interface SmokeOptions {
  timeoutMs?: number;
}

function smokeError(message: string): CapirCliError {
  return new CapirCliError("CAPIR_UPDATE_SMOKE_FAILED", EXIT.INFRASTRUCTURE, message);
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveDone, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(smokeError(`Smoke command timed out after ${timeoutMs}ms: ${args.join(" ")}`));
      else resolveDone({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Run the bundled CLI smoke against `tree` (a staged portable tree containing
 * `node/` and `package/`). `expectedVersion` must match both the signed
 * manifest and the CLI's own report.
 */
export async function smokePortableTree(
  tree: string,
  expectedVersion: string,
  options: SmokeOptions = {},
): Promise<SmokeResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const node = join(tree, "node", "bin", "node");
  const cli = join(tree, "package", "dist", "cli.js");
  const smokeHome = mkdtempSync(join(tmpdir(), "capir-smoke-home-"));
  // Clean environment: no CAPIR_* values, no tokens, no user configuration.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: smokeHome,
    TZ: process.env.TZ ?? "UTC",
    LANG: "C",
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  };

  try {
    const version = await run(node, [cli, "--version"], tree, env, timeoutMs);
    if (version.code !== 0)
      throw smokeError(
        `Bundled CLI --version exited ${version.code} in the staged tree: ${version.stderr.slice(0, 200)}`,
      );
    let reported: { version?: unknown };
    try {
      reported = JSON.parse(version.stdout) as { version?: unknown };
    } catch {
      throw smokeError("Bundled CLI --version did not print one JSON envelope.");
    }
    if (reported?.version !== expectedVersion)
      throw smokeError(
        `Bundled CLI reports version ${String(reported?.version)} but the release declares ${expectedVersion}.`,
      );
  
    const help = await run(node, [cli, "--help"], tree, env, timeoutMs);
    if (help.code !== 0 || help.stdout.trim().length === 0)
      throw smokeError(`Bundled CLI --help failed in the staged tree (exit ${help.code}).`);
  
    const keyring = await run(
      node,
      [join(tree, "package", "dist", "update", "smokeEntry.js")],
      tree,
      env,
      timeoutMs,
    );
    if (keyring.code !== 0 || !keyring.stdout.includes("keyring-ok"))
      throw smokeError(
        `Native keyring binding failed to load in the staged tree: ${keyring.stderr.slice(0, 200)}`,
      );
  
    return {
      version_output: version.stdout.trim(),
      help_bytes: Buffer.byteLength(help.stdout),
      keyring: "loaded",
    };
  } finally {
    rmSync(smokeHome, { recursive: true, force: true });
  }
}
