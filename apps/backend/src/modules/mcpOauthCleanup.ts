import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { type DatabaseClient } from "../database/pool.js";
import {
  deleteNangoConnection,
  loadNangoConfig,
  NANGO_CONNECT_REQUEST_TAG,
  queryNangoConnections,
  type NangoConfig,
} from "./nango.js";

/**
 * Durable Nango broker-cleanup lifecycle.
 *
 * Local disconnect, endpoint/credential replacement and Lab teardown all stop
 * local access immediately, but the Nango-held OAuth credential remains until
 * an authenticated DELETE confirms its removal, and a frozen Connect attempt
 * remains a late-authorization capability until closure is source-backed.
 * These are distinct facts and this ledger tracks them distinctly:
 *   * `state` — the broker credential: pending / confirmed / failed;
 *   * `closure_state` — the late-authorization capability watch. The pinned
 *     runtime does not validate Connect-token TTL on an already-started OAuth
 *     callback. DELETE /connect/session closes new session lookup, but cannot
 *     prove an already-inflight callback is closed; watches stay open honestly and a bounded background
 *     reconciliation keeps polling them.
 *
 * Dispatch is destructive and therefore strict: cleanup validates the full
 * frozen identity (account, owner, connect_request_id, approved endpoint,
 * frozen provider, frozen broker base and environment) against an exact
 * credential-free metadata query first. A reused or mismatched identity is
 * never deleted; absence is concluded only from an authoritative exact query,
 * never from a truncated, failed or malformed read. Only this product's own
 * frozen attempts are ever watched or deleted — nothing caller-supplied.
 */

export type OauthCleanupProvenance =
  | "disconnect"
  | "endpoint_replaced"
  | "credential_replaced"
  | "session_ended"
  | "lab_stop"
  | "late_grant"
  | "withdrawn";

export interface OauthCleanupIntent {
  accountId: string;
  /** The ORIGINAL grant owner, never the actor performing the cleanup. */
  createdByUserId: string;
  labWorkspaceId?: string | null;
  provider: string;
  nangoConnectionId: string | null;
  connectRequestId: string | null;
  /** Frozen trusted broker facts captured at creation time. */
  environment: string | null;
  brokerBaseUrl: string | null;
  targetOrigin: string;
  capabilityExpiresAt?: Date | null;
  provenance: OauthCleanupProvenance;
}

async function findLiveRow(
  client: DatabaseClient,
  accountId: string,
  nangoConnectionId: string | null,
  connectRequestId: string | null,
) {
  const existing = await client.query<{
    id: string;
    lab_workspace_id: string | null;
    nango_connection_id: string | null;
    provenance: string;
    state: string;
    closure_state: string;
    provider: string; created_by_user_id: string; target_origin: string;
    environment: string | null; broker_base_url: string | null;
  }>(
    `SELECT id, lab_workspace_id, nango_connection_id, provenance, state, closure_state,
            provider, created_by_user_id, target_origin, environment, broker_base_url
     FROM mcp_oauth_cleanup
     WHERE account_id = $1
       AND (($3::text IS NOT NULL AND connect_request_id = $3) OR
         ($3::text IS NULL AND connect_request_id IS NULL AND nango_connection_id = $2))
     FOR UPDATE`,
    [accountId, nangoConnectionId, connectRequestId],
  );
  return existing.rows[0] ?? null;
}

/**
 * Records or merges one cleanup intent in the SAME transaction as the local
 * change. A repeated transition for the same exact identity merges into the
 * existing live record (attaching Lab ownership or a late-grant binding)
 * instead of losing track of an outstanding watch.
 */
