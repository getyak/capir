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
      resolve();
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

if (!(await runModelCli(process.argv.slice(2)))) {
const result = await runCli(process.argv.slice(2), {
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  credentialStore,
  testOperatorStore,
  testRunPasswordStore,
  openBrowser,
  interactive: Boolean(
    (process.stdin.isTTY && process.stdout.isTTY) || process.env.CAPIR_BROWSER_OPEN,
  ),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  journal: new OperationJournal(configDirectory(process.env)),
});

process.stdout.write(`${result.output}\n`);
process.exitCode = result.exitCode;

}

if (forceModelExit) process.exit(process.exitCode ?? 0);
