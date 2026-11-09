import type { Pool, PoolClient } from "pg";
import type { ConversationMessage, SessionHistorySnapshot } from "@talent-signal/agent";
import { boundedConversationHistory } from "./chatAnswerProvider.js";
import { createSessionHistorySnapshot } from "./sessionHistorySnapshot.js";
import { collectCapturedHistory, type CapturedHistoryInput } from "./capturedSessionHistory.js";
import { capturedHistoryClaimsCurrentSQL, capturedHistoryDeadlineSQL, capturedHistorySourcesCurrentSQL, lockCapturedHistoryClaims } from "./capturedHistoryClaims.js";
import { types } from "node:util";
import { canonicalBorrowOwner, claimCanonicalBorrow } from "./savedMemoryCanonicalTransaction.js";
import { consumeCapturedCoreClock } from "./workspaceConversationAgent.js";
import type { BackendConfig } from "../config.js";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { labWorkspaceSessionActiveSQL, labWorkspaceSessionActiveAtTickSQL, operatorLabDeploymentActiveSQL,
  operatorTestDeployment } from "./labWorkspaceAccess.js";
import { readLegacyChatSnapshotRecord, snapshotLegacyChatAuth, validateLegacyChatOriginalProof,
  type LegacyChatOriginalProof, type LegacyChatLabBinding } from "./legacyChatOriginalProof.js";
import { readHarnessRunSourceBinding, type HarnessRunSourceHandle } from "./harnessSourceGuard.js";
import { SAVED_MEMORY_READ_LIMIT, SavedMemoryReadSet, captureSavedMemoryReadProof, savedMemoryOwnRecord, savedMemoryUUID,
  savedMemoryBudgetLimited, type SavedMemoryAuthority, type SavedMemoryReadProof, type SavedMemoryStamp } from "./savedMemoryLineage.js";
import type { SavedMemoryFinalReadDomain } from "./savedMemoryDiscovery.js";
import { assertLegacySavedMemoryProofSuperset, captureLegacySavedMemoryDomain, captureLegacySavedMemoryEnvelope,
  legacySavedMemoryMicroseconds, legacySavedMemoryProofSQL, legacySavedMemorySourceSQL,
  type LegacySavedMemoryReadEnvelope } from "./legacySavedMemoryDomain.js";
import { captureSavedMemoryDurableProof, captureSavedMemoryRetainedProof, savedMemoryDurableProofDigest,
  type SavedMemoryDurableProofV2 } from "./savedMemoryDurableLineage.js";
import { consumeSessionHistoryReceipt, isForeignSessionHistoryReceipt, isForeignSessionHistoryReceiptError,
  sessionHistoryReceiptUsesDatabase, type SavedMemorySessionHistoryFacts,
  type SavedMemorySessionHistoryReceipt } from "./savedMemorySessionHistory.js";

type LegacyChatFailureCode = "LEGACY_CHAT_AUTHORITY_UNAVAILABLE" | "CHAT_COMPLETION_SOURCE_CHANGED";
export class LegacyChatTerminated extends ApiError {
  constructor(code: LegacyChatFailureCode = "LEGACY_CHAT_AUTHORITY_UNAVAILABLE") {
    super(409, code, code === "CHAT_COMPLETION_SOURCE_CHANGED"
      ? "The source changed while this answer was being prepared. Reload its current state before trying again."
      : "This request is no longer authorized. Nothing from this attempt was saved. Read the current state before starting again.");
  }
}

type LabBinding = LegacyChatLabBinding;
type Admission = { original_deadline: string; remaining_ms: string; user_kind: string;
  token_branch: "current" | "previous"; lab_binding: LabBinding | null };

// Only immutable lineage IDs/generations: no token hashes, labels or excerpts.
const labBindingSQL = `CASE WHEN users.kind='lab_human' THEN (
 SELECT jsonb_build_object('entry',e.id,'workspace',w.id,'parent',e.owner_session_id,
   'principal',e.owner_principal_id,'generation',e.principal_generation,
   'ownerAccount',w.owner_account_id,'ownerUser',w.owner_user_id,'grant',g.id,
   'entitlementGeneration',g.test_entitlement_generation,'run',r.id)
 FROM lab_test_workspace_entries e JOIN lab_test_workspaces w ON w.id=e.workspace_id
 LEFT JOIN capir_auth_grants g ON g.backing_session_id=e.owner_session_id
 LEFT JOIN capir_test_runs r ON r.workspace_id=w.id AND r.principal_id=e.owner_principal_id
 WHERE e.session_id=sessions.id
) ELSE NULL::jsonb END`;
const acceptedDeadlineSQL = "CASE WHEN sessions.token_hash=$1 THEN sessions.expires_at ELSE sessions.previous_token_expires_at END";
const authoritySQL = `FROM sessions
 JOIN accounts ON accounts.id=sessions.account_id AND accounts.retired_at IS NULL
 JOIN users ON users.account_id=sessions.account_id AND users.id=sessions.user_id AND users.status='active'
 CROSS JOIN tick
 WHERE sessions.account_id=$6 AND sessions.user_id=$7 AND sessions.id=$8
   AND sessions.revoked_at IS NULL AND sessions.expires_at>tick.checked_at
   AND (sessions.token_hash=$1 OR (sessions.previous_token_hash=$1 AND sessions.previous_token_expires_at>tick.checked_at))
   AND ${labWorkspaceSessionActiveSQL} AND ${operatorLabDeploymentActiveSQL}`;
// Only the new joint path uses the equivalent closed tick variant. The original
// Legacy predicate and its slot layout stay byte-for-byte unchanged above.
const memoryAuthoritySQL = authoritySQL.replace(labWorkspaceSessionActiveSQL, labWorkspaceSessionActiveAtTickSQL);

type SavedMemoryHistoryAncestor = Readonly<{
  taskID: string; completionID: string; bodyDigest: string; proofDigest: string;
  proof: Readonly<SavedMemoryDurableProofV2>; sourceTaskExpiresAt: string | null;
}>;
// Append-only original history domains, never old Run/query/login proofs. The
// canonical body, complete original V2 and dependencies must still agree at
// this command's tick, including explicit zero-dependency V2 ancestors.
const legacySavedMemoryHistorySQL = `NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements($12::jsonb->'history') ancestor WHERE NOT EXISTS (
    SELECT 1 FROM agent_task_memory_lineage historical
    JOIN idempotency_records canonical ON canonical.id=historical.completion_idempotency_id
    LEFT JOIN agent_session_chat_tasks retained ON retained.account_id=historical.account_id
      AND retained.task_id=historical.task_id::text
    WHERE historical.account_id=$6 AND historical.reader_actor_id=$7
      AND historical.task_id=(ancestor->>'taskID')::uuid AND historical.format_version=2
      AND historical.completion_idempotency_id=(ancestor->>'completionID')::uuid
      AND historical.proof_digest=ancestor->>'proofDigest'
      AND historical.retention_kind=ancestor->'proof'->>'retention_kind'
      AND historical.source_origin_session_id IS NOT DISTINCT FROM (ancestor->'proof'->>'source_origin_session_id')::uuid
      AND historical.expires_at IS NOT DISTINCT FROM (ancestor->'proof'->>'expires_at')::timestamptz
      AND historical.dependency_count=jsonb_array_length(ancestor->'proof'->'stamps')
      AND canonical.account_id=$6 AND canonical.actor_user_id=$7
      AND canonical.operation_scope='create_unscoped_chat_task' AND canonical.status='completed'
      AND canonical.response_status=201 AND canonical.saved_memory_lineage_required
      AND canonical.response_body->>'task_id'=historical.task_id::text
      AND encode(sha256(convert_to(canonical.response_body::text,'UTF8')),'hex')=ancestor->>'bodyDigest'
      AND retained.expires_at IS NOT DISTINCT FROM (ancestor->>'sourceTaskExpiresAt')::timestamptz
      AND ((historical.retention_kind='canonical_no_session' AND retained.task_id IS NULL)
        OR (historical.retention_kind='session_bound' AND retained.actor_user_id=$7
          AND retained.origin_session_id=historical.source_origin_session_id AND retained.expires_at=historical.expires_at))
      AND COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
        'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
        'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id)
        FROM agent_task_saved_memory_dependencies d WHERE d.account_id=$6 AND d.task_id=historical.task_id),'[]'::jsonb)
          =ancestor->'proof'->'stamps'
      AND agent_session_chat_sources_available($6,historical.task_id::text)
      AND saved_memory_task_current($6,historical.task_id,$7,tick.checked_at)))`;
const legacySavedMemoryHistoryDeadlineSQL = `,
                COALESCE((SELECT min((h->'proof'->>'expires_at')::timestamptz)
                  FROM jsonb_array_elements($12::jsonb->'history') h),'infinity'::timestamptz),
                COALESCE((SELECT min((h->>'sourceTaskExpiresAt')::timestamptz)
                  FROM jsonb_array_elements($12::jsonb->'history') h),'infinity'::timestamptz)`;