export async function recordOauthCleanup(
  client: DatabaseClient,
  intent: OauthCleanupIntent,
): Promise<void> {
  // Serialize all writers of the frozen generation in their caller transaction.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${intent.accountId}:${intent.connectRequestId ?? intent.nangoConnectionId}`,
  ]);
  const live = await findLiveRow(
    client,
    intent.accountId,
    intent.nangoConnectionId,
    intent.connectRequestId,
  );
  if (live) {
    if (live.provider !== intent.provider || live.created_by_user_id !== intent.createdByUserId ||
        live.target_origin !== intent.targetOrigin ||
        (live.environment && intent.environment && live.environment !== intent.environment) ||
        (live.broker_base_url && intent.brokerBaseUrl && live.broker_base_url !== intent.brokerBaseUrl) ||
        (live.lab_workspace_id && intent.labWorkspaceId && live.lab_workspace_id !== intent.labWorkspaceId)) {
      throw new Error("Cleanup intent differs from its frozen generation.");
    }
    await client.query(
      `UPDATE mcp_oauth_cleanup
       SET lab_workspace_id = coalesce(lab_workspace_id, $2),
           nango_connection_id = CASE WHEN $7 THEN $3 ELSE coalesce(nango_connection_id, $3) END,
           environment = coalesce(environment, $4),
           broker_base_url = coalesce(broker_base_url, $5),
           capability_expires_at = coalesce(capability_expires_at, $6),
           state = CASE WHEN $7 THEN 'pending' ELSE state END,
           confirmed_at = CASE WHEN $7 THEN NULL ELSE confirmed_at END,
           revision = revision + 1, claim_token = NULL, claimed_until = NULL,
           next_attempt_at = CASE WHEN $7 THEN clock_timestamp() ELSE next_attempt_at END,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [
        live.id,
        intent.labWorkspaceId ?? null,
        intent.nangoConnectionId ?? null,
        intent.environment ?? null,
        intent.brokerBaseUrl ?? null,
        intent.capabilityExpiresAt ?? null,
        // An authenticated late grant reopens the cleanup cycle even when a
        // previous credential removal was confirmed.
        intent.provenance === "late_grant" || intent.nangoConnectionId !== null,
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO mcp_oauth_cleanup(
       id, account_id, created_by_user_id, lab_workspace_id, provider,
       nango_connection_id, connect_request_id, environment, broker_base_url,
       capability_expires_at, target_origin, provenance, closure_state, attempts
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0)`,
    [
      randomUUID(),
      intent.accountId,
      intent.createdByUserId,
      intent.labWorkspaceId ?? null,
      intent.provider,
      intent.nangoConnectionId ?? null,
      intent.connectRequestId ?? null,
      intent.environment ?? null,
      intent.brokerBaseUrl ?? null,
      intent.capabilityExpiresAt ?? null,
      intent.targetOrigin,
      intent.provenance,
      // Session DELETE prevents new lookup, but cannot prove already-inflight
      // callbacks closed. Keep the frozen attempt watch until that is proven.
      intent.connectRequestId ? "open" : "closed",
    ],
  );
}

interface CleanupRow {
  claim_token: string;
  revision: number;
  account_id: string;
  broker_base_url: string | null;
  capability_expires_at: Date | null;
  closure_state: string;
  connect_request_id: string | null;
  created_by_user_id: string;
  environment: string | null;
  id: string;
  lab_workspace_id: string | null;
  nango_connection_id: string | null;
  provider: string;
  provenance: OauthCleanupProvenance;
  state: string;
  target_origin: string;
}

export interface OauthCleanupDependencies {
  nangoConfig?: NangoConfig | null;
  fetcher?: typeof fetch;
  batchSize?: number;
}

export interface OauthCleanupResult {
  confirmed: number;
  pending: number;
  watching: number;
}

/**
 * Idempotent, restart-safe cleanup reconciliation. External work runs outside
 * any long database lock; each row is claimed with a lease and rescheduled
 * with backoff. A potentially late grant is never abandoned: rows remain
 * eligible indefinitely and watches outlive credential removal.
 */
