import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendConfig } from "../config.js";
import type { AuthContext } from "./auth.js";
import {
  approveDesktopBrowserLogin,
  consumeDesktopBrowserLogin,
  pkceS256,
  postgresDesktopBrowserLoginDb,
  prepareDesktopBrowserLogin,
  readDesktopBrowserLoginStatus,
  type DesktopBrowserLoginDb,
} from "./desktopBrowserLogin.js";

// Explicit opt-in: never run against a resident or customer database.
const database = process.env.DESKTOP_BROWSER_LOGIN_TEST_DATABASE_URL;
if (database && !["localhost", "127.0.0.1"].includes(new URL(database).hostname)) {
  throw new Error("Desktop login proof requires an owned disposable loopback database.");
}
const pool = database ? new Pool({ connectionString: database, max: 6, statement_timeout: 5000 }) : null;
const accountId = randomUUID();
const userId = randomUUID();
const browserSessionId = randomUUID();
const email = `desktop-proof-${userId}@example.test`;
const auth: AuthContext = {
  accountId, userId, sessionId: browserSessionId,
  accountSlug: `desktop-proof-${accountId}`, userEmail: email, userKind: "password_human",
};
const config = {
  allowedOrigins: ["https://web.test"], sessionTtlSeconds: 28800,
} as BackendConfig;
const secret = () => randomBytes(32).toString("base64url");
const attempts: string[] = [];

async function grant(db: DesktopBrowserLoginDb) {
  const verifier = secret();
  const state = secret();
  const prepared = await prepareDesktopBrowserLogin(db, config, {
    protocol_version: 1, purpose: "macos-primary-login", web_origin: "https://web.test",
    state, challenge: pkceS256(verifier), cancel_secret: secret(),
  });
  attempts.push(prepared.attempt_id);
  const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, auth, { state, web_origin: "https://web.test" });
  expect(approved.code).toBeTruthy();
  return { attempt_id: prepared.attempt_id, code: approved.code!, verifier, state, web_origin: "https://web.test" };
}