export interface LegacyChatAuthority {
  readonly signal: AbortSignal;
  /** Server-only immutable admission metadata, never a request credential. */
  snapshotOriginal(): Readonly<LegacyChatOriginalProof>;
  assertCurrent(): Promise<void>;
  /** Account locks precede the existing final source locks. No provider await follows. */
  lockAccountsForFinalization(client: DatabaseClient): Promise<void>;
  /** The original final source locks precede user/session/Lab locks. */
  lockReadersForFinalization(client: DatabaseClient): Promise<void>;
  assertFinalCurrent(client: DatabaseClient): Promise<void>;
  withClient<T>(client: PoolClient, operation: (guarded: PoolClient) => Promise<T>): Promise<T>;
  source<T>(operation: () => Promise<T>): Promise<T>;
  observeSource(check: () => Promise<void>): void;
  host<T>(operation: () => Promise<T>, sourceCheck?: (() => Promise<void>) | undefined): Promise<T>;
  provider<T>(operation: () => Promise<T>, sourceCheck?: (() => Promise<void>) | undefined): Promise<T>;
  throwIfTerminated(): void;
  dispose(): void;
}

declare const legacySavedMemoryRunBrand: unique symbol;
export interface LegacySavedMemoryRunHandle { readonly [legacySavedMemoryRunBrand]: true }
export interface LegacySavedMemoryRunInput {
  readonly auth: AuthContext;
  readonly taskID: string;
  readonly runID: string;
  /** Actual Core timeout origin + duration, never a fresh duration or seven days. */
  readonly runDeadlineMonotonicMs: number;
  readonly source: HarnessRunSourceHandle;
  readonly guard: () => Promise<void>;
}
export interface LegacySavedMemoryRunAccess {
  readonly runID: string;
  readonly authority: SavedMemoryAuthority;
  readonly reads: SavedMemoryReadSet;
  finalizeRead(domain: SavedMemoryFinalReadDomain): Promise<Readonly<LegacySavedMemoryReadEnvelope>>;
  finalizeProof(proof: SavedMemoryReadProof): Promise<Readonly<LegacySavedMemoryReadEnvelope>>;
  assertCurrent(): Promise<void>;
  throwIfTerminated(): void;
  terminate(error: unknown): never;
}
export interface LegacySavedMemoryHistoryFrame {
  readonly envelope: Readonly<LegacySavedMemoryReadEnvelope>;
  /** Exact selected inline messages; the owning bridge must charge its shared
   * context budget before exposure and terminate on a failed charge. */
  readonly messages: SavedMemorySessionHistoryFacts["messages"];
}
declare const capturedHistoryBrand: unique symbol;
export interface LegacyCapturedHistoryHandle { readonly [capturedHistoryBrand]: true }
type CapturedFrame = Awaited<ReturnType<typeof collectCapturedHistory>>;
interface CapturedPreparation {
  readonly handle: LegacyCapturedHistoryHandle;
  readonly inline: CapturedFrame["inline"];
  readonly complete: CapturedFrame["complete"];
  readonly guard: CapturedFrame["guard"];
  readonly conversationHistory: readonly ConversationMessage[];
  readonly snapshot: SessionHistorySnapshot | undefined;
}
const capturedOwners = new WeakMap<object, {
  readonly pool: Pool;
  prepare(input: CapturedHistoryInput): Promise<CapturedPreparation>;
  bind(handle: LegacyCapturedHistoryHandle, receipt: object): void;
  assertEntry(handle: LegacyCapturedHistoryHandle, database: DatabaseClient, auth: AuthContext): void;
  bound(): boolean;
}>();
const capturedHandles = new WeakMap<object, LegacyChatAuthority>();
const guardedClientOwners = new WeakMap<object, LegacyChatAuthority>();

/** A known credential owner cannot borrow through a forwarded pool. */
export function assertLegacyCanonicalPool(owner: LegacyChatAuthority, pool: Pool): void {
  const issuer = capturedOwners.get(owner);
  if (issuer && issuer.pool !== pool) return foreignHistoryStop();
}

/** Only the original credential owner can read and register its history. */
export async function prepareLegacyCapturedHistory(owner: LegacyChatAuthority, input: CapturedHistoryInput) {
  const binder = capturedOwners.get(owner);
  if (!binder) throw new LegacyChatTerminated();
  return binder.prepare(input);
}
export function assertLegacyCapturedHistoryEntry(owner: LegacyChatAuthority, handle: LegacyCapturedHistoryHandle,
  database: DatabaseClient, auth: AuthContext): void {
  const original = capturedHandles.get(handle);
  if (original && original !== owner) return foreignHistoryStop();
  const issuer = guardedClientOwners.get(database) ?? canonicalBorrowOwner(database as PoolClient);
  if (issuer && issuer !== owner) return foreignHistoryStop();
  const binder = capturedOwners.get(owner);
  if (!binder) throw new LegacyChatTerminated();
  binder.assertEntry(handle, database, auth);
}
export function bindLegacyCapturedHistoryRun(owner: LegacyChatAuthority, handle: LegacyCapturedHistoryHandle,
  receipt: object): void {
  const original = capturedHandles.get(handle);
  if (original && original !== owner) return foreignHistoryStop();
  const binder = capturedOwners.get(owner);
  if (!binder) throw new LegacyChatTerminated();
  binder.bind(handle, receipt);
}
export function hasBoundLegacyCapturedHistory(owner: LegacyChatAuthority): boolean {
  return capturedOwners.get(owner)?.bound() === true;
}

type MemoryBinder = {
  bind(input: LegacySavedMemoryRunInput): Promise<LegacySavedMemoryRunHandle>;
  bindCaptured(handle: LegacyCapturedHistoryHandle,
    input: Omit<LegacySavedMemoryRunInput, "source" | "guard">): Promise<LegacySavedMemoryRunHandle>;
  terminate(error: unknown): never;
  readPublication(auth: AuthContext, taskID: string): Promise<Readonly<SavedMemoryDurableProofV2>>;
};
const memoryBinders = new WeakMap<object, MemoryBinder>();
const memoryRuns = new WeakMap<object, { owner: LegacyChatAuthority; auth: Readonly<AuthContext>;
  access: LegacySavedMemoryRunAccess; seal(): Promise<Readonly<SavedMemoryReadProof>>;
  inheritHistory(receipt: SavedMemorySessionHistoryReceipt): Promise<Readonly<LegacySavedMemoryHistoryFrame>> }>();
const foreignHistoryErrors = new WeakSet<object>();
function foreignHistoryStop(): never {
  const stop = new LegacyChatTerminated(); foreignHistoryErrors.add(stop); throw stop;
}
/** Reject-only identity, never permission or a callback into a caller owner.
 * Keep this before bridge/Core phase and clock checks for genuine foreigners. */
export function assertLegacySavedMemoryHistoryReceiptOwner(receipt: SavedMemorySessionHistoryReceipt,
  owner: LegacyChatAuthority): void {
  if (isForeignSessionHistoryReceipt(receipt, owner)) foreignHistoryStop();
}
/** Private origin survives bridge/Core catches without exposing payloads. */
export function isForeignLegacySavedMemoryHistoryError(error: unknown): boolean {
  return error !== null && typeof error === "object" && foreignHistoryErrors.has(error);
}

/** Only an actually minted Legacy credential owner can bind this capability. */
export function bindLegacySavedMemoryRun(owner: LegacyChatAuthority, input: LegacySavedMemoryRunInput): Promise<LegacySavedMemoryRunHandle> {
  const binder = memoryBinders.get(owner);
  if (!binder) return Promise.reject(new LegacyChatTerminated());
  return binder.bind(input);
}
/** The same original captured owner, handle and consumed Core clock are the
 * qualification. No provider label, source callback or parsed proof grants it. */
export function bindLegacyCapturedSavedMemoryRun(owner: LegacyChatAuthority, handle: LegacyCapturedHistoryHandle,
  input: Omit<LegacySavedMemoryRunInput, "source" | "guard">): Promise<LegacySavedMemoryRunHandle> {
  assertLegacyCapturedMemoryHandleOwner(handle, owner);
  const binder = memoryBinders.get(owner);
  if (!binder) return Promise.reject(new LegacyChatTerminated());
  return binder.bindCaptured(handle, input);
}
/** Reject-only preflight, before a bridge can allocate recipient Run state. */
export function assertLegacyCapturedMemoryHandleOwner(handle: LegacyCapturedHistoryHandle, owner: LegacyChatAuthority): void {
  const original = capturedHandles.get(handle);
  if (original && original !== owner) return foreignHistoryStop();
}
/** Construction can fail before a Run handle exists. Only the actual private
 * owner may latch that failure; structural clones never invoke foreign code. */
export function terminateLegacySavedMemoryRun(owner: LegacyChatAuthority, error: unknown): never {
  const binder = memoryBinders.get(owner);
  if (!binder) throw new LegacyChatTerminated();
  return binder.terminate(error);
}
export function accessLegacySavedMemoryRun(handle: LegacySavedMemoryRunHandle, owner: LegacyChatAuthority,
  auth: AuthContext): Readonly<LegacySavedMemoryRunAccess> {
  const entry = memoryRuns.get(handle);
  // A real handle belonging to A cannot be used to terminate a different real
  // owner B. Refuse before touching AuthContext hooks or B's terminal latch.
  if (entry && entry.owner !== owner) throw new LegacyChatTerminated();
  const binder = memoryBinders.get(owner);
  try {
    const current = snapshotLegacyChatAuth(auth);
    if (!entry || entry.owner !== owner || entry.auth.accountId !== current.accountId || entry.auth.userId !== current.userId
      || entry.auth.sessionId !== current.sessionId || entry.auth.userKind !== current.userKind) throw new LegacyChatTerminated();
    entry.access.throwIfTerminated(); return entry.access;
  } catch (error) { if (binder) return binder.terminate(error); throw new LegacyChatTerminated(); }
}
/** Close the actual owner's read-set after the bridge has drained its accepted
 * producers. Neither a JSON proof nor a cloned handle can seal a foreign Run. */
