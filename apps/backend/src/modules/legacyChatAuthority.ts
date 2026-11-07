import type { Pool, PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { labWorkspaceSessionActiveSQL, operatorLabDeploymentActiveSQL,
  operatorTestDeployment } from "./labWorkspaceAccess.js";

export class LegacyChatTerminated extends ApiError {
  constructor() {
    super(409, "LEGACY_CHAT_AUTHORITY_UNAVAILABLE",
      "This request is no longer authorized. Nothing from this attempt was saved. Read the current state before starting again.");
  }
}

type LabBinding = { entry: string; workspace: string; parent: string | null;
  principal: string | null; generation: number | null; ownerAccount: string | null;
  ownerUser: string | null; grant: string | null; entitlementGeneration: number | null; run: string | null };
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

export interface LegacyChatAuthority {
  readonly signal: AbortSignal;
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

/** Called only after the real route authenticator, with that request's actual
 * accepted header. The closure retains the fingerprint, never the bearer; its
 * matching current/previous deadline stays in PostgreSQL microsecond format.
 */
export async function admitLegacyChatAuthority(pool: Pool, auth: AuthContext,
  authorization: string | undefined, config: BackendConfig,
  audience?: readonly string[]): Promise<LegacyChatAuthority> {
  const stop = new LegacyChatTerminated();
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7)
    || (audience && !audience.includes(auth.accountId))) throw stop;
  const deployment = operatorTestDeployment(config);
  const params: unknown[] = [sha256(authorization.slice(7)), deployment.enabled,
    deployment.webOrigin, deployment.backendOrigin, deployment.userAuthEnabled === true,
    auth.accountId, auth.userId, auth.sessionId];
  const started = performance.now();
  let admitted: Admission | undefined;
  try {
    admitted = (await pool.query<Admission>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
      SELECT to_char((${acceptedDeadlineSQL}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS original_deadline,
        floor(extract(epoch FROM ((${acceptedDeadlineSQL})-tick.checked_at))*1000)::text AS remaining_ms,
        users.kind AS user_kind, CASE WHEN sessions.token_hash=$1 THEN 'current' ELSE 'previous' END AS token_branch,
        ${labBindingSQL} AS lab_binding ${authoritySQL}`, params)).rows[0];
  } catch { throw stop; }
  if (!admitted || admitted.user_kind !== auth.userKind
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(admitted.original_deadline)
    || !["current", "previous"].includes(admitted.token_branch)
    || !/^\d+$/u.test(admitted.remaining_ms)
    || (admitted.user_kind === "lab_human" && !admitted.lab_binding)) throw stop;
  const proof = [...params, admitted.original_deadline, admitted.user_kind,
    admitted.lab_binding === null ? null : JSON.stringify(admitted.lab_binding)];
  const binding = admitted.lab_binding;
  const deadline = performance.now() + Number(admitted.remaining_ms) - Math.ceil(performance.now() - started);
  if (!Number.isSafeInteger(Number(admitted.remaining_ms))) throw stop;
  const controller = new AbortController();
  let terminated = false, disposed = false;
  let active: PoolClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sourceChecks = new Set<() => Promise<void>>();
  const fail = (): never => {
    terminated = true;
    if (!controller.signal.aborted) controller.abort(stop);
    throw stop;
  };
  const alive = () => { if (terminated || disposed) fail(); };
  const arm = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) { terminated = true; controller.abort(stop); return; }
    timer = setTimeout(arm, Math.min(2_147_483_647, Math.max(1, remaining)));
    timer.unref?.();
  };
  arm();
  const check = async (database: DatabaseClient) => {
    alive();
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
    try { const value = await operation(); alive(); return value; } catch { return fail(); }
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
  return {
    signal: controller.signal, throwIfTerminated: alive,
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
    dispose: () => { disposed = true; if (timer) clearTimeout(timer); if (!controller.signal.aborted) controller.abort(stop); },
  };
}