export async function reconcileMcpOAuthCleanup(
  pool: Pool,
  dependencies: OauthCleanupDependencies = {},
): Promise<OauthCleanupResult> {
  const config = dependencies.nangoConfig ?? loadNangoConfig();
  if (!config) return { confirmed: 0, pending: 0, watching: 0 };
  const fetcher = dependencies.fetcher ?? fetch;
  const claimed = await pool.query<CleanupRow>(
    `UPDATE mcp_oauth_cleanup
     SET attempts = LEAST(attempts + 1, 1000000), claim_token = $2,
         claimed_until = clock_timestamp() + interval '10 minutes',
         next_attempt_at = clock_timestamp() + (LEAST(3600000, 30000 * power(2, LEAST(attempts, 8))) || ' milliseconds')::interval,
         updated_at = clock_timestamp()
     WHERE id IN (
       SELECT id FROM mcp_oauth_cleanup
       WHERE (state <> 'confirmed' OR closure_state = 'open')
         AND next_attempt_at <= clock_timestamp()
         AND (claimed_until IS NULL OR claimed_until < clock_timestamp())
       ORDER BY next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${CLEANUP_COLUMNS}`,
    [Math.max(1, Math.min(dependencies.batchSize ?? 5, 5)), randomUUID()],
  );
  let confirmed = 0;
  let pending = 0;
  let watching = 0;
  await Promise.all(claimed.rows.map(async (row) => {
    const outcome = await cleanOne(config, row, fetcher, pool);
    if (outcome === "confirmed") confirmed += 1;
    else pending += 1;
    if (row.connect_request_id) watching += 1;
  }));
  // Lab teardown finalizes honestly only when every exact identity is
  // confirmed AND no capability watch remains open for it.
  await pool.query(
    `UPDATE lab_test_workspaces
     SET state = 'deleted', deleted_at = coalesce(deleted_at, now()),
         external_cleanup_pending = 0
     WHERE state = 'deleting' AND external_cleanup_pending > 0
       AND NOT EXISTS (
         SELECT 1 FROM mcp_oauth_cleanup c
         WHERE c.lab_workspace_id = lab_test_workspaces.id
           AND (c.state <> 'confirmed' OR c.closure_state = 'open'))`,
  );
  return { confirmed, pending, watching };
}

const CLEANUP_COLUMNS = `claim_token, revision, account_id, broker_base_url, capability_expires_at,
  closure_state, connect_request_id, created_by_user_id, environment, id,
  lab_workspace_id, nango_connection_id, provider, provenance, state,
  target_origin`;

type CleanOutcome = "confirmed" | "pending";

async function settle(
  pool: Pool,
  row: CleanupRow,
  update: { state?: "confirmed" | "failed" | "pending"; lastError?: string | null },
): Promise<CleanOutcome> {
  const changed = await pool.query(
    `UPDATE mcp_oauth_cleanup SET state = coalesce($2, state), last_error = $3,
     confirmed_at = CASE WHEN $2 = 'confirmed' THEN coalesce(confirmed_at, clock_timestamp())
       WHEN $2 IN ('pending','failed') THEN NULL ELSE confirmed_at END,
     claimed_until = NULL, claim_token = NULL, updated_at = clock_timestamp()
     WHERE id = $1 AND claim_token = $4 AND revision = $5 RETURNING id`,
    [row.id, update.state ?? null, update.lastError ?? null, row.claim_token, row.revision],
  );
  if (!changed.rowCount) return "pending";
  return update.state === "confirmed" ? "confirmed" : "pending";
}

/** Full frozen identity validation before any destructive dispatch. */
function identityMatches(
  row: CleanupRow,
  entry: {
    connectionId: string;
    providerConfigKey: string;
    tags: Record<string, string>;
  },
): boolean {
  // The frozen provider is the authority; metadata never overrides it.
  if (entry.providerConfigKey !== row.provider) return false;
  if (row.connect_request_id) {
    if (entry.tags[NANGO_CONNECT_REQUEST_TAG] !== row.connect_request_id) return false;
    if (entry.tags["mcp_server_url"] !== row.target_origin) return false;
    if (entry.tags["account_id"] !== row.account_id) return false;
    if (entry.tags["user_id"] !== row.created_by_user_id) return false;
    if (entry.tags["provider"] !== row.provider) return false;
  } else {
    // Without the frozen attempt identity, ownership cannot be proven.
    return false;
  }
  return true;
}

