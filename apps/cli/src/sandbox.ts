/**
 * Stage A sandbox commands: start, status, stop.
 *
 * - Client intent (request id + semantic digest) is journaled before the first
 *   dispatch; the same request id resumes the same operation and parameter
 *   conflicts fail before dispatch.
 * - `status` only reads (unless `--open web` requests a handoff) and never
 *   renews TTLs.
 * - `stop` polls the real readback and reports deleting/failed distinctly; it
 *   only reports `deleted` when the backend projection says so.
 */
import { randomUUID } from "node:crypto";
import { CapirCliError, EXIT } from "./errors.js";
import type { ParsedArgs } from "./args.js";
import type { CapirEnvironment } from "./config.js";
import { CapirBackendClient, type FetchLike } from "./http.js";
import {
  OperationJournal,
  semanticDigest,
  type JournalEntry,
  type OperationKind,
} from "./journal.js";
import {
  browserFailure,
  browserRunnerEntry,
  spawnRunner,
  type RunnerLaunchMessage,
  type RunnerReceipt,
} from "./runner.js";

export interface CapirCapabilities {
  enabled: boolean;
  max_active_sandboxes: number;
  web_handoff_available: boolean;
  scenarios: Array<{ id: string; version: string; digest: string }>;
  supported_tasks: string[];
  unsupported: string[];
  backend_origins: string[];
  web_origins: string[];
}

export interface SandboxDeps {
  fetchImpl: FetchLike;
  token: string;
  journal: OperationJournal;
  spawnRunner?: typeof spawnRunner;
  sleep(ms: number): Promise<void>;
}

export function requestIds(entry: JournalEntry | undefined, requestId: string) {
  return {
    request_id: requestId,
    kind: entry?.kind ?? null,
    journal_status: entry?.status ?? null,
    digest: entry?.digest ?? null,
  };
}

async function discover(
  client: CapirBackendClient,
  environment: CapirEnvironment,
): Promise<CapirCapabilities> {
  const capabilities = (await client.capabilities()) as unknown as CapirCapabilities;
  if (
    !capabilities.backend_origins.includes(environment.backendOrigin) ||
    !capabilities.web_origins.includes(environment.webOrigin)
  ) {
    throw new CapirCliError(
      "CAPIR_ENVIRONMENT_INVALID",
      EXIT.INVALID_ARGUMENTS,
      "The configured origins are not registered for this test backend; capabilities and credentials bind to the exact configured origin.",
    );
  }
  return capabilities;
}

function planOperation(
  journal: OperationJournal,
  kind: OperationKind,
  environment: CapirEnvironment,
  digestInput: Record<string, unknown>,
  explicitRequestId: string | undefined,
  sandboxId: string | undefined,
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
    ...(sandboxId ? { sandbox_id: sandboxId } : {}),
  });
  if (entry && entry.digest !== digest) {
    throw new CapirCliError(
      "CAPIR_INTENT_CONFLICT",
      EXIT.INVALID_ARGUMENTS,
      `Request id ${requestId} was already recorded with different parameters or authorization; refusing to dispatch a conflicting operation.`,
      { clientState: requestIds(entry, requestId) },
    );
  }
  return { requestId, entry };
}

