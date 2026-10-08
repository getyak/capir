#!/usr/bin/env node
/**
 * `capir` binary entry: real dependency wiring only.
 *
 * - Credentials come from the OS keyring (native @napi-rs/keyring API) bound
 *   to the exact configured origin pair, or from the ephemeral CAPIR_TOKEN
 *   environment variable which is never persisted.
 * - The system browser opener can be substituted with CAPIR_BROWSER_OPEN for
 *   owned test browsers; that substitution is a test/operations hook and is
 *   recorded as such in reports.
 * - The `update` family is routed BEFORE model parsing so no model ever
 *   receives update keywords. The bounded automatic update notice runs only
 *   after successful ordinary interactive commands (stderr only, managed
 *   installs only, never help/--version/doctor/update/--json/noninteractive).
 */
import { spawn } from "node:child_process";
import { configDirectory } from "./config.js";
import { OperationJournal } from "./journal.js";
import {
  createKeyringStore,
  environmentTokenStore,
  keyringUsername,
  type CredentialStore,
  type KeyringModule,
} from "./keyring.js";
import { runCli } from "./run.js";
import { runModelCli, forceModelExit } from "./model/run.js";
import {
  createRunPasswordStore,
  operatorCredentialStore,
  type RunPasswordStore,
} from "./testCredentials.js";
import {
  maybePrintUpdateNotice,
  updateNoticeEligible,
} from "./update/notice.js";
import type { CapirEnvironment } from "./config.js";

function openBrowser(url: string): Promise<void> {
  const substitute = process.env.CAPIR_BROWSER_OPEN?.trim();
  const [command, ...prefix] = substitute
    ? [substitute]
    : process.platform === "darwin"
      ? ["open"]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", ""]
        : ["xdg-open"];
  return new Promise((resolve, reject) => {
    const child = spawn(command!, [...prefix, url], {
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
    });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("The browser opener did not complete successfully."));
    });
    child.once("error", reject);
  });
}

async function loadKeyring(): Promise<KeyringModule | null> {
  try {
    return (await import("@napi-rs/keyring")) as unknown as KeyringModule;
  } catch {
    return null; // fail closed at use time; no plaintext fallback
  }
}

async function credentialStore(environment: CapirEnvironment): Promise<CredentialStore> {
  const token = process.env.CAPIR_TOKEN?.trim();
  if (token) return environmentTokenStore(token);
  return createKeyringStore(
    await loadKeyring(),
    keyringUsername(environment.backendOrigin, environment.webOrigin),
  );
}

/** Dedicated operator provisioning credential (never the human CAPIR_TOKEN). */
async function testOperatorStore(environment: CapirEnvironment): Promise<CredentialStore> {
  return operatorCredentialStore(process.env, await loadKeyring(), environment);
}

/** Run-specific password item for one exact operation namespace. */
async function testRunPasswordStore(account: string): Promise<RunPasswordStore> {
  return createRunPasswordStore(await loadKeyring(), account);
}

const UPDATE_NOTICE_VALUE_FLAGS = new Set([
  "profile", "model", "system", "max-tokens", "timeout", "provider",
  "base-url", "api-key-env", "auth", "token-limit-field", "system-role",
  "env", "server", "client-label", "username", "password", "expires-in", "preset",
  "request-id", "open", "receipt-dir", "wait", "role", "scenario",
  "model-policy", "duration-hours", "surface",
]);

/**
 * True when the invocation targets the `update` family. Value-aware leading
 * flag skipping mirrors model parsing so a flag VALUE of "update" (e.g.
 * `--env update`) never routes to the updater. Routed before any model parse.
 */
function updateRequested(argv: string[]): boolean {
  const rest = argv[0] === "--" ? argv.slice(1) : [...argv];
  let index = 0;
  while (index < rest.length && rest[index]!.startsWith("-")) {
    const token = rest[index]!;
    if (token === "--") break;
    index += UPDATE_NOTICE_VALUE_FLAGS.has(token.slice(2)) ? 2 : 1;
  }
  return rest[index] === "update";
}

const argv = process.argv.slice(2);

// Downstream pipes closing early (e.g. `| head`) are normal; never crash or
// write a stack trace into stderr for them.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const dependencies = {
  env: process.env,
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
  credentialStore,
  testOperatorStore,
  testRunPasswordStore,
  openBrowser,
  onAuthProgress:(message:string)=>{process.stderr.write(message);},
  interactive: Boolean(
    (process.stdin.isTTY && process.stdout.isTTY) || process.env.CAPIR_BROWSER_OPEN,
  ),
  sleep: (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  journal: new OperationJournal(configDirectory(process.env)),
};

if (updateRequested(argv)) {
  const result = await runCli(argv, dependencies);
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
} else if (!(await runModelCli(argv))) {
  const result = await runCli(argv, dependencies);
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}

// Bounded automatic update notice: stderr only, successful ordinary
// interactive commands only, never blocking longer than its own hard cap.
if ((process.exitCode ?? 0) === 0 && updateNoticeEligible(argv)) {
  await maybePrintUpdateNotice({
    env: process.env,
    fetchImpl: dependencies.fetchImpl as never,
    invokedBinary: process.argv[1] ?? "",
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
}

if (forceModelExit) process.exit(process.exitCode ?? 0);
