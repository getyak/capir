import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "./auth.js";
import { mutateAccountSettings, readAccountSettings } from "./accountManagement.js";
import { readAgentPreference, saveAgentPreference } from "./agentPreferences.js";

/**
 * The two user-owned language preferences (docs/internationalization.md).
 *
 * Both are presentation-only settings with revision semantics: display
 * language lives in account settings, prompt-output language in the agent
 * preference store. Neither value may appear in the audit trail, and a test
 * account may set its own presentation language while still being read-only
 * for access management.
 */
const database =
  process.env.ACCOUNT_SETTINGS_TEST_DATABASE_URL ?? process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database && !["localhost", "127.0.0.1"].includes(new URL(database).hostname)) {
  throw new Error("Use an owned disposable loopback database.");
}
const pool: Pool | null = database ? new PgPool({ connectionString: database, max: 2 }) : null;

const slug = `language-prefs-${randomUUID()}`;
const human: AuthContext = {
  accountId: randomUUID(), accountSlug: slug, userId: randomUUID(),
  userEmail: `language-human-${randomUUID()}@example.test`, userKind: "password_human", sessionId: randomUUID(),
};
const labUser: AuthContext = {
  ...human, userId: randomUUID(), userEmail: `language-lab-${randomUUID()}@example.test`,
  userKind: "lab_human", sessionId: randomUUID(),
};

async function seedUser(user: AuthContext): Promise<void> {
  const client = await pool!.connect();
  try {
    await client.query("begin");
    if (user.userKind === "password_human") {
      await client.query(
        `INSERT INTO account_email_reservations(normalized_email, state, account_id, user_id)
         VALUES ($1, 'owned', $2, $3)`, [user.userEmail, user.accountId, user.userId]);
    }
    await client.query(
      `INSERT INTO users(id, account_id, email, display_name, kind, account_role, email_verified_at)
       VALUES ($1, $2, $3, 'Language owner', $4, 'admin', now())`,
      [user.userId, user.accountId, user.userEmail, user.userKind]);
    await client.query(
      `INSERT INTO sessions(id, account_id, user_id, client_label, token_hash, expires_at)
       VALUES ($1, $2, $3, 'language preference test', $4, now() + interval '1 day')`,
      [user.sessionId, user.accountId, user.userId, randomUUID()]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  if (!pool) return;
  await pool.query("INSERT INTO accounts(id, slug, name) VALUES ($1, $2, 'Language prefs workspace')",
    [human.accountId, slug]);
  await seedUser(human);
  await seedUser(labUser);
}, 30_000);
afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)("user-owned display language", () => {
  it("defaults to follow-system and persists an explicit locale with revisions", async () => {
    const fresh = await readAccountSettings(pool!, human, false);
    expect(fresh.preferences?.display_language ?? "system").toBe("system");

    const saved = await mutateAccountSettings(pool!, human, {
      id: randomUUID(), kind: "preferences", expected_revision: fresh.user.revision, display_language: "zh-TW",
    }, false);
    expect(saved.preferences?.display_language).toBe("zh-TW");
    expect(saved.user.revision).toBe(fresh.user.revision + 1);

    const reloaded = await readAccountSettings(pool!, human, false);
    expect(reloaded.preferences?.display_language).toBe("zh-TW");
  });

  it("rejects a stale revision before writing anything", async () => {
    const current = await readAccountSettings(pool!, human, false);
    await expect(mutateAccountSettings(pool!, human, {
      id: randomUUID(), kind: "preferences", expected_revision: current.user.revision - 1, display_language: "ja",
    }, false)).rejects.toMatchObject({ code: "ACCOUNT_STALE" });
    expect((await readAccountSettings(pool!, human, false)).preferences?.display_language).toBe("zh-TW");
  });

  it("replays one operation id without bumping the revision twice", async () => {
    const current = await readAccountSettings(pool!, human, false);
    const operation = randomUUID();
    const input = { id: operation, kind: "preferences" as const, expected_revision: current.user.revision, display_language: "ko" as const };
    const saved = await mutateAccountSettings(pool!, human, input, false);
    const replay = await mutateAccountSettings(pool!, human, input, false);
    expect(replay.user.revision).toBe(saved.user.revision);
    expect(replay.preferences?.display_language).toBe("ko");
  });

  it("never records the language value in the audit trail", async () => {
    const rows = await pool!.query<{ details: unknown }>(
      "SELECT details FROM account_access_events WHERE account_id=$1 AND kind='preferences'", [human.accountId]);
    expect(rows.rowCount).toBeGreaterThan(0);
    for (const row of rows.rows) expect(JSON.stringify(row.details)).not.toMatch(/ko|zh-TW|ja/);
  });

  it("lets a test account set its presentation language while access stays read-only", async () => {
    const before = await readAccountSettings(pool!, labUser, true);
    const saved = await mutateAccountSettings(pool!, labUser, {
      id: randomUUID(), kind: "preferences", expected_revision: before.user.revision, display_language: "ja",
    }, true);
    expect(saved.preferences?.display_language).toBe("ja");
    await expect(mutateAccountSettings(pool!, labUser, {
      id: randomUUID(), kind: "profile", expected_revision: saved.user.revision, name: "Renamed",
    }, true)).rejects.toMatchObject({ code: "TEST_ACCOUNT_READ_ONLY" });
  });
});

describe.skipIf(!pool)("user-owned prompt-output language", () => {
  it("persists the generated-output language separately from display language", async () => {
    const initial = await readAgentPreference(pool!, labUser);
    expect(initial.preference.prompt_output_language ?? "system").toBe("system");

    const saved = await saveAgentPreference(pool!, labUser, {
      idempotency_key: randomUUID(), expected_revision: initial.preference.revision,
      response_style: "default", prompt_output_language: "ja",
    });
    expect(saved.preference.prompt_output_language).toBe("ja");
    const reloaded = await readAgentPreference(pool!, labUser);
    expect(reloaded.preference.prompt_output_language).toBe("ja");

    const reset = await saveAgentPreference(pool!, labUser, {
      idempotency_key: randomUUID(), expected_revision: saved.preference.revision,
      response_style: "default",
    });
    expect(reset.preference.prompt_output_language ?? "system").toBe("system");
  });
});
