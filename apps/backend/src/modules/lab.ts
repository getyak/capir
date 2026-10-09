import { randomBytes, randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type CompareLabScenarioRequest,
  type CreateRealityReceiptRequest,
  type LabComparison,
  type LabComparisonResponse,
  type LabEvalCase,
  type LabEvalCaseResponse,
  type LabManifestResponse,
  type LabRun,
  type LabRunResponse,
  type LabSession,
  type LabSessionResponse,
  type LabVersionEnvelope,
  type PromoteRealityReceiptRequest,
  type RealityReceipt,
  type RealityReceiptResponse,
  type RunLabScenarioRequest,
  type StartLabSessionRequest,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { digestValue, sha256 } from "../lib/hash.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  compareLabScenarioOutputs,
  getLabScenario,
  labScenarioOutput,
  listLabScenarios,
  summarizeLabOutput,
} from "./labScenarios.js";

interface LabSessionRow {
  id: string;
  scenario_id: string;
  scenario_revision: string;
  snapshot_hash: string;
  workspace_ref: string;
  environment: "FAT";
  tester_identity: string;
  status: "active" | "expired" | "closed";
  active_envelope: LabVersionEnvelope;
  canonical_isolation: true;
  production_data_access: false;
  write_boundary: "lab_only";
  started_at: Date | string;
  expires_at: Date | string;
}

interface LabRunRow {
  id: string;
  session_id: string;
  scenario_id: string;
  scenario_revision: string;
  variant: "baseline" | "candidate";
  snapshot_hash: string;
  output_hash: string;
  version_envelope: LabVersionEnvelope;
  output: LabRun["output"];
  trace_id: string;
  deterministic: true;
  canonical_revision_before: number;
  canonical_revision_after: number;
  created_at: Date | string;
}

interface LabEvalCaseRow {
  id: string;
  case_ref: string;
  version: number;
  source_receipt_id: string;
  scenario_id: string;
  scenario_revision: string;
  snapshot_hash: string;
  expected_behavior: string;
  observed_regression: string;
  partition: "dev";
  lifecycle: "active";
  adjudication: "human_gold";
  release_gate: "candidate_blocking";
  reviewer_note: string;
  promoted_by_user_id: string;
  created_at: Date | string;
}

