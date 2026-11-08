import type { Pool, PoolClient } from "pg";
import { types } from "node:util";
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
import { SavedMemoryReadSet, captureSavedMemoryReadProof, savedMemoryOwnRecord, savedMemoryUUID,
  savedMemoryBudgetLimited, type SavedMemoryAuthority, type SavedMemoryReadProof } from "./savedMemoryLineage.js";
import type { SavedMemoryFinalReadDomain } from "./savedMemoryDiscovery.js";
import { assertLegacySavedMemoryProofSuperset, captureLegacySavedMemoryDomain, captureLegacySavedMemoryEnvelope,
  legacySavedMemoryMicroseconds, legacySavedMemoryProofSQL, legacySavedMemorySourceSQL,
  type LegacySavedMemoryReadEnvelope } from "./legacySavedMemoryDomain.js";

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
type MemoryBinder = { bind(input: LegacySavedMemoryRunInput): Promise<LegacySavedMemoryRunHandle>; terminate(error: unknown): never };
const memoryBinders = new WeakMap<object, MemoryBinder>();
const memoryRuns = new WeakMap<object, { owner: LegacyChatAuthority; auth: Readonly<AuthContext>; access: LegacySavedMemoryRunAccess }>();

/** Only an actually minted Legacy credential owner can bind this capability. */
export function bindLegacySavedMemoryRun(owner: LegacyChatAuthority, input: LegacySavedMemoryRunInput): Promise<LegacySavedMemoryRunHandle> {
  const binder = memoryBinders.get(owner);
  if (!binder) return Promise.reject(new LegacyChatTerminated());
  return binder.bind(input);
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
  return buildLegacyChatAuthority(pool, original, admitted.remaining_ms, started, sourceFailureCode);
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
  const restored = buildLegacyChatAuthority(pool, original, remaining, started, sourceFailureCode);
  try { restored.throwIfTerminated(); } catch (error) { restored.dispose(); throw error; }
  return restored;
}