async function cleanOne(
  config: NangoConfig,
  row: CleanupRow,
  fetcher: typeof fetch,
  pool: Pool,
): Promise<CleanOutcome> {
  // Frozen broker facts must still hold: a deployment that changed base URL
  // or environment must never delete in the changed one.
  if (!row.broker_base_url || !row.environment) {
    return settle(pool, row, {
      lastError: "insufficient_provenance: frozen broker base/environment missing",
      state: "failed",
    });
  }
  if (config.baseUrl !== row.broker_base_url || (config.environment ?? null) !== row.environment) {
    return settle(pool, row, { lastError: "environment_changed: frozen broker identity differs" });
  }
  if (!row.connect_request_id && !row.nango_connection_id) {
    return settle(pool, row, {
      lastError: "insufficient_provenance: no frozen identity",
      state: "failed",
    });
  }

  // Check the bound ID separately: filters on old tags must never hide a
  // reused ID and turn it into an absence receipt.
  const entries = new Map<string, { connectionId: string; providerConfigKey: string; tags: Record<string, string> }>();
  if (row.nango_connection_id) {
    const bound = await queryNangoConnections(config,
      { connectionId: row.nango_connection_id, providerConfigKey: row.provider }, fetcher);
    if (bound.outcome !== "success") return settle(pool, row, { lastError: `metadata_${bound.outcome}: absence cannot be concluded` });
    for (const entry of bound.entries) {
      if (!identityMatches(row, entry)) return settle(pool, row, { state: "failed", lastError: "identity_mismatch: reused broker identity refused" });
      entries.set(entry.connectionId, entry);
    }
  }
  if (!row.connect_request_id) return settle(pool, row, { state: "failed", lastError: "insufficient_provenance: no frozen attempt" });
  // Keep watching the entire generation, even after the first ID is removed.
  // Multiple grants and callbacks arriving after a prior removal are covered.
  const attempt = await queryNangoConnections(config, {
    providerConfigKey: row.provider,
    tags: { [NANGO_CONNECT_REQUEST_TAG]: row.connect_request_id, mcp_server_url: row.target_origin },
  }, fetcher);
  if (attempt.outcome !== "success") return settle(pool, row, { lastError: `metadata_${attempt.outcome}: generation incomplete` });
  for (const entry of attempt.entries) {
    if (!identityMatches(row, entry)) return settle(pool, row, { state: "failed", lastError: "identity_mismatch: frozen attempt ownership refused" });
    entries.set(entry.connectionId, entry);
  }
  if (!entries.size) return settle(pool, row, {
    state: row.nango_connection_id || row.state === "confirmed" ? "confirmed" : "pending",
    lastError: "capability_watch_open",
  });
  for (const entry of entries.values()) {
    // A concurrent binding or new claim invalidates this snapshot before any
    // further dispatch. Settlement repeats the CAS; observations are retained
    // separately even when this generation snapshot has become stale.
    const receiptId = randomUUID();
    const current = await pool.query(
      `INSERT INTO mcp_oauth_cleanup_effects(id, cleanup_id, account_id, created_by_user_id,
        connect_request_id, nango_connection_id, provider, broker_base_url, environment,
        target_origin, generation_revision, claim_token)
       SELECT $4, id, account_id, created_by_user_id, connect_request_id, $5,
         provider, broker_base_url, environment, target_origin, revision, claim_token
       FROM mcp_oauth_cleanup WHERE id=$1 AND claim_token=$2 AND revision=$3
         AND claimed_until > clock_timestamp() RETURNING id`,
      [row.id, row.claim_token, row.revision, receiptId, entry.connectionId]);
    if (!current.rowCount) return "pending";
    const deletion = await deleteNangoConnection(config, entry.connectionId, row.provider, fetcher);
    // Preserve the observed dispatch even if this worker's settlement has
    // become stale or another connection in the generation later fails.
    await pool.query(`UPDATE mcp_oauth_cleanup_effects SET outcome=$2, observed_at=clock_timestamp()
      WHERE id=$1 AND outcome='dispatched'`, [receiptId,
      deletion === "async" ? "accepted" : deletion === "failed" ? "unconfirmed" : deletion]);
    if (deletion === "confirmed" || deletion === "already_missing") {
      continue;
    }
    if (deletion === "async") {
      const readback = await queryNangoConnections(config,
        { connectionId: entry.connectionId, providerConfigKey: row.provider }, fetcher);
      if (readback.outcome === "success" && readback.entries.length === 0) {
        await pool.query(`UPDATE mcp_oauth_cleanup_effects SET outcome='confirmed', observed_at=clock_timestamp()
          WHERE id=$1 AND outcome='accepted'`, [receiptId]);
        continue;
      }
      return settle(pool, row, { state: "pending", lastError: "delete_unconfirmed: awaiting readback" });
    }
    return settle(pool, row, { state: deletion === "forbidden" ? "failed" : "pending",
      lastError: deletion === "forbidden" ? "permission_denied: environment:connections:delete required" : "broker_delete_unconfirmed" });
  }
  return settle(pool, row, { state: "confirmed", lastError: "capability_watch_open" });
}

