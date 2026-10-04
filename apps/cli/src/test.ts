/**
 * `capir test create|status|stop`: operator-owned expiring test accounts.
 *
 * - `create` persists the generated run credential BEFORE the first dispatch
 *   (locked create-if-absent), journals nonsecret intent, then sends one
 *   atomic creation request. Replay with the same `--request-id` reuses the
 *   same request and the same preserved credential; nothing is ever rotated,
 *   reset or allocated twice.
 * - The generated password is disclosed only through the dedicated
 *   generated-credential success projection of a successful create. Supplied
 *   passwords, operator credentials, handoff secrets and untrusted server
 *   text can never reach stdout, errors or journals.
 * - `status` is a pure read that never extends TTLs or reveals credentials;
 *   `stop` revokes access first and prunes the local run credential.
 * - `--open web` creates a one-use private handoff and hands its secret to the
 *   owned browser runner over the private IPC channel only. Browser readiness
 *   is reported separately and can never suppress a successful credential.
 */
import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  CapirTestCapabilitiesResponseSchema,
  CapirTestHandoffResponseSchema,
  CapirTestProvisioningClient,
  CapirTestRunSchema,
  TalentSignalHttpError,
  type CapirTestCapabilitiesResponse,
  type CapirTestRun,
} from "@talent-signal/contracts";

import type { ParsedArgs } from "./args.js";
import type { CapirEnvironment } from "./config.js";
import { CapirCliError, EXIT } from "./errors.js";
import { registerContractFormats } from "./formats.js";
import type { CredentialStore } from "./keyring.js";
import {
  semanticDigest,
  type JournalEntry,
  type JournalStatus,
  type OperationJournal,
} from "./journal.js";
import { redactSecrets, redactText } from "./output.js";
import {
  browserFailure,
  browserRunnerEntry,
  spawnRunner,
  type RunnerLaunchMessage,
  type RunnerReceipt,
} from "./runner.js";
import {
  generatePassword,
  operatorCredentialFingerprint,
  requireOperatorCredential,
  runPasswordAccount,
  type RunPasswordStore,
} from "./testCredentials.js";
import { TEST_PRESET_COUNTS } from "./testHelp.js";

registerContractFormats();

export type TestPreset = "daily" | "empty";

export interface TestDeps {
  operatorStore: CredentialStore;
  runPasswordStore(account: string): Promise<RunPasswordStore> | RunPasswordStore;
  journal: OperationJournal;
  readStdin(): Promise<string>;
  spawnRunner?: typeof spawnRunner;
  client(
    environment: CapirEnvironment,
    provisioningKey: string,
    timeoutMs?: number,
  ): CapirTestProvisioningClient;
}

export interface TestCommandResult {
  payload: Record<string, unknown>;
  /** Appended AFTER global redaction: the one authorized disclosure channel. */
  rawFields?: Record<string, unknown>;
  humanOutput: string;
}

const KIND_CREATE = "test.create";
const KIND_STOP = "test.stop";
const KIND_HANDOFF = "test.handoff";

/** Task 1 fixed public entry path of the operator test-account flow. */
const TEST_ENTRY_PATH = "/capir/test-entry";

function requestIds(entry: JournalEntry | undefined, requestId: string) {
  return {
    request_id: requestId,
    kind: entry?.kind ?? null,
    journal_status: entry?.status ?? null,
    digest: entry?.digest ?? null,
    run_id: entry?.run_id ?? null,
    credential_identity: entry?.credential_identity ?? null,
  };
}

