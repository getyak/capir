/**
 * Command dispatch for the `capir` CLI.
 *
 * All side effects happen behind `RunDependencies` so the deterministic test
 * suites can exercise the real argument, journal, credential and envelope code
 * with injected transports. stdout is exactly one JSON document (or `--human`
 * text); every failure is a stable redacted error envelope.
 */
import { readFileSync } from "node:fs";
import { parseArgs, validateRequestShape } from "./args.js";
import { configDirectory, resolveEnvironment, type CapirEnvironment } from "./config.js";
import { CapirCliError, EXIT, type ExitCode } from "./errors.js";
import { OperationJournal } from "./journal.js";
import {
  createCredentialTxn,
  credentialMutexPath,
  keyringUsername,
  missingCredentialStore,
  KEYRING_SERVICE,
  type CredentialStore,
  type CredentialTxn,
} from "./keyring.js";
import type { FetchLike } from "./http.js";
import {
  failureEnvelope,
  renderHuman,
  successEnvelope,
  type FailureEnvelope,
  type SuccessEnvelope,
} from "./output.js";
import { machineHelpPayload, renderGlobalHelp, USAGE } from "./help.js";
import { runAuthLogin } from "./login.js";
import { runAuthLogout, runAuthStatus } from "./auth.js";
import {
  runSandboxStart,
  runSandboxStatus,
  runSandboxStop,
  type SandboxDeps,
} from "./sandbox.js";
import {
  runTestCreate,
  runTestStatus,
  runTestStop,
  type TestCommandResult,
  type TestDeps,
} from "./test.js";
import { CapirTestProvisioningClient } from "@talent-signal/contracts";
import {
  createRunPasswordStore,
  type RunPasswordStore,
} from "./testCredentials.js";
import { renderTestHelp } from "./testHelp.js";
import type { RunnerLaunchMessage, RunnerReceipt } from "./runner.js";

export interface RunDependencies {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  credentialStore(environment: CapirEnvironment): Promise<CredentialStore> | CredentialStore;
  /** Origin-pair credential mutation boundary; built around credentialStore by default. */
  credentialTxn?: (
    environment: CapirEnvironment,
    store: CredentialStore,
  ) => Promise<CredentialTxn> | CredentialTxn;
  /** Dedicated operator provisioning credential (distinct from CAPIR_TOKEN). */
  testOperatorStore?: (
    environment: CapirEnvironment,
  ) => Promise<CredentialStore> | CredentialStore;
  /** Run-specific password item bound to the exact operation namespace. */
  testRunPasswordStore?: (
    account: string,
  ) => Promise<RunPasswordStore> | RunPasswordStore;
  readStdin?: () => Promise<string>;
  openBrowser(url: string): Promise<void>;
  interactive: boolean;
  sleep(ms: number): Promise<void>;
  spawnRunner?: (
    message: RunnerLaunchMessage,
    options?: { receiptTimeoutMs?: number },
  ) => Promise<RunnerReceipt>;
  journal?: OperationJournal;
}

export interface RunResult {
  exitCode: ExitCode | number;
  output: string;
}

function commandLabel(argv: string[]): string {
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  const [first, second] = rest;
  if (!first || first.startsWith("-")) return "help";
  const candidate = second ? `${first} ${second}` : first;
  const known = new Set([
    "help",
    "auth login",
    "auth status",
    "auth logout",
    "sandbox start",
    "sandbox status",
    "sandbox stop",
    "test create",
    "test status",
    "test stop",
  ]);
  if (known.has(candidate)) return candidate;
  return first === "test" ? "test" : "capir";
}

export function readVersion(): string {
  try {
    return (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        version: string;
      }
    ).version;
  } catch {
    return "0.0.0";
  }
}