function originalProofParameters(original: Readonly<LegacyChatOriginalProof>): unknown[] {
  return [original.tokenHash, original.deployment.enabled, original.deployment.webOrigin, original.deployment.backendOrigin,
    original.deployment.userAuthEnabled, original.accountId, original.userId, original.sessionId, original.originalDeadline,
    original.userKind, original.labBinding === null ? null : JSON.stringify(original.labBinding)];
}
function buildLegacyChatAuthority(pool: Pool, original: Readonly<LegacyChatOriginalProof>, remaining: string, started: number,
  sourceFailureCode: LegacyChatFailureCode): LegacyChatAuthority {
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sourceChecks = new Set<() => Promise<void>>();
  let memoryRun: LegacySavedMemoryRunAccess | null = null;
  let memoryBindingPending = false;
  let memoryDeadline: number | null = null;
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
    await check(active ?? pool);
    if (sourceCheck) await source(sourceCheck);
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
    return result;
  };
  const lock = async (client: DatabaseClient, sql: string, values: unknown[], count = 1) => {
    alive();
    try { if ((await client.query(sql, values)).rowCount !== count) fail(); }
    catch { fail(); }
  };
  const owner: LegacyChatAuthority = {
    signal: controller.signal, throwIfTerminated: alive,
    snapshotOriginal: () => { alive(); return original; },
    assertCurrent: () => check(active ?? pool), source,
    observeSource: current => { alive(); sourceChecks.add(current); },
    assertFinalCurrent: async client => {
      for (const current of sourceChecks) await source(current);
      await check(client); // Owner/clock last, after every source await.
    },
    host: (operation, sourceCheck) => checked(operation, sourceCheck, true),
    provider: (operation, sourceCheck) => checked(operation, sourceCheck, false),
    lockAccountsForFinalization: async client => {
      const ids = [...new Set([auth.accountId, ...(binding?.ownerAccount ? [binding.ownerAccount] : [])])].sort();
      await lock(client, "SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE NOWAIT", [ids], ids.length);
    },
    lockReadersForFinalization: async client => {
      // Only after the caller's unchanged source locks. FOR SHARE also blocks
      // revoked_at/expiry/hash non-key updates; KEY SHARE would not.
      // The generation baseline is created with the account by migration061.
      await lock(client, "SELECT account_id FROM harness_source_generations WHERE account_id=$1 FOR SHARE NOWAIT", [auth.accountId]);
      await lock(client, "SELECT id FROM users WHERE account_id=$1 AND id=$2 FOR SHARE NOWAIT", [auth.accountId, auth.userId]);
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
      alive();
      if (active) return fail();
      active = client;
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
      try {
        const value = await operation(guarded);
        await check(client); // Also fences completed-result read-only replay.
        return value;
      } finally { clientOpen = false; active = null; }
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
  memoryBinders.set(owner, { terminate: terminateMemory, bind: async input => {
    if (memoryRun || memoryBindingPending) return fail();
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
      const begun = performance.now(), remainingMs = Math.floor(Math.min(deadline, coreDeadline) - begun);
      if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) return fail();
      // pool.query owns one autocommit command, independently of `active`.
      // https://node-postgres.com/apis/pool#poolquery
      const initialization = await pool.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
        admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
          tick.checked_at + $13::bigint * interval '1 millisecond',
          ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,
          COALESCE(($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,'infinity'::timestamptz)) AS read_deadline
          ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
          AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb AND ${legacySavedMemorySourceSQL})
        SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
          to_char(admitted.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
        FROM tick,admitted WHERE admitted.read_deadline>tick.checked_at`, [...proof, JSON.stringify({ source: sourceBinding }), remainingMs]);
      if (initialization.rows.length !== 1) return fail();
      const initial = captureLegacySavedMemoryEnvelope(initialization.rows[0]);
      // Charge all acquisition, database and ACK time; never reset Core's clock.
      const lifetimeMs = Number((legacySavedMemoryMicroseconds(initial.read_until)
        - legacySavedMemoryMicroseconds(initial.checked_at)) / 1000n);
      let runDeadline = Math.min(deadline, coreDeadline, begun + lifetimeMs);
      if (performance.now() >= runDeadline) return fail();
      const authority: SavedMemoryAuthority = Object.freeze({ auth: Object.freeze({ accountId: actor.accountId, userId: actor.userId }),
        taskID, expiresAt: initial.read_until, assertCurrent: () => owner.assertCurrent() });
      const reads = new SavedMemoryReadSet(authority);
      const domains: Readonly<SavedMemoryFinalReadDomain>[] = [];
      let tail: Promise<unknown> = Promise.resolve();
      const runAlive = () => { alive(); if (performance.now() >= runDeadline) return fail(); };
      const finalize = (value?: SavedMemoryReadProof, query?: SavedMemoryFinalReadDomain) => {
        let captured: Readonly<SavedMemoryReadProof> | undefined, domain: Readonly<SavedMemoryFinalReadDomain> | undefined;
        try {
          runAlive();
          captured = value === undefined ? undefined : captureSavedMemoryReadProof(value);
          domain = query === undefined ? undefined : captureLegacySavedMemoryDomain(query);
          if (domain && JSON.stringify(domain.proof) !== JSON.stringify(captured)) return terminateMemory(null);
        } catch (error) { return terminateMemory(error); }
        const operation = tail.then(async () => {
          try {
            runAlive();
            const next = captured ?? reads.snapshot();
            assertLegacySavedMemoryProofSuperset(reads.snapshot(), next);
            const allDomains = domain ? [...domains, domain] : [...domains];
            if (allDomains.length > 64 || Buffer.byteLength(JSON.stringify(allDomains), "utf8") > 256 * 1024) savedMemoryBudgetLimited();
            for (const current of new Set([...sourceChecks, guard])) await source(current);
            runAlive();
            const actualSource = readHarnessRunSourceBinding(sourceHandle, guard, actor);
            const started = performance.now();
            const metadata = JSON.stringify({ source: actualSource, proof: next, domains: allDomains });
            if (Buffer.byteLength(metadata, "utf8") > 512 * 1024) savedMemoryBudgetLimited();
            // All original credential slots stay inside this owner. One fresh
            // statement snapshot and one MATERIALIZED tick govern every domain.
            // https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED
            const result = await pool.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
              admitted AS MATERIALIZED (SELECT LEAST($9::timestamptz,(${acceptedDeadlineSQL}),sessions.expires_at,
                ($12::jsonb->'proof'->>'expires_at')::timestamptz,
                ($12::jsonb->'source'->>'sourceExpiresAt')::timestamptz,
                COALESCE(($12::jsonb->'source'->>'sessionExpiresAt')::timestamptz,'infinity'::timestamptz),
                COALESCE((SELECT min((d->>'query_expires_at')::timestamptz)
                  FROM jsonb_array_elements($12::jsonb->'domains') d),'infinity'::timestamptz)) AS read_deadline
                ${memoryAuthoritySQL} AND tick.checked_at<$9::timestamptz AND users.kind=$10 AND users.kind<>'lab_human'
                AND (${labBindingSQL}) IS NOT DISTINCT FROM $11::jsonb
                AND ${legacySavedMemorySourceSQL} AND ${legacySavedMemoryProofSQL})
              SELECT true AS available,to_char(tick.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS checked_at,
                to_char(admitted.read_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_until
              FROM tick,admitted WHERE admitted.read_deadline>tick.checked_at`, [...proof, metadata]);
            if (result.rows.length !== 1) return fail();
            const envelope = captureLegacySavedMemoryEnvelope(result.rows[0]);
            if (envelope.read_until > authority.expiresAt) return fail();
            const milliseconds = Number((legacySavedMemoryMicroseconds(envelope.read_until)
              - legacySavedMemoryMicroseconds(envelope.checked_at)) / 1000n);
            runDeadline = Math.min(runDeadline, started + milliseconds);
            memoryDeadline = runDeadline;
            if (timer) clearTimeout(timer);
            arm();
            runAlive();
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
      memoryRuns.set(handle, { owner, auth: actor, access });
      memoryRun = access; memoryDeadline = runDeadline; memoryBindingPending = false;
      if (timer) clearTimeout(timer);
      arm();
      return handle;
    } catch (error) { return terminateMemory(error); }
  } });
  return owner;
}
