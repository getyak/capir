/**
 * Command dispatch for the `capir` CLI.
 *
 * All side effects happen behind `RunDependencies` so the deterministic test
 * suites can exercise the real argument, journal, credential and envelope code
 * with injected transports. stdout is exactly one JSON document (or `--human`
 * text); every failure is a stable redacted error envelope.
 */
import { readVersion as readRunningVersion } from "./version.js";
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
import { renderUpdateHelp, UPDATE_HELP_PATHS } from "./updateHelp.js";
import { runUpdateCommand, type UpdateMode } from "./update/command.js";
import { runAuthLogin } from "./login.js";
import { authV2Status, usableCredential } from "./authV2.js";
import { environmentTokenStore } from "./keyring.js";
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
  /** Explicit legacy protocol adapter for existing embedded v1 clients.
   * The shipped binary always negotiates v2; no network-error fallback. */
  authProtocol?: "capir.v1" | "capir-auth.v2";
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
  onAuthProgress?: (message:string) => void;
  sleep(ms: number): Promise<void>;
  spawnRunner?: (
    message: RunnerLaunchMessage,
    options?: { receiptTimeoutMs?: number },
  ) => Promise<RunnerReceipt>;
  journal?: OperationJournal;
  /** Absolute path of the executed CLI script; binds managed-update metadata. */
  invokedBinary?: string;
  /** Explicit updater seams for tests (trust key, channel URLs); production omits them. */
  update?: {
    trustPublicKey?: string;
    channelManifestUrl?: string;
    channelSignatureUrl?: string;
    requestTimeoutMs?: number;
    lockTimeoutMs?: number;
    now?: () => Date;
    platform?: string;
  };
}

export interface RunResult {
  exitCode: ExitCode | number;
  output: string;
}

function commandLabel(argv: string[]): string {
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  // Skip leading flags value-aware so `--json update --rollback` is labeled
  // as an update command, never as help.
  const VALUE_FLAGS = new Set([
    "profile", "model", "system", "max-tokens", "timeout", "provider",
    "base-url", "api-key-env", "auth", "token-limit-field", "system-role",
    "env", "server", "client-label", "username", "password", "expires-in", "preset",
    "request-id", "open", "receipt-dir", "wait", "role", "scenario",
    "model-policy", "duration-hours", "surface",
  ]);
  let index = 0;
  while (index < rest.length && rest[index]!.startsWith("-")) {
    const token = rest[index]!;
    if (token === "--") break;
    index += VALUE_FLAGS.has(token.slice(2)) ? 2 : 1;
  }
  const [first, second] = rest.slice(index);
  if (!first || first.startsWith("-")) return "help";
  if (first === "update") {
    if (rest.includes("--check")) return "update --check";
    if (rest.includes("--rollback")) return "update --rollback";
    return "update";
  }
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
  return readRunningVersion();
}

