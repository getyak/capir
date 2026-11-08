/** Opt-in Memory content publication. All reads/COMMIT ACK/readback finish
 * inside load; only one closed autocommit decision follows, with no post-fence IO. */
import type { PoolClient } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { labWorkspaceSessionActiveAtTickSQL, memoryContentOperatorLabDeploymentActiveSQL,
  operatorTestDeployment } from "./labWorkspaceAccess.js";
import { memoryContentChanged, memoryReviewContentBinding, memoryReviewContentDomainCTEs } from "./memoryContentFinalFence.js";

interface AuthorityRow {
  token_hash: string;
  accepted_deadline: string;
  lab_deadline: string;
  remaining_ms: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const leasedClients = new WeakSet<PoolClient>();
const preparationTransactions = new WeakMap<PoolClient, () => boolean>();
const sixDigits = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

// Actual top-level xid8 identity, never a clock or access grant. Each probe
// and following boundary query must be separate, acknowledged statements on
// the same exclusive physical client. This intentionally allocates up to4 XIDs
// per read and requires a primary (recovery cannot allocate a top-level XID).
// https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-TXID-SNAPSHOT
async function transactionProbe(client: PoolClient): Promise<string> {
  const result = await client.query<{ xid: string }>("SELECT pg_current_xact_id()::text AS xid");
  const xid = result.rows.length === 1 ? result.rows[0]?.xid : undefined;
  if (typeof xid !== "string" || !/^[1-9][0-9]{0,19}$/u.test(xid)
    || BigInt(xid) > 18_446_744_073_709_551_615n) return memoryContentChanged();
  return xid;
}

// A true Lab predicate at tick is not an ACK-time deadline. This closed
// projection repeats only already legitimate branches and supplies their TTL
// horizon; the original535 boolean/serving predicates remain mandatory below.
// AND branches use LEAST, alternative legitimate branches use MAX. No access
// token/refresh TTL is substituted for the child-lineage lifetime.
const memoryLabDeadlineSQL = `SELECT CASE WHEN users.kind<>'lab_human'
 THEN sessions.expires_at ELSE (SELECT max(admitted.valid_until) FROM (
  SELECT LEAST(w.expires_at,e.expires_at,
    CASE WHEN g.protocol_version='capir-auth.v3' AND g.state='active'
      THEN 'infinity'::timestamptz ELSE parent.expires_at END,
    COALESCE(g.absolute_expires_at,'infinity'::timestamptz)) AS valid_until
  FROM lab_test_workspaces w
  JOIN lab_test_workspace_entries e ON e.workspace_id=w.id AND e.session_id=sessions.id
  JOIN sessions parent ON parent.id=e.owner_session_id
    AND parent.account_id=w.owner_account_id AND parent.user_id=w.owner_user_id
  JOIN users owner ON owner.account_id=parent.account_id AND owner.id=parent.user_id
  LEFT JOIN capir_auth_grants g ON g.backing_session_id=parent.id
  LEFT JOIN capir_user_test_entitlements t ON t.account_id=g.account_id AND t.user_id=g.user_id AND t.state='active'
  WHERE w.target_account_id=users.account_id AND w.target_user_id=users.id
    AND w.state='active' AND w.expires_at>tick.checked_at
    AND e.revoked_at IS NULL AND e.expires_at>tick.checked_at
    AND parent.revoked_at IS NULL AND (parent.expires_at>tick.checked_at
      OR (g.protocol_version='capir-auth.v3' AND g.state='active'))
    AND owner.status='active' AND owner.kind<>'lab_human'
    AND (g.id IS NULL OR (g.state='active'
      AND (g.absolute_expires_at IS NULL OR g.absolute_expires_at>tick.checked_at)
      AND t.generation=g.test_entitlement_generation
      AND 'test.handoff'=ANY(t.scopes) AND 'test.handoff'=ANY(g.scopes)))
  UNION ALL
  SELECT LEAST(w.expires_at,e.expires_at) AS valid_until
  FROM lab_test_workspaces w
  JOIN lab_test_workspace_entries e ON e.workspace_id=w.id AND e.session_id=sessions.id
  JOIN capir_test_runs r ON r.workspace_id=w.id AND r.principal_id=e.owner_principal_id
  JOIN capir_test_provisioners p ON p.id=r.principal_id
  WHERE w.target_account_id=users.account_id AND w.target_user_id=users.id
    AND w.owner_principal_id=r.principal_id
    AND w.owner_account_id IS NULL AND w.owner_user_id IS NULL
    AND r.account_id=w.target_account_id AND r.user_id=w.target_user_id
    AND w.state='active' AND w.expires_at>tick.checked_at
    AND e.revoked_at IS NULL AND e.expires_at>tick.checked_at
    AND e.owner_session_id IS NULL
    AND e.principal_generation=r.principal_generation
    AND p.state='enabled' AND p.generation=e.principal_generation
    AND p.web_origin=r.web_origin AND p.backend_origin=r.backend_origin
 ) admitted WHERE isfinite(admitted.valid_until)) END AS valid_until`;

const acceptedDeadlineSQL = `CASE WHEN sessions.token_hash=$4 THEN sessions.expires_at ELSE sessions.previous_token_expires_at END`;
// Fixed slots account1,user2,login3,actual-header4,current-generation5,
// original-accepted-deadline6,serving7..10,audience11. Final additionally binds
// scope12/credential13/stamp14/domain-deadline15/XID16/original-Lab-deadline17.
// No trusted-null header mode.
const currentAuthoritySQL = `SELECT sessions.token_hash, sessions.expires_at,
  lab_bound.valid_until AS lab_until,
  to_char(lab_bound.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS lab_deadline,
  ${acceptedDeadlineSQL} AS accepted_until,
  to_char((${acceptedDeadlineSQL}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS accepted_deadline
 FROM sessions JOIN accounts ON accounts.id=sessions.account_id AND accounts.retired_at IS NULL
 JOIN users ON users.account_id=sessions.account_id AND users.id=sessions.user_id AND users.status='active'
 CROSS JOIN tick CROSS JOIN LATERAL (${memoryLabDeadlineSQL}) lab_bound
 WHERE sessions.account_id=$1 AND sessions.user_id=$2 AND sessions.id=$3::uuid
   AND sessions.revoked_at IS NULL AND sessions.expires_at>tick.checked_at
   AND isfinite(lab_bound.valid_until) AND lab_bound.valid_until>tick.checked_at
   AND (sessions.token_hash=$4 OR (sessions.previous_token_hash=$4 AND sessions.previous_token_expires_at>tick.checked_at))
   AND ($5::text IS NULL OR sessions.token_hash=$5)
   AND ($6::timestamptz IS NULL OR tick.checked_at<$6::timestamptz)
   AND ($11::uuid[] IS NULL OR sessions.account_id=ANY($11::uuid[]))
   AND ${labWorkspaceSessionActiveAtTickSQL}
   AND ${memoryContentOperatorLabDeploymentActiveSQL}`;

function remaining(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) return memoryContentChanged();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return memoryContentChanged();
  return number;
}