export async function sealLegacySavedMemoryRun(handle: LegacySavedMemoryRunHandle, owner: LegacyChatAuthority,
  auth: AuthContext): Promise<Readonly<SavedMemoryReadProof>> {
  accessLegacySavedMemoryRun(handle, owner, auth);
  return memoryRuns.get(handle)!.seal();
}
/** A real private Run consumes the exact inline Session receipt. JSON proofs,
 * callbacks, restored readers and structural owners cannot mint inheritance. */
export async function inheritLegacySavedMemoryHistory(handle: LegacySavedMemoryRunHandle, owner: LegacyChatAuthority,
  auth: AuthContext, receipt: SavedMemorySessionHistoryReceipt): Promise<Readonly<LegacySavedMemoryHistoryFrame>> {
  assertLegacySavedMemoryHistoryReceiptOwner(receipt, owner);
  const entry = memoryRuns.get(handle);
  if (entry && entry.owner !== owner) foreignHistoryStop();
  accessLegacySavedMemoryRun(handle, owner, auth);
  return memoryRuns.get(handle)!.inheritHistory(receipt);
}
/** Fresh current-reader admission only. Missing lineage and old v1 are refusals;
 * the route must explicitly select any authorized legacy compatibility path. */
export function readLegacySavedMemoryPublication(owner: LegacyChatAuthority, auth: AuthContext,
  taskID: string): Promise<Readonly<SavedMemoryDurableProofV2>> {
  const binder = memoryBinders.get(owner);
  if (!binder) return Promise.reject(new LegacyChatTerminated());
  return binder.readPublication(auth, taskID);
}
/** Retain the existing terminal class so Legacy fallback cannot turn a caught
 * Memory budget failure into a successful answer. Only this closed413 is kept. */
class LegacySavedMemoryBudgetTerminated extends LegacyChatTerminated {
  override readonly statusCode = 413;
  override readonly code = "SAVED_MEMORY_BUDGET_LIMITED";
  constructor() { super(); this.message = "The current Run cannot admit another complete saved Memory page."; }
}

/** Called only after the real route authenticator, with that request's actual
 * accepted header. The closure retains the fingerprint, never the bearer; its
 * matching current/previous deadline stays in PostgreSQL microsecond format.
 */
export async function admitLegacyChatAuthority(pool: Pool, auth: AuthContext,
  authorization: string | undefined, config: BackendConfig,
  audience?: readonly string[],
  sourceFailureCode: LegacyChatFailureCode = "LEGACY_CHAT_AUTHORITY_UNAVAILABLE"): Promise<LegacyChatAuthority> {
  const stop = new LegacyChatTerminated();
  try { auth = snapshotLegacyChatAuth(auth); } catch { throw stop; }
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7)
    || (audience && !audience.includes(auth.accountId))) throw stop;
  const deployment = operatorTestDeployment(config);
  const params: unknown[] = [sha256(authorization.slice(7)), deployment.enabled,
    deployment.webOrigin, deployment.backendOrigin, deployment.userAuthEnabled === true,
    auth.accountId, auth.userId, auth.sessionId];
  const started = performance.now();
  let admitted: Admission | undefined;
  try {
    const row = (await pool.query<Admission>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
      SELECT to_char((${acceptedDeadlineSQL}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS original_deadline,
        floor(extract(epoch FROM ((${acceptedDeadlineSQL})-tick.checked_at))*1000)::text AS remaining_ms,
        users.kind AS user_kind, CASE WHEN sessions.token_hash=$1 THEN 'current' ELSE 'previous' END AS token_branch,
        ${labBindingSQL} AS lab_binding ${authoritySQL}`, params)).rows[0];
    if (row) admitted = readLegacyChatSnapshotRecord(row, ["original_deadline", "remaining_ms", "user_kind", "token_branch", "lab_binding"]) as Admission;
  } catch { throw stop; }
  if (!admitted || admitted.user_kind !== auth.userKind
    || typeof admitted.original_deadline !== "string" || typeof admitted.remaining_ms !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(admitted.original_deadline)
    || !["current", "previous"].includes(admitted.token_branch)
    || !/^\d+$/u.test(admitted.remaining_ms)
    || (admitted.user_kind === "lab_human" && !admitted.lab_binding)) throw stop;
  let original: Readonly<LegacyChatOriginalProof>;
  try {
    original = validateLegacyChatOriginalProof({ version: 1, tokenHash: params[0], accountId: auth.accountId, userId: auth.userId,
      sessionId: auth.sessionId, userKind: admitted.user_kind, tokenBranch: admitted.token_branch, originalDeadline: admitted.original_deadline,
      deployment: { enabled: deployment.enabled, userAuthEnabled: deployment.userAuthEnabled === true,
        webOrigin: deployment.webOrigin, backendOrigin: deployment.backendOrigin }, labBinding: admitted.lab_binding });
  } catch { throw stop; }
  return buildLegacyChatAuthority(pool, original, admitted.remaining_ms, started, sourceFailureCode, true);
}

/** Only a trusted owner-joined execution row may supply `value`. The current
 * reader authenticates the resolve operation, not a replacement execution
 * credential. Original slot provenance is retained, while real slot rotation
 * continues to use the unchanged current-or-live-previous SQL predicate. */
export async function restoreLegacyChatAuthority(pool: Pool, currentAuth: AuthContext, value: unknown, config: BackendConfig,
  sourceFailureCode: LegacyChatFailureCode = "LEGACY_CHAT_AUTHORITY_UNAVAILABLE"): Promise<LegacyChatAuthority> {
  const stop = new LegacyChatTerminated();
  let original: Readonly<LegacyChatOriginalProof>;
  try {
    original = validateLegacyChatOriginalProof(value);
    currentAuth = snapshotLegacyChatAuth(currentAuth);
  } catch { throw stop; }
  const deployment = operatorTestDeployment(config);
  if (currentAuth.accountId !== original.accountId || currentAuth.userId !== original.userId
    || deployment.enabled !== original.deployment.enabled || (deployment.userAuthEnabled === true) !== original.deployment.userAuthEnabled
    || deployment.webOrigin !== original.deployment.webOrigin || deployment.backendOrigin !== original.deployment.backendOrigin) throw stop;
  const params = originalProofParameters(original);
  const started = performance.now();
  let remaining: unknown;
  try {
    const row = (await pool.query<{ remaining_ms: string }>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
      SELECT floor(extract(epoch FROM (LEAST($9::timestamptz,(${acceptedDeadlineSQL}))-tick.checked_at))*1000)::text AS remaining_ms
      ${authoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10
        AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb`, params)).rows[0];
    if (row) remaining = readLegacyChatSnapshotRecord(row, ["remaining_ms"]).remaining_ms;
  } catch { throw stop; }
  if (typeof remaining !== "string" || !/^\d+$/u.test(remaining)) throw stop;
  const restored = buildLegacyChatAuthority(pool, original, remaining, started, sourceFailureCode, false);
  try { restored.throwIfTerminated(); } catch (error) { restored.dispose(); throw error; }
  return restored;
}

