import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { BackendConfig } from "../config.js";
import {
  approveDesktopBrowserLogin,
  cancelDesktopBrowserLogin,
  consumeDesktopBrowserLogin,
  newDesktopBrowserLoginSecrets,
  pkceS256,
  prepareDesktopBrowserLogin,
  postgresDesktopBrowserLoginDb,
  readDesktopBrowserLoginGrantResult,
  readDesktopBrowserLoginStatus,
} from "./desktopBrowserLogin.js";

/**
 * Real PostgreSQL integration for the browser-owned macOS primary login.
 * All data is synthetic; the SQL constraints, atomic consume and session
 * correlation run against the actual schema (086 + account identity fences).
 */

const database = process.env.DESKTOP_BROWSER_LOGIN_TEST_DATABASE_URL;
const pool = database ? new Pool({ connectionString: database }) : null;
const db = pool ? postgresDesktopBrowserLoginDb(pool) : null;
const RUN = randomUUID().slice(0, 8);
// Only rows created by this test are ever deleted in cleanup.
const synthetic: { attempts: string[]; accountId?: string; userId?: string; email?: string } = {
  attempts: [],
};

afterAll(async () => {
  if (pool && synthetic.accountId && synthetic.userId && synthetic.email) {
    await pool.query(
      `DELETE FROM desktop_browser_login_attempts WHERE id = ANY($1::uuid[])`,
      [synthetic.attempts],
    );
    await pool.query(`DELETE FROM account_access_events WHERE account_id = $1`, [synthetic.accountId]);
    await pool.query(`DELETE FROM sessions WHERE account_id = $1`, [synthetic.accountId]);
    await pool.query(`DELETE FROM harness_source_generations WHERE account_id = $1`, [synthetic.accountId]);
    await pool.query(`UPDATE accounts SET owner_user_id = NULL WHERE id = $1`, [synthetic.accountId]);
    await pool.query(`DELETE FROM account_email_reservations WHERE normalized_email = $1`, [synthetic.email]);
    await pool.query(`DELETE FROM users WHERE account_id = $1`, [synthetic.accountId]);
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [synthetic.accountId]);
  }
  await pool?.end();
});

const config: BackendConfig = {
  allowedOrigins: ["https://web.test"],
  appleSignInAudiences: ["com.talentsignal.app"],
  appleSignInEnabled: false,
  databaseUrl: database ?? "synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: true,
};

describe.skipIf(!pool)("desktop browser login (PostgreSQL)", () => {
  it("runs prepare → approve → consume → status with real constraints", async () => {
    const accountId = randomUUID();
    const userId = randomUUID();
    const browserSessionId = randomUUID();
    const email = `person-${RUN}@example.test`;
    Object.assign(synthetic, { accountId, userId, email });
    // One transaction so the deferred reservation/user foreign keys resolve
    // exactly like a real account creation.
    await pool!.query("BEGIN");
    await pool!.query(`INSERT INTO accounts(id, name, slug) VALUES ($1, $2, $3)`, [
      accountId, `Account ${RUN}`, `account-${RUN}-${accountId.slice(0, 8)}`,
    ]);
    await pool!.query(
      `INSERT INTO account_email_reservations(normalized_email, state, account_id, user_id)
       VALUES ($1, 'owned', $2, $3)`,
      [email, accountId, userId],
    );
    await pool!.query(
      `INSERT INTO users(id, account_id, account_role, kind, email, display_name, status, email_verified_at)
       VALUES ($1, $2, 'admin', 'password_human', $3, 'Real Person', 'active', now())`,
      [userId, accountId, email],
    );
    await pool!.query(`UPDATE accounts SET owner_user_id = $2 WHERE id = $1`, [accountId, userId]);
    await pool!.query("COMMIT");
    await pool!.query(
      `INSERT INTO sessions(id, account_id, user_id, token_hash, client_label, expires_at)
       VALUES ($1, $2, $3, $4, 'talent-signal-web', now() + interval '1 hour')`,
      [browserSessionId, accountId, userId, `browser-hash-${RUN}`],
    );
    const auth = {
      accountId, accountSlug: `account-${RUN}`, userId,
      userEmail: `person-${RUN}@example.test`, userKind: "password_human" as const,
      sessionId: browserSessionId,
    };
    const verifier = "v".repeat(43);
    const secrets = newDesktopBrowserLoginSecrets();
    const prepared = await prepareDesktopBrowserLogin(db!, config, {
      protocol_version: 1,
      purpose: "macos-primary-login",
      challenge: pkceS256(verifier),
      state: secrets.state,
      cancel_secret: secrets.cancelSecret,
      web_origin: "https://web.test",
    });
    synthetic.attempts.push(prepared.attempt_id);
    const approved = await approveDesktopBrowserLogin(db!, config, prepared.attempt_id, auth, {
      state: secrets.state,
      web_origin: "https://web.test",
    });
    expect(approved.code).not.toBeNull();
    const session = await consumeDesktopBrowserLogin(db!, config, {
      attempt_id: prepared.attempt_id,
      code: approved.code!,
      verifier,
      state: secrets.state,
      web_origin: "https://web.test",
    });
    expect(session.account.id).toBe(accountId);
    expect(session.user.id).toBe(userId);

    const status = await readDesktopBrowserLoginStatus(
      db!,
      prepared.attempt_id,
      { ...auth, sessionId: (await pool!.query<{ id: string }>(
        `SELECT id FROM sessions WHERE account_id = $1 AND client_label = 'talent-signal-macos'`,
        [accountId],
      )).rows[0]!.id },
    );
    expect(status).toMatchObject({ state: "consumed", account_id: accountId, user_id: userId });

    await expect(
      consumeDesktopBrowserLogin(db!, config, {
        attempt_id: prepared.attempt_id,
        code: approved.code!,
        verifier,
        state: secrets.state,
        web_origin: "https://web.test",
      }),
    ).rejects.toMatchObject({ code: "DESKTOP_BROWSER_LOGIN_GRANT_CONSUMED" });

    const result = await readDesktopBrowserLoginGrantResult(db!, prepared.attempt_id, {
      verifier,
    });
    expect(result).toMatchObject({ committed: true, account_id: accountId, user_id: userId });

    // A fresh grant can still be cancelled truthfully with its secret.
    const second = await prepareDesktopBrowserLogin(db!, config, {
      protocol_version: 1,
      purpose: "macos-primary-login",
      challenge: pkceS256(verifier),
      state: secrets.state,
      cancel_secret: secrets.cancelSecret,
      web_origin: "https://web.test",
    });
    synthetic.attempts.push(second.attempt_id);
    const cancelled = await cancelDesktopBrowserLogin(db!, second.attempt_id, {
      cancel_secret: secrets.cancelSecret,
    });
    expect(cancelled).toMatchObject({ state: "cancelled", cancellation_recorded: true });
  });
});
