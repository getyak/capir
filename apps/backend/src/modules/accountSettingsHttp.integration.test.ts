import { randomUUID } from "node:crypto";

import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

/**
 * The HTTP surface the Web settings page actually calls.
 *
 * `accountSettingsIsolation.integration.test.ts` proves the module boundary. This
 * proves the layer above it: two real Bearer sessions from `simulated-login`,
 * `GET`/`POST /v1/account/settings`, and a signed-out caller. Without the
 * session the endpoint must refuse, and with account B's session every answer
 * must be B's — including when the request body names A's session or A's user.
 *
 * Both accounts register with one deliberate and one real request each, because
 * the audit row is written in the same transaction as the change.
 */
const database = process.env.ACCOUNT_SETTINGS_TEST_DATABASE_URL;
if (database && !["localhost", "127.0.0.1"].includes(new URL(database).hostname)) {
  throw new Error("Use an owned disposable loopback database.");
}
const pool = database ? new Pool({ connectionString: database, max: 4 }) : null;

type Tenant = { accountId: string; accountSlug: string; ownerId: string; memberId: string; ownerEmail: string;
  memberEmail: string; token: string };

function tenant(label: string): Tenant {
  const accountId = randomUUID();
  return {
    accountId,
    accountSlug: `settings-http-${label}-${randomUUID()}`,
    ownerId: randomUUID(),
    memberId: randomUUID(),
    ownerEmail: `owner-${label}@example.test`,
    memberEmail: `member-${label}@example.test`,
    token: "",
  };
}

const alice = tenant("a");
const bob = tenant("b");
let app: Awaited<ReturnType<typeof buildApp>>;
let aliceSessionId: string;