function planOperation(
  journal: OperationJournal,
  kind: JournalEntry["kind"],
  environment: CapirEnvironment,
  digestInput: Record<string, unknown>,
  explicitRequestId: string | undefined,
  runId: string | undefined,
): { requestId: string; entry: JournalEntry | undefined } {
  const digest = semanticDigest({
    kind,
    environment: environment.name,
    backend_origin: environment.backendOrigin,
    web_origin: environment.webOrigin,
    ...digestInput,
  });
  const requestId = explicitRequestId ?? randomUUID();
  const entry = journal.ensureIntent({
    request_id: requestId,
    kind,
    environment: environment.name,
    backend_origin: environment.backendOrigin,
    web_origin: environment.webOrigin,
    digest,
    ...(runId ? { run_id: runId } : {}),
  });
  if (entry && entry.digest !== digest) {
    throw new CapirCliError(
      "CAPIR_TEST_INTENT_CONFLICT",
      EXIT.INVALID_ARGUMENTS,
      `Request id ${requestId} was already recorded with different parameters or authorization; refusing to dispatch a conflicting operation.`,
      { clientState: requestIds(entry, requestId) },
    );
  }
  return { requestId, entry };
}

function sanitize(message: string, secrets: string[]): string {
  return redactText(redactSecrets(message, secrets));
}

/**
 * Recursively suppress known secrets through every nested untrusted string
 * (runner receipts, observations, custom fields) before any CLI output,
 * error or receipt path. Pattern redaction alone cannot catch a short chosen
 * password without a token shape.
 */
function sanitizeDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return sanitize(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => sanitizeDeep(entry, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = sanitizeDeep(entry, secrets);
    return out;
  }
  return value;
}

function serverFailure(error: unknown, secrets: string[]): CapirCliError {
  if (error instanceof TalentSignalHttpError) {
    const message = sanitize(
      typeof error.message === "string" && error.message
        ? error.message
        : `Request failed with ${error.status}.`,
      secrets,
    );
    if (error.status === 401 || error.status === 403) {
      return new CapirCliError("CAPIR_TEST_AUTH_DENIED", EXIT.AUTH_DENIED, message);
    }
    if (error.status === 404) {
      return new CapirCliError("CAPIR_TEST_NOT_FOUND", EXIT.INFRASTRUCTURE, message);
    }
    if (error.status === 409) {
      return new CapirCliError("CAPIR_TEST_CONFLICT", EXIT.INVALID_ARGUMENTS, message);
    }
    if (error.status === 429) {
      return new CapirCliError("CAPIR_TEST_QUOTA_EXCEEDED", EXIT.CAPACITY, message);
    }
    return new CapirCliError("CAPIR_TEST_UNAVAILABLE", EXIT.INFRASTRUCTURE, message);
  }
  return new CapirCliError(
    "CAPIR_TEST_INTERNAL_ERROR",
    EXIT.INFRASTRUCTURE,
    "The test provisioning request failed locally; no state was changed.",
  );
}

function validateRun(value: unknown): CapirTestRun {
  if (!Value.Check(CapirTestRunSchema, value)) {
    throw new CapirCliError(
      "CAPIR_TEST_CONTRACT_INVALID",
      EXIT.INFRASTRUCTURE,
      "The service returned a run projection that does not match the capir-test.v1 contract; it is not trusted, printed or used.",
    );
  }
  return value as CapirTestRun;
}

function validateCapabilities(value: unknown): CapirTestCapabilitiesResponse {
  if (!Value.Check(CapirTestCapabilitiesResponseSchema, value)) {
    throw new CapirCliError(
      "CAPIR_TEST_CONTRACT_INVALID",
      EXIT.INFRASTRUCTURE,
      "The service capability projection does not match the capir-test.v1 contract; nothing was allocated.",
    );
  }
  return value as CapirTestCapabilitiesResponse;
}

function expectedCounts(preset: TestPreset) {
  return { ...TEST_PRESET_COUNTS[preset] };
}

function countsMatch(preset: TestPreset, run: CapirTestRun): boolean {
  const expected = expectedCounts(preset);
  return (
    run.counts.contacts === expected.contacts &&
    run.counts.observations === expected.observations &&
    run.counts.tasks === expected.tasks
  );
}