interface RealityReceiptRow {
  id: string;
  display_ref: string;
  session_id: string;
  run_id: string;
  scenario_id: string;
  scenario_revision: string;
  expected: string;
  actual: string;
  issue_summary: string;
  snapshot_hash: string;
  output_hash: string;
  version_envelope: LabVersionEnvelope;
  trace_id: string;
  canonical_revision: number;
  reproduced: boolean;
  screenshot_state: "redacted_surface_snapshot";
  redaction_applied: true;
  status: "recorded" | "promoted";
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function labCapability(config: BackendConfig) {
  const internalBuild = config.internalLabEnabled === true;
  return {
    enabled: internalBuild,
    reason: !internalBuild
      ? "Internal Lab is disabled for this backend build."
      : null,
    internal_build_required: true as const,
    synthetic_evidence_only: true as const,
    production_data_access: false as const,
    canonical_write_access: false as const,
    external_effect_access: false as const,
  };
}

function assertLabCapability(config: BackendConfig): void {
  const capability = labCapability(config);
  if (!capability.enabled) {
    throw new ApiError(
      403,
      "LAB_CAPABILITY_DENIED",
      capability.reason ?? "capri Lab is unavailable.",
    );
  }
}

function sessionFromRow(row: LabSessionRow): LabSession {
  const scenario = getLabScenario(row.scenario_id);
  if (
    !scenario ||
    scenario.revision !== row.scenario_revision ||
    scenario.snapshot_hash !== row.snapshot_hash
  ) {
    throw new ApiError(
      409,
      "LAB_SCENARIO_VERSION_UNAVAILABLE",
      "The Lab session points to a scenario version that is no longer available.",
    );
  }
  const { baseline_output: _baseline, candidate_output: _candidate, difference_impacts: _impacts, ...summary } = scenario;
  return {
    id: row.id,
    scenario: summary,
    environment: row.environment,
    workspace_ref: row.workspace_ref,
    tester_identity: row.tester_identity,
    status: row.status,
    canonical_isolation: row.canonical_isolation,
    production_data_access: row.production_data_access,
    write_boundary: row.write_boundary,
    active_envelope: row.active_envelope,
    started_at: iso(row.started_at),
    expires_at: iso(row.expires_at),
  };
}

function runFromRow(row: LabRunRow): LabRun {
  return {
    id: row.id,
    session_id: row.session_id,
    scenario_id: row.scenario_id,
    scenario_revision: row.scenario_revision,
    variant: row.variant,
    snapshot_hash: row.snapshot_hash,
    output_hash: row.output_hash,
    envelope: row.version_envelope,
    output: row.output,
    trace_id: row.trace_id,
    deterministic: row.deterministic,
    canonical_revision_before: row.canonical_revision_before,
    canonical_revision_after: row.canonical_revision_after,
    created_at: iso(row.created_at),
  };
}

function evalCaseFromRow(row: LabEvalCaseRow): LabEvalCase {
  return {
    ...row,
    created_at: iso(row.created_at),
  };
}

function receiptFromRow(row: RealityReceiptRow): RealityReceipt {
  return {
    id: row.id,
    display_ref: row.display_ref,
    session_id: row.session_id,
    run_id: row.run_id,
    scenario_id: row.scenario_id,
    scenario_revision: row.scenario_revision,
    expected: row.expected,
    actual: row.actual,
    issue_summary: row.issue_summary,
    snapshot_hash: row.snapshot_hash,
    output_hash: row.output_hash,
    envelope: row.version_envelope,
    trace_id: row.trace_id,
    canonical_revision: row.canonical_revision,
    reproduced: row.reproduced,
    screenshot_state: row.screenshot_state,
    redaction_applied: row.redaction_applied,
    status: row.status,
    created_at: iso(row.created_at),
  };
}

async function activeLabSession(
  pool: Pool,
  auth: AuthContext,
): Promise<LabSession | null> {
  await pool.query(
    `UPDATE lab_sessions
     SET status = 'expired', closed_at = now()
     WHERE account_id = $1 AND started_by_user_id = $2
       AND status = 'active' AND expires_at <= now()`,
    [auth.accountId, auth.userId],
  );
  const result = await pool.query<LabSessionRow>(
    `SELECT id, scenario_id, scenario_revision, snapshot_hash, workspace_ref,
            environment, tester_identity, status, active_envelope,
            canonical_isolation, production_data_access, write_boundary,
            started_at, expires_at
     FROM lab_sessions
     WHERE account_id = $1 AND started_by_user_id = $2 AND status = 'active'
     ORDER BY started_at DESC, id
     LIMIT 1`,
    [auth.accountId, auth.userId],
  );
  return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
}

async function listLabEvalCases(
  pool: Pool,
  auth: AuthContext,
): Promise<LabEvalCase[]> {
  const result = await pool.query<LabEvalCaseRow>(
    `SELECT id, case_ref, version, source_receipt_id, scenario_id,
            scenario_revision, snapshot_hash, expected_behavior,
            observed_regression, partition, lifecycle, adjudication,
            release_gate, reviewer_note, promoted_by_user_id, created_at
     FROM lab_eval_cases
     WHERE account_id = $1
     ORDER BY created_at DESC, id
     LIMIT 50`,
    [auth.accountId],
  );
  return result.rows.map(evalCaseFromRow);
}

async function latestLabRun(
  pool: Pool,
  auth: AuthContext,
  sessionId: string,
): Promise<LabRun | null> {
  const result = await pool.query<LabRunRow>(
    `SELECT id, session_id, scenario_id, scenario_revision, variant,
            snapshot_hash, output_hash, version_envelope, output, trace_id,
            deterministic, canonical_revision_before,
            canonical_revision_after, created_at
     FROM lab_runs
     WHERE account_id = $1 AND session_id = $2
     ORDER BY created_at DESC, id
     LIMIT 1`,
    [auth.accountId, sessionId],
  );
  return result.rows[0] ? runFromRow(result.rows[0]) : null;
}

export async function getLabManifest(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
): Promise<LabManifestResponse> {
  const capability = labCapability(config);
  if (!capability.enabled) {
    return {
      contract_version: CONTRACT_VERSION,
      capability,
      environment: "FAT",
      scenarios: [],
      active_session: null,
      latest_run: null,
      eval_cases: [],
    };
  }
  const [activeSession, evalCases] = await Promise.all([
    activeLabSession(pool, auth),
    listLabEvalCases(pool, auth),
  ]);
  const latestRun = activeSession
    ? await latestLabRun(pool, auth, activeSession.id)
    : null;
  return {
    contract_version: CONTRACT_VERSION,
    capability,
    environment: "FAT",
    scenarios: listLabScenarios(),
    active_session: activeSession,
    latest_run: latestRun,
    eval_cases: evalCases,
  };
}

function replayBody<T>(claim: IdempotencyClaim): T | null {
  return claim.replay ? (claim.replay.body as T) : null;
}

async function lockedSession(
  client: PoolClient,
  auth: AuthContext,
  sessionId: string,
): Promise<LabSessionRow> {
  const result = await client.query<LabSessionRow>(
    `SELECT id, scenario_id, scenario_revision, snapshot_hash, workspace_ref,
            environment, tester_identity, status, active_envelope,
            canonical_isolation, production_data_access, write_boundary,
            started_at, expires_at
     FROM lab_sessions
     WHERE account_id = $1 AND id = $2
     FOR UPDATE`,
    [auth.accountId, sessionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "LAB_SESSION_NOT_FOUND", "The Lab session was not found.");
  }
  if (row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row.status === "active") {
      await client.query(
        `UPDATE lab_sessions SET status = 'expired', closed_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, sessionId],
      );
    }
    throw new ApiError(409, "LAB_SESSION_EXPIRED", "Start a new Lab session before replaying this scenario.");
  }
  return row;
}

export async function startLabSession(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  request: StartLabSessionRequest,
): Promise<LabSessionResponse> {
  assertLabCapability(config);
  const scenario = getLabScenario(request.scenario_id);
  if (!scenario) {
    throw new ApiError(404, "LAB_SCENARIO_NOT_FOUND", "The requested Lab scenario does not exist.");
  }
  return inTransaction(pool, async (client) => {
    const claim = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "lab.session.start.v1",
      request.idempotency_key,
      request,
    );
    const replay = replayBody<LabSessionResponse>(claim);
    if (replay) return replay;

    await client.query(
      `UPDATE lab_sessions
       SET status = 'closed', closed_at = now()
       WHERE account_id = $1 AND started_by_user_id = $2 AND status = 'active'`,
      [auth.accountId, auth.userId],
    );
    const id = randomUUID();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 4 * 60 * 60 * 1_000);
    const workspaceRef = `lab_${sha256(id).slice(0, 12)}`;
    const inserted = await client.query<LabSessionRow>(
      `INSERT INTO lab_sessions(
         id, account_id, started_by_user_id, idempotency_record_id,
         scenario_id, scenario_revision, snapshot_hash, workspace_ref,
         environment, tester_identity, status, active_envelope,
         canonical_isolation, production_data_access, write_boundary,
         started_at, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         'FAT', $9, 'active', $10::jsonb,
         true, false, 'lab_only', $11, $12
       )
       RETURNING id, scenario_id, scenario_revision, snapshot_hash,
                 workspace_ref, environment, tester_identity, status,
                 active_envelope, canonical_isolation, production_data_access,
                 write_boundary, started_at, expires_at`,
      [
        id,
        auth.accountId,
        auth.userId,
        claim.id,
        scenario.id,
        scenario.revision,
        scenario.snapshot_hash,
        workspaceRef,
        scenario.demo_identity,
        JSON.stringify(scenario.candidate),
        startedAt,
        expiresAt,
      ],
    );
    const body: LabSessionResponse = {
      contract_version: CONTRACT_VERSION,
      session: sessionFromRow(inserted.rows[0]!),
    };
    await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId }, "lab_session_started", "lab_session", id, {
      scenario_id: scenario.id,
      scenario_revision: scenario.revision,
      snapshot_hash: scenario.snapshot_hash,
      canonical_isolation: true,
    });
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

function spanId(): string {
  return randomBytes(8).toString("hex");
}

function traceId(): string {
  return randomBytes(16).toString("hex");
}

async function insertReplayTrace(
  client: PoolClient,
  auth: AuthContext,
  session: LabSessionRow,
  variant: "baseline" | "candidate",
  outputHash: string,
): Promise<string> {
  const id = traceId();
  const root = spanId();
  const load = spanId();
  const interpret = spanId();
  const guard = spanId();
  const now = new Date();
  const safeAttributes = {
    "ts.lab.session_id": session.id,
    "ts.lab.scenario": session.scenario_id,
    "ts.lab.scenario_revision": session.scenario_revision,
    "ts.lab.variant": variant,
    "ts.lab.snapshot_hash": session.snapshot_hash,
    "ts.lab.output_hash": outputHash,
    "ts.lab.canonical_isolation": true,
    "ts.lab.external_effect_count": 0,
  };
  await client.query(
    `INSERT INTO telemetry_traces(
       account_id, trace_id, root_span_id, interaction_id, user_id,
       session_hash, name, surface, route, environment,
       data_classification, content_capture_status, status, error_code,
       safe_attributes, started_at, ended_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'evaluation',
       '/v1/lab/sessions/:id/runs', 'FAT', 'synthetic', 'none',
       'ok', NULL, $8::jsonb, $9, $9
     )`,
    [
      auth.accountId,
      id,
      root,
      randomUUID(),
      auth.userId,
      sha256(auth.sessionId),
      `lab.replay.${session.scenario_id}.${variant}`,
      JSON.stringify(safeAttributes),
      now,
    ],
  );
  const spans = [
    [root, null, "lab.replay", "server", safeAttributes],
    [load, root, "lab.fixture.load", "internal", {
      "ts.lab.snapshot_hash": session.snapshot_hash,
      "ts.lab.fixture_version": "lab-fixtures.v1",
    }],
    [interpret, root, "lab.signal.interpret", "internal", {
      "ts.lab.variant": variant,
      "ts.lab.output_hash": outputHash,
    }],
    [guard, root, "lab.canonical.write_guard", "internal", {
      "ts.lab.canonical_mutation_count": 0,
      "ts.lab.external_effect_count": 0,
      "ts.lab.guard": "pass",
    }],
  ] as const;
  for (const [current, parent, name, kind, attributes] of spans) {
    await client.query(
      `INSERT INTO telemetry_spans(
         account_id, trace_id, span_id, parent_span_id, name, kind,
         status, safe_attributes, artifact_refs, agent_run_id,
         agent_event_sequence, started_at, ended_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'ok', $7::jsonb, '{}', NULL, NULL, $8, $8
       )`,
      [auth.accountId, id, current, parent, name, kind, JSON.stringify(attributes), now],
    );
  }
  await client.query(
    `INSERT INTO telemetry_events(
       id, account_id, trace_id, span_id, name, safe_attributes,
       artifact_refs, occurred_at
     ) VALUES ($1, $2, $3, $4, 'lab_replay_completed', $5::jsonb, '{}', $6)`,
    [
      randomUUID(),
      auth.accountId,
      id,
      root,
      JSON.stringify({
        "ts.lab.deterministic": true,
        "ts.lab.canonical_mutation_count": 0,
      }),
      now,
    ],
  );
  for (const [name, explanation] of [
    ["lab_deterministic_replay", "The versioned fixture produced a deterministic output hash."],
    ["lab_canonical_isolation", "The Lab run recorded zero canonical mutations and zero external effects."],
  ] as const) {
    await client.query(
      `INSERT INTO eval_annotations(
         id, account_id, trace_id, span_id, evaluator_type,
         evaluator_name, evaluator_version, verdict, score,
         explanation, evidence_refs
       ) VALUES ($1, $2, $3, $4, 'deterministic', $5, '1', 'pass', 1, $6, '{}')`,
      [randomUUID(), auth.accountId, id, root, name, explanation],
    );
  }
  return id;
}

async function insertLabRun(
  client: PoolClient,
  auth: AuthContext,
  session: LabSessionRow,
  request: RunLabScenarioRequest,
  idempotencyScope: string,
): Promise<LabRun> {
  const claim = await claimIdempotency(
    client,
    { accountId: auth.accountId, actorUserId: auth.userId },
    idempotencyScope,
    request.idempotency_key,
    { session_id: session.id, ...request },
  );
  const replay = replayBody<LabRunResponse>(claim);
  if (replay) return replay.run;
  const scenario = getLabScenario(session.scenario_id);
  const output = labScenarioOutput(session.scenario_id, request.variant);
  if (!scenario || !output) {
    throw new ApiError(409, "LAB_SCENARIO_VERSION_UNAVAILABLE", "The frozen Lab scenario cannot be replayed.");
  }
  if (
    scenario.revision !== session.scenario_revision ||
    scenario.snapshot_hash !== session.snapshot_hash
  ) {
    throw new ApiError(409, "LAB_SNAPSHOT_STALE", "Start a new session for the current scenario revision.");
  }
  const outputHash = digestValue(output);
  const telemetryTraceId = await insertReplayTrace(
    client,
    auth,
    session,
    request.variant,
    outputHash,
  );
  const envelope = request.variant === "baseline" ? scenario.baseline : scenario.candidate;
  const result = await client.query<LabRunRow>(
    `INSERT INTO lab_runs(
       id, account_id, session_id, idempotency_record_id, scenario_id,
       scenario_revision, variant, snapshot_hash, output_hash,
       version_envelope, output, trace_id, deterministic,
       canonical_revision_before, canonical_revision_after
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12, true, 0, 0
     )
     RETURNING id, session_id, scenario_id, scenario_revision, variant,
               snapshot_hash, output_hash, version_envelope, output, trace_id,
               deterministic, canonical_revision_before,
               canonical_revision_after, created_at`,
    [
      randomUUID(),
      auth.accountId,
      session.id,
      claim.id,
      scenario.id,
      scenario.revision,
      request.variant,
      scenario.snapshot_hash,
      outputHash,
      JSON.stringify(envelope),
      JSON.stringify(output),
      telemetryTraceId,
    ],
  );
  const run = runFromRow(result.rows[0]!);
  const body: LabRunResponse = { contract_version: CONTRACT_VERSION, run };
  await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId }, "lab_scenario_replayed", "lab_session", session.id, {
    run_id: run.id,
    scenario_id: scenario.id,
    variant: request.variant,
    snapshot_hash: scenario.snapshot_hash,
    output_hash: outputHash,
    canonical_mutation_count: 0,
    external_effect_count: 0,
  });
  await completeIdempotency(client, claim, 201, body);
  return run;
}

export async function runLabScenario(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  sessionId: string,
  request: RunLabScenarioRequest,
): Promise<LabRunResponse> {
  assertLabCapability(config);
  return inTransaction(pool, async (client) => {
    const session = await lockedSession(client, auth, sessionId);
    const run = await insertLabRun(client, auth, session, request, "lab.run.v1");
    return { contract_version: CONTRACT_VERSION, run };
  });
}

export async function compareLabScenario(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  sessionId: string,
  request: CompareLabScenarioRequest,
): Promise<LabComparisonResponse> {
  assertLabCapability(config);
  return inTransaction(pool, async (client) => {
    const session = await lockedSession(client, auth, sessionId);
    const claim = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "lab.comparison.v1",
      request.idempotency_key,
      { session_id: sessionId, ...request },
    );
    const replay = replayBody<LabComparisonResponse>(claim);
    if (replay) return replay;

    const keyPrefix = request.idempotency_key.slice(0, 170);
    const baselineRun = await insertLabRun(
      client,
      auth,
      session,
      { variant: "baseline", idempotency_key: `${keyPrefix}:baseline` },
      "lab.comparison.run.v1",
    );
    const candidateRun = await insertLabRun(
      client,
      auth,
      session,
      { variant: "candidate", idempotency_key: `${keyPrefix}:candidate` },
      "lab.comparison.run.v1",
    );
    if (baselineRun.snapshot_hash !== candidateRun.snapshot_hash) {
      throw new ApiError(409, "LAB_COMPARISON_SNAPSHOT_MISMATCH", "Baseline and candidate must use the same frozen snapshot.");
    }
    const scenario = getLabScenario(session.scenario_id);
    if (!scenario) {
      throw new ApiError(409, "LAB_SCENARIO_VERSION_UNAVAILABLE", "The Lab comparison scenario is unavailable.");
    }
    const differences = compareLabScenarioOutputs(
      scenario,
      baselineRun.output,
      candidateRun.output,
    );
    const result = await client.query<{
      id: string;
      created_at: Date | string;
    }>(
      `INSERT INTO lab_comparisons(
         id, account_id, session_id, idempotency_record_id,
         baseline_run_id, candidate_run_id, identical_snapshot, differences,
         improved_count, regressed_count, changed_count,
         canonical_mutation_count, external_effect_count
       ) VALUES (
         $1, $2, $3, $4, $5, $6, true, $7::jsonb, $8, $9, $10, 0, 0
       ) RETURNING id, created_at`,
      [
        randomUUID(),
        auth.accountId,
        session.id,
        claim.id,
        baselineRun.id,
        candidateRun.id,
        JSON.stringify(differences),
        differences.filter((item) => item.impact === "improved").length,
        differences.filter((item) => item.impact === "regressed").length,
        differences.filter((item) => item.impact === "changed").length,
      ],
    );
    const comparison: LabComparison = {
      id: result.rows[0]!.id,
      session_id: session.id,
      baseline_run: baselineRun,
      candidate_run: candidateRun,
      identical_snapshot: true,
      differences,
      improved_count: differences.filter((item) => item.impact === "improved").length,
      regressed_count: differences.filter((item) => item.impact === "regressed").length,
      changed_count: differences.filter((item) => item.impact === "changed").length,
      canonical_mutation_count: 0,
      external_effect_count: 0,
      created_at: iso(result.rows[0]!.created_at),
    };
    const body: LabComparisonResponse = {
      contract_version: CONTRACT_VERSION,
      comparison,
    };
    await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId }, "lab_baseline_compared", "lab_session", session.id, {
      comparison_id: comparison.id,
      identical_snapshot: true,
      improved_count: comparison.improved_count,
      regressed_count: comparison.regressed_count,
      canonical_mutation_count: 0,
    });
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

export async function createRealityReceipt(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  sessionId: string,
  request: CreateRealityReceiptRequest,
): Promise<RealityReceiptResponse> {
  assertLabCapability(config);
  return inTransaction(pool, async (client) => {
    const session = await lockedSession(client, auth, sessionId);
    const claim = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "lab.reality-receipt.create.v1",
      request.idempotency_key,
      { session_id: sessionId, ...request },
    );
    const replay = replayBody<RealityReceiptResponse>(claim);
    if (replay) return replay;
    const runResult = await client.query<LabRunRow>(
      `SELECT id, session_id, scenario_id, scenario_revision, variant,
              snapshot_hash, output_hash, version_envelope, output, trace_id,
              deterministic, canonical_revision_before,
              canonical_revision_after, created_at
       FROM lab_runs
       WHERE account_id = $1 AND session_id = $2 AND id = $3
       FOR UPDATE`,
      [auth.accountId, session.id, request.run_id],
    );
    const runRow = runResult.rows[0];
    if (!runRow) {
      throw new ApiError(404, "LAB_RUN_NOT_FOUND", "The Lab run was not found in this session.");
    }
    const run = runFromRow(runRow);
    const scenario = getLabScenario(run.scenario_id);
    const replayedOutput = labScenarioOutput(run.scenario_id, run.variant);
    if (!scenario || !replayedOutput) {
      throw new ApiError(409, "LAB_SCENARIO_VERSION_UNAVAILABLE", "The Lab run can no longer be reproduced.");
    }
    const reproduced =
      run.snapshot_hash === scenario.snapshot_hash &&
      run.output_hash === digestValue(replayedOutput);
    const id = randomUUID();
    const displayRef = `RR-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const redactedSnapshot = {
      schema: "lab-redacted-surface-snapshot.v1",
      scenario_id: run.scenario_id,
      scenario_revision: run.scenario_revision,
      lifecycle: run.output.lifecycle,
      evidence_summary: run.output.evidence_summary,
      headline_hash: digestValue(run.output.headline),
      trace_ref: run.trace_id.slice(0, 12),
      surface_path: "/workspace/lab",
      contains_raw_evidence: false,
    };
    const issueSummary = `The synthetic result “${run.output.headline}” was explicitly recorded for review against the protected scenario behavior.`;
    const inserted = await client.query<RealityReceiptRow>(
      `INSERT INTO lab_reality_receipts(
         id, account_id, session_id, run_id, idempotency_record_id,
         display_ref, scenario_id, scenario_revision, expected, actual,
         issue_summary, surface_path, snapshot_hash, output_hash,
         version_envelope, trace_id, canonical_revision, reproduced,
         screenshot_state, redacted_surface_snapshot, redaction_applied, status
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15::jsonb, $16, 0, $17,
         'redacted_surface_snapshot', $18::jsonb, true, 'recorded'
       )
       RETURNING id, display_ref, session_id, run_id, scenario_id,
                 scenario_revision, expected, actual, issue_summary,
                 snapshot_hash, output_hash, version_envelope, trace_id,
                 canonical_revision, reproduced, screenshot_state,
                 redaction_applied, status, created_at`,
      [
        id,
        auth.accountId,
        session.id,
        run.id,
        claim.id,
        displayRef,
        run.scenario_id,
        run.scenario_revision,
        scenario.expected_behavior,
        summarizeLabOutput(run.output),
        issueSummary,
        "/workspace/lab",
        run.snapshot_hash,
        run.output_hash,
        JSON.stringify(run.envelope),
        run.trace_id,
        reproduced,
        JSON.stringify(redactedSnapshot),
      ],
    );
    const receipt = receiptFromRow(inserted.rows[0]!);
    const body: RealityReceiptResponse = {
      contract_version: CONTRACT_VERSION,
      receipt,
    };
    await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId }, "lab_reality_receipt_recorded", "lab_session", session.id, {
      receipt_id: receipt.id,
      run_id: run.id,
      trace_id: run.trace_id,
      reproduced,
      redaction_applied: true,
      canonical_revision: 0,
    });
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}

export async function promoteRealityReceipt(
  pool: Pool,
  config: BackendConfig,
  auth: AuthContext,
  receiptId: string,
  request: PromoteRealityReceiptRequest,
): Promise<LabEvalCaseResponse> {
  assertLabCapability(config);
  return inTransaction(pool, async (client) => {
    const claim = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "lab.reality-receipt.promote.v1",
      request.idempotency_key,
      { receipt_id: receiptId, ...request },
    );
    const replay = replayBody<LabEvalCaseResponse>(claim);
    if (replay) return replay;
    const receiptResult = await client.query<RealityReceiptRow>(
      `SELECT id, display_ref, session_id, run_id, scenario_id,
              scenario_revision, expected, actual, issue_summary,
              snapshot_hash, output_hash, version_envelope, trace_id,
              canonical_revision, reproduced, screenshot_state,
              redaction_applied, status, created_at
       FROM lab_reality_receipts
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [auth.accountId, receiptId],
    );
    const receiptRow = receiptResult.rows[0];
    if (!receiptRow) {
      throw new ApiError(404, "LAB_RECEIPT_NOT_FOUND", "The Reality Receipt was not found.");
    }
    let evalCaseResult = await client.query<LabEvalCaseRow>(
      `SELECT id, case_ref, version, source_receipt_id, scenario_id,
              scenario_revision, snapshot_hash, expected_behavior,
              observed_regression, partition, lifecycle, adjudication,
              release_gate, reviewer_note, promoted_by_user_id, created_at
       FROM lab_eval_cases
       WHERE account_id = $1 AND source_receipt_id = $2`,
      [auth.accountId, receiptId],
    );
    if (!evalCaseResult.rows[0]) {
      const id = randomUUID();
      const caseRef = `LAB-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      evalCaseResult = await client.query<LabEvalCaseRow>(
        `INSERT INTO lab_eval_cases(
           id, account_id, source_receipt_id, idempotency_record_id,
           case_ref, version, scenario_id, scenario_revision, snapshot_hash,
           expected_behavior, observed_regression, partition, lifecycle,
           adjudication, release_gate, reviewer_note, promoted_by_user_id
         ) VALUES (
           $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10,
           'dev', 'active', 'human_gold', 'candidate_blocking', $11, $12
         )
         RETURNING id, case_ref, version, source_receipt_id, scenario_id,
                   scenario_revision, snapshot_hash, expected_behavior,
                   observed_regression, partition, lifecycle, adjudication,
                   release_gate, reviewer_note, promoted_by_user_id, created_at`,
        [
          id,
          auth.accountId,
          receiptId,
          claim.id,
          caseRef,
          receiptRow.scenario_id,
          receiptRow.scenario_revision,
          receiptRow.snapshot_hash,
          receiptRow.expected,
          receiptRow.issue_summary,
          `Human reviewer explicitly promoted ${receiptRow.display_ref}; protect the versioned scenario's expected behavior.`,
          auth.userId,
        ],
      );
      await client.query(
        `UPDATE lab_reality_receipts
         SET status = 'promoted', promoted_at = now()
         WHERE account_id = $1 AND id = $2`,
        [auth.accountId, receiptId],
      );
      await client.query(
        `INSERT INTO eval_annotations(
           id, account_id, trace_id, span_id, evaluator_type,
           evaluator_name, evaluator_version, verdict, score,
           explanation, evidence_refs, created_by_user_id
         ) VALUES (
           $1, $2, $3, NULL, 'human', 'lab_reality_receipt_promoted',
           '1', 'fail', 0, $4, '{}', $5
         )`,
        [
          randomUUID(),
          auth.accountId,
          receiptRow.trace_id,
          `Promoted as ${caseRef}; human review is required before candidate release.`,
          auth.userId,
        ],
      );
    }
    const evalCase = evalCaseFromRow(evalCaseResult.rows[0]!);
    const body: LabEvalCaseResponse = {
      contract_version: CONTRACT_VERSION,
      eval_case: evalCase,
    };
    await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId }, "lab_reality_receipt_promoted", "lab_session", receiptRow.session_id, {
      receipt_id: receiptId,
      eval_case_id: evalCase.id,
      case_ref: evalCase.case_ref,
      release_gate: evalCase.release_gate,
      adjudication: evalCase.adjudication,
    });
    await completeIdempotency(client, claim, 201, body);
    return body;
  });
}