describe.skipIf(!pool)("account settings over HTTP (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!pool || !database) return;
    for (const value of [alice, bob]) {
      await pool.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,$3)", [value.accountId, value.accountSlug, `${value.accountSlug} workspace`]);
      await pool.query(
        "INSERT INTO users(id,account_id,email,display_name,kind,account_role) VALUES($1,$2,$3,$4,'simulated_human','admin')",
        [value.ownerId, value.accountId, value.ownerEmail, "Owner"],
      );
      await pool.query(
        "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,$4,'simulated_human')",
        [value.memberId, value.accountId, value.memberEmail, "Member"],
      );
      await pool.query("UPDATE accounts SET owner_user_id=$2 WHERE id=$1", [value.accountId, value.ownerId]);
    }
    app = await buildApp({
      pool,
      config: {
        databaseUrl: database, host: "127.0.0.1", port: 0, allowedOrigins: [],
        appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: false,
        passwordRegistrationEnabled: false, simulatedAuthEnabled: true, internalLabEnabled: false,
        retentionSweepIntervalMs: 60000, sessionTtlSeconds: 3600,
      },
      remoteChatProvider: null,
      personResearchProvider: null,
    });
    for (const value of [alice, bob]) {
      const login = await app.inject({
        method: "POST", url: "/v1/auth/simulated-login",
        payload: { account_slug: value.accountSlug, user_email: value.ownerEmail, client_label: "settings-http" },
      });
      expect(login.statusCode, login.body).toBe(200);
      value.token = login.json().access_token;
    }
    const session = await pool.query<{ id: string }>("SELECT id FROM sessions WHERE account_id=$1 AND user_id=$2 AND revoked_at IS NULL", [alice.accountId, alice.ownerId]);
    aliceSessionId = session.rows[0]!.id;
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await app?.close();
    for (const value of [alice, bob]) {
      await pool.query("DELETE FROM account_access_events WHERE account_id=$1", [value.accountId]);
      await pool.query("DELETE FROM sessions WHERE account_id=$1", [value.accountId]);
      await pool.query("DELETE FROM harness_source_generations WHERE account_id=$1", [value.accountId]);
      await pool.query("UPDATE accounts SET owner_user_id=NULL WHERE id=$1", [value.accountId]);
      await pool.query("DELETE FROM users WHERE account_id=$1", [value.accountId]);
      await pool.query("DELETE FROM accounts WHERE id=$1", [value.accountId]);
    }
    await pool.end();
  });

  const get = (token?: string): Promise<LightMyRequestResponse> => app.inject({
    method: "GET", url: "/v1/account/settings",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const post = (token: string | undefined, body: object): Promise<LightMyRequestResponse> => app.inject({
    method: "POST", url: "/v1/account/settings", payload: body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  it("refuses a signed-out caller and never caches the answer", async () => {
    const signedOut = await get();
    expect(signedOut.statusCode).toBe(401);

    const signedIn = await get(alice.token);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.headers["cache-control"]).toBe("private, no-store");
  });

  it("answers each session with only its own account", async () => {
    const forAlice = (await get(alice.token)).json();
    const forBob = (await get(bob.token)).json();
    expect(forAlice.workspace.id).toBe(alice.accountId);
    expect(forAlice.user.email).toBe(alice.ownerEmail);
    expect(forAlice.members.map((member: { id: string }) => member.id).sort()).toEqual([alice.memberId, alice.ownerId].sort());

    expect(forBob.workspace.id).toBe(bob.accountId);
    expect(forBob.user.email).toBe(bob.ownerEmail);
    expect(forBob.members.map((member: { id: string }) => member.id).sort()).toEqual([bob.memberId, bob.ownerId].sort());
    expect(JSON.stringify(forBob)).not.toContain(alice.accountId);
    expect(JSON.stringify(forBob)).not.toContain(alice.ownerEmail);
  });

  it("writes a profile save to the authenticated account only, and refuses a stale revision", async () => {
    const before = (await get(alice.token)).json();
    const saved = await post(alice.token, {
      id: randomUUID(), kind: "profile", expected_revision: before.user.revision, name: "Alice Saved",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().user.display_name).toBe("Alice Saved");

    const stale = await post(alice.token, {
      id: randomUUID(), kind: "profile", expected_revision: before.user.revision, name: "Too Late",
    });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, "ACCOUNT_STALE"]);

    expect((await get(alice.token)).json().user.display_name).toBe("Alice Saved");
    expect((await get(bob.token)).json().user.display_name).toBe("Owner");
  });

  it("rejects a body that names another account's session or user", async () => {
    const revoked = await post(bob.token, { id: randomUUID(), kind: "revoke_session", session_id: aliceSessionId });
    expect([revoked.statusCode, revoked.json().error.code]).toEqual([404, "SESSION_NOT_FOUND"]);
    const stillActive = await pool!.query("SELECT 1 FROM sessions WHERE id=$1 AND revoked_at IS NULL", [aliceSessionId]);
    expect(stillActive.rowCount).toBe(1);

    const promoted = await post(bob.token, {
      id: randomUUID(), kind: "member", expected_revision: (await get(bob.token)).json().workspace.revision,
      user_id: alice.ownerId, role: "admin", status: "active",
    });
    expect([promoted.statusCode, promoted.json().error.code]).toEqual([404, "MEMBER_NOT_FOUND"]);
    const untouched = await pool!.query<{ account_role: string }>("SELECT account_role FROM users WHERE id=$1", [alice.ownerId]);
    expect(untouched.rows[0]!.account_role).toBe("admin");
    expect((await get(alice.token)).json().user.email).toBe(alice.ownerEmail);
  });

  it("still lets the owning session act on its own account after those refusals", async () => {
    const rename = await post(alice.token, {
      id: randomUUID(), kind: "workspace", expected_revision: (await get(alice.token)).json().workspace.revision,
      name: "Alice Renamed",
    });
    expect(rename.statusCode, rename.body).toBe(200);
    expect(rename.json().workspace.name).toBe("Alice Renamed");
    expect((await get(bob.token)).json().workspace.name).not.toBe("Alice Renamed");
  });
});