/**
 * Canonical readback verification: identity, preset, seed counts and an
 * active expiration must all hold before the CLI reports a ready run.
 */
function verifyReadyRun(
  run: CapirTestRun,
  request: { requestId: string; preset: TestPreset; username?: string },
): {
  state: string;
  counts_match: boolean;
  expected_counts: ReturnType<typeof expectedCounts>;
  observed_counts: CapirTestRun["counts"];
} {
  const counts_match = countsMatch(request.preset, run);
  const identityHolds =
    run.request_id === request.requestId &&
    run.preset === request.preset &&
    run.email.endsWith("@lab.invalid") &&
    (request.username === undefined || run.username === request.username);
  const active = run.state === "ready" && Date.parse(run.expires_at) > Date.now();
  if (!identityHolds || !counts_match || !active) {
    throw new CapirCliError(
      "CAPIR_TEST_VERIFICATION_FAILED",
      EXIT.ASSERTION,
      "The created account did not verify as a ready run (identity, preset seed counts or active expiry); the allocation is preserved but not reported ready.",
      { run },
    );
  }
  return {
    state: run.state,
    counts_match,
    expected_counts: expectedCounts(request.preset),
    observed_counts: run.counts,
  };
}

function runProjection(run: CapirTestRun, environment: CapirEnvironment) {
  return {
    run,
    next: {
      status: `capir test status ${run.id} --env ${environment.name}`,
      stop: `capir test stop ${run.id} --env ${environment.name}`,
    },
  };
}

function humanRunLines(
  command: string,
  run: CapirTestRun,
  environment: CapirEnvironment,
  credential?: { username: string; password: string },
): string {
  const counts = run.counts;
  const lines = [
    `ok ${command}`,
    `run id: ${run.id}`,
    `username: ${credential?.username ?? run.username}`,
  ];
  if (credential) lines.push(`password: ${credential.password}`);
  lines.push(
    `preset: ${run.preset} (${counts.contacts} contacts, ${counts.observations} observations, ${counts.tasks} tasks)`,
    `expires: ${run.expires_at}`,
    `web origin: ${environment.webOrigin}`,
    `next: capir test status ${run.id} --env ${environment.name}`,
    `      capir test stop ${run.id} --env ${environment.name}`,
  );
  return lines.join("\n");
}

function suppliedPassword(args: ParsedArgs, raw: string | undefined): string | undefined {
  if (args.password !== undefined) return args.password;
  if (raw === undefined) return undefined;
  const password = raw.replace(/\r?\n$/, "");
  if (!password) {
    throw invalid("CAPIR_CLI_INVALID_ARGUMENT", "--password-stdin received an empty password.");
  }
  return password;
}

function invalid(code: string, message: string): CapirCliError {
  return new CapirCliError(code, EXIT.INVALID_ARGUMENTS, message);
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 128) {
    throw invalid(
      "CAPIR_CLI_INVALID_ARGUMENT",
      "The password must use the existing account password limits (8-128 characters).",
    );
  }
}

/**
 * Canonical handle: the backend resolves handles trim+lowercase, so the CLI
 * canonicalizes the supplied username ONCE before validation, journal digest,
 * dispatch and readback comparison. Omitted usernames stay omitted.
 */
function canonicalUsername(username: string | undefined): string | undefined {
  return username === undefined ? undefined : username.trim().toLowerCase();
}

interface PasswordResolution {
  password: string;
  generated: boolean;
  resumed: boolean;
  store: RunPasswordStore;
}