export async function runCli(argv: string[], dependencies: RunDependencies): Promise<RunResult> {
  const label = commandLabel(argv);
  const env = dependencies.env;
  let human = argv.includes("--human");
  try {
    const args = parseArgs(argv);
    human = args.human;
    if (args.version) {
      return finish(
        successEnvelope("capir", { version: readVersion(), usage_summary: USAGE.summary }),
        human,
      );
    }
    if (args.help || args.command === "help") {
      // Offline help: readable by default, `--json` for machine callers. It
      // never resolves an environment, reads stdin, loads a credential, uses
      // the network or writes a journal — hostile-looking flags included.
      const path = args.helpPath;
      if (args.json) {
        const payload = path
          ? { help: JSON.parse(renderTestHelp(path, "json")) as Record<string, unknown> }
          : machineHelpPayload();
        return finish(successEnvelope("help", payload), false);
      }
      return {
        exitCode: EXIT.SUCCESS,
        output: path ? renderTestHelp(path, "human") : renderGlobalHelp(),
      };
    }
    validateRequestShape(args);
    const environment = resolveEnvironment(args.environment, env);

    if (
      args.command === "test create" ||
      args.command === "test status" ||
      args.command === "test stop"
    ) {
      return finishTest(
        args.command,
        human,
        await runTestCommand(args, environment, dependencies),
      );
    }

    const store = await dependencies.credentialStore(environment);
    const txn =
      (await dependencies.credentialTxn?.(environment, store)) ??
      createCredentialTxn(
        store,
        // Canonical per-OS-user mutex root: identical for the same keyring
        // identity even when CAPIR_CONFIG_DIR differs between invocations.
        credentialMutexPath(
          KEYRING_SERVICE,
          keyringUsername(environment.backendOrigin, environment.webOrigin),
        ),
      );

    if (args.command === "auth login") {
      if (store.kind === "environment") {
        throw new CapirCliError(
          "CAPIR_TOKEN_PROVIDED",
          EXIT.INVALID_ARGUMENTS,
          "CAPIR_TOKEN is already provided and must not be silently persisted by login. Unset CAPIR_TOKEN to run auth login.",
        );
      }
      return finish(
        successEnvelope(
          "auth login",
          await runAuthLogin(
            {
              environment,
              clientLabel: args.clientLabel,
              timeoutSeconds: args.timeoutSeconds,
              noninteractive: args.noninteractive,
            },
            {
              fetchImpl: dependencies.fetchImpl,
              store,
              txn,
              openBrowser: dependencies.openBrowser,
              interactive: dependencies.interactive,
            },
          ),
        ),
        human,
      );
    }

    const token = await store.get();
    if (!token) {
      throw new CapirCliError(
        "CAPIR_CREDENTIAL_MISSING",
        EXIT.AUTH_DENIED,
        "No scoped capir credential exists for this exact configured origin; run auth login first or provide an ephemeral CAPIR_TOKEN.",
      );
    }

    if (args.command === "auth status") {
      return finish(
        successEnvelope(
          "auth status",
          await runAuthStatus(environment, { fetchImpl: dependencies.fetchImpl, store, token }),
        ),
        human,
      );
    }
    if (args.command === "auth logout") {
      return finish(
        successEnvelope(
          "auth logout",
          await runAuthLogout(environment, {
            fetchImpl: dependencies.fetchImpl,
            store,
            txn,
            token,
          }),
        ),
        human,
      );
    }

    const journal = dependencies.journal ?? new OperationJournal(configDirectory(env));
    const sandboxDeps: SandboxDeps = {
      fetchImpl: dependencies.fetchImpl,
      token,
      journal,
      sleep: dependencies.sleep,
      ...(dependencies.spawnRunner ? { spawnRunner: dependencies.spawnRunner } : {}),
    };
    const payload =
      args.command === "sandbox start"
        ? await runSandboxStart(args, environment, sandboxDeps)
        : args.command === "sandbox status"
          ? await runSandboxStatus(args, environment, sandboxDeps)
          : await runSandboxStop(args, environment, sandboxDeps);
    return finish(successEnvelope(args.command, payload), human);
  } catch (error) {
    return renderFailure(error, label, human);
  }
}

function finish(envelope: SuccessEnvelope, human: boolean): RunResult {
  return {
    exitCode: EXIT.SUCCESS,
    output: human ? renderHuman(envelope) : JSON.stringify(envelope),
  };
}

function finishTest(
  command: string,
  human: boolean,
  result: TestCommandResult,
): RunResult {
  return {
    exitCode: EXIT.SUCCESS,
    output: human
      ? result.humanOutput
      : JSON.stringify(successEnvelope(command, result.payload, result.rawFields)),
  };
}

async function readStdinBounded(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    chunks.push(buffer);
    total += buffer.length;
    if (total > 4096) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runTestCommand(
  args: ReturnType<typeof parseArgs>,
  environment: CapirEnvironment,
  dependencies: RunDependencies,
): Promise<TestCommandResult> {
  const operatorStore =
    (await dependencies.testOperatorStore?.(environment)) ?? missingCredentialStore();
  const journal = dependencies.journal ?? new OperationJournal(configDirectory(dependencies.env));
  const deps: TestDeps = {
    operatorStore,
    runPasswordStore: async (account) =>
      (await dependencies.testRunPasswordStore?.(account)) ?? createRunPasswordStore(null, account),
    journal,
    readStdin: dependencies.readStdin ?? readStdinBounded,
    ...(dependencies.spawnRunner ? { spawnRunner: dependencies.spawnRunner } : {}),
    client: (target, provisioningKey, timeoutMs) =>
      new CapirTestProvisioningClient(target.backendOrigin, {
        provisioningKey,
        backendOrigin: target.backendOrigin,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
  };
  if (args.command === "test create") return runTestCreate(args, environment, deps);
  if (args.command === "test status") return runTestStatus(args, environment, deps);
  return runTestStop(args, environment, deps);
}

function renderFailure(error: unknown, label: string, human: boolean): RunResult {
  const envelope = toFailure(error, label);
  return {
    exitCode: envelope.exitCode,
    output: human ? renderHuman(envelope.envelope) : JSON.stringify(envelope.envelope),
  };
}

function toFailure(
  error: unknown,
  label: string,
): { exitCode: number; envelope: FailureEnvelope } {
  if (error instanceof CapirCliError) {
    return {
      exitCode: error.exitCode,
      envelope: failureEnvelope(label, {
        code: error.code,
        message: error.message,
        ...(error.recoverableRequestId
          ? { recoverableRequestId: error.recoverableRequestId }
          : {}),
        ...(error.run !== undefined ? { run: error.run } : {}),
        ...(error.browser !== undefined ? { browser: error.browser } : {}),
        ...(error.clientState !== undefined ? { clientState: error.clientState } : {}),
        ...(error.generatedCredential !== undefined
          ? { generatedCredential: error.generatedCredential }
          : {}),
      }),
    };
  }
  return {
    exitCode: EXIT.INFRASTRUCTURE,
    envelope: failureEnvelope(label, {
      code: "CAPIR_INTERNAL_ERROR",
      message: `Unexpected CLI failure: ${error instanceof Error ? error.message : String(error)}`,
    }),
  };
}
