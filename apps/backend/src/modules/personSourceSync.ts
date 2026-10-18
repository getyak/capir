import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  PERSON_SOURCE_SYNC_ATTEMPT_LIMIT,
  PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
  type PersonSourceSyncDeleteRequest,
  type PersonSourceSyncEffectiveState,
  type PersonSourceSyncListQuery,
  type PersonSourceSyncListResponse,
  type PersonSourceSyncMutationRequest,
  type PersonSourceSyncRecord,
  type PersonSourceSyncResponse,
  type PersonSourceSyncRunRecord,
  type PersonSourceSyncRunStatus,
  type PersonSourceSyncRunsResponse,
  type PersonSourceSyncStopReason,
  type PersonSourceSyncWarningCode,
  type PublicResearchPage,
  type PublicResearchRequest,
  type PublicResearchResponse,
  type ResourceCaptureRequest,
} from "@talent-signal/contracts";
import type { Pool } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { digestValue, sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import {
  canonicalPublicResearchUrl,
  loadPinnedPublicResearchPage,
  runPublicResearch,
  type CrawledPage,
  type RecurringCycleOutcome,
  type RecurringResearchCycleHooks,
  type ResearchPageLoader,
} from "./research.js";
import { assertAccountActive } from "./accountIdentity.js";
import { createResourceCaptureInTransaction } from "./resourceIntake.js";
import { isValidTimeZone } from "./timeWorkspaceShared.js";

/**
 * GET-131 one-person / one already-bound public source periodic observation.
 *
 * A durable grant is one owner's deliberate, expiring confirmation to re-read
 * ONE exact already-authorized public URL on an honest 24-hour UTC interval.
 * Every cycle freezes its request from immutable grant-time values (exact
 * canonical URL/domain plus the ORIGINAL grant actor, authorization revision
 * and time), re-derives live authority at dispatch, at EVERY page capture
 * commit and at final completion inside the SAME database transaction as the
 * write, and never fabricates a per-cycle approval or an unobserved success.
 */

export const PERSON_SOURCE_SYNC_PURPOSE =
  "Owner-confirmed periodic re-read of one bound public source for one person.";
export const PERSON_SOURCE_SYNC_DEADLINE_MINUTES = 15;
export const PERSON_SOURCE_SYNC_LEASE_MINUTES = 5;
export const PERSON_SOURCE_SYNC_CYCLE_KEY_PREFIX = "person-source-sync";
export const PERSON_SOURCE_SYNC_MAX_DISPATCH_PER_TICK = 5;
export const PERSON_SOURCE_SYNC_MAX_MATERIALIZATIONS_PER_TICK = 10;
export const PERSON_SOURCE_SYNC_WORKER_SESSION_PREFIX =
  "system:person-source-sync-worker";

export type PersonSourceSyncOperation = "create" | "pause" | "resume" | "delete";

const MAX_EXPIRY_DAYS = 366;

export function personSourceSyncCycleKey(
  grantId: string,
  dueAt: Date,
): string {
  return `${PERSON_SOURCE_SYNC_CYCLE_KEY_PREFIX}:${grantId}:${dueAt.toISOString()}`;
}

/** Stable extracted-body hash for cross-cycle UNCHANGED dedup. */
export function personSourceSyncBodyHash(text: string): string {
  return sha256(text);
}

export interface NormalizedPersonSourceSyncInput {
  person_id: string;
  relationship_context_id: string;
  seed_resource_id: string;
  source_url: string;
  time_zone: string;
  interval_seconds: typeof PERSON_SOURCE_SYNC_INTERVAL_SECONDS;
  expires_at: string;
  status: "active" | "paused";
  confirmation: "periodic_public_source_re_read";
}

function invalid(code: string, message: string): never {
  throw new ApiError(400, code, message);
}

/** Strict server-side validation of the deliberate periodic confirmation. */
function normalizePersonSourceSyncFields(
  request: PersonSourceSyncMutationRequest,
): NormalizedPersonSourceSyncInput {
  if (request.interval_seconds !== PERSON_SOURCE_SYNC_INTERVAL_SECONDS) {
    invalid(
      "PERSON_SOURCE_SYNC_INVALID",
      "The periodic observation interval is an honest 24-hour UTC duration.",
    );
  }
  if (request.confirmation !== "periodic_public_source_re_read") {
    invalid(
      "PERSON_SOURCE_SYNC_INVALID",
      "Confirm the periodic re-read explicitly; it is a separate decision from one-shot research.",
    );
  }
  if (!isValidTimeZone(request.time_zone)) {
    invalid(
      "PERSON_SOURCE_SYNC_INVALID",
      "The display time zone must be a valid IANA zone.",
    );
  }
  const expiresMs = Date.parse(request.expires_at);
  if (!Number.isFinite(expiresMs)) {
    throw new ApiError(
      422,
      "PERSON_SOURCE_SYNC_EXPIRY_INVALID",
      "The periodic observation needs a valid expiry.",
    );
  }
  let source: URL;
  try {
    source = canonicalPublicResearchUrl(request.source_url);
  } catch {
    throw new ApiError(
      422,
      "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED",
      "The confirmed public URL is not a valid HTTPS URL.",
    );
  }
  return {
    person_id: request.person_id,
    relationship_context_id: request.relationship_context_id,
    seed_resource_id: request.seed_resource_id,
    source_url: source.toString(),
    time_zone: request.time_zone,
    interval_seconds: PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
    expires_at: new Date(expiresMs).toISOString(),
    status: request.status,
    confirmation: request.confirmation,
  };
}

function assertNewPersonSourceSyncExpiry(expiresAt: string): void {
  const expiresMs = Date.parse(expiresAt);
  const now = Date.now();
  if (expiresMs <= now) {
    throw new ApiError(
      422,
      "PERSON_SOURCE_SYNC_EXPIRY_INVALID",
      "The periodic observation expiry must be in the future.",
    );
  }
  if (expiresMs > now + MAX_EXPIRY_DAYS * 86_400_000) {
    throw new ApiError(
      422,
      "PERSON_SOURCE_SYNC_EXPIRY_INVALID",
      "The periodic observation expiry is too far in the future.",
    );
  }
}

export function normalizePersonSourceSyncInput(request: PersonSourceSyncMutationRequest): NormalizedPersonSourceSyncInput {
  const input = normalizePersonSourceSyncFields(request);
  assertNewPersonSourceSyncExpiry(input.expires_at);
  return input;
}

/* ------------------------------------------------------------------ */
/* Read model: honest derived state, redaction, fixed diagnostics only  */
/* ------------------------------------------------------------------ */

interface GrantRow {
  account_id: string;
  id: string;
  created_by_user_id: string;
  subject_id: string | null;
  assignment_id: string | null;
  seed_resource_id: string | null;
  source_capture_id: string | null;
  source_capture_version: number | null;
  source_url: string | null;
  allowed_domain: string | null;
  purpose: string | null;
  time_zone: string | null;
  interval_seconds: number;
  expires_at: Date | null;
  next_due_at: Date | null;
  status: "active" | "paused" | "revoked" | "deleted";
  revision: number;
  last_operation_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  person_label: string | null;
  source_available: boolean | null;
  source_authorization_state: "authorized" | "revoked" | "expired" | null;
}

const LIVE_SOURCE_RECEIPT = `seed_receipt.source_access_state = 'available'
    AND seed_receipt.authorization_state = 'authorized'
    AND (seed_receipt.authorization_expires_at IS NULL
      OR seed_receipt.authorization_expires_at > statement_timestamp())`;

const GRANT_SOURCE_JOIN = `
  FROM person_source_sync_grants sync_grant
  LEFT JOIN subjects person
    ON person.account_id = sync_grant.account_id
   AND person.status = 'active'
   AND person.id = sync_grant.subject_id
  LEFT JOIN source_resources seed
    ON seed.account_id = sync_grant.account_id
   AND seed.id = sync_grant.seed_resource_id
  LEFT JOIN captures seed_capture
    ON seed_capture.account_id = seed.account_id
   AND seed_capture.id = seed.capture_id
  LEFT JOIN source_retention_receipts seed_receipt
    ON seed_receipt.account_id = seed_capture.account_id
   AND seed_receipt.capture_id = seed_capture.id`;

const GRANT_COLUMNS = `sync_grant.*,
  person.display_label AS person_label,
  COALESCE((
    seed.processing_state <> 'deleted'
    AND seed_capture.status = 'active'
    AND ${LIVE_SOURCE_RECEIPT}
  ), false) AS source_available,
  CASE
    WHEN seed_receipt.authorization_state = 'authorized'
      AND seed_receipt.authorization_expires_at <= statement_timestamp()
    THEN 'expired'
    ELSE seed_receipt.authorization_state
  END AS source_authorization_state`;

function grantNotFound(): ApiError {
  return new ApiError(
    404,
    "PERSON_SOURCE_SYNC_NOT_FOUND",
    "The periodic observation is not available in this account and user scope.",
  );
}

function effectiveGrantState(
  row: GrantRow,
  now: Date,
): PersonSourceSyncEffectiveState {
  if (row.status === "deleted") return "deleted";
  if (row.status === "revoked") return "revoked";
  if (row.source_available === false || row.source_available === null) {
    return row.source_authorization_state === "expired" ? "expired" : "revoked";
  }
  if (row.expires_at !== null && row.expires_at.valueOf() <= now.valueOf()) {
    return "expired";
  }
  return row.status === "paused" ? "paused" : "active";
}

function recordGrant(row: GrantRow, now: Date): PersonSourceSyncRecord {
  const contentAvailable =
    row.status !== "deleted" && row.source_available === true;
  return {
    id: row.id,
    revision: row.revision,
    last_operation_id: row.last_operation_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    status: row.status,
    effective_state: effectiveGrantState(row, now),
    content_available: contentAvailable,
    person_id: contentAvailable ? row.subject_id : null,
    person_label: contentAvailable ? row.person_label : null,
    relationship_context_id: contentAvailable ? row.assignment_id : null,
    seed_resource_id: contentAvailable ? row.seed_resource_id : null,
    source_url: contentAvailable ? row.source_url : null,
    allowed_domain: contentAvailable ? row.allowed_domain : null,
    purpose: row.status === "deleted" ? null : row.purpose,
    time_zone: row.status === "deleted" ? null : row.time_zone,
    interval_seconds: PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
    expires_at:
      row.status === "deleted" || row.expires_at === null
        ? null
        : row.expires_at.toISOString(),
    next_due_at:
      row.status === "deleted" || row.next_due_at === null
        ? null
        : row.next_due_at.toISOString(),
    authority: "user_authored",
    external_effect: "none",
  };
}

interface RunRow {
  account_id: string;
  id: string;
  grant_id: string;
  cycle_key: string;
  due_at: Date;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  frozen_seed_resource_id: string;
  frozen_source_url: string;
  frozen_allowed_domain: string;
  grant_actor_user_id: string;
  grant_authorization_revision: number;
  grant_authorized_at: Date;
  source_capture_version: number;
  task_id: string | null;
  observed_resource_id: string | null;
  observed_capture_id: string | null;
  observed_canonical_url: string | null;
  observed_body_hash: string | null;
  new_observations: number;
  warning_codes: string[] | null;
  stop_reason: PersonSourceSyncStopReason | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  content_available: boolean | null;
}

const RUN_SELECT = `SELECT run.*,
    (
      grant_row.status <> 'deleted'
      AND seed.processing_state <> 'deleted'
      AND seed_capture.status = 'active'
      AND ${LIVE_SOURCE_RECEIPT}
    ) AS content_available
  FROM person_source_sync_runs run
  JOIN person_source_sync_grants grant_row
    ON grant_row.account_id = run.account_id
   AND grant_row.id = run.grant_id
  LEFT JOIN source_resources seed
    ON seed.account_id = run.account_id
   AND seed.id = run.frozen_seed_resource_id
  LEFT JOIN captures seed_capture
    ON seed_capture.account_id = seed.account_id
   AND seed_capture.id = seed.capture_id
  LEFT JOIN source_retention_receipts seed_receipt
    ON seed_receipt.account_id = seed_capture.account_id
   AND seed_receipt.capture_id = seed_capture.id`;

/**
 * Honest run readback: an unexpired lease is "running"; an expired lease with
 * an unsettled cycle reads back as "unknown" (result unverified) until the
 * same cycle key reconciles it — never a fabricated success.
 */
export function personSourceSyncRunStatus(
  row: Pick<RunRow, "status" | "lease_expires_at">,
  now: Date,
): { status: PersonSourceSyncRunStatus; settled: boolean } {
  if (row.status === "pending") return { status: "pending", settled: false };
  if (row.status === "claimed" || row.status === "dispatched") {
    const live =
      row.lease_expires_at !== null &&
      row.lease_expires_at.valueOf() > now.valueOf();
    return live
      ? { status: "running", settled: false }
      : { status: "unknown", settled: false };
  }
  return {
    status: row.status as PersonSourceSyncRunStatus,
    settled: true,
  };
}

function recordRun(row: RunRow, now: Date): PersonSourceSyncRunRecord {
  const contentAvailable = row.content_available === true;
  const derived = personSourceSyncRunStatus(row, now);
  return {
    id: row.id,
    grant_id: row.grant_id,
    cycle_due_at: row.due_at.toISOString(),
    created_at: row.created_at.toISOString(),
    started_at: row.started_at ? row.started_at.toISOString() : null,
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    status: derived.status,
    settled: derived.settled,
    attempt_count: row.attempt_count,
    attempt_limit: PERSON_SOURCE_SYNC_ATTEMPT_LIMIT,
    deadline_at: new Date(
      row.created_at.valueOf() + PERSON_SOURCE_SYNC_DEADLINE_MINUTES * 60_000,
    ).toISOString(),
    task_id: row.task_id,
    new_observations: row.new_observations,
    content_available: contentAvailable,
    source_url: contentAvailable ? row.frozen_source_url : null,
    observed_canonical_url: contentAvailable ? row.observed_canonical_url : null,
    warning_codes: (row.warning_codes ?? []) as PersonSourceSyncWarningCode[],
    stop_reason: row.stop_reason,
    authority: "unconfirmed",
    external_effect: "none",
  };
}

async function readGrant(
  client: DatabaseClient,
  auth: AuthContext,
  id: string,
  lock = false,
): Promise<GrantRow | null> {
  return (
    await client.query<GrantRow>(
      `SELECT ${GRANT_COLUMNS}${GRANT_SOURCE_JOIN}
       WHERE sync_grant.account_id = $1 AND sync_grant.id = $2 AND sync_grant.created_by_user_id = $3${
         lock ? " FOR UPDATE OF sync_grant" : ""
       }`,
      [auth.accountId, id, auth.userId],
    )
  ).rows[0] ?? null;
}

export async function listPersonSourceSyncs(
  pool: Pool | DatabaseClient,
  auth: AuthContext,
  query: PersonSourceSyncListQuery,
): Promise<PersonSourceSyncListResponse> {
  const result = await pool.query<GrantRow>(
    `SELECT ${GRANT_COLUMNS}${GRANT_SOURCE_JOIN}
     WHERE sync_grant.account_id = $1
       AND sync_grant.created_by_user_id = $2
       AND sync_grant.subject_id = $3
       AND sync_grant.assignment_id = $4
       AND ($5::uuid IS NULL OR sync_grant.seed_resource_id = $5)
     ORDER BY sync_grant.created_at DESC, sync_grant.id DESC
     LIMIT 10`,
    [
      auth.accountId,
      auth.userId,
      query.person_id,
      query.relationship_context_id,
      query.seed_resource_id ?? null,
    ],
  );
  const now = new Date();
  return {
    contract_version: CONTRACT_VERSION,
    syncs: result.rows.map((row) => recordGrant(row, now)),
  };
}

export async function getPersonSourceSync(
  pool: Pool | DatabaseClient,
  auth: AuthContext,
  id: string,
): Promise<PersonSourceSyncResponse> {
  const row = await readGrant(pool, auth, id.toLowerCase());
  if (!row) throw grantNotFound();
  return {
    contract_version: CONTRACT_VERSION,
    sync: recordGrant(row, new Date()),
  };
}

export async function listPersonSourceSyncRuns(
  pool: Pool | DatabaseClient,
  auth: AuthContext,
  id: string,
): Promise<PersonSourceSyncRunsResponse> {
  const grantID = id.toLowerCase();
  const grant = await readGrant(pool, auth, grantID);
  if (!grant) throw grantNotFound();
  const result = await pool.query<RunRow>(
    `${RUN_SELECT}
     WHERE run.account_id = $1 AND run.grant_id = $2
     ORDER BY run.created_at DESC, run.id DESC
     LIMIT 21`,
    [auth.accountId, grantID],
  );
  const now = new Date();
  return {
    contract_version: CONTRACT_VERSION,
    grant_id: grantID,
    runs: result.rows.slice(0, 20).map((row) => recordRun(row, now)),
    complete: result.rows.length <= 20,
  };
}

/* ------------------------------------------------------------------ */
/* Grant mutations: owner-scoped CAS, idempotency, redaction receipts   */
/* ------------------------------------------------------------------ */

interface OperationRow {
  grant_id: string;
  operation: PersonSourceSyncOperation;
  request_hash: string;
  resulting_revision: number;
}

async function lockGrantIdentity(
  client: DatabaseClient,
  auth: AuthContext,
  grantID: string,
): Promise<void> {
  // Serialize every mutation of one grant identity before the per-operation
  // idempotency lock, mirroring time_schedules.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `person-source-sync:${auth.accountId}:${grantID}`,
  ]);
}

