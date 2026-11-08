/** A fresh disposable PG namespace; every HTTP auth check remains production. */
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { AuthContext } from "../modules/auth.js";
import { requireProtocol } from "./get452DirectoryProtocolHost.js";

export async function createDirectoryFixture(runtime: string, rawUrl: string) {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid protocol database configuration"); }
  requireProtocol(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1"
    && url.port === "5432" && url.pathname === "/get452_directory_ci" && !url.search && !url.hash, "DATABASE_ADMISSION");
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.href, max: 1, connectionTimeoutMillis: 2000, idleTimeoutMillis: 0 });
  let created = false, databaseOid: string | undefined, pool: Pool | undefined, app: FastifyInstance | undefined;
  const cleanup = async () => {
    let failed = false;
    try { if (app) await app.close(); } catch { failed = true; }
    try { if (pool) await pool.end(); } catch { failed = true; }
    try {
      // No FORCE and no IF EXISTS: an unknown replacement/active connection is a failure.
      if (created) {
        const current = (await admin.query<{ oid: string }>("SELECT oid::text FROM pg_database WHERE datname='get452_directory_ci'")).rows[0]?.oid;
        requireProtocol(databaseOid && current === databaseOid, "DATABASE_NAMESPACE_CHANGED");
        await admin.query("DROP DATABASE get452_directory_ci"); created = false;
      }
    } catch { failed = true; }
    try { await admin.end(); } catch { failed = true; }
    requireProtocol(!failed, "DATABASE_CLEANUP");
  };
  try {
    requireProtocol((await admin.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database === "postgres", "DATABASE_ADMIN_IDENTITY");
    // Existing DB is denied instead of reused or cleared. This runner alone owns creation.
    await admin.query("CREATE DATABASE get452_directory_ci"); created = true;
    databaseOid = (await admin.query<{ oid: string }>("SELECT oid::text FROM pg_database WHERE datname='get452_directory_ci'")).rows[0]?.oid;
    requireProtocol(databaseOid && /^\d+$/.test(databaseOid), "DATABASE_NAMESPACE_IDENTITY");
    process.env.DATABASE_URL = rawUrl;
    process.env.LOG_LEVEL = "silent";
    const { migrate } = await import("../database/migrate.js");
    await migrate();
    pool = new Pool({ connectionString: rawUrl, max: 3, connectionTimeoutMillis: 2000, idleTimeoutMillis: 0 });
    const empty = (await pool.query<{ database: string; users: string }>("SELECT current_database() AS database,(SELECT count(*)::text FROM users) AS users")).rows[0];
    requireProtocol(empty?.database === "get452_directory_ci" && empty.users === "0", "DATABASE_EMPTY");
    const { buildApp } = await import("../app.js");
    const { createRealIdentity, newAccountSlug } = await import("../modules/accountIdentity.js");
    const { encodePasswordCredential } = await import("../modules/passwordCredential.js");
    const { createMemoryMailSink } = await import("../lib/mail.js");
    const { revokeCurrentSession } = await import("../modules/auth.js");
    const accountId = randomUUID(), userId = randomUUID(), email = `get452-${userId}@example.test`;
    const password = randomBytes(24).toString("base64url"), accountSlug = newAccountSlug();
    const tailA = "Directory-" + "a".repeat(167) + "-tail-a";
    const tailB = "Directory-" + "a".repeat(167) + "-tail-b";
    const personA = randomUUID(), personB = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await createRealIdentity(client, { accountId, userId, accountName: "GET452 synthetic directory", accountSlug,
        email, displayName: "Synthetic directory owner", kind: "password_human", emailVerifiedAt: new Date() });
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)", [accountId, userId, await encodePasswordCredential(password)]);
      await client.query("INSERT INTO subjects(id,account_id,external_ref,display_label,status) VALUES($1::uuid,$3::uuid,$1::text,$4,'active'),($2::uuid,$3::uuid,$2::text,$5,'active')", [personA, personB, accountId, tailA, tailB]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    app = await buildApp({ pool, config: { allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
      googleSignInAudiences: [], databaseUrl: rawUrl, host: "127.0.0.1", port: 0, passwordAuthEnabled: true,
      passwordRegistrationEnabled: false, simulatedAuthEnabled: false, sessionTtlSeconds: 28_800,
      retentionSweepIntervalMs: 60_000, internalLabEnabled: false,
      chatMediaStorage: { provider: "local", directory: join(runtime, "chat-media") } },
      remoteChatProvider: null, privateConversationProvider: null, personResearchProvider: null, screenshotContact: null,
      labProviders: new Map(), labCIVerifier: null, labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      voiceTranscriber: { async transcribe() { throw new Error("Voice is outside GET452"); } }, mail: createMemoryMailSink().delivery });
    const observations: Array<{ query: string; status: number; owner: boolean }> = [];
    const observedAuth = new Map<string, AuthContext>();
    let renewalDenials = 0, passwordLogins = 0;
    let serverStarted = 0, serverCompleted = 0;
    const serverStatuses = new Map<string, number>();
    app.addHook("onRequest", async () => { serverStarted++; });
    app.addHook("onResponse", async (request, reply) => {
      const path = request.url.split("?")[0];
      const route = path === "/v1/auth/password/login" ? "password_login"
        : path === "/v1/auth/persistent/enroll" ? "persistent_enroll"
          : path === "/v1/auth/persistent/renew" ? "persistent_renew"
            : path === "/v1/auth/session" ? "auth_session"
              : path === "/v1/account/onboarding" ? "onboarding"
                : path === "/v1/people/search" ? "people_search" : path === "/v1/people" ? "people_list" : "other";
      const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method) ? request.method : "OTHER";
      const status = Number.isInteger(reply.statusCode) && reply.statusCode >= 100 && reply.statusCode <= 599 ? reply.statusCode : "INVALID";
      const key = `${route}:${method}:${status}`;
      serverCompleted++; serverStatuses.set(key, (serverStatuses.get(key) ?? 0) + 1);
      if (path === "/v1/auth/persistent/renew" && reply.statusCode === 401) renewalDenials++;
      if (path === "/v1/auth/password/login" && reply.statusCode === 200) passwordLogins++;
      if (request.method !== "POST" || path !== "/v1/people/search") return;
      requireProtocol(observations.length < 128, "SEARCH_OBSERVATION_BUDGET");
      const query = (request.body as { query?: unknown } | null)?.query;
      const owner = request.auth?.accountId === accountId && request.auth.userId === userId;
      if (owner && request.auth && reply.statusCode === 200 && typeof query === "string") observedAuth.set(query, { ...request.auth });
      if (typeof query === "string") observations.push({ query, status: reply.statusCode, owner });
    });
    const backend = await app.listen({ host: "127.0.0.1", port: 0 });
    return {
      backend, email, password, tailA, tailB, personA, personB,
      seen(query: string, after = 0) { return observations.slice(after).some(value => value.query === query && value.owner && value.status === 200); },
      observationCount() { return observations.length; },
      counters() { return { passwordLogins, renewalDenials, searches: observations.length,
        serverStarted, serverCompleted, serverStatuses: Object.fromEntries([...serverStatuses].sort(([a], [b]) => a.localeCompare(b))) }; },
      async onboardingWasSkipped() {
        const row = (await pool!.query<{ status: string }>("SELECT onboarding_status AS status FROM users WHERE account_id=$1 AND id=$2", [accountId, userId])).rows[0];
        return row?.status === "skipped";
      },
      async revokeBrowserLogin(observedQuery: string) {
        const original = observedAuth.get(observedQuery);
        requireProtocol(original?.accountId === accountId && original.userId === userId, "REVOCATION_OWNER");
        const result = await revokeCurrentSession(pool!, original);
        requireProtocol(result.revoked_session_id === original.sessionId, "REVOCATION_RECEIPT");
      },
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}
export type DirectoryFixture = Awaited<ReturnType<typeof createDirectoryFixture>>;