async function resolveRunPassword(
  args: ParsedArgs,
  entry: JournalEntry | undefined,
  store: RunPasswordStore,
  readStdin: () => Promise<string>,
): Promise<PasswordResolution> {
  const supplied = suppliedPassword(
    args,
    args.passwordStdin ? await readStdin() : undefined,
  );
  if (supplied !== undefined) validatePassword(supplied);
  const existing = await store.get();

  if (entry && entry.credential_identity === "supplied" && supplied === undefined) {
    throw new CapirCliError(
      "CAPIR_TEST_CREDENTIAL_MISSING",
      EXIT.INFRASTRUCTURE,
      "This operation was recorded with a caller-supplied password; resubmit the same password with --password or --password-stdin to resume it. No credential is fabricated or rotated.",
      { clientState: requestIds(entry, entry.request_id) },
    );
  }
  if (entry && entry.credential_identity === "generated" && existing === null && supplied === undefined) {
    throw new CapirCliError(
      "CAPIR_TEST_CREDENTIAL_MISSING",
      EXIT.INFRASTRUCTURE,
      "The local run credential item for this operation is gone; the ready run is never rotated, reset or reallocated. Recover it from the caller that still owns it, or stop the run.",
      { clientState: requestIds(entry, entry.request_id) },
    );
  }

  if (entry === undefined && existing !== null) {
    // A fresh operation must never adopt or overwrite an item owned by
    // another operation (or by a lost local record): report the conflict and
    // dispatch nothing.
    throw new CapirCliError(
      "CAPIR_TEST_KEYRING_CONFLICT",
      EXIT.INFRASTRUCTURE,
      "Another operation already owns this run credential keyring item; the item is preserved and no password is overwritten. Nothing was dispatched.",
    );
  }

  if (existing !== null) {
    if (supplied !== undefined && supplied !== existing) {
      throw new CapirCliError(
        "CAPIR_TEST_KEYRING_CONFLICT",
        EXIT.INFRASTRUCTURE,
        "A different value already owns this operation's run credential item; the item is preserved and never overwritten.",
        { clientState: requestIds(entry, entry?.request_id ?? "") },
      );
    }
    // The semantic intent (including credential mode) was validated before
    // reading this item. A crash can leave its matching intent without the
    // recovery marker, but the preserved generated password still belongs
    // to this operation. Fresh orphan items are rejected above.
    return {
      password: existing,
      generated: entry?.credential_identity === "generated" ||
        (entry?.credential_identity === undefined && supplied === undefined),
      resumed: true,
      store,
    };
  }

  if (supplied !== undefined) {
    return { password: supplied, generated: false, resumed: Boolean(entry), store };
  }

  const candidate = generatePassword();
  const outcome = await store.createIfAbsent(candidate);
  if (outcome === "conflict") {
    throw new CapirCliError(
      "CAPIR_TEST_KEYRING_CONFLICT",
      EXIT.INFRASTRUCTURE,
      "Another operation already owns this run credential keyring item; the item is preserved and no password is overwritten. Nothing was dispatched.",
    );
  }
  return { password: candidate, generated: true, resumed: Boolean(entry), store };
}

