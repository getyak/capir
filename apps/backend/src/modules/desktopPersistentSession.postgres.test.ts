import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { BackendConfig } from "../config.js";
import { createAuthGuard, type AuthContext } from "./auth.js";
import { sha256 } from "../lib/hash.js";
import { ApiError } from "../lib/apiError.js";
import { approveDesktopBrowserLogin, consumeDesktopBrowserLogin, pkceS256,
  postgresDesktopBrowserLoginDb, prepareDesktopBrowserLogin } from "./desktopBrowserLogin.js";
import { enrollDesktopPersistentSession, renewDesktopPersistentSession,
  revokeDesktopPersistentSession } from "./desktopPersistentSession.js";
import { readAccountSettings, mutateAccountSettings } from "./accountManagement.js";
import { registerDesktopPersistentSession } from "../routes/desktopPersistentSession.js";

const database = process.env.DESKTOP_PERSISTENT_SESSION_TEST_DATABASE_URL;
if (database) {
  const parsed = new URL(database);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname)
    || !parsed.pathname.slice(1).startsWith("capri_persistent_test_")) {
    throw new Error("Persistent Mac proof requires an explicitly named disposable loopback database.");
  }
}
const pool = database ? new Pool({ connectionString: database, max: 8,
  statement_timeout: 5000, query_timeout: 6000 }) : null;
const config = { allowedOrigins: ["https://web.test"], sessionTtlSeconds: 28800 } as BackendConfig;
const secret = () => randomBytes(32).toString("base64url");
const accounts: { accountId: string; email: string }[] = [];

/** Transparent fault injection: execute every real statement, holding only the
 * selected transaction's COMMIT. No fixture supplies missing protocol state. */
function holdSessionCommit(sessionId: string, operation: "enroll" | "revoke") {
  let release!: () => void, reached!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const atCommit = new Promise<void>(resolve => { reached = resolve; });
  let holderPid: number | null = null;
  const marker = operation === "enroll" ? "INSERT INTO desktop_persistent_session_credentials"
    : "UPDATE sessions SET revoked_at=clock_timestamp()";
  const wrapped = new Proxy(pool!, {
    get(target, property) {
      if (property !== "connect") {
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        let matches = false;
        return new Proxy(client, {
          get(connection, key) {
            if (key !== "query") {
              const value: unknown = Reflect.get(connection, key);
              return typeof value === "function" ? value.bind(connection) : value;
            }
            return async (...args: unknown[]) => {
              const [sql, values] = args;
              if (typeof sql === "string" && sql.includes(marker)
                && Array.isArray(values) && values[0] === sessionId) matches = true;
              if (sql === "COMMIT" && matches) {
                matches = false;
                holderPid = (await connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
                reached();
                await released;
              }
              const query = connection.query as unknown as (...parameters: unknown[]) => Promise<unknown>;
              return query.apply(connection, args);
            };
          },
        });
      };
    },
  });
  return { pool: wrapped, atCommit, release, holderPid: () => holderPid };
}

async function waitForBlockedTransaction(holderPid: number | null) {
  expect(holderPid).not.toBeNull();
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const row = await pool!.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, [holderPid]);
    if (row.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("The expected production transaction did not reach the held row lock.");
}

async function waitForCommit(gate: ReturnType<typeof holdSessionCommit>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([gate.atCommit, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The production transaction did not reach COMMIT.")), 5_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function fixture() {
  const accountId = randomUUID(), userId = randomUUID(), browserId = randomUUID();
  const email = `persistent-${userId}@example.test`;
  const browserToken = secret();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Disposable persistent proof')", [accountId, `persistent-${accountId}`]);
    await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)", [email, accountId, userId]);
    await client.query("INSERT INTO users(id,account_id,email,display_name,kind,account_role,email_verified_at) VALUES($1,$2,$3,'Disposable owner','password_human','admin',now())", [userId, accountId, email]);
    await client.query("UPDATE accounts SET owner_user_id=$2 WHERE id=$1", [accountId, userId]);
    await client.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'Disposable browser',now()+interval '8 hours')", [browserId, accountId, userId, sha256(browserToken)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
  accounts.push({ accountId, email });
  const browser: AuthContext = { accountId, userId, sessionId: browserId, accountSlug: `persistent-${accountId}`,
    userEmail: email, userKind: "password_human" };
  const db = postgresDesktopBrowserLoginDb(pool!);
  const verifier = secret(), state = secret();
  const prepared = await prepareDesktopBrowserLogin(db, config, {
    protocol_version: 1, purpose: "macos-primary-login", web_origin: "https://web.test",
    state, challenge: pkceS256(verifier), cancel_secret: secret(),
  });
  const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, browser, { state, web_origin: "https://web.test" });
  const mac = await consumeDesktopBrowserLogin(db, config, { attempt_id: prepared.attempt_id,
    code: approved.code!, verifier, state, web_origin: "https://web.test" });
  const sessionId = (await pool!.query<{ id: string }>("SELECT id FROM sessions WHERE token_hash=$1", [sha256(mac.access_token)])).rows[0]!.id;
  const auth = { ...browser, sessionId };
  const proof = { device_secret: secret(), web_origin: "https://web.test", account_id: accountId, user_id: userId };
  return { auth, browser, browserToken, mac, proof, sessionId };
}
async function accepted(token: string): Promise<boolean> {
  const app = Fastify();
  app.get("/private", { preHandler: createAuthGuard(pool!) }, async () => ({ ok: true }));
  try { return (await app.inject({ url: "/private", headers: { authorization: `Bearer ${token}` } })).statusCode === 200; }
  finally { await app.close(); }
}

