import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "./auth.js";
import { inTransaction } from "../database/pool.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import {
  recordLabStopCleanup,
  recordOauthCleanup,
  reconcileMcpOAuthCleanup,
  startMcpOAuthCleanupPump,
} from "./mcpOauthCleanup.js";
import { disconnectMcpConnection } from "./mcpConnections.js";
import { loadMcpEncryptionKey } from "./mcpSecurity.js";
import type { NangoConfig } from "./nango.js";

/**
 * Broker-cleanup lifecycle regressions against the production functions with
 * the real wire envelopes of the pinned Nango runtime. These are synthetic
 * HTTP contract tests; the hosted Nango acceptance remains parent-owned live
 * verification.
 */

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated local PostgreSQL database for cleanup tests.");
}
const pool = url ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 4 }) : null;
const suite = url ? describe : describe.skip;

const encryptionKey = loadMcpEncryptionKey(Buffer.alloc(32, 9).toString("base64"));
if (!encryptionKey) throw new Error("synthetic key");

const nangoConfig: NangoConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.nango.dev",
  environment: "DEV",
  webhookSigningKey: "test-signing-key",
};

interface Fixture { accountId: string; auth: AuthContext; userId: string }

async function seed(label: string, kind: "simulated_human" | "lab_human" = "simulated_human"): Promise<Fixture> {
  const accountId = randomUUID();
  const userId = randomUUID();
  const auth: AuthContext = {
    accountId,
    accountSlug: `cl-${label}-${accountId.slice(0, 8)}`,
    sessionId: randomUUID(),
    userEmail: `${userId}@synthetic.local`,
    userId,
    userKind: kind,
  };
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,$3)", [accountId, auth.accountSlug, `Cleanup ${label}`]);
  await pool!.query(
    "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,$4,$5)",
    [userId, accountId, auth.userEmail, `Cleanup ${label}`, kind],
  );
  await pool!.query(
    "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
    [auth.sessionId, accountId, userId, randomBytes(32).toString("hex")],
  );
  return { accountId, auth, userId };
}