export async function runTestCreate(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: TestDeps,
): Promise<TestCommandResult> {
  const secrets: string[] = [];
  const operatorKey = await requireOperatorCredential(deps.operatorStore);
  secrets.push(operatorKey);
  const client = deps.client(environment, operatorKey, args.timeoutSeconds * 1000);
  const capabilities = validateCapabilities(await client.capabilities());
  if (!capabilities.enabled) {
    throw new CapirCliError(
      "CAPIR_TEST_DISABLED",
      EXIT.INFRASTRUCTURE,
      "Internal test-account provisioning is disabled on this service; nothing was created.",
    );
  }
  if (args.open === "web" && !capabilities.web_handoff_available) {
    throw new CapirCliError(
      "CAPIR_TEST_WEB_HANDOFF_UNAVAILABLE",
      EXIT.INFRASTRUCTURE,
      "Web handoff is not configured on this service; nothing was created.",
    );
  }

  const preset = args.preset as TestPreset;
  const username = canonicalUsername(args.username);
  const operatorFingerprint = operatorCredentialFingerprint(operatorKey);
  const credentialIdentity =
    args.password !== undefined || args.passwordStdin ? "supplied" : "generated";
  // ONE planned request id end to end: journal, keyring namespace, dispatch,
  // output and recovery all share it.
  const { requestId, entry } = planOperation(
    deps.journal,
    KIND_CREATE,
    environment,
    {
      preset,
      duration_hours: args.durationHours,
      username: username ?? null,
      // Nonsecret operator identity marker: another principal can never
      // replay or take over this recorded intent.
      operator_fingerprint: operatorFingerprint,
      // Never a password or any hash of one: replay credential identity is
      // verified by the server's salted credential and the private keyring.
      credential_identity: credentialIdentity,
    },
    args.requestId,
    undefined,
  );

  const account = runPasswordAccount({
    operatorCredential: operatorKey,
    backendOrigin: environment.backendOrigin,
    webOrigin: environment.webOrigin,
    requestId,
  });
  const store = await deps.runPasswordStore(account);
  const resolution = await resolveRunPassword(args, entry, store, deps.readStdin);
  secrets.push(resolution.password);
  deps.journal.setCredentialIdentity(
    requestId,
    resolution.generated ? "generated" : "supplied",
  );
  deps.journal.updateStatus(requestId, "dispatched");

  let run: CapirTestRun;
  try {
    run = validateRun(
      await client.create({
        request_id: requestId,
        ...(username === undefined ? {} : { username }),
        password: resolution.password,
        preset,
        duration_hours: args.durationHours as 1 | 4 | 24,
        web_origin: environment.webOrigin,
      }),
    );
  } catch (error) {
    if (error instanceof TalentSignalHttpError && error.status === 0) {
      deps.journal.updateStatus(requestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TEST_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The create request may or may not have been accepted; resume the SAME operation with --request-id to reuse the preserved credential and avoid creating a copy.",
        {
          recoverableRequestId: requestId,
          clientState: requestIds(deps.journal.find(requestId), requestId),
        },
      );
    }
    deps.journal.updateStatus(requestId, "completed" satisfies JournalStatus);
    throw serverFailure(error, secrets);
  }
  deps.journal.updateStatus(requestId, "completed");
  deps.journal.attachRun(requestId, run.id);

  const verified = verifyReadyRun(run, {
    requestId,
    preset,
    ...(username === undefined ? {} : { username }),
  });
  const credential = resolution.generated
    ? { username: run.username, password: resolution.password }
    : undefined;
  const rawFields = credential ? { generated_credential: credential } : undefined;

  const payload: Record<string, unknown> = {
    request_id: requestId,
    resumed: resolution.resumed,
    ...runProjection(run, environment),
    verified,
    client_state: requestIds(deps.journal.find(requestId), requestId),
    server_capabilities: {
      supported: capabilities.supported,
      unsupported: capabilities.unsupported,
    },
  };

  if (args.open === "web") {
    if (!deps.spawnRunner) browserRunnerEntry();
    try {
      const opened = await openTestWeb(run, args, environment, client, deps, secrets, requestId, operatorFingerprint);
      payload.browser = sanitizeDeep(opened.browser, secrets);
      payload.handoff_request_id = opened.handoff_request_id;
    } catch (error) {
      if (error instanceof CapirCliError) {
        // The authoritative recovery identity is the CREATE request id; the
        // one-use handoff id travels only as its own separate field.
        const clientState: Record<string, unknown> = {
          ...requestIds(deps.journal.find(requestId), requestId),
          ...(error.handoffRequestId !== undefined
            ? { handoff_request_id: error.handoffRequestId }
            : {}),
        };
        throw new CapirCliError(error.code, error.exitCode, error.message, {
          recoverableRequestId: requestId,
          run: error.run ?? run,
          ...(error.browser !== undefined
            ? { browser: sanitizeDeep(error.browser, secrets) }
            : {}),
          clientState,
          ...(credential ? { generatedCredential: credential } : {}),
        });
      }
      throw error;
    }
  }

  return {
    payload,
    ...(rawFields ? { rawFields } : {}),
    humanOutput: humanRunLines("test create", run, environment, credential),
  };
}