describe.skipIf(!pool)("persistent Mac sessions (disposable PostgreSQL)", () => {
  afterEach(async () => {
    for (const { accountId, email } of accounts.splice(0)) {
      await pool!.query("UPDATE accounts SET retired_at=NULL WHERE id=$1", [accountId]);
      await pool!.query("DELETE FROM desktop_browser_login_attempts WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM account_access_events WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]);
      await pool!.query("UPDATE accounts SET owner_user_id=NULL WHERE id=$1", [accountId]);
      await pool!.query("DELETE FROM account_email_reservations WHERE normalized_email=$1", [email]);
      await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    }
  });
  afterAll(async () => { await pool?.end(); });

  it("enrolls only the actual Mac session and stores neither raw device nor access secrets", async () => {
    const f = await fixture();
    await expect(enrollDesktopPersistentSession(pool!, config, f.browser, f.proof))
      .rejects.toMatchObject({ statusCode: 403, code: "DESKTOP_SESSION_INELIGIBLE" });
    const result = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    const retry = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    expect(result.session_id).toBe(f.sessionId);
    expect(retry.access_token).toBe(result.access_token);
    expect(retry.expires_at).toBe(result.expires_at);
    const stored = (await pool!.query("SELECT * FROM desktop_persistent_session_credentials WHERE session_id=$1", [f.sessionId])).rows[0];
    expect(JSON.stringify(stored)).not.toContain(f.proof.device_secret);
    expect(JSON.stringify(stored)).not.toContain(result.access_token);
    expect(stored.credential_hash).toBe(sha256(f.proof.device_secret));
    await expect(enrollDesktopPersistentSession(pool!, config, f.auth, { ...f.proof, device_secret: secret() }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await accepted(result.access_token)).toBe(true);
  });

  it("recovers a lost enrollment response, then renews a dormant session without a browser login", async () => {
    const f = await fixture();
    const enrolled = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    const recovered = await renewDesktopPersistentSession(pool!, config, f.proof);
    expect(recovered.access_token).toBe(enrolled.access_token);
    expect(recovered.expires_at).toBe(enrolled.expires_at);
    await pool!.query("UPDATE sessions SET expires_at=now()-interval '10 years',previous_token_expires_at=now()-interval '10 years' WHERE id=$1", [f.sessionId]);
    expect(await accepted(enrolled.access_token)).toBe(false);
    const list = await readAccountSettings(pool!, f.browser, false);
    expect(list.sessions.find(s => s.id === f.sessionId)?.persistent).toBe(true);
    await pool!.query("DELETE FROM desktop_browser_login_attempts WHERE device_session_id=$1", [f.sessionId]);
    const renewed = await renewDesktopPersistentSession(pool!, config, f.proof);
    expect(renewed.session_id).toBe(f.sessionId);
    expect(renewed.access_token).not.toBe(enrolled.access_token);
    expect(await accepted(renewed.access_token)).toBe(true);
    expect(await accepted(enrolled.access_token)).toBe(false);
    expect((await pool!.query("SELECT count(*)::int AS count FROM sessions WHERE account_id=$1", [f.auth.accountId])).rows[0].count).toBe(2);
  });

  it("serializes concurrent renewals and preserves only the previous access's original deadline", async () => {
    const f = await fixture();
    const old = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    const originalDeadline = new Date(Date.now() + 60_000);
    await pool!.query("UPDATE sessions SET expires_at=$2 WHERE id=$1", [f.sessionId, originalDeadline]);
    const outcomes = await Promise.all([
      renewDesktopPersistentSession(pool!, config, f.proof),
      renewDesktopPersistentSession(pool!, config, f.proof),
    ]);
    expect(outcomes[0].access_token).toBe(outcomes[1].access_token);
    expect(outcomes[0].expires_at).toBe(outcomes[1].expires_at);
    const row = (await pool!.query("SELECT previous_token_expires_at FROM sessions WHERE id=$1", [f.sessionId])).rows[0];
    expect(row.previous_token_expires_at).toEqual(originalDeadline);
    expect(await accepted(old.access_token)).toBe(true);
    await pool!.query("UPDATE sessions SET previous_token_expires_at=now()-interval '1 second' WHERE id=$1", [f.sessionId]);
    expect(await accepted(old.access_token)).toBe(false);
    expect(await accepted(outcomes[0].access_token)).toBe(true);
  });

  it("revokes a dormant Mac using the real Account Settings mutation and cannot revive it", async () => {
    const f = await fixture();
    await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    await pool!.query("UPDATE sessions SET expires_at=now()-interval '1 day' WHERE id=$1", [f.sessionId]);
    await mutateAccountSettings(pool!, f.browser, { id: randomUUID(), kind: "revoke_session", session_id: f.sessionId }, false);
    await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
  });

  it("keeps every persistent device visible and revocable beyond 100 newer ordinary or persistent sessions", async () => {
    const f = await fixture();
    await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    await pool!.query("UPDATE sessions SET created_at=now()-interval '1 year',expires_at=now()-interval '1 day' WHERE id=$1", [f.sessionId]);
    const ordinaryIds = Array.from({ length: 101 }, () => randomUUID());
    const deviceIds = Array.from({ length: 101 }, () => randomUUID());
    await pool!.query(`INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at)
      SELECT id,$1,$2,hash,'Disposable ordinary pressure',now()+interval '8 hours'
      FROM unnest($3::uuid[],$4::text[]) AS fixture(id,hash)`,
      [f.auth.accountId, f.auth.userId, ordinaryIds, ordinaryIds.map(() => sha256(secret()))]);
    await pool!.query(`INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at)
      SELECT id,$1,$2,hash,'Disposable device pressure',now()-interval '1 day'
      FROM unnest($3::uuid[],$4::text[]) AS fixture(id,hash)`,
      [f.auth.accountId, f.auth.userId, deviceIds, deviceIds.map(() => sha256(secret()))]);
    await pool!.query(`INSERT INTO desktop_persistent_session_credentials
      (session_id,account_id,user_id,credential_hash,origin)
      SELECT id,$1,$2,hash,'https://web.test'
      FROM unnest($3::uuid[],$4::text[]) AS fixture(id,hash)`,
      [f.auth.accountId, f.auth.userId, deviceIds, deviceIds.map(() => sha256(secret()))]);
    const list = await readAccountSettings(pool!, f.browser, false);
    expect(list.sessions.find(s => s.id === f.sessionId)?.persistent).toBe(true);
    expect(list.sessions.filter(s => s.persistent)).toHaveLength(102);
    expect(list.sessions.filter(s => !s.persistent)).toHaveLength(100);
    await mutateAccountSettings(pool!, f.browser, { id: randomUUID(), kind: "revoke_session", session_id: f.sessionId }, false);
    await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
    const after = await readAccountSettings(pool!, f.browser, false);
    expect(after.sessions.some(s => s.id === f.sessionId)).toBe(false);
  });

  it("a revocation that already owns the account lock wins over an in-flight renewal", async () => {
    const f = await fixture();
    await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    const revoker = await pool!.connect();
    try {
      await revoker.query("BEGIN");
      await revoker.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [f.auth.accountId]);
      await revoker.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.sessionId]);
      const renewal = renewDesktopPersistentSession(pool!, config, f.proof).then(
        value => ({ value }), error => ({ error }));
      // Observe the real renewal waiting on this account lock. A timer alone
      // would not establish that renewal reached the concurrent transaction.
      const deadline = Date.now() + 2_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const waiting = await pool!.query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query LIKE 'SELECT id,name,slug,retired_at FROM accounts%'`);
        if (waiting.rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await revoker.query("COMMIT");
      const outcome = await renewal;
      expect(outcome).toHaveProperty("error");
      expect((outcome as { error: unknown }).error).toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
    } finally { await revoker.query("ROLLBACK"); revoker.release(); }
  });

  it("a successful renewal still loses authority immediately after explicit revoke", async () => {
    const f = await fixture();
    const enrolled = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    await revokeDesktopPersistentSession(pool!, config, f.proof);
    expect(await accepted(enrolled.access_token)).toBe(false);
    await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("revokes an expired pending Mac enrollment using only its exact original access proof", async () => {
    const f = await fixture();
    await pool!.query("UPDATE sessions SET expires_at=now()-interval '1 day' WHERE id=$1", [f.sessionId]);
    const proof = { ...f.proof, session_id: f.sessionId, original_access_token: f.mac.access_token };
    await expect(revokeDesktopPersistentSession(pool!, config, proof)).resolves.toEqual({ revoked: true });
    await expect(revokeDesktopPersistentSession(pool!, config, proof)).resolves.toEqual({ revoked: true });
    await expect(enrollDesktopPersistentSession(pool!, config, f.auth, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
    expect(await accepted(f.mac.access_token)).toBe(false);
  });

  it.each(["enroll", "revoke"] as const)("serializes pending %s COMMIT against the competing Mac transition", async first => {
    const f = await fixture(), gate = holdSessionCommit(f.sessionId, first);
    const proof = { ...f.proof, session_id: f.sessionId, original_access_token: f.mac.access_token };
    let enrollment: Promise<unknown> | undefined, logout: Promise<unknown> | undefined;
    try {
      if (first === "enroll") {
        await pool!.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1", [f.sessionId]);
        enrollment = enrollDesktopPersistentSession(gate.pool, config, f.auth, f.proof);
        await waitForCommit(gate);
        const deadline = Date.now() + 2500;
        let expired = false;
        while (Date.now() < deadline) {
          expired = (await pool!.query("SELECT clock_timestamp()>expires_at AS expired FROM sessions WHERE id=$1", [f.sessionId])).rows[0].expired;
          if (expired) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(expired).toBe(true);
        expect((await pool!.query("SELECT 1 FROM desktop_persistent_session_credentials WHERE session_id=$1", [f.sessionId])).rowCount).toBe(0);
        logout = revokeDesktopPersistentSession(pool!, config, proof);
      } else {
        logout = revokeDesktopPersistentSession(gate.pool, config, proof);
        await waitForCommit(gate);
        enrollment = enrollDesktopPersistentSession(pool!, config, f.auth, f.proof).catch(error => ({ error }));
      }
      await waitForBlockedTransaction(gate.holderPid());
      gate.release();
      const [enrolled, ended] = await Promise.all([enrollment, logout]);
      expect(ended).toEqual({ revoked: true });
      if (first === "enroll") {
        expect(await accepted((enrolled as { access_token: string }).access_token)).toBe(false);
      } else {
        expect(enrolled).toMatchObject({ error: { code: "DESKTOP_SESSION_REVOKED" } });
        expect((await pool!.query("SELECT 1 FROM desktop_persistent_session_credentials WHERE session_id=$1", [f.sessionId])).rowCount).toBe(0);
      }
      await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
    } finally { gate.release(); await Promise.allSettled([enrollment, logout]); }
  }, 12_000);

  it("rejects wrong original proof, other sessions, Web grants and origins without reporting revocation", async () => {
    const f = await fixture();
    const proof = { ...f.proof, session_id: f.sessionId, original_access_token: f.mac.access_token };
    for (const wrong of [
      { ...proof, original_access_token: secret() },
      { ...proof, session_id: f.browser.sessionId },
      { ...proof, session_id: f.browser.sessionId, original_access_token: f.browserToken },
      { ...proof, web_origin: "https://other.test" },
    ]) {
      await expect(revokeDesktopPersistentSession(pool!, { ...config, allowedOrigins: [...config.allowedOrigins, "https://other.test"] }, wrong))
        .rejects.toMatchObject({ code: "DESKTOP_SESSION_PROOF_INVALID" });
    }
    await expect(revokeDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_PROOF_INVALID" });
    expect((await pool!.query("SELECT revoked_at FROM sessions WHERE id=$1", [f.sessionId])).rows[0].revoked_at).toBeNull();
  });

  it("accepts an expired previous Mac access only for destructive revoke", async () => {
    const f = await fixture();
    await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    await pool!.query("UPDATE sessions SET previous_token_expires_at=now()-interval '1 day' WHERE id=$1", [f.sessionId]);
    await expect(revokeDesktopPersistentSession(pool!, config, { ...f.proof, device_secret: secret(), session_id: f.sessionId,
      original_access_token: f.mac.access_token })).resolves.toEqual({ revoked: true });
    await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
  });

  it("the production route schemas reject original bearer proof on enrollment and renewal", async () => {
    const f = await fixture(), app = Fastify();
    app.setErrorHandler((error, request, reply) => reply.code(error instanceof ApiError ? error.statusCode : 500).send({
      error: { code: error instanceof ApiError ? error.code : "UNKNOWN", message: "Synthetic failure", request_id: request.id },
    }));
    registerDesktopPersistentSession(app, pool!, config, createAuthGuard(pool!));
    try {
      for (const action of ["enroll", "renew"]) {
        const payload = action === "enroll" ? { device_secret: f.proof.device_secret, web_origin: f.proof.web_origin }
          : f.proof;
        const response = await app.inject({ method: "POST", url: "/v1/desktop-persistent-session/" + action,
          headers: { authorization: `Bearer ${f.mac.access_token}` }, payload: { ...payload, original_access_token: f.mac.access_token } });
        expect(response.statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });

  it.each(["disable", "retire", "delete"] as const)("does not revive a device after %s", async action => {
    const f = await fixture();
    const enrolled = await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    if (action === "disable") await pool!.query("UPDATE users SET status='revoked' WHERE id=$1", [f.auth.userId]);
    if (action === "retire") await pool!.query("UPDATE accounts SET retired_at=now() WHERE id=$1", [f.auth.accountId]);
    if (action === "delete") await pool!.query("DELETE FROM sessions WHERE id=$1", [f.sessionId]);
    expect(await accepted(enrolled.access_token)).toBe(false);
    await expect(renewDesktopPersistentSession(pool!, config, f.proof)).rejects.toMatchObject({ code: "DESKTOP_SESSION_REVOKED" });
  });

  it("rejects a different allowed origin, wrong identity and deployment audience without changing the credential", async () => {
    const f = await fixture();
    await enrollDesktopPersistentSession(pool!, config, f.auth, f.proof);
    await expect(renewDesktopPersistentSession(pool!, { ...config, allowedOrigins: [...config.allowedOrigins, "https://other.test"] },
      { ...f.proof, web_origin: "https://other.test" })).rejects.toMatchObject({ statusCode: 401 });
    await expect(renewDesktopPersistentSession(pool!, config, { ...f.proof, account_id: randomUUID() }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(renewDesktopPersistentSession(pool!, config, f.proof, [randomUUID()]))
      .rejects.toMatchObject({ code: "DEPLOYMENT_WORKSPACE_NOT_ADMITTED" });
    const recovered = await renewDesktopPersistentSession(pool!, config, f.proof);
    expect(recovered.session_id).toBe(f.sessionId);
  });
});
