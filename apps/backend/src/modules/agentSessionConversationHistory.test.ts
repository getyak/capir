import { describe, expect, it, vi } from "vitest";
import { readAgentSessionConversation } from "./agentSessions.js";
import type { AuthContext } from "./auth.js";
import type { DatabaseClient } from "../database/pool.js";

const auth = { accountId: "account-one", userId: "actor-one" } as AuthContext;
function database(options: { owner?: string; expired?: boolean; turnCount?: number; resultBytes?: number } = {}) {
  const turns = Array.from({ length: options.turnCount ?? 9 }, (_, index) => ({
    id: `message-${index}`, objective: `Choice ${index} ` + "中😀".repeat(1_100),
    response: { taskID: `task-${index}`, execution: {},
      unboundConversationBlocks: [{ kind: "answer", body: `Answer ${index} ` + "文😀".repeat(1_100) }] },
  }));
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT *") && sql.includes("FROM agent_sessions")) return { rows: [{
      created_by_user_id: options.owner ?? auth.userId, deleted_at: null,
      history_stamp: "synthetic-stamp", history_generation: "1",
      expires_at: new Date(Date.now() + (options.expired ? -1 : 60_000)), payload: { turns },
    }] };
    if (sql.includes("AS history_result_rows")) return { rows: [{ history_result_rows: "0",
      history_result_bytes: String(options.resultBytes ?? 0), responses: options.resultBytes ? null : [] }] };
    if (sql.includes("AS history_source_task")) return { rows: turns.map(turn => ({ history_source_task: turn.response.taskID,
      available: true, screenshot_task_id: null, source_fingerprint: null })) };
    if (sql.includes("agent_session_chat_sources_available")) return { rows: [{ available: true }] };
    return { rows: [] };
  });
  return { client: { query } as unknown as DatabaseClient, turns };
}

describe("canonical complete dialogue projection", () => {
  it("preserves default inline bounds while making early/long canonical text available on demand", async () => {
    const { client, turns } = database();
    const inline = await readAgentSessionConversation(client, auth, "session", { personId: null, relationshipContextId: null });
    expect(inline.messages.some(message => message.message_id === "message-0")).toBe(false);
    expect(inline.messages.reduce((size, message) => size + message.text.length, 0)).toBeLessThanOrEqual(12_000);
    expect(inline.messages.every(message => message.text.length <= 2_000)).toBe(true);
    const complete = await readAgentSessionConversation(client, auth, "session", { personId: null, relationshipContextId: null }, { complete: true });
    expect(complete.messages).toHaveLength(18);
    expect(complete.messages[0]).toMatchObject({ message_id: "message-0", text: turns[0]!.objective });
    expect(complete.messages[1]!.text).toBe(turns[0]!.response.unboundConversationBlocks[0]!.body);
  });
  it("does not let complete projection bypass owner or retention", async () => {
    for (const options of [{ owner: "foreign-actor" }, { expired: true }]) {
      await expect(readAgentSessionConversation(database(options).client, auth, "session",
        { personId: null, relationshipContextId: null }, { complete: true })).rejects.toThrow();
    }
  });
  it("declines an oversized host snapshot instead of silently clipping or loading its result bodies", async () => {
    for (const options of [{ turnCount: 201 }, { resultBytes: 1_048_577 }]) {
      await expect(readAgentSessionConversation(database(options).client, auth, "session",
        { personId: null, relationshipContextId: null }, { complete: true }))
        .rejects.toMatchObject({ code: "SESSION_HISTORY_SNAPSHOT_UNAVAILABLE" });
    }
  });
});
