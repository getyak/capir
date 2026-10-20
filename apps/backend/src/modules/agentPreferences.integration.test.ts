import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAgentResponsePreference, readAgentPreference, saveAgentPreference } from "./agentPreferences.js";
import { createHarnessSourceGuard } from "./harnessSourceGuard.js";
import { createHarnessContinuationFactory } from "./harnessSessions.js";
import { mutateAgentSession } from "./agentSessions.js";
import { inTransaction } from "../database/pool.js";
import type { AuthContext } from "./auth.js";

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 2 }) : null;
const auth: AuthContext = { accountId: randomUUID(), accountSlug: `preferences-${randomUUID()}`, userId: randomUUID(),
  userEmail: "preferences@synthetic.local", userKind: "simulated_human", sessionId: randomUUID() };
const second = { ...auth, userId: randomUUID(), userEmail: "second@synthetic.local" };
beforeAll(async () => {
  if (!pool) return;
  await pool.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic preferences')", [auth.accountId, auth.accountSlug]);
  for (const user of [auth, second]) await pool.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner','simulated_human')", [user.userId, user.accountId, user.userEmail]);
}, 30_000);
afterAll(async () => { await pool?.end(); });

describe.skipIf(!pool)("user-owned response preference", () => {
  it("erases a resumable SDK checkpoint when only the output-language pin changes", async () => {
    const owner = second;
    const initial = await readAgentPreference(pool!, owner);
    const pinned = await saveAgentPreference(pool!, owner, {
      idempotency_key: randomUUID(), expected_revision: initial.preference.revision,
      response_style: "default", prompt_output_language: "ja",
    });
    const id = randomUUID();
    await mutateAgentSession(pool!, owner, id, { expected_revision: 0, idempotency_key: randomUUID(), payload: {
      id, scopeKind: "unresolved_intent", personDisplayLabel: "New session", contextDisplayLabel: "Conversation", title: "Language pin check",
      updatedAt: new Date().toISOString(), isUnread: false, turns: [],
    } });
    let sdkSessionID: string;
    await inTransaction(pool!, async client => {
      const lease = await createHarnessContinuationFactory(client, pool!, owner, id, { kind: "workspace_conversation" },
        () => ({ expiresAt: new Date(Date.now() + 86_400_000), personIDs: [] }))("b".repeat(64));
      sdkSessionID = lease.sessionID;
      expect(lease.resume).toBe(false);
      await lease.store.append({ projectKey: "synthetic", sessionId: lease.sessionID }, [{ type: "user", uuid: randomUUID(), message: "Synthetic previous turn" }]);
      await lease.finish(true);
    });
    await inTransaction(pool!, async client => {
      const lease = await createHarnessContinuationFactory(client, pool!, owner, id, { kind: "workspace_conversation" },
        () => ({ expiresAt: new Date(Date.now() + 86_400_000), personIDs: [] }))("b".repeat(64));
      expect(lease.resume).toBe(true);
      expect(lease.sessionID).toBe(sdkSessionID!);
      await lease.finish(true);
    });
    const guard = await createHarnessSourceGuard(pool!, owner, id, () => undefined);
    await saveAgentPreference(pool!, owner, { idempotency_key: randomUUID(), expected_revision: pinned.preference.revision,
      response_style: "default", prompt_output_language: "ko" });
    await expect(guard()).rejects.toThrow("source context changed");
    expect((await pool!.query("SELECT count(*)::int AS count FROM harness_session_entries WHERE account_id=$1", [owner.accountId])).rows[0].count).toBe(0);
    // The language lives in host context rather than the configuration hash;
    // source-generation invalidation must prevent reuse even with that same hash.
    await inTransaction(pool!, async client => {
      const lease = await createHarnessContinuationFactory(client, pool!, owner, id, { kind: "workspace_conversation" },
        () => ({ expiresAt: new Date(Date.now() + 86_400_000), personIDs: [] }))("b".repeat(64));
      expect(lease.resume).toBe(false);
      expect(lease.sessionID).not.toBe(sdkSessionID!);
      await lease.finish(false);
    });
    expect(await loadAgentResponsePreference(pool!, owner)).toMatchObject({ responseStyle: "default", promptOutputLanguage: "ko" });
  });

  it("persists only the authenticated user's setting with revisions and exact retry semantics", async () => {
    expect((await readAgentPreference(pool!, auth)).preference).toMatchObject({ response_style: "default", revision: 0, provenance: null });
    const mutation = { idempotency_key: randomUUID(), expected_revision: 0, response_style: "conclusion_first" as const };
    const saved = await saveAgentPreference(pool!, auth, mutation);
    expect(saved.preference).toMatchObject({ response_style: "conclusion_first", revision: 1, provenance: { kind: "user_setting", user_id: auth.userId } });
    expect(await saveAgentPreference(pool!, auth, mutation)).toEqual(saved);
    expect((await readAgentPreference(pool!, second)).preference.response_style).toBe("default");
    expect(await loadAgentResponsePreference(pool!, auth)).toMatchObject({ responseStyle: "conclusion_first", sourceID: saved.preference.provenance!.source_id });
    await expect(saveAgentPreference(pool!, auth, { ...mutation, idempotency_key: randomUUID() })).rejects.toThrow("Read the current preference");
    const id = randomUUID();
    await mutateAgentSession(pool!, auth, id, { expected_revision: 0, idempotency_key: randomUUID(), payload: {
      id, scopeKind: "unresolved_intent", personDisplayLabel: "New session", contextDisplayLabel: "Conversation", title: "Preference check",
      updatedAt: new Date().toISOString(), isUnread: false, turns: [],
    } });
    await inTransaction(pool!, async client => {
      const lease = await createHarnessContinuationFactory(client, pool!, auth, id, { kind: "workspace_conversation" },
        () => ({ expiresAt: new Date(Date.now() + 86_400_000), personIDs: [] }))("a".repeat(64));
      await lease.store.append({ projectKey: "synthetic", sessionId: lease.sessionID }, [{ type: "user", uuid: randomUUID(), message: "Saved reply preference" }]);
      await lease.finish(true);
    });
    const guard = await createHarnessSourceGuard(pool!, auth, id, () => undefined);
    const reset = await saveAgentPreference(pool!, auth, { idempotency_key: randomUUID(), expected_revision: 1, response_style: "default" });
    expect(reset.preference).toMatchObject({ response_style: "default", revision: 2 });
    expect(await loadAgentResponsePreference(pool!, auth)).toBeUndefined();
    await expect(guard()).rejects.toThrow("source context changed");
    expect((await pool!.query("SELECT count(*)::int AS count FROM harness_session_entries WHERE account_id=$1", [auth.accountId])).rows[0].count).toBe(0);
    await expect(saveAgentPreference(pool!, auth, mutation)).rejects.toThrow("changed after that request");
  });
});