describe.skipIf(!pool)("desktop browser login durable proof (PostgreSQL)", () => {
  beforeAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Disposable Mac login proof')", [accountId, auth.accountSlug]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)", [email, accountId, userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,account_role,email_verified_at) VALUES($1,$2,$3,'Disposable owner','password_human','admin',now())", [userId, accountId, email]);
      await client.query("UPDATE accounts SET owner_user_id=$2 WHERE id=$1", [accountId, userId]);
      await client.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'Disposable browser',now()+interval '1 hour')", [browserSessionId, accountId, userId, secret()]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM desktop_browser_login_attempts WHERE id=ANY($1::uuid[])", [attempts]);
    await pool.query("DELETE FROM account_access_events WHERE account_id=$1", [accountId]);
    await pool.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
    await pool.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]);
    await pool.query("UPDATE accounts SET owner_user_id=NULL WHERE id=$1", [accountId]);
    await pool.query("DELETE FROM account_email_reservations WHERE normalized_email=$1", [email]);
    await pool.query("DELETE FROM users WHERE account_id=$1", [accountId]);
    await pool.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    await pool.end();
  });

  it("serializes two real exchanges into exactly one correlated device session", async () => {
    const db = postgresDesktopBrowserLoginDb(pool!);
    const request = await grant(db);
    const before = (await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [accountId])).rowCount;
    const outcomes = await Promise.allSettled([
      consumeDesktopBrowserLogin(db, config, request), consumeDesktopBrowserLogin(db, config, request),
    ]);
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
    const rows = await pool!.query<{ device_session_id: string; state: string }>("SELECT state,device_session_id FROM desktop_browser_login_attempts WHERE id=$1", [request.attempt_id]);
    expect(rows.rows[0]!.state).toBe("consumed");
    expect((await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [accountId])).rowCount).toBe(before! + 1);
    const deviceSessionId = rows.rows[0]!.device_session_id;
    const status = await readDesktopBrowserLoginStatus(db, request.attempt_id, { ...auth, sessionId: deviceSessionId });
    expect(status.account_id).toBe(accountId);
    expect(status.user_id).toBe(userId);
    await expect(readDesktopBrowserLoginStatus(db, request.attempt_id, auth)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses an exchange racing a browser-session revocation that has already acquired its write lock", async () => {
    const base = postgresDesktopBrowserLoginDb(pool!);
    const request = await grant(base);
    const revoker = await pool!.connect();
    let queryStarted!: () => void;
    const started = new Promise<void>(resolve => { queryStarted = resolve; });
    let resumeQuery!: () => void;
    const resume = new Promise<void>(resolve => { resumeQuery = resolve; });
    let sessionReadFinished = false;
    let exchangePid = 0;
    const controlled: DesktopBrowserLoginDb = {
      query: base.query,
      transaction: run => base.transaction(async tx => {
        exchangePid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        return run({ query: async <R>(sql: string, params?: unknown[]) => {
          if (!/FROM sessions[\s\S]*revoked_at IS NULL/.test(sql)) return tx.query<R>(sql, params);
          const pending = tx.query<R>(sql, params);
          queryStarted();
          const result = await pending;
          sessionReadFinished = true;
          await resume;
          return result;
        } });
      }),
    };
    try {
      await revoker.query("BEGIN");
      // Same account-before-session lock ordering as the real revocation path.
      await revoker.query("SELECT id FROM accounts WHERE id=$1 FOR SHARE", [accountId]);
      await revoker.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [browserSessionId]);
      const exchange = consumeDesktopBrowserLogin(controlled, config, request);
      // Attach a rejection observer before awaiting the PostgreSQL barrier.
      const outcome = exchange.then(value => ({ value }), error => ({ error }));
      await started;
      const deadline = Date.now() + 3000;
      while (!sessionReadFinished) {
        const activity = await pool!.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [exchangePid]);
        if (activity.rows[0]?.wait_event_type === "Lock") break;
        if (Date.now() >= deadline) throw new Error("Exchange did not reach the database concurrency barrier.");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await revoker.query("COMMIT");
      resumeQuery();
      const result = await outcome;
      expect(result).toHaveProperty("error");
      expect((result as { error: unknown }).error).toMatchObject({ code: "DESKTOP_BROWSER_LOGIN_BROWSER_SESSION_GONE" });
      const attempt = (await pool!.query("SELECT state,device_session_id FROM desktop_browser_login_attempts WHERE id=$1", [request.attempt_id])).rows[0];
      expect(attempt).toMatchObject({ state: "approved", device_session_id: null });
    } finally {
      resumeQuery();
      await revoker.query("ROLLBACK");
      revoker.release();
      await pool!.query("UPDATE sessions SET revoked_at=NULL WHERE id=$1", [browserSessionId]);
    }
  });

  it("mints no session when the code expires while the exchange waits on write locks", async () => {
    const base = postgresDesktopBrowserLoginDb(pool!);
    // Deterministic injected clock: the exchange begins before code expiry
    // and the account/session lock wait outlives the sixty-second code window.
    let nowMs = Date.now();
    const clock = () => new Date(nowMs);
    const verifier = secret();
    const state = secret();
    const prepared = await prepareDesktopBrowserLogin(base, config, {
      protocol_version: 1, purpose: "macos-primary-login", web_origin: "https://web.test",
      state, challenge: pkceS256(verifier), cancel_secret: secret(),
    }, clock);
    attempts.push(prepared.attempt_id);
    // A second prepared grant must remain prepared throughout.
    const untouched = await prepareDesktopBrowserLogin(base, config, {
      protocol_version: 1, purpose: "macos-primary-login", web_origin: "https://web.test",
      state: secret(), challenge: pkceS256(secret()), cancel_secret: secret(),
    }, clock);
    attempts.push(untouched.attempt_id);
    const approved = await approveDesktopBrowserLogin(base, config, prepared.attempt_id, auth, {
      state, web_origin: "https://web.test",
    }, { now: clock });
    expect(approved.code).toBeTruthy();
    const request = {
      attempt_id: prepared.attempt_id, code: approved.code!, verifier, state,
      web_origin: "https://web.test",
    };
    const sessionsBefore = (await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [accountId])).rowCount;

    // Holder uses the account-before-session ordering of the real revocation
    // path and a benign session write lock that keeps the session LIVE.
    const holder = await pool!.connect();
    let queryStarted!: () => void;
    const started = new Promise<void>(resolve => { queryStarted = resolve; });
    let resumeQuery!: () => void;
    const resume = new Promise<void>(resolve => { resumeQuery = resolve; });
    let sessionReadFinished = false;
    let exchangePid = 0;
    const controlled: DesktopBrowserLoginDb = {
      query: base.query,
      transaction: run => base.transaction(async tx => {
        exchangePid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        return run({ query: async <R>(sql: string, params?: unknown[]) => {
          if (!/FROM sessions[\s\S]*revoked_at IS NULL/.test(sql)) return tx.query<R>(sql, params);
          const pending = tx.query<R>(sql, params);
          queryStarted();
          const result = await pending;
          sessionReadFinished = true;
          await resume;
          return result;
        } });
      }),
    };
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM accounts WHERE id=$1 FOR SHARE", [accountId]);
      await holder.query("UPDATE sessions SET client_label = client_label WHERE id=$1", [browserSessionId]);
      const exchange = consumeDesktopBrowserLogin(controlled, config, request, { now: clock });
      const outcome = exchange.then(value => ({ value }), error => ({ error }));
      await started;
      const deadline = Date.now() + 3000;
      while (!sessionReadFinished) {
        const activity = await pool!.query<{ wait_event_type: string | null }>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [exchangePid]);
        if (activity.rows[0]?.wait_event_type === "Lock") break;
        if (Date.now() >= deadline) throw new Error("Exchange did not reach the database concurrency barrier.");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // The code window closes while the exchange still waits on the lock.
      nowMs += 61_000;
      await holder.query("COMMIT");
      resumeQuery();
      const result = await outcome;
      expect(result).toHaveProperty("error");
      expect((result as { error: unknown }).error).toMatchObject({ code: "DESKTOP_BROWSER_LOGIN_CODE_EXPIRED" });
      // No device session minted; both grants remain exactly as they were.
      expect((await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [accountId])).rowCount).toBe(sessionsBefore);
      const attempt = (await pool!.query(
        "SELECT state,device_session_id,consumed_at FROM desktop_browser_login_attempts WHERE id=$1",
        [prepared.attempt_id])).rows[0];
      expect(attempt).toMatchObject({ state: "approved", device_session_id: null, consumed_at: null });
      const untouchedRow = (await pool!.query(
        "SELECT state FROM desktop_browser_login_attempts WHERE id=$1",
        [untouched.attempt_id])).rows[0];
      expect(untouchedRow).toMatchObject({ state: "prepared" });
    } finally {
      resumeQuery();
      await holder.query("ROLLBACK");
      holder.release();
    }
  });
});