/**
 * Lab teardown capture: preserves every outstanding exact identity and watch
 * BEFORE the account wipe deletes their source rows, merging Lab ownership
 * into already-outstanding records. The ledger is control scope precisely so
 * the wipe cannot destroy it. The returned count includes open capability
 * watches: Lab deletion is never claimed while they remain.
 */
export async function recordLabStopCleanup(
  client: DatabaseClient,
  accountId: string,
  labWorkspaceId: string,
  ownerUserId: string,
): Promise<number> {
  void ownerUserId;
  const connections = await client.query<{
    created_by_user_id: string;
    nango_connection_id: string;
    nango_provider: string | null;
    server_url: string;
  }>(
    `SELECT created_by_user_id, nango_connection_id, nango_provider, server_url
     FROM mcp_connections
     WHERE account_id = $1 AND auth_mode = 'oauth' AND nango_connection_id IS NOT NULL`,
    [accountId],
  );
  for (const row of connections.rows) {
    const attempt = await client.query<{
      connect_request_id: string;
      created_by_user_id: string;
      environment: string | null;
      broker_base_url: string | null;
      capability_expires_at: Date | null;
    }>(
      `SELECT connect_request_id, created_by_user_id, environment, broker_base_url, capability_expires_at
       FROM mcp_oauth_connect_requests
       WHERE account_id = $1 AND nango_connection_id = $2`,
      [accountId, row.nango_connection_id],
    );
    const bound = attempt.rows[0] ?? null;
    await recordOauthCleanup(client, {
      accountId,
      brokerBaseUrl: bound?.broker_base_url ?? null,
      capabilityExpiresAt: bound?.capability_expires_at ?? null,
      connectRequestId: bound?.connect_request_id ?? null,
      createdByUserId: bound?.created_by_user_id ?? row.created_by_user_id,
      environment: bound?.environment ?? null,
      labWorkspaceId,
      nangoConnectionId: row.nango_connection_id,
      provenance: "lab_stop",
      provider: row.nango_provider ?? "mcp-generic",
      targetOrigin: row.server_url,
    });
  }
  const attempts = await client.query<{
    broker_base_url: string | null;
    capability_expires_at: Date | null;
    connect_request_id: string;
    created_by_user_id: string;
    environment: string | null;
    mcp_server_url: string;
    nango_connection_id: string | null;
    provider: string;
  }>(
    `SELECT connect_request_id, created_by_user_id, environment, broker_base_url,
            capability_expires_at, mcp_server_url, nango_connection_id, provider
     FROM mcp_oauth_connect_requests WHERE account_id = $1`,
    [accountId],
  );
  for (const row of attempts.rows) {
    await recordOauthCleanup(client, {
      accountId,
      brokerBaseUrl: row.broker_base_url,
      capabilityExpiresAt: row.capability_expires_at,
      connectRequestId: row.connect_request_id,
      createdByUserId: row.created_by_user_id,
      environment: row.environment,
      labWorkspaceId,
      nangoConnectionId: row.nango_connection_id,
      provenance: "lab_stop",
      provider: row.provider,
      targetOrigin: row.mcp_server_url,
    });
  }
  const remaining = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM mcp_oauth_cleanup
     WHERE lab_workspace_id = $1 AND (state <> 'confirmed' OR closure_state = 'open')`,
    [labWorkspaceId],
  );
  return Number(remaining.rows[0]?.n ?? 0);
}

/**
 * Bounded, restart-safe background pump. Runs the idempotent reconciliation
 * with no overlap; a stopped pump leaves durable rows for the next process.
 */
export function startMcpOAuthCleanupPump(
  pool: Pool,
  options: { intervalMs?: number; dependencies?: OauthCleanupDependencies } = {},
): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = reconcileMcpOAuthCleanup(pool, options.dependencies ?? {})
      .then(() => undefined).catch(() => undefined).finally(() => { running = null; });
  };
  const timer = setInterval(tick, options.intervalMs ?? 60_000);
  timer.unref?.();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