async function openWeb(
  run: Record<string, unknown>,
  sandbox: { id: string; state: string; expires_at: string; entry_path: string; scenario: { id: string } },
  args: ParsedArgs,
  environment: CapirEnvironment,
  client: CapirBackendClient,
  deps: SandboxDeps,
): Promise<{ browser: RunnerReceipt; handoff_request_id: string }> {
  if (sandbox.state !== "ready") {
    throw new CapirCliError(
      "CAPIR_SANDBOX_NOT_READY",
      EXIT.INFRASTRUCTURE,
      `The sandbox run is preserved but its state is "${sandbox.state}"; a Web session can only open from a ready sandbox.`,
      { run },
    );
  }
  const { requestId: handoffRequestId } = planOperation(
    deps.journal,
    "sandbox.handoff",
    environment,
    { sandbox_id: sandbox.id },
    undefined,
    sandbox.id,
  );
  deps.journal.updateStatus(handoffRequestId, "dispatched");
  let handoff;
  try {
    handoff = await client.handoff(sandbox.id, handoffRequestId);
  } catch (error) {
    if (error instanceof CapirCliError && error.code === "CAPIR_TRANSPORT") {
      deps.journal.updateStatus(handoffRequestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The handoff request may or may not have been accepted; retry with a fresh --open web (handoff operations are single-use).",
        {
          recoverableRequestId: handoffRequestId,
          run,
          clientState: requestIds(deps.journal.find(handoffRequestId), handoffRequestId),
        },
      );
    }
    throw error;
  }
  deps.journal.updateStatus(handoffRequestId, "completed");
  const message: RunnerLaunchMessage = {
    web_origin: environment.webOrigin,
    sandbox_id: sandbox.id,
    entry_path: handoff.entry_path,
    handoff_secret: handoff.handoff_secret,
    sandbox_expires_at: sandbox.expires_at,
    scenario_id: sandbox.scenario.id,
    ...(args.receiptDir ? { receipt_dir: args.receiptDir } : {}),
    ...(process.env.CAPIR_PROOF_HEADLESS === "1" && args.receiptDir
      ? { test_headless: true } : {}),
  };
  const receipt = await (deps.spawnRunner ?? spawnRunner)(message);
  if (!receipt.launched || receipt.error || !receipt.verification?.passed) {
    throw browserFailure(
      receipt,
      run,
      requestIds(deps.journal.find(handoffRequestId), handoffRequestId),
    );
  }
  return { browser: receipt, handoff_request_id: handoffRequestId };
}

export async function runSandboxStart(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: SandboxDeps,
): Promise<Record<string, unknown>> {
  const client = new CapirBackendClient(environment.backendOrigin, deps.fetchImpl, deps.token);
  const capabilities = await discover(client, environment);
  if (!capabilities.enabled) {
    throw new CapirCliError(
      "CAPIR_DISABLED",
      EXIT.INFRASTRUCTURE,
      "capir is disabled on the configured test backend; no sandbox was created.",
    );
  }
  const scenario = capabilities.scenarios.find((entry) => entry.id === args.scenario);
  if (!scenario) {
    throw new CapirCliError(
      "CAPIR_SCENARIO_UNSUPPORTED",
      EXIT.INFRASTRUCTURE,
      `Scenario "${args.scenario}" is not offered by capability discovery; no sandbox was created.`,
    );
  }
  if (args.open === "web" && !capabilities.web_handoff_available) {
    throw new CapirCliError(
      "CAPIR_WEB_HANDOFF_UNAVAILABLE",
      EXIT.INFRASTRUCTURE,
      "Web handoff is not configured on the test backend; no sandbox was created.",
    );
  }
  if (args.open === "web" && !deps.spawnRunner) browserRunnerEntry();
  const modelPolicy = "strict_replay" as const;
  const { requestId, entry } = planOperation(
    deps.journal,
    "sandbox.start",
    environment,
    {
      scenario_id: scenario.id,
      scenario_version: scenario.version,
      scenario_digest: scenario.digest,
      duration_hours: args.durationHours,
      member_role: "member",
      model_policy: modelPolicy,
    },
    args.requestId,
    undefined,
  );
  deps.journal.updateStatus(requestId, "dispatched");
  let response;
  try {
    response = await client.prepare({
      id: requestId,
      scenario_id: scenario.id,
      scenario_version: scenario.version,
      scenario_digest: scenario.digest,
      duration_hours: args.durationHours,
      member_role: "member",
      model_policy: modelPolicy,
    });
  } catch (error) {
    if (error instanceof CapirCliError && error.code === "CAPIR_TRANSPORT") {
      deps.journal.updateStatus(requestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The sandbox request may or may not have been accepted; resume the SAME operation with --request-id to avoid creating a copy.",
        {
          recoverableRequestId: requestId,
          clientState: requestIds(deps.journal.find(requestId), requestId),
        },
      );
    }
    throw error;
  }
  deps.journal.updateStatus(requestId, "completed");
  const run: Record<string, unknown> = {
    request_id: requestId,
    resumed: Boolean(entry),
    sandbox: response.sandbox,
    client_state: requestIds(deps.journal.find(requestId), requestId),
  };
  if (args.open === "web") {
    const opened = await openWeb(
      run,
      response.sandbox as unknown as Parameters<typeof openWeb>[1],
      args,
      environment,
      client,
      deps,
    );
    return { ...run, browser: opened.browser, handoff_request_id: opened.handoff_request_id };
  }
  return run;
}