function originalProofParameters(original: Readonly<LegacyChatOriginalProof>): unknown[] {
  return [original.tokenHash, original.deployment.enabled, original.deployment.webOrigin, original.deployment.backendOrigin,
    original.deployment.userAuthEnabled, original.accountId, original.userId, original.sessionId, original.originalDeadline,
    original.userKind, original.labBinding === null ? null : JSON.stringify(original.labBinding)];
}
function buildLegacyChatAuthority(pool: Pool, original: Readonly<LegacyChatOriginalProof>, remaining: string, started: number,
  sourceFailureCode: LegacyChatFailureCode, currentReaderAdmission: boolean): LegacyChatAuthority {
  const stop = new LegacyChatTerminated();
  // Only the route-owned exact source rejection selects this public code.
  const sourceStop = new LegacyChatTerminated(sourceFailureCode);
  const auth = original;
  const proof = originalProofParameters(original), binding = original.labBinding;
  const deadline = performance.now() + Number(remaining) - Math.ceil(performance.now() - started);
  if (!Number.isSafeInteger(Number(remaining))) throw stop;
  const controller = new AbortController();
  let terminated = false, disposed = false;
  let terminalFailure = stop;
  let active: PoolClient | null = null;
  let activeGuarded: PoolClient | null = null;
  let activeLease: object | null = null;
  let certifiedBorrow = false;
  let missingLineage = false, missingRetention = false;
  let accountFence: object | null = null, readerFence: object | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sourceChecks = new Set<() => Promise<void>>();
  let captureStarted = false;
  let capturedCheck: ((writer?: PoolClient) => Promise<void>) | undefined;
  let captureBound = false;
  let capturedSourcePreflight: (() => Promise<void>) | undefined;
  let lockCaptureForFinal: ((writer: PoolClient) => Promise<void>) | undefined;
  let memoryRun: LegacySavedMemoryRunAccess | null = null;
  let memoryBindingPending = false;
  let memoryDeadline: number | null = null;
  let memorySealed = false, memoryReaderPending = false, memoryReaderUsed = false;
  let memoryFinalCurrent: ((client: DatabaseClient) => Promise<void>) | null = null;
  let memoryPublicationTaskID: string | null = null;
  let memoryPublication: Readonly<SavedMemoryDurableProofV2> | null = null;
  let publicationFinalCurrent: ((client: DatabaseClient) => Promise<void>) | null = null;
  let publicationTail: Promise<unknown> = Promise.resolve();
  const fail = (failure = stop): never => {
    if (!terminated) terminalFailure = failure;
    terminated = true;
    if (!controller.signal.aborted) controller.abort(terminalFailure);
    throw terminalFailure;
  };
  // Timers request cancellation, but a delayed timer task cannot extend the
  // conservative monotonic bound established by the original DB clock read.
  const alive = () => { if (terminated || disposed || performance.now() >= deadline
    || (memoryDeadline !== null && performance.now() >= memoryDeadline)) fail(); };
  const arm = () => {
    const remaining = Math.min(deadline, memoryDeadline ?? Infinity) - performance.now();
    if (remaining <= 0) { terminated = true; controller.abort(stop); return; }
    timer = setTimeout(arm, Math.min(2_147_483_647, Math.max(1, remaining)));
    timer.unref?.();
  };
  arm();
  const check = async (database: DatabaseClient) => {
    alive();
    if (captureStarted) return capturedCheck ? capturedCheck() : fail();
    if (memoryBindingPending) return fail();
    if (memoryRun) return memoryRun.assertCurrent();
    try {
      const result = await database.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
        SELECT 1 ${authoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10
          AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb`, proof);
      if (!result.rows.length) fail();
      alive();
    } catch { fail(); }
  };
  const source = async <T>(operation: () => Promise<T>): Promise<T> => {
    alive();
    try { const value = await operation(); alive(); return value; }
    catch (error) {
      return fail(error instanceof ApiError && error.statusCode === 409 && error.code === "HARNESS_SOURCE_CHANGED"
        ? sourceStop : stop);
    }
  };
  const checked = async <T>(operation: () => Promise<T>, sourceCheck: (() => Promise<void>) | undefined,
    hostOperation: boolean): Promise<T> => {
    if (captureStarted && !captureBound) return fail();
    await check(active ?? pool);
    if (sourceCheck) await source(sourceCheck);
    if (capturedCheck && sourceCheck) await capturedCheck();
    let result: T;
    try { result = await operation(); }
    catch (error) {
      alive();
      if (hostOperation && error instanceof ApiError && error.statusCode !== 400) fail();
      await check(active ?? pool);
      if (sourceCheck) await source(sourceCheck);
      throw error; // Ordinary provider/user-input failure retains its own semantics.
    }
    await check(active ?? pool);
    if (sourceCheck) await source(sourceCheck);
    if (capturedCheck && sourceCheck) await capturedCheck();
    return result;
  };
  const lock = async (client: DatabaseClient, sql: string, values: unknown[], count = 1) => {
    alive();
    try { if ((await client.query(sql, values)).rowCount !== count) fail(); }
    catch { fail(); }
  };
  const rejectForeignClient = (client: DatabaseClient) => {
    const issuer = guardedClientOwners.get(client) ?? canonicalBorrowOwner(client as PoolClient);
    if (issuer && issuer !== owner) return foreignHistoryStop();
  };
  const certified = () => certifiedBorrow && active !== null && canonicalBorrowOwner(active) === owner;
  const checkFinalClient = (client: DatabaseClient) => {
    rejectForeignClient(client);
    if (captureStarted && (client !== activeGuarded || !certified())) return foreignHistoryStop();
  };
  const owner: LegacyChatAuthority = {
    signal: controller.signal, throwIfTerminated: alive,
    snapshotOriginal: () => { alive(); return original; },
    assertCurrent: () => check(active ?? pool), source,
    observeSource: current => {
      alive();
      // The captured final writer already checks this fixed domain after all
      // its source checks. Keep this earlier phase a private source preflight.
      sourceChecks.add(current === prepared?.guard && capturedSourcePreflight ? capturedSourcePreflight : current);
    },
    assertFinalCurrent: async client => {
      checkFinalClient(client);
      if (captureStarted) {
        const writer = activeGuarded;
        if (!captureBound || !lockCaptureForFinal || !capturedCheck || !writer
          || ((missingLineage || missingRetention) && accountFence !== activeLease)
          || (missingRetention && readerFence !== activeLease)) return fail();
        await source(() => lockCaptureForFinal!(writer));
        for (const current of sourceChecks) await source(current);
        await capturedCheck(writer);
        if (memorySealed && memoryFinalCurrent) return memoryFinalCurrent(writer);
        return;
      }
      if (memorySealed && memoryFinalCurrent) return memoryFinalCurrent(client);
      if (memoryPublication && publicationFinalCurrent) return publicationFinalCurrent(client);
      for (const current of sourceChecks) await source(current);
      await check(client); // Owner/clock last, after every source await.
    },
    host: (operation, sourceCheck) => checked(operation, sourceCheck, true),
    provider: (operation, sourceCheck) => checked(operation, sourceCheck, false),
    lockAccountsForFinalization: async client => {
      checkFinalClient(client);
      const ids = [...new Set([auth.accountId, ...(binding?.ownerAccount ? [binding.ownerAccount] : [])])].sort();
      if (missingLineage || missingRetention) {
        // Captured owners are password humans and have one original account.
        // UPDATE conflicts with the FK KEY SHARE for a new lineage or user.
        await lock(client, "SELECT id FROM accounts WHERE id=$1 FOR UPDATE NOWAIT", [auth.accountId]);
        accountFence = activeLease;
      } else await lock(client, "SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE NOWAIT", [ids], ids.length);
    },
    lockReadersForFinalization: async client => {
      checkFinalClient(client);
      // Only after the caller's unchanged source locks. FOR SHARE also blocks
      // revoked_at/expiry/hash non-key updates; KEY SHARE would not.
      // The generation baseline is created with the account by migration061.
      await lock(client, "SELECT account_id FROM harness_source_generations WHERE account_id=$1 FOR SHARE NOWAIT", [auth.accountId]);
      if (missingRetention) {
        if (accountFence !== activeLease) return fail();
        // The task PK is account-wide. Every existing actor is a possible FK
        // parent; the earlier account lock also fences insertion of a new actor.
        await lock(client, `WITH locked AS MATERIALIZED (
          SELECT id FROM users WHERE account_id=$1 ORDER BY id FOR UPDATE NOWAIT
        ) SELECT 1 FROM locked HAVING bool_or(id=$2::uuid)`, [auth.accountId, auth.userId]);
        readerFence = activeLease;
      } else await lock(client, "SELECT id FROM users WHERE account_id=$1 AND id=$2 FOR SHARE NOWAIT", [auth.accountId, auth.userId]);
      await lock(client, "SELECT id FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3 FOR SHARE NOWAIT", [auth.accountId, auth.userId, auth.sessionId]);
      if (binding) {
        await lock(client, "SELECT id FROM lab_test_workspaces WHERE id=$1 FOR SHARE NOWAIT", [binding.workspace]);
        await lock(client, "SELECT id FROM lab_test_workspace_entries WHERE id=$1 AND session_id=$2 FOR SHARE NOWAIT", [binding.entry, auth.sessionId]);
        if (binding.parent) {
          await lock(client, "SELECT id FROM users WHERE account_id=$1 AND id=$2 FOR SHARE NOWAIT", [binding.ownerAccount, binding.ownerUser]);
          await lock(client, "SELECT id FROM sessions WHERE id=$1 FOR SHARE NOWAIT", [binding.parent]);
        }
        if (binding.grant) {
          await lock(client, "SELECT id FROM capir_auth_grants WHERE id=$1 FOR SHARE NOWAIT", [binding.grant]);
          await lock(client, "SELECT id FROM capir_user_test_entitlements WHERE account_id=$1 AND user_id=$2 FOR SHARE NOWAIT", [binding.ownerAccount, binding.ownerUser]);
        }
        if (binding.principal) await lock(client, "SELECT id FROM capir_test_provisioners WHERE id=$1 FOR SHARE NOWAIT", [binding.principal]);
        if (binding.run) await lock(client, "SELECT id FROM capir_test_runs WHERE id=$1 FOR SHARE NOWAIT", [binding.run]);
      }
      await check(client);
    },
    withClient: async (client, operation) => {
      rejectForeignClient(client);
      if (guardedClientOwners.has(client)) return foreignHistoryStop();
      const canonical = claimCanonicalBorrow(pool, owner, client);
      if (!canonical && (captureStarted || certified())) return foreignHistoryStop();
      alive();
      if (active) return fail();
      active = client; activeLease = {}; certifiedBorrow = canonical;
      let clientOpen = true;
      const guarded = new Proxy(client, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== "query") return typeof value === "function" ? value.bind(target) : value;
        return (...args: unknown[]) => {
          if (!clientOpen) return fail(); // A late callback cannot touch a released/reused connection.
          const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: unknown })?.text;
          // Rollback/release must remain possible after a terminal failure.
          const cleanup = typeof text === "string" && /^(?:ROLLBACK(?: TO SAVEPOINT [A-Za-z0-9_]+)?|RELEASE SAVEPOINT [A-Za-z0-9_]+)\s*;?$/iu.test(text.trim());
          if (!cleanup) alive();
          try {
            const result = Reflect.apply(value as (...values: unknown[]) => unknown, target, args);
            if (result && typeof (result as Promise<unknown>).then === "function")
              return (result as Promise<unknown>).catch(() => fail());
            return result;
          } catch { return fail(); }
        };
      } });
      activeGuarded = guarded; guardedClientOwners.set(guarded, owner);
      try {
        const value = await operation(guarded);
        if (captureStarted) {
          if (!captureBound || !capturedCheck) return fail();
          await capturedCheck(guarded);
          if (memorySealed && memoryFinalCurrent) { await memoryFinalCurrent(guarded); alive(); }
        } else if (memorySealed && memoryFinalCurrent) { await memoryFinalCurrent(guarded); alive(); }
        else if (memoryPublication && publicationFinalCurrent) { await publicationFinalCurrent(guarded); alive(); }
        else await check(client); // Also fences completed-result read-only replay.
        return value;
      } finally { clientOpen = false; certifiedBorrow = false; activeGuarded = null; activeLease = null; active = null; }
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (!terminated) { terminalFailure = stop; terminated = true; }
      if (!controller.signal.aborted) controller.abort(terminalFailure);
    },
  };
  const terminateMemory = (error: unknown): never => {
    // Never forward arbitrary error/SQL prose, getters or a caller's status.
    if (error !== null && typeof error === "object" && !types.isProxy(error) && error instanceof ApiError) {
      const code = Object.getOwnPropertyDescriptor(error, "code"), status = Object.getOwnPropertyDescriptor(error, "statusCode");
      if (code && "value" in code && code.value === "SAVED_MEMORY_BUDGET_LIMITED"
        && status && "value" in status && status.value === 413) return fail(new LegacySavedMemoryBudgetTerminated());
      if (code && "value" in code && code.value === "HARNESS_SOURCE_CHANGED"
        && status && "value" in status && status.value === 409) return fail(sourceStop);
    }
    return fail();
  };
  let captureHandle: LegacyCapturedHistoryHandle | undefined;
  let captureIdentity: { taskID: string; sessionID: string; messageID: string | undefined } | undefined;
  let prepared: CapturedPreparation | undefined;
  let captureDatabase: DatabaseClient | undefined;
  let assertCaptureHeld: (() => void) | undefined;
  let captureCoreDeadline: number | undefined;
  let capturedMemoryBinding: { source: HarnessRunSourceHandle; guard: () => Promise<void>;
    domain: string } | undefined;
  const capturedMemoryBindInputs = new WeakSet<object>();
  const narrowDeadline = (next: number) => {
    memoryDeadline = Math.min(deadline, memoryDeadline ?? Infinity, next);
    if (timer) clearTimeout(timer);
    arm(); alive();
  };
  capturedOwners.set(owner, {
    pool, bound: () => captureBound,
    assertEntry(handle, database, entryAuth) {
      try {
        alive();
        const actor = snapshotLegacyChatAuth(entryAuth);
        assertCaptureHeld?.();
        if (!captureHandle || captureHandle !== handle || captureDatabase !== database
          || (database !== pool && database !== activeGuarded)
          || actor.accountId !== original.accountId || actor.userId !== original.userId
          || actor.sessionId !== original.sessionId || actor.userKind !== original.userKind) return fail();
      } catch (error) { return terminateMemory(error); }
    },
    bind(handle, receipt) {
      const run = consumeCapturedCoreClock(owner, handle, receipt);
      if (!run || !captureHandle || handle !== captureHandle || captureBound || !captureIdentity || !assertCaptureHeld
        || run.runID !== captureIdentity.taskID || run.workspaceID !== original.accountId
        || typeof run.sessionID !== "string" || run.sessionID.toLowerCase() !== captureIdentity.sessionID
        || (captureIdentity.messageID !== undefined && run.messageID !== captureIdentity.messageID)
        || !prepared || run.conversationHistory !== prepared.conversationHistory || run.sessionHistory !== prepared.snapshot
        || !Number.isFinite(run.runDeadlineMonotonicMs)) return fail();
      assertCaptureHeld();
      narrowDeadline(run.runDeadlineMonotonicMs); captureCoreDeadline = run.runDeadlineMonotonicMs; captureBound = true;
    },
    async prepare(input) {
      // A known foreign lease cannot affect this owner's clock or failure latch.
      if (!input || typeof input !== "object" || types.isProxy(input)) throw new LegacyChatTerminated();
      const supplied = Object.getOwnPropertyDescriptor(input, "database");
      if (supplied && "value" in supplied) rejectForeignClient(supplied.value);
      if (supplied && "value" in supplied && supplied.value === activeGuarded && !certified()) return foreignHistoryStop();
      try {
        alive();
        if (!currentReaderAdmission || captureStarted || memoryRun || memoryBindingPending || memoryReaderUsed
          || original.userKind !== "password_human") return fail();
        const fields = savedMemoryOwnRecord(input, ["database", "auth", "sessionID", "taskID", "messageID", "sources",
          ...(Object.getOwnPropertyDescriptor(input, "onExpiry") ? ["onExpiry"] : [])]);
        input = fields as unknown as CapturedHistoryInput;
        const database = input.database, lease = activeLease;
        const held = () => {
          alive();
          if (database !== pool && (!certified() || !lease || lease !== activeLease || database !== activeGuarded)) return fail();
        };
        held();
        const actor = snapshotLegacyChatAuth(input.auth);
        if (actor.userKind !== original.userKind || actor.accountId !== original.accountId
          || actor.userId !== original.userId || actor.sessionId !== original.sessionId) return fail();
        if (typeof input.sessionID !== "string" || (input.messageID !== undefined && typeof input.messageID !== "string")
          || typeof input.sources !== "function" || (input.onExpiry !== undefined && typeof input.onExpiry !== "function")) return fail();
        const sessionID = savedMemoryUUID(input.sessionID.toLowerCase());
        const taskID = savedMemoryUUID(input.taskID);
        const messageID = input.messageID;
        if (messageID !== undefined) savedMemoryUUID(messageID.toLowerCase());
        captureStarted = true;
        // Only fixed server readers see this query channel. Check the original
        // lease both before I/O and after its ACK, including the capture reads.
        const queryChannel = { query: async (sql: string, values?: unknown[]) => {
          held(); const result = await database.query(sql, values); held(); return result;
        } } as DatabaseClient;
        const frame = await collectCapturedHistory(queryChannel,
          { database, auth: actor, taskID, sessionID, messageID, sources: input.sources });
        held();
        const domain = JSON.parse(frame.domain) as {
          claims: { task: string; proof: unknown; sourceActor: string | null }[]; tasks: string[]; screenshots: unknown[] };
        capturedMemoryBinding = { source: frame.source, guard: frame.guard, domain: frame.domain };
        // Match the canonical SQL parser, including legacy mixed-case UUIDs.
        missingLineage = domain.claims.some(c => c.proof === null && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(c.task));
        missingRetention = domain.claims.some(c => c.sourceActor === null);
        lockCaptureForFinal = async writer => {
          held();
          if (!certified() || !activeLease || writer !== activeGuarded) return fail();
          if (domain.claims.length) await lockCapturedHistoryClaims(writer, actor.accountId, domain.claims);
          held();
          if (!certified() || writer !== activeGuarded) return fail();
        };
        const joint = async (writer?: PoolClient) => {
          try {
            held();
            await frame.guard();
            held();
            const sourceBinding = frame.currentSource();
            const currentMemory = memoryRun?.reads.snapshot();
            const begun = performance.now();
            if (writer && (!certified() || !activeLease || writer !== activeGuarded)) return fail();
            const row = await (writer ?? queryChannel).query(`WITH tick AS MATERIALIZED (SELECT statement_timestamp() AS checked_at),
              captured_history_owner AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
                ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,
                (SELECT expires_at FROM agent_sessions WHERE account_id=$6 AND created_by_user_id=$7
                  AND id=($12::jsonb->'source'->>'sessionID')::uuid),${capturedHistoryDeadlineSQL}
                  ${currentMemory ? ",($12::jsonb->'proof'->>'expires_at')::timestamptz" : ""}) AS until
                ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind='password_human'
                AND ($13::text='current' OR (sessions.token_hash IS DISTINCT FROM $1 AND sessions.previous_token_hash=$1))
                AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb
                AND ${legacySavedMemorySourceSQL} AND ${capturedHistorySourcesCurrentSQL} AND ${capturedHistoryClaimsCurrentSQL}
                ${currentMemory ? ` AND ${legacySavedMemoryProofSQL}` : ""})
              SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
                to_char(captured_history_owner.until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
              FROM tick,captured_history_owner WHERE captured_history_owner.until>tick.checked_at`,
            [...proof, JSON.stringify({ ...domain, source: sourceBinding,
              ...(currentMemory ? { proof: currentMemory, domains: [] } : {}) }), original.tokenBranch]);
            held();
            if ((writer && (!certified() || writer !== activeGuarded)) || row.rows.length !== 1
              || JSON.stringify(frame.currentSource()) !== JSON.stringify(sourceBinding)) return fail();
            const envelope = captureLegacySavedMemoryEnvelope(row.rows[0]);
            const us = legacySavedMemoryMicroseconds(envelope.read_until) - legacySavedMemoryMicroseconds(envelope.checked_at);
            narrowDeadline(begun + Number(us / 1000n));
          } catch (error) { return terminateMemory(error); }
        };
        // Serialize checks to keep a single source observation and monotonic
        // narrowing order even when host tools run concurrently.
        let tail: Promise<void> = Promise.resolve();
        const enqueue = async (operation: () => Promise<void>) => {
          held();
          const pending = tail.then(async () => { held(); await operation(); held(); });
          tail = pending.catch(() => {});
          await pending; held();
        };
        capturedCheck = writer => enqueue(() => joint(writer));
        await capturedCheck(); held();
        captureIdentity = { taskID, sessionID, messageID };
        captureDatabase = database;
        assertCaptureHeld = held;
        captureHandle = Object.freeze({}) as LegacyCapturedHistoryHandle;
        capturedHandles.set(captureHandle, owner);
        const assertBound = () => {
          held();
          if (!captureBound) fail();
        };
        // Routing needs the array identity before Core binds its original Run.
        // Keep the selected text private even if this view is read or copied.
        const conversationHistory = Object.freeze(boundedConversationHistory(frame.inline.messages, messageID)
          .map(({ message_id, role, text }) => Object.freeze({ message_id, role,
            get text() { assertBound(); return text; },
          })));
        const frameView = (selected: CapturedFrame["inline"]) => Object.freeze({ ...selected,
          get messages() { assertBound(); return selected.messages; },
        });
        const allSources = [...new Map([...(frame.inline.sources ?? []), ...(frame.complete?.sources ?? [])]
          .map(source => [source.taskID, source])).values()];
        let snapshot: SessionHistorySnapshot | undefined;
        if (frame.complete?.messages.length) {
          const originalSnapshot = createSessionHistorySnapshot({ database: queryChannel, auth: actor, sessionID,
            messages: frame.complete.messages, ...(messageID ? { currentMessageID: messageID } : {}),
            sources: allSources, taskIDs: frame.complete.historyTaskIDs!, sessionStamp: frame.complete.historyStamp!,
            sourceGeneration: frame.complete.historyGeneration!, assertCurrent: frame.guard,
            ...(input.onExpiry ? { onExpiry: input.onExpiry } : {}) });
          const messages = Object.freeze(originalSnapshot.messages.map(message => Object.freeze(message)));
          const checkSnapshot = () => enqueue(async () => {
            await source(originalSnapshot.assertCurrent);
            await joint();
          });
          await checkSnapshot(); // Private preparation, before a provider or tool exists.
          snapshot = Object.freeze({ version: originalSnapshot.version,
            get messages() { assertBound(); return messages; },
            async assertCurrent() { assertBound(); await checkSnapshot(); } });
        }
        capturedSourcePreflight = () => enqueue(() => source(frame.guard));
        prepared = Object.freeze({ handle: captureHandle, inline: frameView(frame.inline),
          complete: frame.complete && frameView(frame.complete), conversationHistory, snapshot,
          async guard() { assertBound(); await enqueue(joint); },
        });
        return prepared;
      } catch (error) { return terminateMemory(error); }
    },
  });
  const readCurrentPublication = async (database: DatabaseClient, taskID: string) => {
        const begun = performance.now();
        // Canonical source functions055/056/065 use statement_timestamp(). Use
        // that exact clock for the other predicates in this same fresh command.
        const result = await database.query(`WITH tick AS MATERIALIZED (SELECT statement_timestamp() AS checked_at),
          dependencies AS MATERIALIZED (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
              'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
              'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text)
              ORDER BY d.memory_item_id),'[]'::jsonb) AS stamps
            FROM agent_task_saved_memory_dependencies d WHERE d.account_id=$6 AND d.task_id=$12::uuid
          ), admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
            COALESCE((SELECT t.expires_at FROM agent_task_memory_lineage t WHERE t.account_id=$6 AND t.task_id=$12::uuid),
              'infinity'::timestamptz),
            COALESCE((SELECT c.expires_at FROM agent_session_chat_tasks c WHERE c.account_id=$6 AND c.task_id=$12::text),
              'infinity'::timestamptz)) AS read_deadline
            ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
            AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb
            AND NOT EXISTS (SELECT 1 FROM agent_session_chat_tasks c WHERE c.account_id=$6 AND c.task_id=$12::text AND c.actor_user_id<>$7)
            AND agent_session_chat_sources_available($6,$12::text)
            AND saved_memory_task_current($6,$12::uuid,$7,tick.checked_at))
          SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
            to_char(a.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until,t.proof_digest,
            jsonb_build_object('version',2,'account_id',t.account_id::text,'reader_actor_id',t.reader_actor_id::text,
              'task_id',t.task_id::text,'completion_idempotency_id',t.completion_idempotency_id::text,
              'retention_kind',t.retention_kind,'source_origin_session_id',t.source_origin_session_id::text,
              'expires_at',CASE WHEN t.expires_at IS NULL THEN NULL ELSE to_char(t.expires_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'stamps',d.stamps) AS proof
          FROM admitted a CROSS JOIN tick CROSS JOIN dependencies d JOIN agent_task_memory_lineage t
            ON t.account_id=$6 AND t.task_id=$12::uuid AND t.reader_actor_id=$7 AND t.format_version=2
          WHERE a.read_deadline>tick.checked_at`, [...proof, taskID]);
        if (result.rows.length !== 1) return fail();
        const row = savedMemoryOwnRecord(result.rows[0], ["available", "checked_at", "read_until", "proof_digest", "proof"]);
        const envelope = captureLegacySavedMemoryEnvelope({ available: row.available, checked_at: row.checked_at, read_until: row.read_until });
        const retained = captureSavedMemoryDurableProof(row.proof);
        if (retained.account_id !== original.accountId || retained.reader_actor_id !== original.userId || retained.task_id !== taskID
          || row.proof_digest !== savedMemoryDurableProofDigest(retained)) return fail();
        const lifetime = Number((legacySavedMemoryMicroseconds(envelope.read_until)
          - legacySavedMemoryMicroseconds(envelope.checked_at)) / 1000n);
        // Charge queue/query/ACK time; do not turn this bound into a retained TTL.
        const readDeadline = Math.min(deadline, memoryDeadline ?? Infinity, begun + lifetime);
        if (performance.now() >= readDeadline) return fail();
        // Preserve the earliest actual delivery horizon through later awaits;
        // this never changes the retained proof or restarts a reader/Run TTL.
        memoryDeadline = readDeadline;
        if (timer) clearTimeout(timer);
        arm(); alive();
        return retained;
  };
  publicationFinalCurrent = async client => {
    const lease = activeLease, originalPublication = memoryPublication;
    const assertHeld = () => {
      if (!lease || activeLease !== lease || !active || !originalPublication
        || (client !== active && client !== activeGuarded)) return terminateMemory(null);
    };
    try {
      alive(); assertHeld();
      const operation = publicationTail.then(async () => {
        try {
          alive(); assertHeld();
          for (const current of sourceChecks) await source(current);
          assertHeld(); alive();
          const retained = await readCurrentPublication(client, originalPublication!.task_id);
          assertHeld(); alive();
          if (JSON.stringify(retained) !== JSON.stringify(originalPublication)) return terminateMemory(null);
        } catch (error) { return terminateMemory(error); }
      });
      publicationTail = operation.catch(() => {});
      await operation;
    } catch (error) { return terminateMemory(error); }
  };
  memoryBinders.set(owner, { terminate: terminateMemory,
    readPublication: async (readerAuth, value) => {
      try {
        alive();
        if (!currentReaderAdmission || captureStarted || memoryRun || memoryBindingPending || memoryReaderPending
          || original.userKind === "lab_human") return fail();
        // This current reader may not later be repurposed as an execution Run.
        memoryReaderPending = true; memoryReaderUsed = true;
        const actor = snapshotLegacyChatAuth(readerAuth), taskID = savedMemoryUUID(value);
        if (actor.accountId !== original.accountId || actor.userId !== original.userId
          || actor.sessionId !== original.sessionId || actor.userKind !== original.userKind) return fail();
        if (memoryPublicationTaskID !== null && memoryPublicationTaskID !== taskID) return fail();
        memoryPublicationTaskID = taskID;
        const retained = await readCurrentPublication(pool, taskID);
        if (memoryPublication && JSON.stringify(retained) !== JSON.stringify(memoryPublication)) return fail();
        memoryPublication = retained;
        return retained;
      } catch (error) { return terminateMemory(error); }
      finally { memoryReaderPending = false; }
    }, bindCaptured: async (handle, value) => {
      // A genuine foreign handle cannot affect the recipient's latch or clock.
      const issuer = capturedHandles.get(handle);
      if (issuer && issuer !== owner) return foreignHistoryStop();
      try {
        alive(); assertCaptureHeld?.();
        if (!captureBound || !captureHandle || handle !== captureHandle || !captureIdentity || !capturedMemoryBinding)
          return fail();
        const row = savedMemoryOwnRecord(value, ["auth", "taskID", "runID", "runDeadlineMonotonicMs"]);
        if (row.taskID !== captureIdentity.taskID || row.runID !== captureIdentity.taskID
          || row.runDeadlineMonotonicMs !== captureCoreDeadline) return fail();
        const input: LegacySavedMemoryRunInput = { auth: snapshotLegacyChatAuth(row.auth as AuthContext),
          taskID: captureIdentity.taskID, runID: captureIdentity.taskID, runDeadlineMonotonicMs: captureCoreDeadline!,
          source: capturedMemoryBinding.source, guard: capturedMemoryBinding.guard };
        capturedMemoryBindInputs.add(input);
        return await memoryBinders.get(owner)!.bind(input);
      } catch (error) { return terminateMemory(error); }
    }, bind: async input => {
    const capturedBinding = capturedMemoryBindInputs.delete(input) ? capturedMemoryBinding : undefined;
    if ((captureStarted && !capturedBinding) || memoryRun || memoryBindingPending || memoryReaderPending || memoryReaderUsed) return fail();
    memoryBindingPending = true;
    try {
      alive();
      const row = savedMemoryOwnRecord(input, ["auth", "taskID", "runID", "runDeadlineMonotonicMs", "source", "guard"]);
      const actor = snapshotLegacyChatAuth(row.auth as AuthContext);
      const taskID = savedMemoryUUID(row.taskID), runID = savedMemoryUUID(row.runID);
      const coreDeadline = row.runDeadlineMonotonicMs;
      if (actor.accountId !== original.accountId || actor.userId !== original.userId
        || actor.sessionId !== original.sessionId || actor.userKind !== original.userKind
        || typeof coreDeadline !== "number" || !Number.isFinite(coreDeadline)
        || coreDeadline <= performance.now() || typeof row.guard !== "function") return fail();
      // Original Legacy proof has no original Lab deadline. In particular,
      // capirTestSessions only caps the child to workspace/sessionTTL, not the
      // grant absolute expiry. A later Lab query cannot reconstruct that floor.
      if (original.userKind === "lab_human") return fail();
      const guard = row.guard as () => Promise<void>, sourceHandle = row.source as HarnessRunSourceHandle;
      readHarnessRunSourceBinding(sourceHandle, guard, actor); // Validate identity before executing any supplied function.
      await source(guard);
      const sourceBinding = readHarnessRunSourceBinding(sourceHandle, guard, actor);
      const begun = performance.now(), remainingMs = Math.floor(Math.min(deadline, coreDeadline,
        capturedBinding ? memoryDeadline ?? Infinity : Infinity) - begun);
      if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) return fail();
      // pool.query owns one autocommit command, independently of `active`.
      // https://node-postgres.com/apis/pool#poolquery
      const captureMetadata = capturedBinding ? { ...JSON.parse(capturedBinding.domain), capturedTokenBranch: original.tokenBranch } : {};
      const captureSQL = capturedBinding ? ` AND ($12::jsonb->>'capturedTokenBranch'='current'
        OR (sessions.token_hash IS DISTINCT FROM $1 AND sessions.previous_token_hash=$1))
        AND ${capturedHistorySourcesCurrentSQL} AND ${capturedHistoryClaimsCurrentSQL}` : "";
      const captureDeadlineSQL = capturedBinding ? `,${capturedHistoryDeadlineSQL}` : "";
      const initialization = await pool.query(`WITH tick AS MATERIALIZED (SELECT ${capturedBinding ? "statement_timestamp()" : "clock_timestamp()"} AS checked_at),
        admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
          tick.checked_at + $13::bigint * interval '1 millisecond',
          ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,
          COALESCE(($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,'infinity'::timestamptz)${captureDeadlineSQL}) AS read_deadline
          ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
          AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb AND ${legacySavedMemorySourceSQL}${captureSQL})
        SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
          to_char(admitted.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
        FROM tick,admitted WHERE admitted.read_deadline>tick.checked_at`, [...proof,
        JSON.stringify({ ...captureMetadata, source: sourceBinding }), remainingMs]);
      if (initialization.rows.length !== 1) return fail();
      const initial = captureLegacySavedMemoryEnvelope(initialization.rows[0]);
      // Charge all acquisition, database and ACK time; never reset Core's clock.
      const lifetimeMs = Number((legacySavedMemoryMicroseconds(initial.read_until)
        - legacySavedMemoryMicroseconds(initial.checked_at)) / 1000n);
      let runDeadline = Math.min(deadline, coreDeadline, begun + lifetimeMs,
        capturedBinding ? memoryDeadline ?? Infinity : Infinity);
      if (performance.now() >= runDeadline) return fail();
      const authority: SavedMemoryAuthority = Object.freeze({ auth: Object.freeze({ accountId: actor.accountId, userId: actor.userId }),
        taskID, expiresAt: initial.read_until, assertCurrent: () => owner.assertCurrent() });
      const reads = new SavedMemoryReadSet(authority);
      // The original fixed capture, including inline-only and empty V2 cases.
      // No later database read can substitute newer tuples for these ancestors.
      if (capturedBinding) {
        const claims = JSON.parse(capturedBinding.domain).claims as { task: string; proof: unknown }[];
        const inherited = new Map<string, Readonly<SavedMemoryStamp>>();
        for (const claim of claims) {
          if (claim.proof === null) continue;
          const retained = captureSavedMemoryRetainedProof(claim.proof);
          if (retained.account_id !== actor.accountId || retained.reader_actor_id !== actor.userId
            || retained.task_id !== savedMemoryUUID(claim.task.toLowerCase()) || retained.task_id === taskID) return fail();
          for (const stamp of retained.stamps) {
            const prior = inherited.get(stamp.item_id);
            if (prior && JSON.stringify(prior) !== JSON.stringify(stamp)) return fail();
            inherited.set(stamp.item_id, stamp);
          }
        }
        if (inherited.size > SAVED_MEMORY_READ_LIMIT) savedMemoryBudgetLimited();
        reads.admit([...inherited.values()]);
      }
      const domains: Readonly<SavedMemoryFinalReadDomain>[] = [];
      const history: SavedMemoryHistoryAncestor[] = [];
      let tail: Promise<unknown> = Promise.resolve();
      let sealing = false;
      let sealedProof: Readonly<SavedMemoryReadProof> | null = null;
      let sealPromise: Promise<Readonly<SavedMemoryReadProof>> | null = null;
      const runAlive = () => { alive(); if (performance.now() >= runDeadline) return fail(); };
      const finalize = (value?: SavedMemoryReadProof, query?: SavedMemoryFinalReadDomain, finalClient?: DatabaseClient,
        inheritance?: readonly SavedMemoryHistoryAncestor[], historyLease?: Readonly<{ lease: object; database: DatabaseClient }>) => {
        let captured: Readonly<SavedMemoryReadProof> | undefined, domain: Readonly<SavedMemoryFinalReadDomain> | undefined;
        const lease = finalClient ? activeLease : null;
        const heldAlive = () => {
          if (finalClient && (!memorySealed || !sealedProof || !lease || activeLease !== lease || !active
            || (finalClient !== active && finalClient !== activeGuarded))) return terminateMemory(null);
        };
        const historyAlive = () => {
          if (historyLease && (activeLease !== historyLease.lease || activeGuarded !== historyLease.database || !active))
            return terminateMemory(null);
        };
        try {
          runAlive(); historyAlive();
          if (sealing && (value !== undefined || query !== undefined || inheritance !== undefined)) return terminateMemory(null);
          heldAlive();
          captured = value === undefined ? undefined : captureSavedMemoryReadProof(value);
          domain = query === undefined ? undefined : captureLegacySavedMemoryDomain(query);
          if (domain && JSON.stringify(domain.proof) !== JSON.stringify(captured)) return terminateMemory(null);
        } catch (error) { return terminateMemory(error); }
        const operation = tail.then(async () => {
          try {
            runAlive(); heldAlive(); historyAlive();
            let next = captured ?? sealedProof ?? reads.snapshot();
            const byTask = new Map(history.map(ancestor => [ancestor.taskID, ancestor]));
            for (const ancestor of inheritance ?? []) {
              const before = byTask.get(ancestor.taskID);
              if (before && JSON.stringify(before) !== JSON.stringify(ancestor)) return terminateMemory(null);
              byTask.set(ancestor.taskID, ancestor);
            }
            const allHistory = [...byTask.values()].sort((a, b) => a.taskID < b.taskID ? -1 : a.taskID > b.taskID ? 1 : 0);
            if (allHistory.length > 64 || Buffer.byteLength(JSON.stringify(allHistory), "utf8") > 256 * 1024) savedMemoryBudgetLimited();
            if (inheritance !== undefined) {
              const merged = new Map(next.stamps.map(stamp => [stamp.item_id, stamp]));
              for (const ancestor of inheritance) for (const stamp of ancestor.proof.stamps) {
                const before = merged.get(stamp.item_id);
                if (before && JSON.stringify(before) !== JSON.stringify(stamp)) return terminateMemory(null);
                merged.set(stamp.item_id, stamp);
              }
              if (merged.size > SAVED_MEMORY_READ_LIMIT) savedMemoryBudgetLimited();
              next = captureSavedMemoryReadProof({ ...next,
                stamps: [...merged.values()].sort((a, b) => a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0) });
            }
            assertLegacySavedMemoryProofSuperset(reads.snapshot(), next);
            const allDomains = domain ? [...domains, domain] : [...domains];
            if (allDomains.length > 64 || Buffer.byteLength(JSON.stringify(allDomains), "utf8") > 256 * 1024) savedMemoryBudgetLimited();
            for (const current of new Set([...sourceChecks, guard])) await source(current);
            runAlive();
            const actualSource = readHarnessRunSourceBinding(sourceHandle, guard, actor);
            const started = performance.now();
            const memoryMetadata = { source: actualSource, proof: next, domains: allDomains,
              ...(allHistory.length ? { history: allHistory } : {}) };
            if (Buffer.byteLength(JSON.stringify(memoryMetadata), "utf8") > 512 * 1024) savedMemoryBudgetLimited();
            // The separate original capture has its own unchanged 1 MiB limit.
            // Do not charge complete-history eligibility to the Run frame cap.
            const metadata = JSON.stringify({ ...captureMetadata, ...memoryMetadata });
            heldAlive(); historyAlive(); // Recheck after every source await, before touching a held connection.
            // All original credential slots stay inside this owner. One fresh
            // statement snapshot and one MATERIALIZED tick govern every domain.
            // https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED
            const result = finalClient ? await finalClient.query(`WITH tick AS MATERIALIZED (SELECT statement_timestamp() AS checked_at),
              dependencies AS MATERIALIZED (
                SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id',d.memory_item_id::text,'item_version',d.item_version,
                  'lineage_epoch',d.lineage_epoch::text,'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,
                  'subject_id',d.subject_id::text,'relationship_context_id',d.relationship_context_id::text)
                  ORDER BY d.memory_item_id),'[]'::jsonb) AS stamps
                FROM agent_task_saved_memory_dependencies d WHERE d.account_id=$6 AND d.task_id=$13::uuid
              ), admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
                ($12::jsonb->'proof'->>'expires_at')::timestamptz,
                ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,
                COALESCE(($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,'infinity'::timestamptz),
                COALESCE((SELECT min((d->>'query_expires_at')::timestamptz)
                  FROM jsonb_array_elements($12::jsonb->'domains') d),'infinity'::timestamptz),
                COALESCE((SELECT t.expires_at FROM agent_task_memory_lineage t WHERE t.account_id=$6 AND t.task_id=$13::uuid),
                  'infinity'::timestamptz)${allHistory.length ? legacySavedMemoryHistoryDeadlineSQL : ""}${captureDeadlineSQL}) AS read_deadline
                ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
                AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb
                AND ${legacySavedMemorySourceSQL} AND ${legacySavedMemoryProofSQL}${allHistory.length ? ` AND ${legacySavedMemoryHistorySQL}` : ""}${captureSQL}
                AND agent_session_chat_sources_available($6,$13::text)
                AND NOT EXISTS (SELECT 1 FROM agent_session_chat_tasks c WHERE c.account_id=$6 AND c.task_id=$13::text AND c.actor_user_id<>$7)
                AND EXISTS (SELECT 1 FROM agent_task_memory_lineage t CROSS JOIN dependencies d
                  WHERE t.account_id=$6 AND t.task_id=$13::uuid AND t.reader_actor_id=$7 AND t.format_version=2
                    AND t.dependency_count=jsonb_array_length($12::jsonb->'proof'->'stamps')
                    AND d.stamps=$12::jsonb->'proof'->'stamps'
                    AND saved_memory_task_current($6,$13::uuid,$7,tick.checked_at)))
              SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
                to_char(admitted.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
              FROM tick,admitted WHERE admitted.read_deadline>tick.checked_at`, [...proof, metadata, taskID])
              : await pool.query(`WITH tick AS MATERIALIZED (SELECT ${capturedBinding || allHistory.length ? "statement_timestamp()" : "clock_timestamp()"} AS checked_at),
              admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
                ($12::jsonb->'proof'->>'expires_at')::timestamptz,
                ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,
                COALESCE(($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,'infinity'::timestamptz),
                COALESCE((SELECT min((d->>'query_expires_at')::timestamptz)
                  FROM jsonb_array_elements($12::jsonb->'domains') d),'infinity'::timestamptz)${allHistory.length ? legacySavedMemoryHistoryDeadlineSQL : ""}${captureDeadlineSQL}) AS read_deadline
                ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
                AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb
                AND ${legacySavedMemorySourceSQL} AND ${legacySavedMemoryProofSQL}${allHistory.length ? ` AND ${legacySavedMemoryHistorySQL}` : ""}${captureSQL})
              SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
                to_char(admitted.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
              FROM tick,admitted WHERE admitted.read_deadline>tick.checked_at`, [...proof, metadata]);
            heldAlive(); historyAlive(); // A delayed ACK cannot outlive or switch this connection lease.
            if (result.rows.length !== 1) return fail();
            const envelope = captureLegacySavedMemoryEnvelope(result.rows[0]);
            if (envelope.read_until > authority.expiresAt) return fail();
            const milliseconds = Number((legacySavedMemoryMicroseconds(envelope.read_until)
              - legacySavedMemoryMicroseconds(envelope.checked_at)) / 1000n);
            runDeadline = Math.min(runDeadline, started + milliseconds, capturedBinding ? memoryDeadline ?? Infinity : Infinity);
            memoryDeadline = runDeadline;
            if (timer) clearTimeout(timer);
            arm();
            runAlive();
            if (inheritance !== undefined) {
              // Only a successful joint can admit the complete original tuple.
              // Concurrent metadata additions cannot be silently omitted.
              assertLegacySavedMemoryProofSuperset(reads.snapshot(), next);
              reads.admit(next.stamps);
              history.splice(0, history.length, ...allHistory);
            }
            if (domain) domains.push(domain);
            return envelope;
          } catch (error) { return terminateMemory(error); }
        });
        tail = operation.catch(() => {});
        return operation;
      };
      const access: LegacySavedMemoryRunAccess = Object.freeze({ runID, authority, reads,
        finalizeRead: (value: SavedMemoryFinalReadDomain) => {
          try { const domain = captureLegacySavedMemoryDomain(value); return finalize(domain.proof, domain); }
          catch (error) { return terminateMemory(error); }
        },
        finalizeProof: (value: SavedMemoryReadProof) => finalize(value),
        assertCurrent: async () => { await finalize(); }, throwIfTerminated: runAlive, terminate: terminateMemory });
      const handle = Object.freeze({}) as LegacySavedMemoryRunHandle;
      const inheritHistory = (receipt: SavedMemorySessionHistoryReceipt) => {
        try {
          // A known foreign receipt must not poison either real owner, even
          // when this Run is closing or has no Session source of its own.
          const fact = consumeSessionHistoryReceipt(receipt, owner, actor, sourceBinding.sessionID ?? "", runID, taskID);
          let historyLease: Readonly<{ lease: object; database: DatabaseClient }> | undefined;
          if (!sessionHistoryReceiptUsesDatabase(receipt, owner, pool)) {
            // withClient creates a NEW guarded Proxy for EACH private lease;
            // its query closure permanently closes in finally. Raw clients
            // and forwarding wrappers carry no such issuance identity.
            if (!activeGuarded || !activeLease || !sessionHistoryReceiptUsesDatabase(receipt, owner, activeGuarded))
              return terminateMemory(null);
            historyLease = Object.freeze({ lease: activeLease, database: activeGuarded });
          }
          runAlive();
          if (sealing || sourceBinding.sessionID === null) return terminateMemory(null);
          const currentSource = readHarnessRunSourceBinding(sourceHandle, guard, actor);
          if (fact.accountId !== actor.accountId || fact.userId !== actor.userId || fact.sessionID !== sourceBinding.sessionID
            || fact.runID !== runID || fact.taskID !== taskID
            || fact.unavailableAssistantTaskIDs.length !== 0
            || JSON.stringify(fact.source) !== JSON.stringify(currentSource)) return terminateMemory(null);
          const ancestors: SavedMemoryHistoryAncestor[] = fact.ancestors.map(ancestor => {
            const retained = captureSavedMemoryDurableProof(ancestor.proof);
            if (retained.account_id !== actor.accountId || retained.reader_actor_id !== actor.userId
              || retained.task_id !== ancestor.taskID || retained.task_id === taskID
              || retained.completion_idempotency_id !== ancestor.completionID
              || typeof ancestor.bodyDigest !== "string" || !/^[a-f0-9]{64}$/.test(ancestor.bodyDigest)
              || ancestor.proofDigest !== savedMemoryDurableProofDigest(retained)
              || ancestor.sourceTaskExpiresAt !== retained.expires_at) return terminateMemory(null);
            return Object.freeze({ taskID: savedMemoryUUID(ancestor.taskID), completionID: savedMemoryUUID(ancestor.completionID),
              bodyDigest: ancestor.bodyDigest, proofDigest: ancestor.proofDigest, proof: retained,
              sourceTaskExpiresAt: ancestor.sourceTaskExpiresAt });
          });
          return finalize(undefined, undefined, undefined, Object.freeze(ancestors), historyLease).then(envelope => {
            runAlive();
            if (historyLease && (activeLease !== historyLease.lease || activeGuarded !== historyLease.database || !active))
              return terminateMemory(null);
            return Object.freeze({ envelope, messages: fact.messages });
          });
        } catch (error) {
          if (isForeignSessionHistoryReceiptError(error)) foreignHistoryStop();
          return terminateMemory(error);
        }
      };
      const seal = (): Promise<Readonly<SavedMemoryReadProof>> => {
        try {
          runAlive();
          if (sealPromise) return sealPromise;
          // Reject newly submitted finalizers immediately. Already accepted
          // operations retain their original tail and must finish before seal.
          sealing = true;
          const pending = tail;
          sealPromise = pending.then(async () => {
            runAlive();
            // Closing blocks new producer finalizers, but the internal current
            // proof still needs its fresh-pool joint before writer admission.
            const before = reads.snapshot();
            await finalize();
            runAlive();
            if (JSON.stringify(reads.snapshot()) !== JSON.stringify(before)) return terminateMemory(null);
            sealedProof = reads.seal(); memorySealed = true;
            return sealedProof;
          }).catch(error => terminateMemory(error));
          return sealPromise;
        } catch (error) { return terminateMemory(error); }
      };
      memoryFinalCurrent = async client => { await finalize(undefined, undefined, client); };
      memoryRuns.set(handle, { owner, auth: actor, access, seal, inheritHistory });
      memoryRun = access; memoryDeadline = runDeadline; memoryBindingPending = false;
      if (timer) clearTimeout(timer);
      arm();
      return handle;
    } catch (error) { return terminateMemory(error); }
  } });
  return owner;
}