async function openTestWeb(
  run: CapirTestRun,
  args: ParsedArgs,
  environment: CapirEnvironment,
  client: CapirTestProvisioningClient,
  deps: TestDeps,
  secrets: string[],
  createRequestId: string,
  operatorFingerprint: string,
): Promise<{ browser: RunnerReceipt; handoff_request_id: string }> {
  const { requestId: handoffRequestId } = planOperation(
    deps.journal,
    KIND_HANDOFF,
    environment,
    { run_id: run.id, operator_fingerprint: operatorFingerprint },
    undefined,
    run.id,
  );
  deps.journal.updateStatus(handoffRequestId, "dispatched");
  let handoff;
  try {
    handoff = await client.createHandoff(run.id, { request_id: handoffRequestId });
    secrets.push(handoff.handoff_secret);
  } catch (error) {
    if (error instanceof TalentSignalHttpError && error.status === 0) {
      deps.journal.updateStatus(handoffRequestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TEST_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The one-use handoff request may or may not have been accepted; retry with a fresh --open web (handoffs are single-use).",
        {
          recoverableRequestId: createRequestId,
          handoffRequestId,
          run,
          clientState: requestIds(deps.journal.find(handoffRequestId), handoffRequestId),
        },
      );
    }
    throw serverFailure(error, secrets);
  }
  deps.journal.updateStatus(handoffRequestId, "completed");
  // Runtime-verify the one-use handoff projection before any IPC: typed
  // contract, exact target run, the fixed entry path and a live handoff
  // expiry within the run deadline.
  const handoffExpiry = Date.parse(handoff.expires_at);
  if (
    !Value.Check(CapirTestHandoffResponseSchema, handoff) ||
    handoff.run_id !== run.id ||
    handoff.entry_path !== TEST_ENTRY_PATH ||
    !(handoffExpiry > Date.now()) ||
    handoffExpiry > Date.parse(run.expires_at)
  ) {
    throw new CapirCliError(
      "CAPIR_TEST_CONTRACT_INVALID",
      EXIT.INFRASTRUCTURE,
      "The one-use handoff did not verify against the target run (typed contract, run id, entry path, live expiry within the run deadline); no browser was opened.",
      { run, handoffRequestId },
    );
  }
  const message: RunnerLaunchMessage = {
    web_origin: environment.webOrigin,
    sandbox_id: run.id,
    entry_path: handoff.entry_path,
    handoff_secret: handoff.handoff_secret,
    sandbox_expires_at: run.expires_at,
    scenario_id: run.preset,
    purpose: "test-run",
    expected: {
      run_id: run.id,
      account_id: run.account_id,
      user_id: run.user_id,
      username: run.username,
    },
    ...(args.receiptDir ? { receipt_dir: args.receiptDir } : {}),
    ...(process.env.CAPIR_PROOF_HEADLESS === "1" && args.receiptDir
      ? { test_headless: true }
      : {}),
  };
  const receipt = await (deps.spawnRunner ?? spawnRunner)(message);
  if (!receipt.launched || receipt.error || !receipt.verification?.passed) {
    const failure = browserFailure(
      receipt,
      run,
      requestIds(deps.journal.find(handoffRequestId), handoffRequestId),
    );
    // Browser/runner text is untrusted: it may echo a chosen password.
    throw new CapirCliError(failure.code, failure.exitCode, sanitize(failure.message, secrets), {
      recoverableRequestId: createRequestId,
      handoffRequestId,
      run: failure.run,
      ...(failure.browser !== undefined
        ? { browser: sanitizeDeep(failure.browser, secrets) }
        : {}),
      clientState: failure.clientState,
    });
  }
  return { browser: receipt, handoff_request_id: handoffRequestId };
}