/** The concrete Review preparation cannot run on a caller-made facade or in
 * autocommit. Every real projection/source query must share its short RR snapshot. */
export function assertMemoryContentPreparationTransaction(client: PoolClient): void {
  if (preparationTransactions.get(client)?.() !== true) return memoryContentChanged();
}

/** One private facade per run tracks actual acknowledged commands. A failed
 * COMMIT is unknown, not rollback: publication is refused without retry or any
 * manufactured resolution. Unknown ACK poisons this read run; canonical
 * recovery remains the actual mutation owner's separate obligation. */
function preparationClient(client: PoolClient) {
  let open = false, busy = false, uncertain = false, closed = false, repeatable = false, beginAttempted = false;
  let active: Promise<unknown> | null = null;
  const proxy = new Proxy(client, { get(target, property) {
    if (property === "release") return () => { uncertain = true; return memoryContentChanged(); };
    if (property !== "query") {
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    return (...args: unknown[]) => {
      const refuse = () => { uncertain = true; return Promise.reject(new ApiError(409, "MEMORY_CONTENT_CHANGED", "Memory preparation is no longer current.")); };
      if (closed || busy) return refuse();
      const input: unknown = args[0];
      const text = typeof input === "string" ? input
        : input && typeof input === "object" ? Reflect.get(input, "text") : undefined;
      // All actual owners here use one Promise query at a time. Do not admit
      // callbacks/multi-statement scripts/transaction aliases as an untracked
      // path around this facade. No SQL text is included in rejection errors.
      if (typeof text !== "string" || args.some(arg => typeof arg === "function") || text.includes(";")) return refuse();
      const command = text.trim().toUpperCase();
      const isBegin = command === "BEGIN", isCommit = command === "COMMIT", isRollback = command === "ROLLBACK";
      // A host's normal error cleanup may still ROLLBACK its own transaction.
      // This never clears the poisoned run or proves an unknown COMMIT undone.
      if (uncertain && !isRollback) return refuse();
      if ((isBegin && open) || (/^(BEGIN|START|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE|SET|RESET|DISCARD)\b/u.test(command) && !isBegin && !isCommit && !isRollback))
        return refuse();
      busy = true;
      if (isBegin) beginAttempted = true;
      let result: unknown;
      try { result = Reflect.apply(target.query, target, args); }
      catch (error) { busy = false; uncertain = true; throw error; }
      if (!result || typeof Reflect.get(Object(result), "then") !== "function") {
        busy = false; uncertain = true; return Promise.reject(new ApiError(409, "MEMORY_CONTENT_CHANGED", "Memory preparation requires acknowledged queries."));
      }
      const pending = Promise.resolve(result).then(async actual => {
        const actualCommand: unknown = actual && typeof actual === "object" ? Reflect.get(actual, "command") : undefined;
        if (actualCommand === "BEGIN") beginAttempted = true;
        if ((isBegin && actualCommand !== "BEGIN") || (isCommit && actualCommand !== "COMMIT") || (isRollback && actualCommand !== "ROLLBACK") || Array.isArray(actual)
          || (["BEGIN", "COMMIT", "ROLLBACK", "SET", "RESET", "DISCARD"].includes(String(actualCommand)) && !isBegin && !isCommit && !isRollback)) {
          uncertain = true; return memoryContentChanged();
        }
        if (isBegin) {
          open = true;
          // Owned current-Tx setting, not a session default and never a fake
          // BEGIN result. No loader read can start until this real SET ACK.
          const isolation = await target.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          if (isolation.command !== "SET") return memoryContentChanged();
          repeatable = true;
        }
        if (isCommit || isRollback) { open = false; repeatable = false; beginAttempted = false; }
        return actual;
      }).catch(error => { uncertain = true; throw error; }).finally(() => { busy = false; active = null; });
      active = pending;
      // A host that forgets to await a query cannot publish or return an active
      // client to its pool. Preserve rejection for its awaited caller, while
      // preventing an unhandled rejection during the failure-only drain.
      void pending.catch(() => {});
      return pending;
    };
  } });
  preparationTransactions.set(proxy, () => open && repeatable && !busy && !uncertain && !closed);
  return { client: proxy, finish() {
    if (busy || open || uncertain || closed) return memoryContentChanged();
    closed = true;
  }, async abort() {
    closed = true;
    if (active) await active.catch(() => {});
    if (beginAttempted && (open || uncertain)) {
      // Only this run's own attempted BEGIN is cleaned. A rejected caller outer
      // transaction never reaches load and is never committed/reset/rolled back.
      // ROLLBACK after an unknown COMMIT is connection cleanup, not evidence
      // that any canonical commit was undone or permission to redispatch.
      try {
        const cleanup = await client.query("ROLLBACK");
        if (cleanup.command !== "ROLLBACK") throw new Error("Unacknowledged cleanup");
        open = false; repeatable = false;
      } catch { throw new ApiError(503, "MEMORY_CONTENT_CLIENT_UNSAFE", "Memory preparation could not close its database transaction."); }
    }
  }, current() { return closed && !busy && !open && !uncertain; }, close() { closed = true; preparationTransactions.delete(proxy); } };
}

export interface MemoryContentReaderOptions {
  readonly config: Readonly<BackendConfig>;
  readonly deploymentWorkspaceIds?: readonly string[];
}
export interface MemoryContentReaderProbe {
  run<T>(client: PoolClient, load: (client: PoolClient) => Promise<T>): Promise<T>;
}
export type MemoryContentReaderProbeFactory = (auth: AuthContext, actualAuthorization: string | undefined) => MemoryContentReaderProbe;

/** Registration captures only nonsecret serving primitives. The actual HTTP
 * header is hashed at adapter entry, before any await; no proof comes from wire
 * body/query, a mutable deployment array or a later session's current slot. */
export function createMemoryContentReaderProbeFactory(options: MemoryContentReaderOptions): MemoryContentReaderProbeFactory {
  const deployment = Object.freeze(operatorTestDeployment(options.config));
  const audience = options.deploymentWorkspaceIds ? Object.freeze([...new Set(options.deploymentWorkspaceIds)]) : null;
  if (audience?.some(id => typeof id !== "string" || !uuid.test(id))) return memoryContentChanged();
  return (auth, actualAuthorization) => {
    const accountId = auth.accountId, userId = auth.userId, loginId = auth.sessionId;
    if (![accountId, userId, loginId].every(id => typeof id === "string" && uuid.test(id))) return memoryContentChanged();
    if (audience && !audience.includes(accountId)) {
      throw new ApiError(403, "DEPLOYMENT_WORKSPACE_NOT_ADMITTED", "This workspace is outside this deployment's configured audience.");
    }
    if (typeof actualAuthorization !== "string" || !actualAuthorization.startsWith("Bearer ") || !actualAuthorization.slice(7)) return memoryContentChanged();
    const acceptedHash = sha256(actualAuthorization.slice(7));
    const authorityValues: unknown[] = [accountId, userId, loginId, acceptedHash, null, null,
      deployment.enabled, deployment.webOrigin, deployment.backendOrigin, deployment.userAuthEnabled === true, audience];
    let running = false;
    return Object.freeze({ async run<T>(client: PoolClient, load: (client: PoolClient) => Promise<T>): Promise<T> {
      if (running || leasedClients.has(client)) return memoryContentChanged();
      running = true; leasedClients.add(client);
      const phase = preparationClient(client), started = performance.now();
      try {
        const beforeInitial = await transactionProbe(client);
        const initial = (await client.query<AuthorityRow>(`WITH transaction_boundary AS MATERIALIZED (SELECT pg_current_xact_id() AS xid),
          tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at), current_auth AS MATERIALIZED (${currentAuthoritySQL})
          SELECT token_hash,accepted_deadline,lab_deadline,
            floor(extract(epoch FROM LEAST(expires_at,accepted_until,lab_until)-tick.checked_at)*1000)::text AS remaining_ms
          FROM current_auth CROSS JOIN tick CROSS JOIN transaction_boundary
          WHERE transaction_boundary.xid<>$12::xid8`, [...authorityValues, beforeInitial])).rows[0];
        if (!initial || !hash.test(initial.token_hash) || !sixDigits.test(initial.accepted_deadline)
          || !sixDigits.test(initial.lab_deadline)) return memoryContentChanged();
        const originalLabDeadline = initial.lab_deadline; // Exact six digits, frozen before load can extend a row.
        const initialRemaining = remaining(initial.remaining_ms);
        const value = await load(phase.client);
        phase.finish();
        const bound = memoryReviewContentBinding(value, phase.client, accountId, userId);
        const finalValues = [...authorityValues]; finalValues[4] = initial.token_hash; finalValues[5] = initial.accepted_deadline;
        finalValues.push(bound.scopeID, bound.credentialHash, bound.stamp, bound.originalDeadline);
        const finalStarted = performance.now();
        const beforeFinal = await transactionProbe(client); finalValues.push(beforeFinal, originalLabDeadline);
        const final = (await client.query<AuthorityRow>(`WITH transaction_boundary AS MATERIALIZED (SELECT pg_current_xact_id() AS xid),
          tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
          current_auth AS MATERIALIZED (${currentAuthoritySQL}), ${memoryReviewContentDomainCTEs}
          SELECT current_auth.token_hash,current_auth.accepted_deadline,current_auth.lab_deadline,
            floor(extract(epoch FROM LEAST(current_auth.expires_at,current_auth.accepted_until,$6::timestamptz,
              current_auth.lab_until,$17::timestamptz,review_observation.deadline,$15::timestamptz)-tick.checked_at)*1000)::text AS remaining_ms
          FROM current_auth CROSS JOIN tick CROSS JOIN review_observation CROSS JOIN transaction_boundary
          WHERE review_observation.content_stamp=$14 AND transaction_boundary.xid<>$16::xid8`, finalValues)).rows[0];
        // Everything below is synchronous. Charge the whole final round trip
        // plus the full initial-observation→preparation/COMMIT/readback window.
        if (!phase.current() || !final || final.token_hash !== initial.token_hash || !sixDigits.test(final.accepted_deadline) || !sixDigits.test(final.lab_deadline)
          || remaining(final.remaining_ms) <= Math.ceil(performance.now() - finalStarted)
          || initialRemaining <= Math.ceil(performance.now() - started)) return memoryContentChanged();
        return value;
      } catch (error) {
        // Failure-only IO drain. Never rollback/retry or misreport unknown ACK
        // as rollback. The successful final-observation path has no await here.
        await phase.abort(); throw error;
      } finally { phase.close(); running = false; leasedClients.delete(client); }
    } });
  };
}