async function removeAccount(accountId: string): Promise<void> {
  for (const table of ["mcp_oauth_cleanup", "mcp_oauth_connect_requests", "mcp_interaction_requests", "mcp_tool_calls", "mcp_connections", "idempotency_records"]) {
    await pool!.query(`DELETE FROM ${table} WHERE account_id=$1`, [accountId]).catch(() => undefined);
  }
  await pool!.query("DELETE FROM audit_events WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]).catch(() => undefined);
  await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
}

/** A fully frozen grant: attempt row + connection row, as production writes. */
async function seedGrant(
  fixture: Fixture,
  opts: {
    connectRequestId?: string;
    nangoConnectionId?: string | null;
    provider?: string;
    target?: string;
    environment?: string | null;
    baseUrl?: string | null;
    connectionRow?: boolean;
    capabilityExpiry?: string | null;
  } = {},
): Promise<{ connectRequestId: string; connectionRowId: string | null; requestId: string }> {
  const connectRequestId = opts.connectRequestId ?? `mcpconn_seed${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
  const requestId = randomUUID();
  const target = opts.target ?? "https://oauth.example.test/mcp";
  const provider = opts.provider ?? "mcp-generic";
  await pool!.query(
    `INSERT INTO mcp_interaction_requests(
       account_id, id, created_by_user_id, call_id, kind, state, purpose, target,
       arguments_display, bound_arguments, session_id, expires_at
     ) VALUES ($1,$2,$3,$2,'oauth','waiting','Add.',
       $4::jsonb,'{"friendly_name":"Grant"}',$5::jsonb,NULL,now()+interval '1 hour')`,
    [
      fixture.accountId,
      requestId,
      fixture.userId,
      JSON.stringify({ connection_label: "Grant", server_origin: new URL(target).origin, tool_name: null, auth_mode: "oauth" }),
      JSON.stringify({ friendly_name: "Grant", server_url: target, auth_mode: "oauth" }),
    ],
  );
  await pool!.query(
    `INSERT INTO mcp_oauth_connect_requests(
       connect_request_id, account_id, id, created_by_user_id, provider, mcp_server_url,
       expires_at, nango_connection_id, environment, broker_base_url, capability_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '1 hour',$7,$8,$9,$10)`,
    [
      connectRequestId,
      fixture.accountId,
      requestId,
      fixture.userId,
      provider,
      target,
      opts.nangoConnectionId ?? null,
      opts.environment === undefined ? "DEV" : opts.environment,
      opts.baseUrl === undefined ? "https://api.nango.dev" : opts.baseUrl,
      opts.capabilityExpiry === undefined ? new Date(Date.now() + 30 * 60 * 1000) : opts.capabilityExpiry,
    ],
  );
  let connectionRowId: string | null = null;
  if (opts.connectionRow !== false && opts.nangoConnectionId) {
    connectionRowId = randomUUID();
    await pool!.query(
      `INSERT INTO mcp_connections(
         account_id, id, created_by_user_id, friendly_name, server_url,
         credential_ciphertext, status, discovered_tools, tools_count, revision,
         auth_mode, nango_connection_id, nango_provider
       ) VALUES ($1,$2,$3,'Grant server',$4,NULL,'verified','[]',0,1,'oauth',$5,$6)`,
      [fixture.accountId, connectionRowId, fixture.userId, target, opts.nangoConnectionId, provider],
    );
    await pool!.query(
      `UPDATE mcp_interaction_requests SET work_connection_id=$2 WHERE account_id=$1 AND id=$3`,
      [fixture.accountId, connectionRowId, requestId],
    );
  }
  return { connectRequestId, connectionRowId, requestId };
}

type WireResponse = { status: number; body: unknown } | "down";

/** Wire-correct Nango stub: real envelopes, exact filter inspection. */
function wireStub(
  handler: (path: string, init: RequestInit | undefined, url: URL) => WireResponse,
): { fetcher: typeof fetch; calls: Array<{ method: string; url: string }> } {
  const calls: Array<{ method: string; url: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    const target = new URL(raw);
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: raw });
    const result = handler(target.pathname, init, target);
    if (result === "down") throw new Error("network down");
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

function connectionEnvelope(connections: unknown[]): unknown {
  return { connections };
}

/** A deliberate retry in a test is a new attempt window, not wall-clock backoff. */
async function retryNow(accountId: string): Promise<void> {
  await pool!.query(
    "UPDATE mcp_oauth_cleanup SET next_attempt_at = clock_timestamp(), claimed_until = NULL WHERE account_id=$1",
    [accountId],
  );
}

beforeAll(async () => {
  if (!pool) return;
  const ready = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='mcp_oauth_cleanup'");
  if (!ready.rowCount) throw new Error("migrate through 092_mcp_oauth_cleanup_provenance first");
}, 30_000);

afterAll(async () => { await pool?.end(); });

suite("Nango broker cleanup lifecycle", () => {
  it("confirms a fully proven disconnect cleanup and keeps the honest watch", async () => {
    const fixture = await seed("disconnect");
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-broker-1" });
      const stub = wireStub((path, init, target) => {
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") {
          expect(target.searchParams.get("provider_config_key")).toBe("mcp-generic");
          expect(target.searchParams.get("env")).toBe("DEV");
          return { body: { success: true }, status: 200 };
        }
        if (target.searchParams.get("connectionId") === "conn-broker-1") {
          return {
            body: connectionEnvelope([
              {
                connection_id: "conn-broker-1",
                provider_config_key: "mcp-generic",
                tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                  connect_request_id: grant.connectRequestId,
                  mcp_server_url: "https://oauth.example.test/mcp",
                },
              },
            ]),
            status: 200,
          };
        }
        return { body: connectionEnvelope([]), status: 200 };
      });
      await disconnectMcpConnection(pool!, fixture.auth, grant.connectionRowId!, {
        expected_revision: 1,
        idempotency_key: `dc-${randomUUID()}`,
      });
      // Local access stops immediately; the frozen identity and ORIGINAL
      // grant owner survive for external cleanup.
      const ledger = await pool!.query<{ state: string; closure_state: string; created_by_user_id: string; connect_request_id: string; broker_base_url: string; environment: string }>(
        "SELECT state, closure_state, created_by_user_id, connect_request_id, broker_base_url, environment FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(ledger.rows[0]).toMatchObject({
        broker_base_url: "https://api.nango.dev",
        closure_state: "open",
        connect_request_id: grant.connectRequestId,
        created_by_user_id: fixture.userId,
        environment: "DEV",
        state: "pending",
      });
      const result = await reconcileMcpOAuthCleanup(pool!, { fetcher: stub.fetcher, nangoConfig });
      expect(result.confirmed).toBe(1);
      const deletes = stub.calls.filter((call) => call.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toContain("conn-broker-1");
      const audit = await pool!.query(
        "SELECT * FROM mcp_oauth_cleanup_effects WHERE account_id=$1", [fixture.accountId]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        outcome: "confirmed", nango_connection_id: "conn-broker-1",
        connect_request_id: grant.connectRequestId, provider: "mcp-generic",
        account_id: fixture.accountId, created_by_user_id: fixture.userId,
        environment: "DEV", target_origin: "https://oauth.example.test/mcp",
        broker_base_url: nangoConfig.baseUrl,
      });
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("never concludes absence from an unavailable or malformed metadata read", async () => {
    const fixture = await seed("unavailable");
    try {
      await seedGrant(fixture, { nangoConnectionId: "conn-unavail-1" });
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'disconnect',environment,broker_base_url
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      for (const broken of [
        wireStub(() => "down"),
        wireStub(() => ({ body: { data: [] }, status: 200 })),
        wireStub(() => ({ body: { connections: "not-an-array" }, status: 200 })),
        wireStub(() => ({ body: {}, status: 500 })),
        wireStub(() => ({ body: {}, status: 401 })),
      ]) {
        await reconcileMcpOAuthCleanup(pool!, { fetcher: broken.fetcher, nangoConfig });
        const rows = await pool!.query<{ state: string; last_error: string | null }>(
          "SELECT state, last_error FROM mcp_oauth_cleanup WHERE account_id=$1",
          [fixture.accountId],
        );
        expect(rows.rows[0]!.state).not.toBe("confirmed");
        expect(broken.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
      }
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("refuses a reused or mismatched identity and a changed environment", async () => {
    const fixture = await seed("mismatch");
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-reused-1" });
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'disconnect',environment,broker_base_url
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      // The exact identity exists but belongs to a different frozen attempt:
      // never delete it.
      const reused = wireStub((_path, init, target) => {
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") return { body: { success: true }, status: 200 };
        return {
          body: connectionEnvelope([
            {
              connection_id: "conn-reused-1",
              provider_config_key: "mcp-generic",
              tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                connect_request_id: "mcpconn_someoneelse",
                mcp_server_url: "https://other.example.test/mcp",
              },
            },
          ]),
          status: 200,
        };
      });
      await reconcileMcpOAuthCleanup(pool!, { fetcher: reused.fetcher, nangoConfig });
      const rows = await pool!.query<{ state: string; last_error: string | null }>(
        "SELECT state, last_error FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(rows.rows[0]!.state).toBe("failed");
      expect(rows.rows[0]!.last_error).toContain("identity_mismatch");
      expect(reused.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

      // A changed broker environment must never delete in the new one.
      await retryNow(fixture.accountId);
      const changed = wireStub(() => ({ body: { success: true }, status: 200 }));
      await reconcileMcpOAuthCleanup(pool!, {
        fetcher: changed.fetcher,
        nangoConfig: { ...nangoConfig, environment: "PROD" },
      });
      const envRows = await pool!.query<{ last_error: string | null }>(
        "SELECT last_error FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(envRows.rows[0]!.last_error).toContain("environment_changed");
      expect(changed.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
      void grant;
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("keeps a permission failure retryable and confirms only on the pinned contract", async () => {
    const fixture = await seed("forbidden");
    try {
      const forbiddenGrant = await seedGrant(fixture, { nangoConnectionId: "conn-forbidden-1" });
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'disconnect',environment,broker_base_url
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      const listOk = (target: URL, id: string) =>
        target.searchParams.get("connectionId") === id
          ? {
              body: connectionEnvelope([
                {
                  connection_id: id,
                  provider_config_key: "mcp-generic",
                  tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                    connect_request_id: forbiddenGrant.connectRequestId,
                    mcp_server_url: "https://oauth.example.test/mcp",
                  },
                },
              ]),
              status: 200,
            }
          : { body: connectionEnvelope([]), status: 200 };
      // 403: explicit permission error, no success claim.
      const denied = wireStub((_p, init, target) =>
        (init?.method ?? "GET").toUpperCase() === "DELETE"
          ? { body: { error: { code: "forbidden" } }, status: 403 }
          : listOk(target, "conn-forbidden-1"),
      );
      await reconcileMcpOAuthCleanup(pool!, { fetcher: denied.fetcher, nangoConfig });
      let row = (await pool!.query<{ state: string; last_error: string | null }>(
        "SELECT state, last_error FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      )).rows[0]!;
      expect(row.state).toBe("failed");
      expect(row.last_error).toContain("environment:connections:delete");

      // 200 {success:false} is NOT the pinned confirmed contract.
      await retryNow(fixture.accountId);
      const falseOk = wireStub((_p, init, target) =>
        (init?.method ?? "GET").toUpperCase() === "DELETE"
          ? { body: { success: false }, status: 200 }
          : listOk(target, "conn-forbidden-1"),
      );
      await reconcileMcpOAuthCleanup(pool!, { fetcher: falseOk.fetcher, nangoConfig });
      row = (await pool!.query("SELECT state, last_error FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(row.state).not.toBe("confirmed");

      // 202 async: not confirmed until readback shows the identity absent.
      await retryNow(fixture.accountId);
      const asyncStub = wireStub((_p, init, target) =>
        (init?.method ?? "GET").toUpperCase() === "DELETE"
          ? { body: {}, status: 202 }
          : listOk(target, "conn-forbidden-1"),
      );
      await reconcileMcpOAuthCleanup(pool!, { fetcher: asyncStub.fetcher, nangoConfig });
      row = (await pool!.query("SELECT state, last_error FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(row.state).not.toBe("confirmed");

      // Retry with the pinned success contract confirms exactly once.
      await retryNow(fixture.accountId);
      const allowed = wireStub((_p, init, target) =>
        (init?.method ?? "GET").toUpperCase() === "DELETE"
          ? { body: { success: true }, status: 200 }
          : listOk(target, "conn-forbidden-1"),
      );
      await reconcileMcpOAuthCleanup(pool!, { fetcher: allowed.fetcher, nangoConfig });
      row = (await pool!.query("SELECT state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(row.state).toBe("confirmed");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("keeps an empty capability list pending and cleans only its own late grant", async () => {
    const fixture = await seed("lategrant");
    try {
      const grant = await seedGrant(fixture, {});
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,connect_request_id,target_origin,provenance,environment,broker_base_url,capability_expires_at)
         SELECT $1,account_id,created_by_user_id,provider,connect_request_id,mcp_server_url,'withdrawn',environment,broker_base_url,capability_expires_at
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      // Empty exact list: the capability is NOT closed and nothing confirms.
      await retryNow(fixture.accountId);
      const empty = wireStub(() => ({ body: connectionEnvelope([]), status: 200 }));
      await reconcileMcpOAuthCleanup(pool!, { fetcher: empty.fetcher, nangoConfig });
      let row = (await pool!.query<{ state: string; last_error: string | null; closure_state: string }>(
        "SELECT state, last_error, closure_state FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      )).rows[0]!;
      expect(row.state).toBe("pending");
      expect(row.closure_state).toBe("open");
      expect(row.last_error).toContain("capability_watch_open");
      expect(empty.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

      // A late grant for the frozen attempt binds and is cleaned; a foreign
      // identity is never selected.
      // The grant is rejected/expired/closed first: the attempt row is
      // terminal (or gone after deletion) and only the frozen watch remains.
      await pool!.query(
        "UPDATE mcp_oauth_connect_requests SET state='failed' WHERE account_id=$1",
        [fixture.accountId],
      );
      await pool!.query(
        "UPDATE mcp_interaction_requests SET state='rejected', resolved_at=now() WHERE account_id=$1",
        [fixture.accountId],
      );
      await retryNow(fixture.accountId);
      const { applyNangoAuthWebhook } = await import("./mcpInteractions.js");
      const { parseNangoAuthWebhook } = await import("./nango.js");
      const webhookBody = JSON.stringify({
        type: "auth",
        operation: "creation",
        connectionId: "conn-late-1",
        providerConfigKey: "mcp-generic",
        provider: "mcp-generic",
        environment: "DEV",
        success: true,
        tags: { connect_request_id: grant.connectRequestId },
      });
      const signature = createHmac("sha256", nangoConfig.webhookSigningKey).update(webhookBody).digest("hex");
      const late = wireStub((path, init, target) => {
        if (path.includes("/connections") && (init?.method ?? "GET").toUpperCase() !== "DELETE") {
          return {
            body: connectionEnvelope([
              {
                connection_id: "conn-late-1",
                provider_config_key: "mcp-generic",
                tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                  connect_request_id: grant.connectRequestId,
                  mcp_server_url: "https://oauth.example.test/mcp",
                },
              },
            ]),
            status: 200,
          };
        }
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") return { body: { success: true }, status: 200 };
        return { body: connectionEnvelope([]), status: 200 };
      });
      const outcome = await applyNangoAuthWebhook(pool!, webhookBody, signature, parseNangoAuthWebhook(webhookBody), {
        fetcher: late.fetcher,
        nangoConfig,
      });
      expect(outcome.status).toBe("ignored");
      row = (await pool!.query("SELECT state, nango_connection_id FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(row).toMatchObject({ nango_connection_id: "conn-late-1", state: "pending" });
      await retryNow(fixture.accountId);
      await reconcileMcpOAuthCleanup(pool!, { fetcher: late.fetcher, nangoConfig });
      const deletes = late.calls.filter((call) => call.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toContain("conn-late-1");
      expect(deletes[0]!.url).not.toContain("conn-other");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("reopens the cycle when a new authorization reuses nothing from the old one", async () => {
    const fixture = await seed("reauth");
    try {
      await seedGrant(fixture, { connectRequestId: "mcpconn_old00000001", nangoConnectionId: "conn-old" });
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'disconnect',environment,broker_base_url
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      const stub = wireStub((_p, init, target) => {
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") return { body: { success: true }, status: 200 };
        const id = target.searchParams.get("connectionId");
        return {
          body: connectionEnvelope(
            id === "conn-old"
              ? [{
                  connection_id: "conn-old",
                  provider_config_key: "mcp-generic",
                  tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                    connect_request_id: "mcpconn_old00000001",
                    mcp_server_url: "https://oauth.example.test/mcp",
                  },
                }]
              : [],
          ),
          status: 200,
        };
      });
      await reconcileMcpOAuthCleanup(pool!, { fetcher: stub.fetcher, nangoConfig });
      const deletes = stub.calls.filter((call) => call.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toContain("conn-old");
    } finally {
      await removeAccount(fixture.accountId);
    }
  });

  it("attributes pre-existing pending cleanup to Lab stop and keeps the claim honest", async () => {
    const fixture = await seed("labstop", "lab_human");
    const owner = await seed("labstop-owner");
    const labWorkspaceId = randomUUID();
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-lab-1" });
      // A pre-existing session-ended watch WITHOUT Lab ownership.
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url,capability_expires_at)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'session_ended',environment,broker_base_url,capability_expires_at
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      const external = await (async () => {
        const { inTransaction } = await import("../database/pool.js");
        return inTransaction(pool!, (client) =>
          recordLabStopCleanup(client, fixture.accountId, labWorkspaceId, fixture.userId),
        );
      })();
      // The pre-existing row is merged (not duplicated) and counted: Lab may
      // not claim verified deletion while it is outstanding.
      expect(external).toBe(1);
      const merged = await pool!.query<{ lab_workspace_id: string | null; provenance: string; id: string }>(
        "SELECT lab_workspace_id, provenance, id FROM mcp_oauth_cleanup WHERE account_id=$1",
        [fixture.accountId],
      );
      expect(merged.rows).toHaveLength(1);
      expect(merged.rows[0]!.lab_workspace_id).toBe(labWorkspaceId);
      expect(merged.rows[0]!.provenance).toBe("session_ended");

      // The actual Lab cleanup entry point: local wipe succeeds but the
      // deletion claim stays pending while the watch is open.
      await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2", [fixture.accountId, fixture.userId]);
      const labScopeID = createHmac("sha256", "lab-scope").update(labWorkspaceId).digest("hex");
      await pool!.query(
        `INSERT INTO lab_test_workspaces(id,owner_account_id,owner_user_id,target_account_id,target_user_id,duration_hours,expires_at,media_scope_hash,state,stop_id,stop_reason,stopped_at,external_cleanup_pending)
         VALUES($1,$2,$3,$4,$5,1,now()+interval '1 hour',$6,'deleting',$7,'manual',now(),$8)`,
        [
          labWorkspaceId,
          owner.accountId,
          owner.userId,
          fixture.accountId,
          fixture.userId,
          labScopeID,
          randomUUID(),
          0,
        ],
      );
      const storage = {
        existsForLab: async () => false,
        labScopeID,
        provider: "local",
        purgeForLab: async () => undefined,
      } as never;
      const service = new LabWorkspaceService(pool!, storage, 3600);
      await service.clean(labWorkspaceId);
      const workspace = await pool!.query<{ state: string; external_cleanup_pending: number }>(
        "SELECT state, external_cleanup_pending FROM lab_test_workspaces WHERE id=$1",
        [labWorkspaceId],
      );
      // Local data is wiped, but the claim is NOT verified-deleted while the
      // frozen watch/capability is unresolved.
      expect(workspace.rows[0]!.state).toBe("deleting");
      expect(workspace.rows[0]!.external_cleanup_pending).toBeGreaterThan(0);
      expect((await pool!.query("SELECT id FROM mcp_connections WHERE account_id=$1", [fixture.accountId])).rows).toHaveLength(0);
      expect((await pool!.query("SELECT id FROM mcp_oauth_connect_requests WHERE account_id=$1", [fixture.accountId])).rows).toHaveLength(0);
      expect((await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [fixture.accountId])).rows).toHaveLength(0);
      // The ledger survived the actual account wipe (control scope).
      const survivor = await pool!.query("SELECT 1 FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(survivor.rows).toHaveLength(1);
      // Complete real cleanup after the wipe: no account-scoped audit regrowth,
      // while the control-scope dispatch receipt and removal commit normally.
      await retryNow(fixture.accountId);
      const removed = wireStub((_path, init) => init?.method === "DELETE"
        ? { status: 200, body: { success: true } }
        : { status: 200, body: connectionEnvelope([{ connection_id: "conn-lab-1",
          provider_config_key: "mcp-generic", tags: { account_id: fixture.accountId,
          user_id: fixture.userId, provider: "mcp-generic", connect_request_id: grant.connectRequestId,
          mcp_server_url: "https://oauth.example.test/mcp" } }]) });
      await reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher: removed.fetcher });
      const cleaned = (await pool!.query("SELECT state, closure_state, claim_token FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(cleaned).toMatchObject({ state: "confirmed", closure_state: "open", claim_token: null });
      expect((await pool!.query("SELECT outcome FROM mcp_oauth_cleanup_effects WHERE account_id=$1", [fixture.accountId])).rows).toEqual([{ outcome: "confirmed" }]);
      expect((await pool!.query("SELECT id FROM audit_events WHERE account_id=$1", [fixture.accountId])).rows).toHaveLength(0);
      await service.clean(labWorkspaceId);
      expect((await pool!.query("SELECT state FROM lab_test_workspaces WHERE id=$1", [labWorkspaceId])).rows[0]!.state).toBe("deleting");
      await pool!.query("DELETE FROM lab_test_workspaces WHERE id=$1", [labWorkspaceId]).catch(() => undefined);
    } finally {
      await removeAccount(fixture.accountId);
      await removeAccount(owner.accountId);
    }
  });

  it("reconciles ordinary cleanup without any UI read via the bounded pump", async () => {
    const fixture = await seed("pump");
    try {
      const pumpGrant = await seedGrant(fixture, { nangoConnectionId: "conn-pump-1" });
      await pool!.query(
        `INSERT INTO mcp_oauth_cleanup(id,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,target_origin,provenance,environment,broker_base_url)
         SELECT $1,account_id,created_by_user_id,provider,nango_connection_id,connect_request_id,mcp_server_url,'disconnect',environment,broker_base_url
         FROM mcp_oauth_connect_requests WHERE account_id=$2`,
        [randomUUID(), fixture.accountId],
      );
      const stub = wireStub((_p, init, target) => {
        if ((init?.method ?? "GET").toUpperCase() === "DELETE") return { body: { success: true }, status: 200 };
        return {
          body: connectionEnvelope([
            {
              connection_id: "conn-pump-1",
              provider_config_key: "mcp-generic",
              tags: {
                  account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
                connect_request_id: pumpGrant.connectRequestId,
                mcp_server_url: "https://oauth.example.test/mcp",
              },
            },
          ]),
          status: 200,
        };
      });
      const stop = startMcpOAuthCleanupPump(pool!, {
        dependencies: { fetcher: stub.fetcher, nangoConfig },
        intervalMs: 50,
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const row = await pool!.query<{ state: string }>(
          "SELECT state FROM mcp_oauth_cleanup WHERE account_id=$1",
          [fixture.accountId],
        );
        // No UI read happened: the lifecycle pump alone cleaned it.
        expect(row.rows[0]!.state).toBe("confirmed");
      } finally {
        await stop();
      }
    } finally {
      await removeAccount(fixture.accountId);
    }
  });
  it("refuses wrong owners and incomplete generation pages without deletion", async () => {
    for (const fault of ["account", "owner", "provider", "malformed", "truncated"] as const) {
      const fixture = await seed(`scope-${fault}`);
      try {
        const grant = await seedGrant(fixture, { nangoConnectionId: "conn-scope" });
        await disconnectMcpConnection(pool!, fixture.auth, grant.connectionRowId!, {
          expected_revision: 1, idempotency_key: `dc-${randomUUID()}` });
        const valid = { connection_id: "conn-scope", provider_config_key: "mcp-generic", tags: {
          account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
          connect_request_id: grant.connectRequestId, mcp_server_url: "https://oauth.example.test/mcp" } };
        const stub = wireStub((_path, _init, query) => {
          if (fault === "account") valid.tags.account_id = randomUUID();
          if (fault === "owner") valid.tags.user_id = randomUUID();
          if (fault === "provider") valid.tags.provider = "foreign-provider";
          return { status: 200, body: connectionEnvelope(
            fault === "malformed" ? [null] : fault === "truncated" && !query.searchParams.has("connectionId")
              ? Array.from({ length: 21 }, (_, i) => ({ ...valid, connection_id: `conn-${i}` })) : [valid]) };
        });
        await reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher: stub.fetcher });
        expect(stub.calls.filter(call => call.method === "DELETE")).toHaveLength(0);
        expect((await pool!.query("SELECT state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!.state).not.toBe("confirmed");
      } finally { await removeAccount(fixture.accountId); }
    }
  });

  it("cleans every owned grant in the frozen attempt and keeps watching later IDs", async () => {
    const fixture = await seed("multi-grant");
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-first" });
      await disconnectMcpConnection(pool!, fixture.auth, grant.connectionRowId!, {
        expected_revision: 1, idempotency_key: `dc-${randomUUID()}` });
      const live = new Set(["conn-first", "conn-second"]);
      const stub = wireStub((_path, init, query) => {
        if (init?.method === "DELETE") {
          live.delete(decodeURIComponent(query.pathname.split("/").at(-1)!));
          return { status: 200, body: { success: true } };
        }
        const id = query.searchParams.get("connectionId");
        const ids = id ? [...live].filter(value => value === id) : [...live];
        return { status: 200, body: connectionEnvelope(ids.map(connection_id => ({ connection_id,
          provider_config_key: "mcp-generic", tags: { account_id: fixture.accountId, user_id: fixture.userId,
          provider: "mcp-generic", connect_request_id: grant.connectRequestId,
          mcp_server_url: "https://oauth.example.test/mcp" } }))) };
      });
      await reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher: stub.fetcher });
      expect(live.size).toBe(0);
      expect(stub.calls.filter(call => call.method === "DELETE")).toHaveLength(2);
      live.add("conn-third");
      await retryNow(fixture.accountId);
      await reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher: stub.fetcher });
      expect(live.size).toBe(0);
      expect(stub.calls.filter(call => call.method === "DELETE")).toHaveLength(3);
      const ledger = await pool!.query("SELECT closure_state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId]);
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0]!.closure_state).toBe("open");
    } finally { await removeAccount(fixture.accountId); }
  });

  it("does not settle or audit a stale claim after a concurrent late binding", async () => {
    const fixture = await seed("claim-cas");
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-claim" });
      await disconnectMcpConnection(pool!, fixture.auth, grant.connectionRowId!, {
        expected_revision: 1, idempotency_key: `dc-${randomUUID()}` });
      let release!: () => void;
      let dispatch!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const dispatched = new Promise<void>(resolve => { dispatch = resolve; });
      const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          dispatch(); await held;
          return Response.json({ success: true });
        }
        return Response.json(connectionEnvelope([{ connection_id: "conn-claim", provider_config_key: "mcp-generic",
          tags: { account_id: fixture.accountId, user_id: fixture.userId, provider: "mcp-generic",
          connect_request_id: grant.connectRequestId, mcp_server_url: "https://oauth.example.test/mcp" } }]));
      }) as typeof fetch;
      const running = reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher });
      await dispatched;
      await inTransaction(pool!, client => recordOauthCleanup(client, {
        accountId: fixture.accountId, createdByUserId: fixture.userId,
        provider: "mcp-generic", nangoConnectionId: "conn-new-grant", connectRequestId: grant.connectRequestId,
        environment: "DEV", brokerBaseUrl: nangoConfig.baseUrl,
        targetOrigin: "https://oauth.example.test/mcp", provenance: "late_grant" }));
      release(); await running;
      const row = (await pool!.query("SELECT state, nango_connection_id, confirmed_at FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!;
      expect(row.state).toBe("pending");
      expect(row.nango_connection_id).toBe("conn-new-grant");
      expect(row.confirmed_at).toBeNull();
      expect((await pool!.query("SELECT id FROM audit_events WHERE account_id=$1 AND event_type='mcp_oauth_cleanup.confirmed'", [fixture.accountId])).rows).toHaveLength(0);
      const observed = await pool!.query("SELECT outcome, nango_connection_id, generation_revision FROM mcp_oauth_cleanup_effects WHERE account_id=$1", [fixture.accountId]);
      expect(observed.rows).toHaveLength(1);
      expect(observed.rows[0]).toMatchObject({ outcome: "confirmed", nango_connection_id: "conn-claim" });
    } finally { await removeAccount(fixture.accountId); }
  });

  it("retains exact partial-success receipts when a later owned DELETE is denied", async () => {
    const fixture = await seed("partial-delete");
    try {
      const grant = await seedGrant(fixture, { nangoConnectionId: "conn-partial-first" });
      await disconnectMcpConnection(pool!, fixture.auth, grant.connectionRowId!, {
        expected_revision: 1, idempotency_key: `dc-${randomUUID()}` });
      const stub = wireStub((_path, init, query) => {
        if (init?.method === "DELETE") return query.pathname.endsWith("conn-partial-first")
          ? { status: 200, body: { success: true } } : { status: 403, body: { error: { code: "forbidden" } } };
        const ids = query.searchParams.has("connectionId") ? ["conn-partial-first"] : ["conn-partial-first", "conn-partial-second"];
        return { status: 200, body: connectionEnvelope(ids.map(connection_id => ({ connection_id,
          provider_config_key: "mcp-generic", tags: { account_id: fixture.accountId, user_id: fixture.userId,
          provider: "mcp-generic", connect_request_id: grant.connectRequestId,
          mcp_server_url: "https://oauth.example.test/mcp" } }))) };
      });
      await reconcileMcpOAuthCleanup(pool!, { nangoConfig, fetcher: stub.fetcher });
      expect((await pool!.query("SELECT state FROM mcp_oauth_cleanup WHERE account_id=$1", [fixture.accountId])).rows[0]!.state).toBe("failed");
      const observed = await pool!.query("SELECT outcome, nango_connection_id FROM mcp_oauth_cleanup_effects WHERE account_id=$1 ORDER BY dispatched_at", [fixture.accountId]);
      expect(observed.rows).toEqual([
        { outcome: "confirmed", nango_connection_id: "conn-partial-first" },
        { outcome: "forbidden", nango_connection_id: "conn-partial-second" },
      ]);
    } finally { await removeAccount(fixture.accountId); }
  });

});