export async function runTestStatus(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: TestDeps,
): Promise<TestCommandResult> {
  const secrets: string[] = [];
  const operatorKey = await requireOperatorCredential(deps.operatorStore);
  secrets.push(operatorKey);
  const client = deps.client(environment, operatorKey, args.timeoutSeconds * 1000);
  const runId = args.runId!;
  let run: CapirTestRun;
  try {
    run = validateRun(await client.status(runId));
  } catch (error) {
    throw serverFailure(error, secrets);
  }
  // Prune expired local items on later use; never rotate anything.
  const credential_removed =
    run.state !== "ready" &&
    (await pruneLocalRunCredential(environment, run, operatorKey, deps));
  return {
    payload: {
      run,
      read_only: true,
      ...(credential_removed ? { credential_removed } : {}),
    },
    humanOutput: [
      "ok test status",
      `run id: ${run.id}`,
      `username: ${run.username}`,
      `state: ${run.state}`,
      `preset: ${run.preset} (${run.counts.contacts} contacts, ${run.counts.observations} observations, ${run.counts.tasks} tasks)`,
      `expires: ${run.expires_at}`,
    ].join("\n"),
  };
}

export async function runTestStop(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: TestDeps,
): Promise<TestCommandResult> {
  const secrets: string[] = [];
  const operatorKey = await requireOperatorCredential(deps.operatorStore);
  secrets.push(operatorKey);
  const client = deps.client(environment, operatorKey, args.timeoutSeconds * 1000);
  const runId = args.runId!;
  const { requestId } = planOperation(
    deps.journal,
    KIND_STOP,
    environment,
    { run_id: runId, operator_fingerprint: operatorCredentialFingerprint(operatorKey) },
    args.requestId,
    runId,
  );
  deps.journal.updateStatus(requestId, "dispatched");
  let run: CapirTestRun;
  try {
    run = validateRun(await client.stop(runId, { request_id: requestId }));
  } catch (error) {
    if (error instanceof TalentSignalHttpError && error.status === 0) {
      deps.journal.updateStatus(requestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TEST_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The stop request may or may not have been accepted; resume the SAME stop with --request-id.",
        {
          recoverableRequestId: requestId,
          clientState: requestIds(deps.journal.find(requestId), requestId),
        },
      );
    }
    throw serverFailure(error, secrets);
  }
  deps.journal.updateStatus(requestId, "completed");
  const credential_removed = await pruneLocalRunCredential(
    environment,
    run,
    operatorKey,
    deps,
  );
  if (run.cleanup_error !== null) {
    throw new CapirCliError(
      "CAPIR_TEST_CLEANUP_INCOMPLETE",
      EXIT.INFRASTRUCTURE,
      `Access was revoked, but cleanup failed (${run.cleanup_error}). Resume the same stop with --request-id ${requestId} after resolving the cleanup failure.`,
      {
        run,
        recoverableRequestId: requestId,
        clientState: requestIds(deps.journal.find(requestId), requestId),
      },
    );
  }
  return {
    payload: {
      run,
      credential_removed,
      client_state: requestIds(deps.journal.find(requestId), requestId),
    },
    humanOutput: [
      "ok test stop",
      `run id: ${run.id}`,
      `state: ${run.state}`,
      `local credential removed: ${credential_removed ? "yes" : "no"}`,
      ...(run.state === "deleting" ? [`external cleanup pending; check: capir test status ${run.id} --env ${environment.name}`] : []),
    ].join("\n"),
  };
}

/** Remove only this operation's own run credential item; honest on absence. */
async function pruneLocalRunCredential(
  environment: CapirEnvironment,
  run: CapirTestRun,
  operatorKey: string,
  deps: TestDeps,
): Promise<boolean> {
  const store = await deps.runPasswordStore(
    runPasswordAccount({
      operatorCredential: operatorKey,
      backendOrigin: environment.backendOrigin,
      webOrigin: environment.webOrigin,
      requestId: run.request_id,
    }),
  );
  return store.delete();
}