async function assertPersonActive(
  client: DatabaseClient,
  auth: AuthContext,
  personID: string,
): Promise<void> {
  // FOR SHARE keeps the selected Person row alive until commit so a concurrent
  // archive cannot land between validation and the grant write.
  const found = await client.query(
    `SELECT 1 FROM subjects
     WHERE account_id=$1 AND id=$2 AND status='active'
     FOR SHARE`,
    [auth.accountId, personID],
  );
  if (!found.rowCount) {
    throw new ApiError(
      400,
      "PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE",
      "The selected Person is not active in this account.",
    );
  }
}

async function replayOperation(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    grantID: string;
    idempotencyKey: string;
    operation: PersonSourceSyncOperation;
    requestHash: string;
  },
): Promise<PersonSourceSyncResponse | null> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${auth.accountId}:${auth.userId}:${input.idempotencyKey}`,
  ]);
  const operation = (
    await client.query<OperationRow>(
      `SELECT grant_id,operation,request_hash,resulting_revision
       FROM person_source_sync_operations
       WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`,
      [auth.accountId, auth.userId, input.idempotencyKey],
    )
  ).rows[0];
  if (!operation) return null;
  if (
    operation.grant_id !== input.grantID ||
    operation.operation !== input.operation ||
    operation.request_hash !== input.requestHash
  ) {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_INTENT_CONFLICT",
      "This operation identity belongs to a different periodic observation intent.",
    );
  }
  const row = await readGrant(client, auth, input.grantID);
  if (!row) throw grantNotFound();
  return {
    contract_version: CONTRACT_VERSION,
    sync: recordGrant(row, new Date()),
  };
}

async function recordOperation(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    grantID: string;
    idempotencyKey: string;
    operation: PersonSourceSyncOperation;
    requestHash: string;
    resultingRevision: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO person_source_sync_operations(
       account_id,actor_user_id,idempotency_key,grant_id,operation,
       request_hash,resulting_revision
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      auth.accountId,
      auth.userId,
      input.idempotencyKey,
      input.grantID,
      input.operation,
      input.requestHash,
      input.resultingRevision,
    ],
  );
}

interface SeedEligibility {
  source_capture_id: string;
  source_capture_version: number;
  source_url: string;
  allowed_domain: string;
}

/**
 * The already-bound public source must satisfy the exact `loadSeed`
 * conditions: active bound capture on this person/context, available
 * resource, authorized and unexpired receipt. The grant freezes the exact
 * canonical URL/domain and the source authorization revision here.
 */
async function assertSeedEligible(
  client: DatabaseClient,
  auth: AuthContext,
  input: NormalizedPersonSourceSyncInput,
): Promise<SeedEligibility> {
  const result = await client.query<{
    id: string;
    capture_id: string;
    source_locator: string | null;
    capture_status: string;
    identity_status: string;
    capture_subject_id: string | null;
    capture_assignment_id: string | null;
    capture_version: number;
    authorization_state: "authorized" | "revoked" | "expired";
    authorization_expires_at: Date | null;
  }>(
    `SELECT
       resources.id,
       resources.capture_id,
       resources.source_locator,
       captures.status AS capture_status,
       captures.identity_status,
       captures.subject_id AS capture_subject_id,
       captures.assignment_id AS capture_assignment_id,
       captures.version AS capture_version,
       receipts.authorization_state,
       receipts.authorization_expires_at
     FROM source_resources resources
     JOIN captures
       ON captures.account_id = resources.account_id
      AND captures.id = resources.capture_id
     JOIN source_retention_receipts receipts
       ON receipts.account_id = captures.account_id
      AND receipts.capture_id = captures.id
     WHERE resources.account_id = $1
       AND resources.id = $2
       AND resources.resource_kind = 'public_url'
       AND resources.processing_state <> 'deleted'`,
    [auth.accountId, input.seed_resource_id],
  );
  const seed = result.rows[0];
  if (
    !seed ||
    !seed.source_locator ||
    seed.capture_status !== "active" ||
    seed.identity_status !== "bound" ||
    seed.capture_subject_id !== input.person_id ||
    seed.capture_assignment_id !== input.relationship_context_id
  ) {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE",
      "This public URL is not an active bound source for the selected Person and relationship.",
    );
  }
  if (seed.authorization_state === "revoked") {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_SOURCE_NOT_AUTHORIZED",
      "This source access is revoked; restore its authorization before confirming periodic reads.",
    );
  }
  if (
    seed.authorization_state === "expired" ||
    (seed.authorization_expires_at !== null &&
      seed.authorization_expires_at.valueOf() <= Date.now())
  ) {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_SOURCE_NOT_AUTHORIZED",
      "This source authorization expired; renew it before confirming periodic reads.",
    );
  }
  const liveUrl = canonicalPublicResearchUrl(seed.source_locator).toString();
  const frozenUrl = canonicalPublicResearchUrl(input.source_url).toString();
  if (liveUrl !== frozenUrl) {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED",
      "The confirmed URL does not exactly match the bound source URL.",
    );
  }
  return {
    source_capture_id: seed.capture_id,
    source_capture_version: seed.capture_version,
    source_url: frozenUrl,
    allowed_domain: new URL(frozenUrl).hostname.toLowerCase(),
  };
}

export async function putPersonSourceSync(
  pool: Pool,
  auth: AuthContext,
  id: string,
  request: PersonSourceSyncMutationRequest,
): Promise<PersonSourceSyncResponse> {
  const grantID = id.toLowerCase();
  const idempotencyKey = request.idempotency_key.toLowerCase();
  const input = normalizePersonSourceSyncFields(request);
  const operation: PersonSourceSyncOperation =
    request.expected_revision === 0
      ? "create"
      : input.status === "active"
        ? "resume"
        : "pause";
  const requestHash = digestValue({
    operation,
    id: grantID,
    expected_revision: request.expected_revision,
    input,
  });
  return inTransaction(pool, async (client) => {
    await lockGrantIdentity(client, auth, grantID);
    const replay = await replayOperation(client, auth, {
      grantID,
      idempotencyKey,
      operation,
      requestHash,
    });
    if (replay) return replay;
    // Historical receipts remain readable after their fixed expiry. Only a
    // genuinely new intent must pass the live expiry check.
    assertNewPersonSourceSyncExpiry(input.expires_at);
    if (operation === "create") {
      if (await readGrant(client, auth, grantID, true)) {
        throw new ApiError(
          409,
          "PERSON_SOURCE_SYNC_EXISTS",
          "This periodic observation already exists; read it before editing.",
        );
      }
      await assertPersonActive(client, auth, input.person_id);
      const eligibility = await assertSeedEligible(client, auth, input);
      const now = new Date();
      try {
        await client.query(
          `INSERT INTO person_source_sync_grants(
             account_id,id,created_by_user_id,subject_id,assignment_id,
             seed_resource_id,source_capture_id,source_capture_version,
             source_url,allowed_domain,purpose,time_zone,interval_seconds,
             expires_at,next_due_at,status,external_effect,revision,
             last_operation_id,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$18,'none',1,$16,$17,$17)`,
          [
            auth.accountId,
            grantID,
            auth.userId,
            input.person_id,
            input.relationship_context_id,
            input.seed_resource_id,
            eligibility.source_capture_id,
            eligibility.source_capture_version,
            eligibility.source_url,
            eligibility.allowed_domain,
            PERSON_SOURCE_SYNC_PURPOSE,
            input.time_zone,
            PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
            input.expires_at,
            // A new active grant is due immediately; a legal initial paused
            // grant is inert until an explicit valid resume (R1).
            now,
            idempotencyKey,
            now,
            input.status,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ApiError(
            409,
            "PERSON_SOURCE_SYNC_EXISTS",
            "One periodic observation already covers this Person; read it before creating another.",
          );
        }
        throw error;
      }
      const inserted = await readGrant(client, auth, grantID, true);
      if (!inserted) throw grantNotFound();
      await appendAudit(
        client,
        { accountId: auth.accountId, actorUserId: auth.userId },
        "person_source_sync.created",
        "person_source_sync_grant",
        grantID,
        {
          external_effect: "none",
          person_id: input.person_id,
          relationship_context_id: input.relationship_context_id,
          seed_resource_id: input.seed_resource_id,
          interval_seconds: PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
          expires_at: input.expires_at,
          revision: inserted.revision,
        },
      );
      await recordOperation(client, auth, {
        grantID,
        idempotencyKey,
        operation,
        requestHash,
        resultingRevision: inserted.revision,
      });
      return {
        contract_version: CONTRACT_VERSION,
        sync: recordGrant(inserted, now),
      };
    }
    const existing = await readGrant(client, auth, grantID, true);
    if (!existing) throw grantNotFound();
    if (existing.status === "deleted") {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_DELETED",
        "This periodic observation was deleted and cannot be edited.",
      );
    }
    // Person liveness is checked AFTER the grant row lock so grant mutations
    // keep the frozen grant→person lock order (R6).
    await assertPersonActive(client, auth, input.person_id);
    const now = new Date();
    if (effectiveGrantState(existing, now) === "expired") {
      // An expired grant never silently revives; the owner must confirm a
      // fresh grant with a fresh expiry.
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_GRANT_EXPIRED",
        "This periodic observation expired; confirm a new one to continue.",
      );
    }
    if (existing.revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_REVISION_CONFLICT",
        "Read the current periodic observation before changing it.",
      );
    }
    if (
      existing.subject_id !== input.person_id ||
      existing.assignment_id !== input.relationship_context_id ||
      existing.seed_resource_id !== input.seed_resource_id ||
      (existing.time_zone ?? null) !== input.time_zone ||
      (existing.expires_at?.toISOString() ?? null) !== input.expires_at ||
      canonicalPublicResearchUrl(existing.source_url ?? input.source_url).toString() !==
        input.source_url
    ) {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_INTENT_CONFLICT",
        "Person, source, zone and expiry are fixed for one grant; create a new grant to change them.",
      );
    }
    if (existing.status === input.status) {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_UNCHANGED",
        input.status === "active"
          ? "This periodic observation is already active."
          : "This periodic observation is already paused.",
      );
    }
    await client.query(
      `UPDATE person_source_sync_grants SET
         status=$4,
         next_due_at = CASE WHEN $4 = 'active' THEN now() ELSE next_due_at END,
         revision=revision+1,last_operation_id=$5,updated_at=clock_timestamp()
       WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3`,
      [auth.accountId, grantID, auth.userId, input.status, idempotencyKey],
    );
    const updated = await readGrant(client, auth, grantID, true);
    if (!updated) throw grantNotFound();
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      input.status === "active"
        ? "person_source_sync.resumed"
        : "person_source_sync.paused",
      "person_source_sync_grant",
      grantID,
      {
        external_effect: "none",
        status: updated.status,
        revision: updated.revision,
      },
    );
    await recordOperation(client, auth, {
      grantID,
      idempotencyKey,
      operation,
      requestHash,
      resultingRevision: updated.revision,
    });
    return {
      contract_version: CONTRACT_VERSION,
      sync: recordGrant(updated, now),
    };
  });
}

export async function deletePersonSourceSync(
  pool: Pool,
  auth: AuthContext,
  id: string,
  request: PersonSourceSyncDeleteRequest,
): Promise<PersonSourceSyncResponse> {
  const grantID = id.toLowerCase();
  const idempotencyKey = request.idempotency_key.toLowerCase();
  const requestHash = digestValue({
    operation: "delete",
    id: grantID,
    expected_revision: request.expected_revision,
    idempotency_key: idempotencyKey,
  });
  return inTransaction(pool, async (client) => {
    await lockGrantIdentity(client, auth, grantID);
    const replay = await replayOperation(client, auth, {
      grantID,
      idempotencyKey,
      operation: "delete",
      requestHash,
    });
    if (replay) return replay;
    const existing = await readGrant(client, auth, grantID, true);
    if (!existing) throw grantNotFound();
    if (existing.status === "deleted") {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_ALREADY_DELETED",
        "This periodic observation was already deleted.",
      );
    }
    if (existing.revision !== request.expected_revision) {
      throw new ApiError(
        409,
        "PERSON_SOURCE_SYNC_REVISION_CONFLICT",
        "Read the current periodic observation before deleting it.",
      );
    }
    // Identity-only receipt: content is redacted in place while the operation
    // receipt survives a lost response, mirroring time_schedules deletion.
    await client.query(
      `UPDATE person_source_sync_grants SET
         subject_id=NULL,assignment_id=NULL,seed_resource_id=NULL,
         source_capture_id=NULL,source_capture_version=NULL,
         source_url=NULL,allowed_domain=NULL,purpose=NULL,time_zone=NULL,
         expires_at=NULL,next_due_at=NULL,
         status='deleted',deleted_at=clock_timestamp(),
         revision=revision+1,last_operation_id=$4,updated_at=clock_timestamp()
       WHERE account_id=$1 AND id=$2 AND created_by_user_id=$3`,
      [auth.accountId, grantID, auth.userId, idempotencyKey],
    );
    const deleted = await readGrant(client, auth, grantID, true);
    if (!deleted) throw grantNotFound();
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "person_source_sync.deleted",
      "person_source_sync_grant",
      grantID,
      {
        external_effect: "none",
        disposition: "deleted",
        revision: deleted.revision,
      },
    );
    await recordOperation(client, auth, {
      grantID,
      idempotencyKey,
      operation: "delete",
      requestHash,
      resultingRevision: deleted.revision,
    });
    return {
      contract_version: CONTRACT_VERSION,
      sync: recordGrant(deleted, new Date()),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Authority gate: one predicate re-derived from the DB at every step   */
/* ------------------------------------------------------------------ */

export type PersonSourceSyncGateResult =
  | { ok: true; reason: null }
  | { ok: false; reason: PersonSourceSyncStopReason };

interface AuthorityRow {
  grant_status: "active" | "paused" | "revoked" | "deleted";
  grant_expires_at: Date | null;
  grant_subject_id: string | null;
  grant_assignment_id: string | null;
  grant_source_capture_version: number | null;
  person_status: string | null;
  seed_processing_state: string | null;
  seed_source_locator: string | null;
  capture_status: string | null;
  capture_identity_status: string | null;
  capture_subject_id: string | null;
  capture_assignment_id: string | null;
  capture_version: number | null;
  authorization_state: string | null;
  authorization_expires_at: Date | null;
  grant_expired: boolean;
  authorization_expired: boolean;
}

/**
 * Live authority for one cycle: active account, live non-expired grant,
 * active Person, still-available bound seed with an authorized unexpired
 * receipt at the SAME source authorization revision the grant froze, and the
 * exact frozen canonical URL. Pause/revoke/expiry/person archive/source
 * revocation/source expiry therefore stop every later fetch or commit.
 */
export async function personSourceSyncAuthorityGate(
  client: DatabaseClient,
  accountId: string,
  input: {
    grantId: string;
    frozenSourceUrl: string;
    sourceCaptureVersion: number;
  },
): Promise<PersonSourceSyncGateResult> {
  try {
    await assertAccountActive(client, accountId);
  } catch (error) {
    if (error instanceof ApiError && ["ACCOUNT_RETIRED", "ACCOUNT_NOT_FOUND"].includes(error.code)) {
      return { ok: false, reason: "PERSON_SOURCE_SYNC_ACCOUNT_RETIRED" };
    }
    throw error;
  }
  const result = await client.query<AuthorityRow>(
    `SELECT
       grant_row.status AS grant_status,
       grant_row.expires_at AS grant_expires_at,
       grant_row.subject_id AS grant_subject_id,
       grant_row.assignment_id AS grant_assignment_id,
       grant_row.source_capture_version AS grant_source_capture_version,
       person.status AS person_status,
       seed.processing_state AS seed_processing_state,
       seed.source_locator AS seed_source_locator,
       seed_capture.status AS capture_status,
       seed_capture.identity_status AS capture_identity_status,
       seed_capture.subject_id AS capture_subject_id,
       seed_capture.assignment_id AS capture_assignment_id,
       seed_capture.version AS capture_version,
       receipt.authorization_state,
       receipt.authorization_expires_at,
       (grant_row.expires_at IS NOT NULL
         AND grant_row.expires_at <= clock_timestamp()) AS grant_expired,
       (receipt.authorization_expires_at IS NOT NULL
         AND receipt.authorization_expires_at <= clock_timestamp()) AS authorization_expired
     FROM person_source_sync_grants grant_row
     LEFT JOIN subjects person
       ON person.account_id = grant_row.account_id
      AND person.id = grant_row.subject_id
     LEFT JOIN source_resources seed
       ON seed.account_id = grant_row.account_id
      AND seed.id = grant_row.seed_resource_id
     LEFT JOIN captures seed_capture
       ON seed_capture.account_id = seed.account_id
      AND seed_capture.id = seed.capture_id
     LEFT JOIN source_retention_receipts receipt
       ON receipt.account_id = seed_capture.account_id
      AND receipt.capture_id = seed_capture.id
     WHERE grant_row.account_id = $1
       AND grant_row.id = $2`,
    [accountId, input.grantId],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, reason: "PERSON_SOURCE_SYNC_GRANT_REVOKED" };
  if (row.grant_status === "paused") {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_GRANT_PAUSED" };
  }
  if (row.grant_status !== "active") {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_GRANT_REVOKED" };
  }
  // Live DB clock (clock_timestamp) evaluated in the same statement as the
  // fence read, never a transaction-start timestamp (B1).
  if (row.grant_expired === true) {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_GRANT_EXPIRED" };
  }
  if (row.person_status !== "active") {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE" };
  }
  if (
    !row.seed_processing_state ||
    row.seed_processing_state === "deleted" ||
    row.capture_status !== "active" ||
    row.capture_identity_status !== "bound" ||
    row.capture_subject_id !== row.grant_subject_id ||
    row.capture_assignment_id !== row.grant_assignment_id
  ) {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE" };
  }
  if (row.authorization_state === "revoked") {
    return {
      ok: false,
      reason: "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED",
    };
  }
  if (
    row.authorization_state !== "authorized" ||
    row.authorization_expired === true
  ) {
    return {
      ok: false,
      reason: "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED",
    };
  }
  if (
    row.grant_source_capture_version === null ||
    row.capture_version !== row.grant_source_capture_version
  ) {
    // Any source authorization transition moved the capture version: the
    // original grant no longer covers this source state and needs a fresh
    // explicit owner confirmation.
    return {
      ok: false,
      reason: "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED",
    };
  }
  try {
    const liveUrl = canonicalPublicResearchUrl(
      row.seed_source_locator ?? "",
    ).toString();
    if (liveUrl !== input.frozenSourceUrl) {
      return { ok: false, reason: "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED" };
    }
  } catch {
    return { ok: false, reason: "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE" };
  }
  return { ok: true, reason: null };
}

/**
 * Locks the ORIGINAL source lineage ROOT capture, the seed capture, the grant
 * and the cycle row in that order. The source authorization revoke path locks
 * the lineage root FOR UPDATE before it enumerates descendants, so a root
 * revocation and a derived observation commit serialize in either direction:
 * the commit either lands before the enumeration (and is revoked with the
 * lineage) or waits behind the revoke and then fails its live gate.
 */
export async function lockCycleIdentity(
  client: DatabaseClient,
  accountId: string,
  input: {
    rootCaptureId: string | null;
    seedCaptureId: string | null;
    grantId: string;
    runId: string;
  },
): Promise<void> {
  // ROOT first, then seed, then grant, then run: the same order the source
  // authorization revoke path establishes before it enumerates descendants.
  if (input.rootCaptureId) {
    await client.query(
      `SELECT 1 FROM captures WHERE account_id=$1 AND id=$2 FOR SHARE`,
      [accountId, input.rootCaptureId],
    );
  }
  if (input.seedCaptureId && input.seedCaptureId !== input.rootCaptureId) {
    await client.query(
      `SELECT 1 FROM captures WHERE account_id=$1 AND id=$2 FOR SHARE`,
      [accountId, input.seedCaptureId],
    );
  }
  await client.query(
    `SELECT 1 FROM person_source_sync_grants
     WHERE account_id=$1 AND id=$2 FOR UPDATE`,
    [accountId, input.grantId],
  );
  await client.query(
    `SELECT 1 FROM person_source_sync_runs
     WHERE account_id=$1 AND id=$2 FOR UPDATE`,
    [accountId, input.runId],
  );
}

/* ------------------------------------------------------------------ */
/* Cycle hooks: shared-transaction commits and honest finalization      */
/* ------------------------------------------------------------------ */

export interface PersonSourceSyncCycleContext {
  pool: Pool;
  auth: AuthContext;
  runId: string;
  grantId: string;
  executionId: string;
  /** Immutable absolute cycle boundary (created_at + 15 minutes). */
  deadlineAt: Date;
  rootCaptureId: string;
  seedCaptureId: string;
  seedResourceId: string;
  frozenSourceUrl: string;
  frozenAllowedDomain: string;
  sourceCaptureVersion: number;
  grantActorUserId: string;
  grantAuthorizationRevision: number;
  grantAuthorizedAt: Date;
}

const FIXED_WARNING_CODES = new Set<string>([
  "PUBLIC_RESEARCH_FETCH_FAILED",
  "PUBLIC_RESEARCH_CAPTURE_FAILED",
  "PUBLIC_RESEARCH_UNAVAILABLE",
  "PUBLIC_RESEARCH_RETRY_FAILED",
  "PERSON_SOURCE_SYNC_UNCHANGED",
  "PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED",
  "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
  "PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION",
  "PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED",
]);

/** Research warnings are `url: FIXED_CODE` or plain FIXED_CODE; only fixed
 * content-free codes may persist on the cycle row. */
export function personSourceSyncWarningCodes(
  warnings: readonly string[],
): PersonSourceSyncWarningCode[] {
  const codes = new Set<PersonSourceSyncWarningCode>();
  for (const warning of warnings) {
    const separator = warning.lastIndexOf(": ");
    const suffix = separator === -1 ? warning : warning.slice(separator + 2);
    if (FIXED_WARNING_CODES.has(suffix)) {
      codes.add(suffix as PersonSourceSyncWarningCode);
    }
  }
  return [...codes];
}

/**
 * A loader that may receive a transport timeout capped by the remaining
 * cycle budget; plain two-argument loaders are assignable.
 */
export type BoundedPageLoader = (
  url: URL,
  allowedHostname: string,
  options?: { timeoutMs?: number },
) => Promise<CrawledPage>;

/**
 * Builds the injected recurring hooks used by runPublicResearch. Every hook
 * re-derives live authority from the database INSIDE the same transaction as
 * the write it guards; there is no outer-callback illusion and no
 * closure-only authority. The immutable cycle deadline and live lease gate
 * every page commit and the final receipt write with database time.
 */
export function createPersonSourceSyncCycleHooks(
  context: PersonSourceSyncCycleContext,
): RecurringResearchCycleHooks {
  const { pool, auth, runId, executionId } = context;
  return {
    runId,
    boundary: { deadlineAt: context.deadlineAt },
    approval: {
      approvedByUserId: context.grantActorUserId,
      approvedAt: context.grantAuthorizedAt,
      authorizationScope:
        `Periodic public source observation authorized by the original owner ` +
        `grant ${context.grantId} (revision ${context.grantAuthorizationRevision}) ` +
        `for ${context.frozenAllowedDomain}; exactly 1 page at link depth 0 on an ` +
        `honest 24-hour UTC interval.`,
      grantId: context.grantId,
    },
    /**
     * Live re-admission with database time (clock_timestamp) before DNS, the
     * research lease claim and transport: throws when the cycle's lease,
     * immutable deadline or authority no longer allows this work (B2).
     */
    async admit(client: DatabaseClient = pool): Promise<void> {
      // Authority may itself await a retirement lock or source read. Check the
      // live cycle AFTER it returns, using the caller's transaction if any.
      const gate = await personSourceSyncAuthorityGate(client, auth.accountId, {
        grantId: context.grantId,
        frozenSourceUrl: context.frozenSourceUrl,
        sourceCaptureVersion: context.sourceCaptureVersion,
      });
      if (!gate.ok) {
        throw new ApiError(409, gate.reason,
          "The periodic cycle authority ended before research continued.");
      }
      const admission = await cycleAdmissionRow(client, auth.accountId, runId, executionId);
      if (!admission?.lease_ok) {
        throw new ApiError(409, "PERSON_SOURCE_SYNC_LEASE_LOST",
          "The periodic observation cycle execution is no longer live.");
      }
      if (!admission.deadline_ok) {
        throw new ApiError(409, "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
          "The periodic cycle deadline elapsed before research continued.");
      }
    },
    async recordTask(taskId: string): Promise<void> {
      await pool.query(
        `UPDATE person_source_sync_runs SET
           task_id=$3,status='dispatched',updated_at=clock_timestamp()
         WHERE account_id=$1 AND id=$2
           AND lease_owner=$4
           AND lease_expires_at > clock_timestamp()
           AND status IN ('claimed','dispatched')`,
        [auth.accountId, runId, taskId, executionId],
      );
    },
    async commitPage(
      page: CrawledPage,
      request: ResourceCaptureRequest,
    ): Promise<{
      committed: PublicResearchPage | null;
      unchanged: boolean;
      stop: boolean;
    }> {
      return inTransaction(pool, async (client) => {
        // ONE transaction for lineage locks, the live authority gate, the
        // cycle lease/deadline gate and the capture commit
        // (createResourceCaptureInTransaction), so a pause/revoke or an
        // elapsed cycle deadline can never commit new evidence.
        await lockCycleIdentity(client, auth.accountId, {
          rootCaptureId: context.rootCaptureId,
          seedCaptureId: context.seedCaptureId,
          grantId: context.grantId,
          runId,
        });
        const gate = await personSourceSyncAuthorityGate(client, auth.accountId, {
          grantId: context.grantId,
          frozenSourceUrl: context.frozenSourceUrl,
          sourceCaptureVersion: context.sourceCaptureVersion,
        });
        if (!gate.ok) {
          await client.query(
            `UPDATE person_source_sync_runs SET
               stop_reason=COALESCE(stop_reason,$3),updated_at=clock_timestamp()
             WHERE account_id=$1 AND id=$2`,
            [auth.accountId, runId, gate.reason],
          );
          return { committed: null, unchanged: false, stop: true };
        }
        const admission = await cycleAdmissionRow(client, auth.accountId, runId, executionId);
        if (!admission?.lease_ok) {
          await client.query(
            `UPDATE person_source_sync_runs SET
               stop_reason=COALESCE(stop_reason,'PERSON_SOURCE_SYNC_LEASE_LOST'),
               updated_at=clock_timestamp()
             WHERE account_id=$1 AND id=$2`,
            [auth.accountId, runId],
          );
          return { committed: null, unchanged: false, stop: true };
        }
        if (!admission.deadline_ok) {
          // No capture may be committed after the immutable cycle deadline.
          await client.query(
            `UPDATE person_source_sync_runs SET
               stop_reason=COALESCE(stop_reason,'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED'),
               updated_at=clock_timestamp()
             WHERE account_id=$1 AND id=$2`,
            [auth.accountId, runId],
          );
          return { committed: null, unchanged: false, stop: true };
        }
        const bodyHash = personSourceSyncBodyHash(page.text);
        // Cross-cycle UNCHANGED dedup: grant/source lineage + canonical
        // locator + stable extracted BODY hash. Volatile fetch metadata and
        // taskId are never part of the comparison.
        const prior = await client.query(
          `SELECT 1
           FROM person_source_sync_runs prior
           JOIN source_resources prior_resource
             ON prior_resource.account_id = prior.account_id
            AND prior_resource.id = prior.observed_resource_id
            AND prior_resource.processing_state <> 'deleted'
           JOIN captures prior_capture
             ON prior_capture.account_id = prior_resource.account_id
            AND prior_capture.id = prior_resource.capture_id
            AND prior_capture.status = 'active'
           WHERE prior.account_id=$1
             AND prior.frozen_seed_resource_id=$2
             AND prior.observed_canonical_url=$3
             AND prior.observed_body_hash=$4
             AND prior.observed_resource_id IS NOT NULL
             AND prior.id <> $5
           LIMIT 1`,
          [
            auth.accountId,
            context.seedResourceId,
            page.canonicalUrl,
            bodyHash,
            runId,
          ],
        );
        if ((prior.rowCount ?? 0) > 0) {
          await client.query(
            `UPDATE person_source_sync_runs SET
               observed_canonical_url=$3,observed_body_hash=$4,
               updated_at=clock_timestamp()
             WHERE account_id=$1 AND id=$2`,
            [auth.accountId, runId, page.canonicalUrl, bodyHash],
          );
          return { committed: null, unchanged: true, stop: false };
        }
        // Revalidate live admission immediately before the protected write:
        // the awaits above (locks, gate, dedup) may have crossed the absolute
        // cycle deadline or the execution lease.
        const preWrite = await cycleAdmissionRow(
          client,
          auth.accountId,
          runId,
          executionId,
        );
        if (!preWrite?.lease_ok || !preWrite.deadline_ok) {
          await client.query(
            `UPDATE person_source_sync_runs SET
               stop_reason=COALESCE(stop_reason,
                 CASE WHEN $3 THEN 'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED'
                      ELSE 'PERSON_SOURCE_SYNC_LEASE_LOST' END),
               updated_at=clock_timestamp()
             WHERE account_id=$1 AND id=$2`,
            [auth.accountId, runId, preWrite ? !preWrite.deadline_ok : true],
          );
          return { committed: null, unchanged: false, stop: true };
        }
        const committed = await createResourceCaptureInTransaction(
          client,
          auth,
          request,
        );
        // The final protected write is itself fenced by owner, lease and live
        // time; zero affected rows aborts this transaction and rolls back the
        // new capture while earlier committed pages stay preserved.
        const recorded = await client.query(
          `WITH capture_clock AS MATERIALIZED (SELECT clock_timestamp() AS instant)
           UPDATE person_source_sync_runs SET
             observed_resource_id=$3,observed_capture_id=$4,
             observed_canonical_url=$5,observed_body_hash=$6,
             new_observations=1,updated_at=clock_timestamp()
           FROM capture_clock
           WHERE account_id=$1 AND id=$2
             AND lease_owner=$7
             AND lease_expires_at > capture_clock.instant
             AND created_at > capture_clock.instant - make_interval(mins => $8)
             AND EXISTS (
               SELECT 1 FROM person_source_sync_grants live_grant
               JOIN source_retention_receipts receipt
                 ON receipt.account_id=live_grant.account_id AND receipt.capture_id=live_grant.source_capture_id
               WHERE live_grant.account_id=$1 AND live_grant.id=$9
                 AND live_grant.status='active' AND live_grant.expires_at > capture_clock.instant
                 AND receipt.authorization_state='authorized'
                 AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at > capture_clock.instant)
             )`,
          [
            auth.accountId,
            runId,
            committed.body.resource.id,
            committed.body.capture_id,
            page.canonicalUrl,
            bodyHash,
            executionId,
            PERSON_SOURCE_SYNC_DEADLINE_MINUTES,
            context.grantId,
          ],
        );
        if (recorded.rowCount !== 1) {
          throw new ApiError(
            409,
            "PERSON_SOURCE_SYNC_LEASE_LOST",
            "The periodic observation cycle lease or deadline ended before the capture write.",
          );
        }
        return {
          committed: {
            canonical_url: page.canonicalUrl,
            resource_id: committed.body.resource.id,
            capture_id: committed.body.capture_id,
            content_hash: page.contentHash,
            retrieved_at: page.retrievedAt.toISOString(),
          },
          unchanged: false,
          stop: false,
        };
      });
    },
    /**
     * Runs FIRST inside the research completion transaction, before any
     * research row mutation, so the frozen ROOT→seed→grant→run→research lock
     * order can never invert against DB-only reconciliation.
     */
    async finalize(
      client: DatabaseClient,
      input: {
        taskId: string;
        status: PublicResearchResponse["status"];
        committedPages: PublicResearchPage[];
        unchangedPages: number;
        warnings: string[];
      },
    ): Promise<RecurringCycleOutcome> {
      await lockCycleIdentity(client, auth.accountId, {
        rootCaptureId: context.rootCaptureId,
        seedCaptureId: context.seedCaptureId,
        grantId: context.grantId,
        runId,
      });
      const admission = await cycleAdmissionRow(client, auth.accountId, runId, executionId);
      if (!admission?.lease_ok) {
        // A stale or replaced execution never publishes receipts; aborting
        // this transaction rolls back every research row write with it.
        throw new ApiError(
          409,
          "PERSON_SOURCE_SYNC_LEASE_LOST",
          "The periodic observation cycle lease changed before completion.",
        );
      }
      const gate = await personSourceSyncAuthorityGate(client, auth.accountId, {
        grantId: context.grantId,
        frozenSourceUrl: context.frozenSourceUrl,
        sourceCaptureVersion: context.sourceCaptureVersion,
      });
      const codes = new Set(personSourceSyncWarningCodes(input.warnings));
      if (input.unchangedPages > 0) codes.add("PERSON_SOURCE_SYNC_UNCHANGED");
      const observed =
        input.committedPages.length > 0 || input.unchangedPages > 0;
      let status: "completed" | "partial" | "failed" | "skipped";
      let stopReason: PersonSourceSyncStopReason | null = null;
      if (!gate.ok) {
        // Authority was lost before completion: pages committed while it
        // still held remain listed honestly, but the cycle itself stops.
        status = "skipped";
        stopReason = gate.reason;
        codes.add("PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION");
      } else if (!admission.deadline_ok) {
        // Receipt-only completion after the immutable deadline: report the
        // partial/failed outcome honestly and never a success.
        status = observed ? "partial" : "failed";
        stopReason = "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED";
        codes.add("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
      } else if (!observed) {
        status = "failed";
      } else if (input.status === "partial") {
        status = "partial";
      } else {
        status = "completed";
      }
      const written = await client.query<{ status: RecurringCycleOutcome["status"]; warning_codes: string[] }>(
        `WITH write_clock AS MATERIALIZED (SELECT clock_timestamp() AS instant),
         write_gate AS MATERIALIZED (
           SELECT write_clock.instant, CASE
             WHEN live_grant.expires_at <= write_clock.instant THEN 'PERSON_SOURCE_SYNC_GRANT_EXPIRED'
             WHEN receipt.authorization_expires_at <= write_clock.instant THEN 'PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED'
             ELSE NULL END AS expiry_stop
           FROM write_clock
           JOIN person_source_sync_grants live_grant ON live_grant.account_id=$1 AND live_grant.id=$10
           LEFT JOIN source_retention_receipts receipt ON receipt.account_id=live_grant.account_id AND receipt.capture_id=live_grant.source_capture_id
         )
         UPDATE person_source_sync_runs SET
           status=CASE WHEN $3 <> 'skipped' AND write_gate.expiry_stop IS NOT NULL THEN 'skipped'
             WHEN $3 <> 'skipped' AND created_at <= write_gate.instant - make_interval(mins => $8)
             THEN CASE WHEN $9::boolean THEN 'partial' ELSE 'failed' END ELSE $3 END,
           task_id=$4,
           warning_codes=CASE WHEN $3 <> 'skipped' AND write_gate.expiry_stop IS NOT NULL
             AND NOT ('PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION'=ANY($5::text[]))
             THEN array_append($5::text[],'PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION')
             WHEN $3 <> 'skipped' AND created_at <= write_gate.instant - make_interval(mins => $8)
             AND NOT ('PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED'=ANY($5::text[]))
             THEN array_append($5::text[],'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED') ELSE $5::text[] END,
           stop_reason=CASE WHEN $3 <> 'skipped' AND write_gate.expiry_stop IS NOT NULL THEN write_gate.expiry_stop
             WHEN $3 <> 'skipped' AND created_at <= write_gate.instant - make_interval(mins => $8)
             THEN 'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED' ELSE $6 END,
           completed_at=write_gate.instant,updated_at=write_gate.instant,
           lease_owner=NULL,lease_expires_at=NULL
         FROM write_gate
         WHERE account_id=$1 AND id=$2 AND lease_owner=$7 AND lease_expires_at > write_gate.instant
         RETURNING status,warning_codes`,
        [auth.accountId, runId, status, input.taskId, [...codes], stopReason, executionId, PERSON_SOURCE_SYNC_DEADLINE_MINUTES, observed, context.grantId],
      );
      if (written.rowCount !== 1 || !written.rows[0]) {
        // Owner/lease/time moved between admission and this receipt write:
        // abort so a stale execution publishes nothing, while the truthful
        // run receipt stays owned by the live execution.
        throw new ApiError(
          409,
          "PERSON_SOURCE_SYNC_LEASE_LOST",
          "The periodic observation cycle lease changed before completion.",
        );
      }
      // The authoritative outcome is returned to the research pipeline so the
      // research task, idempotent readback, audit and API result can never
      // claim more than this cycle observed (B3).
      return {
        status: written.rows[0]!.status,
        warnings: written.rows[0]!.warning_codes,
      };
    },
  };
}

/** Live cycle admission: durable lease validity + immutable deadline, DB time. */
async function cycleAdmissionRow(
  client: DatabaseClient,
  accountId: string,
  runId: string,
  executionId: string,
): Promise<{ lease_ok: boolean; deadline_ok: boolean; remaining_ms: number } | null> {
  const result = await client.query<{
    lease_ok: boolean;
    deadline_ok: boolean;
    remaining_ms: string;
  }>(
    `SELECT
       (lease_owner = $3 AND lease_expires_at > clock_timestamp()) AS lease_ok,
       (created_at > clock_timestamp() - make_interval(mins => $4)) AS deadline_ok,
       GREATEST(
         0,
         (EXTRACT(epoch FROM (created_at + make_interval(mins => $4) - clock_timestamp())) * 1000)::bigint
       )::text AS remaining_ms
     FROM person_source_sync_runs
     WHERE account_id=$1 AND id=$2`,
    [accountId, runId, executionId, PERSON_SOURCE_SYNC_DEADLINE_MINUTES],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    lease_ok: row.lease_ok === true,
    deadline_ok: row.deadline_ok === true,
    remaining_ms: Number(row.remaining_ms),
  };
}

/* ------------------------------------------------------------------ */
/* Dispatcher: materialize due cycles, count attempts, reconcile        */
/* ------------------------------------------------------------------ */

export interface PersonSourceSyncSweepResult {
  materialized: number;
  dispatched: number;
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
  unresolved: number;
}

export interface FrozenCycleRequest {
  cycleKey: string;
  personId: string;
  relationshipContextId: string;
  seedResourceId: string;
  sourceUrl: string;
  allowedDomain: string;
}

/**
 * The exact immutable per-cycle request: frozen canonical URL/domain and
 * ORIGINAL grant provenance only, never a mutable seed locator.
 */
export function personSourceSyncFrozenRequest(
  input: FrozenCycleRequest,
): PublicResearchRequest {
  return {
    idempotency_key: input.cycleKey,
    person_id: input.personId,
    relationship_context_id: input.relationshipContextId,
    seed_resource_id: input.seedResourceId,
    purpose: PERSON_SOURCE_SYNC_PURPOSE,
    expected_seed_url: input.sourceUrl,
    authorization: {
      decision: "approve_public_research",
      allowed_domain: input.allowedDomain,
      // Exactly one approved URL per due cycle; robots, byte and time limits
      // are the existing bounded pipeline's.
      maximum_page_count: 1,
      maximum_link_depth: 0,
    },
  };
}

interface DispatchableRun extends RunRow {
  account_slug: string;
  grant_subject_id: string | null;
  grant_assignment_id: string | null;
  seed_capture_id: string | null;
  root_capture_id: string | null;
  actor_email: string;
}

const DISPATCHABLE_SELECT = `SELECT run.*,
   (
     grant_row.status <> 'deleted'
     AND seed.processing_state <> 'deleted'
     AND seed_capture.status = 'active'
   ) AS content_available,
   grant_row.subject_id AS grant_subject_id,
   grant_row.assignment_id AS grant_assignment_id,
   seed.capture_id AS seed_capture_id,
   COALESCE(root.capture_id, seed.capture_id) AS root_capture_id,
   accounts.slug AS account_slug,
   owner.email AS actor_email
 FROM person_source_sync_runs run
 JOIN person_source_sync_grants grant_row
   ON grant_row.account_id = run.account_id
  AND grant_row.id = run.grant_id
 JOIN accounts
   ON accounts.id = run.account_id AND accounts.retired_at IS NULL
 LEFT JOIN source_resources seed
   ON seed.account_id = run.account_id
  AND seed.id = run.frozen_seed_resource_id
 LEFT JOIN captures seed_capture
   ON seed_capture.account_id = seed.account_id
  AND seed_capture.id = seed.capture_id
 LEFT JOIN LATERAL (
   WITH RECURSIVE ancestors AS (
     SELECT resources.id, resources.capture_id, resources.discovered_from_resource_id, 0 AS depth
     FROM source_resources resources
     WHERE resources.account_id = run.account_id
       AND resources.capture_id = seed_capture.id
       AND resources.processing_state <> 'deleted'
     UNION ALL
     SELECT parent.id, parent.capture_id, parent.discovered_from_resource_id, ancestors.depth + 1
     FROM ancestors
     JOIN source_resources parent
       ON parent.account_id = run.account_id
      AND parent.id = ancestors.discovered_from_resource_id
     WHERE ancestors.depth < 100
       AND parent.processing_state <> 'deleted'
   )
   SELECT capture_id FROM ancestors ORDER BY depth DESC, capture_id LIMIT 1
 ) root ON TRUE
 JOIN users owner
   ON owner.account_id = run.account_id
  AND owner.id = run.grant_actor_user_id`;

interface CycleOutcome {
  dispatched: number;
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
  unresolved: number;
}

const EMPTY_OUTCOME: CycleOutcome = {
  dispatched: 0,
  completed: 0,
  partial: 0,
  failed: 0,
  skipped: 0,
  unresolved: 0,
};

export async function runDuePersonSourceSyncs(
  pool: Pool,
  options: {
    /** Accepted for sweep wiring; admission and deadlines use live DB time. */
    now?: Date;
    limit?: number;
    /**
     * Test seam: injected offline transport. Production uses the DNS-pinned
     * bounded loader and the cycle gate caps its timeout by the remaining
     * cycle budget.
     */
    loadPage?: BoundedPageLoader;
  } = {},
): Promise<PersonSourceSyncSweepResult> {
  const result: PersonSourceSyncSweepResult = {
    materialized: 0,
    dispatched: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    unresolved: 0,
  };
  result.materialized = await materializeDuePersonSourceSyncs(pool);
  const limit = Math.max(
    1,
    Math.min(
      options.limit ?? PERSON_SOURCE_SYNC_MAX_DISPATCH_PER_TICK,
      PERSON_SOURCE_SYNC_MAX_DISPATCH_PER_TICK,
    ),
  );
  const visitedRuns = new Set<string>();
  for (let index = 0; index < limit; index += 1) {
    const outcome = await runOnePersonSourceSyncCycle(
      pool,
      options.loadPage ?? loadPinnedPublicResearchPage,
      visitedRuns,
    );
    if (outcome === null) break;
    result.dispatched += outcome.dispatched;
    result.completed += outcome.completed;
    result.partial += outcome.partial;
    result.failed += outcome.failed;
    result.skipped += outcome.skipped;
    result.unresolved += outcome.unresolved;
  }
  return result;
}

async function materializeDuePersonSourceSyncs(
  pool: Pool,
): Promise<number> {
  const due = await pool.query<{ id: string; account_id: string }>(
    `SELECT grant_row.id, grant_row.account_id
     FROM person_source_sync_grants grant_row
     JOIN accounts ON accounts.id=grant_row.account_id AND accounts.retired_at IS NULL
     WHERE grant_row.status = 'active'
       AND grant_row.expires_at > clock_timestamp()
       AND grant_row.next_due_at <= clock_timestamp()
       AND NOT EXISTS (
         SELECT 1 FROM person_source_sync_runs open_run
         WHERE open_run.account_id = grant_row.account_id
           AND open_run.grant_id = grant_row.id
           AND open_run.status IN ('pending','claimed','dispatched')
       )
     ORDER BY grant_row.next_due_at, grant_row.id
     LIMIT ${PERSON_SOURCE_SYNC_MAX_MATERIALIZATIONS_PER_TICK}`,
  );
  let materialized = 0;
  for (const grant of due.rows) {
    const inserted = await inTransaction(pool, async (client) => {
      const locked = await client.query<{
        id: string;
        subject_id: string | null;
        assignment_id: string | null;
        seed_resource_id: string | null;
        source_capture_id: string | null;
        source_capture_version: number | null;
        source_url: string | null;
        allowed_domain: string | null;
        created_by_user_id: string;
        revision: number;
        created_at: Date;
        next_due_at: Date | null;
        due_now: boolean;
      }>(
        `SELECT id,subject_id,assignment_id,seed_resource_id,source_capture_id,
                source_capture_version,source_url,allowed_domain,
                created_by_user_id,revision,created_at,next_due_at,
                (next_due_at IS NOT NULL AND next_due_at <= clock_timestamp()) AS due_now
         FROM person_source_sync_grants
         WHERE account_id=$1 AND id=$2 AND status='active'
         FOR UPDATE`,
        [grant.account_id, grant.id],
      );
      const row = locked.rows[0];
      if (
        !row ||
        !row.subject_id ||
        !row.assignment_id ||
        !row.seed_resource_id ||
        !row.source_capture_id ||
        !row.source_capture_version ||
        !row.source_url ||
        !row.allowed_domain ||
        !row.due_now ||
        !row.next_due_at
      ) {
        return false;
      }
      try {
        await assertAccountActive(client, grant.account_id);
      } catch (error) {
        if (error instanceof ApiError && ["ACCOUNT_RETIRED", "ACCOUNT_NOT_FOUND"].includes(error.code)) return false;
        throw error;
      }
      const stillLive = await client.query<{ live: boolean }>(
        "SELECT expires_at > clock_timestamp() AS live FROM person_source_sync_grants WHERE account_id=$1 AND id=$2",
        [grant.account_id, grant.id],
      );
      if (!stillLive.rows[0]?.live) return false;
      const dueAt = row.next_due_at;
      const write = await client.query(
        `INSERT INTO person_source_sync_runs(
           account_id,id,grant_id,cycle_key,due_at,status,attempt_count,
           frozen_seed_resource_id,frozen_source_url,frozen_allowed_domain,
           grant_actor_user_id,grant_authorization_revision,grant_authorized_at,
           source_capture_version
         ) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (account_id, cycle_key) DO NOTHING`,
        [
          grant.account_id,
          randomUUID(),
          row.id,
          personSourceSyncCycleKey(row.id, dueAt),
          dueAt,
          row.seed_resource_id,
          row.source_url,
          row.allowed_domain,
          // ORIGINAL grant actor/authorization revision/time frozen into the
          // immutable cycle request; never a per-cycle approval.
          row.created_by_user_id,
          row.revision,
          row.created_at,
          row.source_capture_version,
        ],
      );
      if (write.rowCount !== 1) return false;
      // Honest 24-hour UTC cadence from materialization; missed days never
      // create catch-up bursts.
      await client.query(
        `UPDATE person_source_sync_grants SET
           next_due_at = clock_timestamp() + make_interval(secs => $3),
           updated_at = clock_timestamp()
         WHERE account_id=$1 AND id=$2`,
        [grant.account_id, row.id, PERSON_SOURCE_SYNC_INTERVAL_SECONDS],
      );
      return true;
    });
    if (inserted) materialized += 1;
  }
  return materialized;
}

async function nextOpenRun(
  pool: Pool,
  excludedIds: string[],
): Promise<DispatchableRun | null> {
  const result = await pool.query<DispatchableRun>(
    `SELECT * FROM (${DISPATCHABLE_SELECT}) dispatchable
     WHERE dispatchable.status IN ('pending','claimed','dispatched')
       AND NOT (dispatchable.id = ANY($1::uuid[]))
       AND (
         dispatchable.created_at <= clock_timestamp() - make_interval(mins => $2)
         OR (
           (dispatchable.lease_expires_at IS NULL OR dispatchable.lease_expires_at <= clock_timestamp())
           AND NOT EXISTS (
             SELECT 1 FROM research_retrieval_jobs job
             WHERE job.account_id=dispatchable.account_id AND job.recurring_run_id=dispatchable.id
               AND job.status='running' AND job.lease_expires_at > clock_timestamp()
           )
         )
       )
     ORDER BY dispatchable.created_at, dispatchable.id
     LIMIT 1`,
    [excludedIds, PERSON_SOURCE_SYNC_DEADLINE_MINUTES],
  );
  return result.rows[0] ?? null;
}

/** A live research lease means another execution owns this cycle's fetch. */
async function liveResearchJob(
  pool: Pool,
  run: DispatchableRun,
): Promise<boolean> {
  const job = await pool.query(
    `SELECT 1 FROM research_retrieval_jobs
     WHERE account_id=$1 AND recurring_run_id=$2
       AND status='running' AND lease_expires_at > clock_timestamp()`,
    [run.account_id, run.id],
  );
  return (job.rowCount ?? 0) > 0;
}

async function runOnePersonSourceSyncCycle(
  pool: Pool,
  loadPage: BoundedPageLoader,
  visitedRuns: Set<string>,
): Promise<CycleOutcome | null> {
  const run = await nextOpenRun(pool, [...visitedRuns]);
  if (!run) return null;
  visitedRuns.add(run.id);
  if (
    run.attempt_count >= PERSON_SOURCE_SYNC_ATTEMPT_LIMIT ||
    run.created_at.valueOf() + PERSON_SOURCE_SYNC_DEADLINE_MINUTES * 60_000 <=
      Date.now()
  ) {
    // Exhaustion/deadline settlement re-checks live execution leases and
    // database time under the consistent locks (R4): a live third attempt is
    // never pre-empted and a fourth attempt never starts.
    const outcome = await reconcileExhaustedPersonSourceSyncRun(pool, run);
    return { ...EMPTY_OUTCOME, ...outcome };
  }
  if (
    (run.lease_expires_at !== null &&
      run.lease_expires_at.valueOf() > Date.now()) ||
    (await liveResearchJob(pool, run))
  ) {
    // Another execution is live on this exact cycle; wait, never burn an
    // attempt and never settle its receipts.
    return EMPTY_OUTCOME;
  }
  const executionId = `${PERSON_SOURCE_SYNC_WORKER_SESSION_PREFIX}:${randomUUID()}`;
  // R7: ONE narrow run-only CAS claim transaction. The counted attempt is
  // durable (COMMITTED) before any authority or IO work can fail, and the run
  // lock is released before the authority transaction starts (R6): no path
  // holds the run row while waiting for the grant.
  const claimed = await inTransaction(pool, async (client) => {
    const claim = await client.query<RunRow>(
      `UPDATE person_source_sync_runs SET
         status='claimed',attempt_count=attempt_count+1,
         lease_owner=$3,
         lease_expires_at=clock_timestamp() + make_interval(mins => $4),
         started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
       WHERE account_id=$1 AND id=$2
         AND status IN ('pending','claimed','dispatched')
         AND attempt_count < $5
         AND created_at > clock_timestamp() - make_interval(mins => $6)
         AND (lease_owner IS NULL OR lease_expires_at <= clock_timestamp())
       RETURNING *`,
      [
        run.account_id,
        run.id,
        executionId,
        PERSON_SOURCE_SYNC_LEASE_MINUTES,
        PERSON_SOURCE_SYNC_ATTEMPT_LIMIT,
        PERSON_SOURCE_SYNC_DEADLINE_MINUTES,
      ],
    );
    return claim.rows[0] ?? null;
  });
  if (claimed === null) {
    // The claim was not confirmed (another replica won it or the live
    // budget/admission moved): nothing was consumed and nothing may fetch.
    return EMPTY_OUTCOME;
  }
  // The durable attempt is confirmed. Every later failure consumes exactly
  // this attempt; there is never a fourth automatic attempt.
  try {
    const dispatch = await inTransaction(pool, async (client) => {
      // Authority BEFORE any IO, in the frozen ROOT→seed→grant→run order.
      if (run.root_capture_id || run.seed_capture_id) {
        await lockCycleIdentity(client, run.account_id, {
          rootCaptureId: run.root_capture_id,
          seedCaptureId: run.seed_capture_id,
          grantId: run.grant_id,
          runId: run.id,
        });
      }
      const gate = await personSourceSyncAuthorityGate(client, run.account_id, {
        grantId: run.grant_id,
        frozenSourceUrl: run.frozen_source_url,
        sourceCaptureVersion: run.source_capture_version,
      });
      if (!gate.ok) {
        await client.query(
          `UPDATE person_source_sync_runs SET
             status='skipped',stop_reason=$3,
             completed_at=clock_timestamp(),updated_at=clock_timestamp(),
             lease_owner=NULL,lease_expires_at=NULL
           WHERE account_id=$1 AND id=$2
             AND lease_owner=$4
             AND status IN ('pending','claimed','dispatched')`,
          [run.account_id, run.id, gate.reason, executionId],
        );
        await appendAudit(
          client,
          { accountId: run.account_id, actorUserId: null },
          "person_source_sync.skipped",
          "person_source_sync_run",
          run.id,
          {
            grant_id: run.grant_id,
            external_effect: "none",
            stop_reason: gate.reason,
            attempt_count: claimed.attempt_count,
          },
        );
        return "skipped" as const;
      }
      return "ok" as const;
    });
    if (dispatch === "skipped") {
      return { ...EMPTY_OUTCOME, skipped: 1 };
    }
  } catch (error) {
    await releaseRunAfterAttemptFailure(pool, run, executionId, error);
    return { ...EMPTY_OUTCOME, failed: 1 };
  }
  if (
    !run.root_capture_id ||
    !run.seed_capture_id ||
    !run.grant_subject_id ||
    !run.grant_assignment_id
  ) {
    await releaseRunAfterAttemptFailure(
      pool,
      run,
      executionId,
      new ApiError(
        409,
        "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE",
        "The bound source is unavailable for this cycle.",
      ),
    );
    return { ...EMPTY_OUTCOME, failed: 1 };
  }
  const auth: AuthContext = {
    accountId: run.account_id,
    accountSlug: run.account_slug,
    // ORIGINAL grant actor; never a fabricated per-cycle approver.
    userId: run.grant_actor_user_id,
    userEmail: run.actor_email,
    userKind: "simulated_human",
    sessionId: executionId,
  };
  const request = personSourceSyncFrozenRequest({
    cycleKey: run.cycle_key,
    personId: run.grant_subject_id,
    relationshipContextId: run.grant_assignment_id,
    seedResourceId: run.frozen_seed_resource_id,
    sourceUrl: run.frozen_source_url,
    allowedDomain: run.frozen_allowed_domain,
  });
  const hooks = createPersonSourceSyncCycleHooks({
    pool,
    auth,
    runId: run.id,
    grantId: run.grant_id,
    executionId,
    deadlineAt: new Date(
      run.created_at.valueOf() + PERSON_SOURCE_SYNC_DEADLINE_MINUTES * 60_000,
    ),
    rootCaptureId: run.root_capture_id,
    seedCaptureId: run.seed_capture_id,
    seedResourceId: run.frozen_seed_resource_id,
    frozenSourceUrl: run.frozen_source_url,
    frozenAllowedDomain: run.frozen_allowed_domain,
    sourceCaptureVersion: run.source_capture_version,
    grantActorUserId: run.grant_actor_user_id,
    grantAuthorizationRevision: run.grant_authorization_revision,
    grantAuthorizedAt: run.grant_authorized_at,
  });
  // R5: every DNS/fetch re-checks live authority, the live lease and the
  // immutable cycle deadline, and the transport timeout is capped by the
  // remaining cycle budget (never extended past the existing per-fetch
  // ceiling).
  const cycleContext = {
    accountId: run.account_id,
    runId: run.id,
    executionId,
    grantId: run.grant_id,
    frozenSourceUrl: run.frozen_source_url,
    sourceCaptureVersion: run.source_capture_version,
    rootCaptureId: run.root_capture_id,
    seedCaptureId: run.seed_capture_id,
    seedResourceId: run.frozen_seed_resource_id,
  };
  const guardedLoader: ResearchPageLoader = async (url, allowedHostname) => {
    // Authority first (awaited), then a FRESH admission read so the transport
    // budget is computed AFTER every await and capped by the remaining cycle
    // budget at the last moment (B2).
    const gate = await personSourceSyncAuthorityGate(pool, cycleContext.accountId, {
      grantId: cycleContext.grantId,
      frozenSourceUrl: cycleContext.frozenSourceUrl,
      sourceCaptureVersion: cycleContext.sourceCaptureVersion,
    });
    if (!gate.ok) {
      throw new Error("The periodic cycle authority ended before fetch.");
    }
    const admission = await cycleAdmissionRow(
      pool,
      cycleContext.accountId,
      cycleContext.runId,
      cycleContext.executionId,
    );
    if (!admission?.lease_ok) {
      throw new Error("The periodic cycle execution is no longer live.");
    }
    if (!admission.deadline_ok) {
      throw new Error("The periodic cycle deadline elapsed before fetch.");
    }
    return loadPage(url, allowedHostname, {
      timeoutMs: Math.max(
        1,
        Math.min(PERSON_SOURCE_SYNC_FETCH_TIMEOUT_MS, admission.remaining_ms),
      ),
    });
  };
  try {
    const outcome = await runPublicResearch(
      pool,
      auth,
      request,
      guardedLoader,
      {
        recurring: hooks,
        recurringRunId: run.id,
      },
    );
    if (outcome.status === 201) {
      // The sweep summary follows the authoritative terminal run row (B3):
      // it can never report completed for a partial/failed/skipped cycle.
      const settled = await pool.query<{ status: string }>(
        `SELECT status FROM person_source_sync_runs
         WHERE account_id=$1 AND id=$2`,
        [run.account_id, run.id],
      );
      const terminal = settled.rows[0]?.status;
      return {
        ...EMPTY_OUTCOME,
        dispatched: 1,
        completed: terminal === "completed" ? 1 : 0,
        partial: terminal === "partial" ? 1 : 0,
        failed: terminal === "failed" ? 1 : 0,
        skipped: terminal === "skipped" ? 1 : 0,
        unresolved: terminal === "unknown" ? 1 : 0,
      };
    }
    return EMPTY_OUTCOME;
  } catch (error) {
    await releaseRunAfterAttemptFailure(pool, run, executionId, error);
    return { ...EMPTY_OUTCOME, failed: 1 };
  }
}

/** The existing per-fetch ceiling; recurring fetches can only be shorter. */
export const PERSON_SOURCE_SYNC_FETCH_TIMEOUT_MS = 12_000;

function stopReasonForError(error: unknown): PersonSourceSyncStopReason | null {
  if (error instanceof ApiError) {
    if (error.code === "PUBLIC_RESEARCH_SEED_NOT_FOUND") {
      return "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE";
    }
    if (error.code === "PUBLIC_RESEARCH_SCOPE_CHANGED") {
      return "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED";
    }
    if (error.code === "PERSON_SOURCE_SYNC_LEASE_LOST") {
      return "PERSON_SOURCE_SYNC_LEASE_LOST";
    }
    if (error.code === "ACCOUNT_RETIRED") {
      return "PERSON_SOURCE_SYNC_ACCOUNT_RETIRED";
    }
    // Admission failures carry their fixed stop reason as the error code.
    const stops: readonly string[] = [
      "PERSON_SOURCE_SYNC_GRANT_PAUSED",
      "PERSON_SOURCE_SYNC_GRANT_REVOKED",
      "PERSON_SOURCE_SYNC_GRANT_EXPIRED",
      "PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE",
      "PERSON_SOURCE_SYNC_ACCOUNT_RETIRED",
      "PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE",
      "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED",
      "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED",
      "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED",
      "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED",
      "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
    ];
    if (stops.includes(error.code)) {
      return error.code as PersonSourceSyncStopReason;
    }
  }
  return null;
}

/**
 * A confirmed attempt that fails later is consumed exactly once: the durable
 * count stands and the same cycle key retries inside the budget. Only owner-
 * fenced writes move the row; if this write is uncertain (DB outage) the
 * cycle stays unresolved and blocks any new cycle instead of restarting
 * blind. Determinate end-of-attempt outcomes keep their fixed stop reason.
 */
async function releaseRunAfterAttemptFailure(
  pool: Pool,
  run: DispatchableRun,
  executionId: string,
  error: unknown,
): Promise<void> {
  const stopReason = stopReasonForError(error);
  await pool.query(
    `UPDATE person_source_sync_runs SET
       status='pending',stop_reason=COALESCE(stop_reason,$3),
       updated_at=now(),
       lease_owner=NULL,lease_expires_at=NULL
     WHERE account_id=$1 AND id=$2
       AND lease_owner=$4
       AND status IN ('claimed','dispatched')`,
    [run.account_id, run.id, stopReason, executionId],
  );
}

/**
 * Exhaustion/deadline reconciliation: bounded DB receipt/idempotency writes
 * only — no fetch, no model call and no new-cycle bypass. A live execution
 * (lease still valid) is never pre-empted unless the absolute cycle deadline
 * has elapsed; committed partial evidence is preserved and reported; an
 * unverifiable outcome is reported as unknown and a missing database write
 * leaves the cycle unresolved, blocking any new one.
 */
async function reconcileExhaustedPersonSourceSyncRun(
  pool: Pool,
  run: DispatchableRun,
): Promise<Partial<CycleOutcome>> {
  return inTransaction(pool, async (client) => {
    // Frozen lock order ROOT→seed→grant→run before any research row write,
    // matching the research completion path (R6).
    await lockCycleIdentity(client, run.account_id, {
      rootCaptureId: run.root_capture_id,
      seedCaptureId: run.seed_capture_id,
      grantId: run.grant_id,
      runId: run.id,
    });
    const locked = await client.query<
      RunRow & { deadline_exceeded: boolean; run_lease_live: boolean }
    >(
      `SELECT run.*,
         (run.created_at <= clock_timestamp() - make_interval(mins => $3)) AS deadline_exceeded,
         (run.lease_owner IS NOT NULL AND run.lease_expires_at > clock_timestamp()) AS run_lease_live
       FROM person_source_sync_runs run
       WHERE run.account_id=$1 AND run.id=$2
       FOR UPDATE OF run`,
      [run.account_id, run.id, PERSON_SOURCE_SYNC_DEADLINE_MINUTES],
    );
    const row = locked.rows[0];
    if (!row || !["pending", "claimed", "dispatched"].includes(row.status)) {
      return {};
    }
    const job = await client.query<{
      id: string;
      task_id: string;
      idempotency_record_id: string;
      status: string;
      job_lease_live: boolean;
    }>(
      `SELECT id,task_id,idempotency_record_id,status,
              (status='running' AND lease_expires_at > clock_timestamp()) AS job_lease_live
       FROM research_retrieval_jobs
       WHERE account_id=$1 AND recurring_run_id=$2`,
      [run.account_id, run.id],
    );
    const existingJob = job.rows[0];
    if (
      !row.deadline_exceeded &&
      (row.run_lease_live || existingJob?.job_lease_live === true)
    ) {
      // R4: a live execution — the third attempt included — is never
      // finalized or cleared by a parallel sweep before the absolute
      // deadline. No fourth attempt ever starts.
      return {};
    }
    const deadlineExceeded = row.deadline_exceeded;
    const exhaustion: PersonSourceSyncWarningCode = deadlineExceeded
      ? "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED"
      : "PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED";
    const codes = new Set(row.warning_codes ?? []);
    codes.add(exhaustion);
    let status: "partial" | "failed" | "unknown";
    if (row.observed_resource_id !== null) {
      // Committed evidence survives honestly even when the cycle could not
      // finish.
      status = "partial";
    } else if (existingJob && existingJob.status === "running") {
      // The last attempt's result is unverified; report unknown rather than
      // fabricating a success or a failure.
      status = "unknown";
      codes.add("PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED");
    } else {
      status = "failed";
    }
    await client.query(
      `UPDATE person_source_sync_runs SET
         status=$3,warning_codes=$4,
         stop_reason=COALESCE(stop_reason,$5),
         completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_owner=NULL,lease_expires_at=NULL
       WHERE account_id=$1 AND id=$2`,
      [
        run.account_id,
        run.id,
        status,
        [...codes],
        deadlineExceeded
          ? "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED"
          : "PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED",
      ],
    );
    if (existingJob && existingJob.status !== "completed") {
      // Bounded receipt reconciliation only: close the durable research job
      // and idempotency record with fixed content-free diagnostics.
      await client.query(
        `UPDATE research_tasks
         SET status=$3,updated_at=clock_timestamp()
         WHERE account_id=$1 AND id=$2`,
        [run.account_id, existingJob.task_id, status === 'partial' ? 'partial' : 'failed'],
      );
      // Recover only the actually committed pointer, never fabricated pages
      // or stale snapshots. Unavailable derived evidence stays redacted.
      const recovered = await client.query<{
        id: string; capture_id: string; source_locator: string;
        content_hash: string; observed_at: Date;
      }>(
        `SELECT resource.id,resource.capture_id,resource.source_locator,resource.content_hash,resource.observed_at
         FROM source_resources resource
         JOIN captures capture ON capture.account_id=resource.account_id AND capture.id=resource.capture_id
         JOIN source_retention_receipts receipt ON receipt.account_id=capture.account_id AND receipt.capture_id=capture.id
         WHERE resource.account_id=$1 AND resource.id=$2 AND capture.id=$3
           AND resource.processing_state <> 'deleted' AND capture.status='active'
           AND receipt.authorization_state='authorized'
           AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at > clock_timestamp())`,
        [run.account_id,row.observed_resource_id,row.observed_capture_id],
      );
      const pages: PublicResearchPage[] = recovered.rows.map((page) => ({
        canonical_url: page.source_locator,resource_id: page.id,capture_id: page.capture_id,
        content_hash: page.content_hash,retrieved_at: page.observed_at.toISOString(),
      }));
      const body: PublicResearchResponse = {
        contract_version: CONTRACT_VERSION,
        task_id: existingJob.task_id,
        seed_resource_id: run.frozen_seed_resource_id,
        status: status === "partial" ? "partial" : "failed",
        authorization_scope:
          `Periodic public source observation authorized by the original owner ` +
          `grant ${run.grant_id} (revision ${run.grant_authorization_revision}).`,
        pages,
        warnings: [...codes],
        created_at: row.created_at.toISOString(),
        completed_at: new Date().toISOString(),
      };
      await client.query(
        `UPDATE idempotency_records
         SET status='completed',response_status=201,response_body=$3,completed_at=now()
         WHERE account_id=$1 AND id=$2`,
        [run.account_id, existingJob.idempotency_record_id, body],
      );
      await client.query(
        `UPDATE research_retrieval_jobs
         SET status='completed',lease_owner=NULL,lease_expires_at=NULL,
             last_error=$3,updated_at=now(),completed_at=now()
         WHERE account_id=$1 AND id=$2`,
        [run.account_id, existingJob.id, exhaustion],
      );
    }
    return {
      partial: status === "partial" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
      unresolved: status === "unknown" ? 1 : 0,
    };
  });
}
