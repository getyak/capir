import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { mutateAccountSettings, readAccountSettings } from "./accountManagement.js";

/**
 * Two real accounts in one PostgreSQL database.
 *
 * Account settings are addressed by the verified session only: no request body
 * carries the account it acts on. This suite proves that at runtime by giving
 * account B's session ids and revisions that belong to account A and asserting
 * that nothing in A changes. A mock cannot prove this, because the failure it
 * guards against is a statement that drops the auth-derived account filter.
 */
const database = process.env.ACCOUNT_SETTINGS_TEST_DATABASE_URL;
const pool: Pool | null = database ? new PgPool({ connectionString: database }) : null;

type Seeded = { accountId: string; userId: string; sessionId: string; email: string; name: string; slug: string;
  auth: AuthContext; settingsRevision: number };

async function seedAccount(accountId: string, slug: string, user: string, email: string, name: string): Promise<Seeded> {
  const sessionId = randomUUID();
  // Real human identities require an owned email reservation, and that
  // reservation points back at the user, so both rows commit together in one
  // transaction (its foreign key is deferred).
  const client = await pool!.connect();
  try {
    await client.query("begin");
    await client.query("INSERT INTO accounts(id, slug, name) VALUES ($1, $2, $3)", [accountId, slug, `${name} workspace`]);
    await client.query(
      `INSERT INTO account_email_reservations(normalized_email, state, account_id, user_id)
       VALUES ($1, 'owned', $2, $3)`,
      [email, accountId, user],
    );
    await client.query(
      `INSERT INTO users(id, account_id, email, display_name, kind, account_role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'password_human', 'admin', now())`,
      [user, accountId, email, name],
    );
    await client.query(
      `INSERT INTO sessions(id, account_id, user_id, client_label, token_hash, expires_at)
       VALUES ($1, $2, $3, 'settings isolation test', $4, now() + interval '1 day')`,
      [sessionId, accountId, user, randomUUID()],
    );
    await client.query("UPDATE accounts SET owner_user_id=$2 WHERE id=$1", [accountId, user]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  const revision = (await pool!.query<{ settings_revision: number }>("SELECT settings_revision FROM accounts WHERE id=$1", [accountId])).rows[0]!.settings_revision;
  return {
    accountId, userId: user, sessionId, email, name, slug, settingsRevision: revision,
    auth: { accountId, accountSlug: slug, userId: user, userEmail: email, userKind: "password_human", sessionId },
  };
}

async function deleteAccount(seed: Seeded): Promise<void> {
  // Only the rows this suite creates, in dependency order. Other suites share
  // the database during a parallel run, so nothing here may truncate.
  await pool!.query("DELETE FROM account_access_events WHERE account_id=$1", [seed.accountId]);
  await pool!.query("DELETE FROM sessions WHERE account_id=$1", [seed.accountId]);
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [seed.accountId]);
  // accounts.owner_user_id references users, so ownership is released first, and
  // the email reservation references the user it was claimed by.
  await pool!.query("UPDATE accounts SET owner_user_id=NULL WHERE id=$1", [seed.accountId]);
  await pool!.query("DELETE FROM account_email_reservations WHERE normalized_email=$1", [seed.email]);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [seed.accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [seed.accountId]);
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected the call to be rejected, but it resolved.");
}

const suffix = randomUUID().slice(0, 8);
const accountPrefix = randomUUID().replace(/-/g, "");
const aliceAccount = `11111111-1111-4111-8111-${accountPrefix.slice(0, 12)}`;
const bobAccount = `22222222-2222-4222-8222-${accountPrefix.slice(12, 24)}`;
let alice: Seeded;
let bob: Seeded;

describe.skipIf(!pool)("account settings isolation (PostgreSQL)", () => {
  beforeAll(async () => {
    alice = await seedAccount(aliceAccount, `settings-alice-${accountPrefix.slice(0, 8)}`, randomUUID(), `alice-${suffix}@example.test`, "Alice");
    bob = await seedAccount(bobAccount, `settings-bob-${accountPrefix.slice(8, 16)}`, randomUUID(), `bob-${suffix}@example.test`, "Bob");
  });

  afterAll(async () => {
    if (!pool) return;
    for (const seed of [alice, bob]) await deleteAccount(seed);
    await pool.end();
  });

  it("reads only the authenticated account, and refuses a mixed account and session pair", async () => {
    const forAlice = await readAccountSettings(pool!, alice.auth, false);
    expect(forAlice.workspace.id).toBe(aliceAccount);
    expect(forAlice.user.id).toBe(alice.userId);
    expect(forAlice.user.email).toBe(`alice-${suffix}@example.test`);

    const forBob = await readAccountSettings(pool!, bob.auth, false);
    expect(forBob.workspace.id).toBe(bobAccount);
    expect(forBob.members.map(member => member.id)).toEqual([bob.userId]);

    // Alice's account with Bob's user and session is not a readable pair.
    const mixed = await rejection(readAccountSettings(pool!, { ...alice.auth, userId: bob.userId, sessionId: bob.sessionId, userEmail: bob.email }, false));
    expect([mixed.statusCode, mixed.code]).toEqual([401, "SESSION_INVALID"]);
  });

  it("keeps a profile save inside the authenticated account", async () => {
    const saved = await mutateAccountSettings(pool!, alice.auth, {
      id: randomUUID(), kind: "profile", expected_revision: alice.settingsRevision, name: "Alice Updated",
    }, false);
    expect(saved.user.display_name).toBe("Alice Updated");

    const bobAfter = await readAccountSettings(pool!, bob.auth, false);
    expect(bobAfter.user.display_name).toBe("Bob");
    const aliceRow = await pool!.query<{ display_name: string }>("SELECT display_name FROM users WHERE account_id=$1 AND id=$2", [aliceAccount, alice.userId]);
    expect(aliceRow.rows[0]!.display_name).toBe("Alice Updated");
  });

  it("cannot revoke another account's session named in the request body", async () => {
    const denied = await rejection(mutateAccountSettings(pool!, bob.auth, {
      id: randomUUID(), kind: "revoke_session", session_id: alice.sessionId,
    }, false));
    expect([denied.statusCode, denied.code]).toEqual([404, "SESSION_NOT_FOUND"]);

    const aliceSession = await pool!.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE account_id=$1 AND id=$2", [aliceAccount, alice.sessionId]);
    expect(aliceSession.rows[0]!.revoked_at).toBeNull();
    const audit = await pool!.query("SELECT 1 FROM account_access_events WHERE account_id=$1", [bobAccount]);
    expect(audit.rowCount).toBe(0);
  });

  it("cannot promote or transfer ownership to another account's user named in the request body", async () => {
    const promoted = await rejection(mutateAccountSettings(pool!, bob.auth, {
      id: randomUUID(), kind: "member", expected_revision: bob.settingsRevision, user_id: alice.userId, role: "admin", status: "active",
    }, false));
    expect([promoted.statusCode, promoted.code]).toEqual([404, "MEMBER_NOT_FOUND"]);

    const transferred = await rejection(mutateAccountSettings(pool!, bob.auth, {
      id: randomUUID(), kind: "transfer", expected_revision: bob.settingsRevision, user_id: alice.userId,
    }, false));
    expect([transferred.statusCode, transferred.code]).toEqual([404, "MEMBER_NOT_FOUND"]);

    const aliceRow = await pool!.query<{ account_role: string; status: string }>("SELECT account_role, status FROM users WHERE account_id=$1 AND id=$2", [aliceAccount, alice.userId]);
    expect(aliceRow.rows[0]).toEqual({ account_role: "admin", status: "active" });
    const owner = await pool!.query<{ owner_user_id: string }>("SELECT owner_user_id FROM accounts WHERE id=$1", [bobAccount]);
    expect(owner.rows[0]!.owner_user_id).toBe(bob.userId);
  });

  it("still lets each account manage itself after the refused attempts", async () => {
    const aliceSession = await pool!.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE account_id=$1 AND id=$2", [aliceAccount, alice.sessionId]);
    expect(aliceSession.rows[0]!.revoked_at).toBeNull();
    const renamed = await mutateAccountSettings(pool!, bob.auth, {
      id: randomUUID(), kind: "workspace", expected_revision: bob.settingsRevision, name: "Bob's Workspace",
    }, false);
    expect(renamed.workspace.name).toBe("Bob's Workspace");
    const aliceWorkspace = await pool!.query<{ name: string }>("SELECT name FROM accounts WHERE id=$1", [aliceAccount]);
    expect(aliceWorkspace.rows[0]!.name).toBe("Alice workspace");
  });
});