export async function runCli(argv: string[], dependencies: RunDependencies): Promise<RunResult> {
  const label = commandLabel(argv);
  const env = dependencies.env;
  let human = argv.includes("--human");
  try {
    const args = parseArgs(argv);
    // The update family defaults to readable text; `--json` opts into the
    // stable envelope. Every other command keeps its JSON-default contract.
    human = args.command === "update" ? !args.json : args.human || (args.command.startsWith("auth ") && dependencies.interactive && !args.json && dependencies.authProtocol !== "capir.v1");
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
          ? { help: JSON.parse(renderHelp(path, "json")) as Record<string, unknown> }
          : machineHelpPayload();
        return finish(successEnvelope("help", payload), false);
      }
      return {
        exitCode: EXIT.SUCCESS,
        output: path ? renderHelp(path, "human") : renderGlobalHelp(),
      };
    }
    validateRequestShape(args);
    if (args.command === "update") {
      // No environment resolution, no credential load, no journal: update
      // runs on release metadata only and is dispatched before any model path.
      const result = await runUpdateCommand(args.updateMode as UpdateMode, {
        env,
        fetchImpl: dependencies.fetchImpl,
        invokedBinary: dependencies.invokedBinary ?? process.argv[1] ?? "",
        ...(dependencies.update ?? {}),
      });
      return {
        exitCode: EXIT.SUCCESS,
        output: human
          ? result.humanOutput
          : JSON.stringify(successEnvelope(updateCommandLabel(args.updateMode), result.payload)),
      };
    }
    const environment = resolveEnvironment(args.environment, env, args.server);

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
              protocolV2:dependencies.authProtocol !== "capir.v1",
            },
            {
              fetchImpl: dependencies.fetchImpl,
              store,
              txn,
              openBrowser: dependencies.openBrowser,
              interactive: dependencies.interactive,
              ...(dependencies.onAuthProgress ? {onProgress:dependencies.onAuthProgress} : {}),
            },
          ),
        ),
        human,
      );
    }

    if (args.command === "auth status" && dependencies.authProtocol !== "capir.v1") return finish(successEnvelope("auth status", await authV2Status(environment, store, dependencies.fetchImpl)), human);
    const token = await store.get();
    if (!token) {
      throw new CapirCliError(
        "CAPIR_CREDENTIAL_MISSING",
        EXIT.AUTH_DENIED,
        "No scoped capir credential exists for this exact configured origin; run auth login first or provide an ephemeral CAPIR_TOKEN.",
      );
    }

    if (args.command === "auth status") return finish(successEnvelope("auth status", await runAuthStatus(environment,{fetchImpl:dependencies.fetchImpl,store,token})),human);
    if (args.command === "auth logout") {
      return finish(
        successEnvelope(
          "auth logout",
          await runAuthLogout(environment, {
            fetchImpl: dependencies.fetchImpl,
            store,
            txn,
            token,
            protocolV2:dependencies.authProtocol !== "capir.v1",
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

function updateCommandLabel(mode: string): string {
  return mode === "check" ? "update --check" : mode === "rollback" ? "update --rollback" : "update";
}

function renderHelp(path: string, format: "human" | "json"): string {
  return UPDATE_HELP_PATHS.includes(path as (typeof UPDATE_HELP_PATHS)[number])
    ? renderUpdateHelp(path, format)
    : path.startsWith("auth") ? (format === "json" ? JSON.stringify({command:path, usage:`capir ${path} --env <name> [--server <registered-origin>]`, notes:["Login reuses a verified credential; otherwise opens browser consent.", "Status is read-only. Logout revokes this grant and its derived test entries.", "OS keyring only; CAPIR_TOKEN stays ephemeral."]}) : `capir ${path} --env <name> [--server <registered-origin>]\nLogin reuses a verified credential. Status is read-only; logout revokes it.\n`)
    : renderTestHelp(path, format);
}

function renderAuthHuman(envelope: SuccessEnvelope): string {
  const value=envelope as unknown as Record<string,unknown>;
  const identity=value.identity as {user_email?:string;account_slug?:string}|undefined;
  const grant=value.grant as {scopes?:string[];access_expires_at?:string}|undefined;
  const environment=String(value.environment??'');
  const origin=String(value.backend_origin??(grant as {backend_origin?:string}|undefined)?.backend_origin??'');
  const source=String(value.credential_source??value.credential_store??'keyring');
  if(value.command==='auth logout') return `CLI 授权撤销：${value.remote_revoked?'已确认':'已不可用'}\n环境：${environment}\n本机凭据：${value.local_credential_state==='preserved_newer'?'已保留较新的登录':value.local_credential_state==='unverified'?'移除尚未确认，请重试退出':value.credential_source==='CAPIR_TOKEN'?'来自 CAPIR_TOKEN；请在调用环境中移除':'已移除'}\n`;
  const labels:Record<string,string>={active:'已登录',expired:'凭据已到期',revoked:'授权已撤销',missing:'尚未登录',unverified:'暂时无法验证登录',reauth_required:'需要重新授权'};
  const state=String(value.state??'active');
  return `${labels[state]??state}${identity?.user_email ? ' '+identity.user_email : ''}${value.reused?'（已复用）':''}\n环境：${environment}${origin ? " · "+origin : ""}${identity?.account_slug?' / '+identity.account_slug:''}\n`+
    `凭据来源：${source==='CAPIR_TOKEN'?'CAPIR_TOKEN（环境变量）':'系统钥匙串'}\n`+
    (grant?.scopes ? `权限：${grant.scopes.join(', ')} · 访问凭据到期 ${grant.access_expires_at??''}\n` : '')+
    (state==='active' ? `下一步：capir ${grant?.scopes?.includes('test.create')?'test create':'auth status'} --env ${environment}\n` : state==='unverified' ? `重试：capir auth status --env ${environment}\n` : `下一步：capir ${state==='missing'?'auth login':'auth logout'} --env ${environment}\n`);
}

function finish(envelope: SuccessEnvelope, human: boolean): RunResult {
  return {
    exitCode: EXIT.SUCCESS,
    output: human ? (envelope.command.startsWith("auth ") ? renderAuthHuman(envelope) : renderHuman(envelope)) : JSON.stringify(envelope),
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
  let operatorStore: CredentialStore;
  let authority: string | undefined;
  // Only an explicit operator credential chooses the operator path. A present
  // user grant's denial must never fall through to an operator keyring item.
  const userStore = await dependencies.credentialStore(environment);
  const hasUser = !dependencies.env.CAPIR_TEST_OPERATOR_TOKEN?.trim() && await userStore.get();
  if (hasUser) {
    const credential = await usableCredential(environment, userStore, dependencies.fetchImpl);
    operatorStore = environmentTokenStore(credential.token);
    authority = credential.authority;
  } else operatorStore = (await dependencies.testOperatorStore?.(environment)) ?? missingCredentialStore();
  const journal = dependencies.journal ?? new OperationJournal(configDirectory(dependencies.env));
  const deps: TestDeps = {
    operatorStore,
    ...(authority ? {authority} : {}),
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