export async function runSandboxStatus(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: SandboxDeps,
): Promise<Record<string, unknown>> {
  const client = new CapirBackendClient(environment.backendOrigin, deps.fetchImpl, deps.token);
  const sandboxId = args.sandboxId!;
  // Strictly a read unless --open requests a handoff; TTLs are never renewed.
  const response = await client.readSandbox(sandboxId);
  const run: Record<string, unknown> = {
    sandbox: response.sandbox,
    read_only: args.open !== "web",
  };
  if (args.open === "web") {
    if (!deps.spawnRunner) browserRunnerEntry();
    const opened = await openWeb(
      run,
      response.sandbox as unknown as Parameters<typeof openWeb>[1],
      args,
      environment,
      client,
      deps,
    );
    return { ...run, browser: opened.browser, handoff_request_id: opened.handoff_request_id };
  }
  return run;
}

const TERMINAL_STATES = new Set(["deleted", "cleanup_failed", "failed"]);

export async function runSandboxStop(
  args: ParsedArgs,
  environment: CapirEnvironment,
  deps: SandboxDeps,
): Promise<Record<string, unknown>> {
  const client = new CapirBackendClient(environment.backendOrigin, deps.fetchImpl, deps.token);
  const sandboxId = args.sandboxId!;
  const { requestId, entry } = planOperation(
    deps.journal,
    "sandbox.stop",
    environment,
    { sandbox_id: sandboxId },
    args.requestId,
    sandboxId,
  );
  deps.journal.updateStatus(requestId, "dispatched");
  let accepted;
  try {
    accepted = await client.stop(sandboxId, requestId);
  } catch (error) {
    if (error instanceof CapirCliError && error.code === "CAPIR_TRANSPORT") {
      deps.journal.updateStatus(requestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TRANSPORT_AMBIGUOUS",
        EXIT.INFRASTRUCTURE,
        "The stop request may or may not have been accepted; resume the SAME operation with --request-id.",
        {
          recoverableRequestId: requestId,
          clientState: requestIds(deps.journal.find(requestId), requestId),
        },
      );
    }
    throw error;
  }
  // Never report `deleted` from the accepted request: poll the real readback.
  let state = accepted.sandbox.state;
  let last = accepted.sandbox;
  const deadline = Date.now() + args.waitSeconds * 1000;
  let polls = 0;
  for (;;) {
    try {
      const current = await client.readSandbox(sandboxId, {
        timeoutMs: polls === 0 && args.waitSeconds === 0
          ? 5_000 : Math.max(1, Math.min(30_000, deadline - Date.now())),
      });
      polls++;
      last = current.sandbox;
      state = last.state;
    } catch {
      deps.journal.updateStatus(requestId, "ambiguous");
      throw new CapirCliError(
        "CAPIR_TRANSPORT_AMBIGUOUS", EXIT.INFRASTRUCTURE,
        "The stop was accepted, but cleanup readback could not be confirmed; resume the SAME operation with --request-id.",
        { recoverableRequestId: requestId,
          clientState: requestIds(deps.journal.find(requestId), requestId) },
      );
    }
    if (TERMINAL_STATES.has(state) || Date.now() >= deadline) break;
    await deps.sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
  }
  deps.journal.updateStatus(requestId, "completed");
  const run: Record<string, unknown> = {
    request_id: requestId,
    resumed: Boolean(entry),
    sandbox: last,
    cleanup: { observed_state: state, polls, waited_seconds: args.waitSeconds },
    client_state: requestIds(deps.journal.find(requestId), requestId),
  };
  if (state === "deleted") return run;
  if (state === "cleanup_failed") {
    throw new CapirCliError(
      "CAPIR_CLEANUP_FAILED",
      EXIT.INFRASTRUCTURE,
      "Cleanup failed and the sandbox is not deleted; retry the same stop operation id to retry cleanup.",
      { run },
    );
  }
  if (state === "failed") {
    throw new CapirCliError(
      "CAPIR_SANDBOX_FAILED",
      EXIT.INFRASTRUCTURE,
      "The sandbox projection reports failed, not deleted; no deleted claim is made.",
      { run },
    );
  }
  throw new CapirCliError(
    "CAPIR_STOP_INCOMPLETE",
    EXIT.INFRASTRUCTURE,
    `Cleanup is still in progress (observed state "${state}"); nothing is reported as deleted.`,
    { run },
  );
}
