import { describe, expect, it, vi } from "vitest";
import { ScriptedAgentProvider } from "@talent-signal/agent";
import { executeUnscopedChatTask } from "./unscopedChat.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";

const auth = { accountId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000002",
  sessionId: "10000000-0000-4000-8000-000000000003", userKind: "simulated_human" } as AuthContext;
const sessionID = "10000000-0000-4000-8000-000000000004";
const currentID = "10000000-0000-4000-8000-000000000005";
const earlierID = "10000000-0000-4000-8000-000000000006";
const longText = "An earlier authorized choice. " + "中😀".repeat(1_200);

describe("ordinary workspace production history entry", () => {
  it.each([{ overBudget: false, sourceCount: 0 }, { overBudget: true, sourceCount: 0 },
    { overBudget: false, sourceCount: 20 }, { overBudget: false, sourceCount: 21 }])(
    "admits only a persistable canonical dependency union: %j", async ({ overBudget, sourceCount }) => {
    const unavailable = overBudget || sourceCount > 20;
    const originalTaskExpiry = new Date(Date.now() + 30_000);
    const sourceID = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const sourceRows = Array.from({ length: sourceCount }, (_, index) => ({ id: sourceID(index), fingerprint: "a".repeat(64),
      expires_at: new Date(Date.now() + 60_000) }));
    const turns = Array.from({ length: Math.max(9, sourceCount + 6) }, (_, index) => ({ id: index === 0 ? earlierID : `message-${index}`,
      objective: index === 0 ? longText : `Synthetic message ${index}`,
      response: { taskID: `task-${index}`, execution: {}, unboundConversationBlocks: [{ kind: "answer", body: `Synthetic answer ${index}` }] } }));
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/iu.test(sql)) throw new Error("No writes allowed in this read-only synthetic entry");
      if (sql.includes("AS history_owner_current")) return { rows: [{ history_owner_current: true, history_tasks_current: true,
        history_sources_current: true, history_stamp_current: true, history_generation_current: true,
        expires_at: originalTaskExpiry, read_until: originalTaskExpiry, checked_at: new Date() }] };
      if (sql.includes("AS session_stamp")) return { rows: [{ generation: "1", session_stamp: "frozen-canonical-turns", current: true }] };
      if (sql.startsWith("SELECT *") && sql.includes("FROM agent_sessions")) return { rows: [{ created_by_user_id: auth.userId,
        history_stamp: "frozen-canonical-turns", history_generation: "1",
        deleted_at: null, expires_at: new Date(Date.now() + 60_000), payload: { turns } }] };
      if (sql.includes("SELECT expires_at FROM agent_sessions")) return { rows: [{ expires_at: new Date(Date.now() + 60_000) }] };
      if (sql.includes("FROM sessions")) return { rows: [{ current: true }] };
      if (sql.includes("AS history_result_rows")) return { rows: [{ history_result_rows: "0",
        history_result_bytes: overBudget ? "1048577" : "0", responses: overBudget ? null : [] }] };
      if (sql.includes("AS history_source_task")) return { rows: turns.map((turn, index) => ({ history_source_task: turn.response.taskID,
        available: true, screenshot_task_id: index < sourceCount ? sourceID(index) : null,
        source_fingerprint: index < sourceCount ? "a".repeat(64) : null })) };
      if (sql.includes("agent_session_chat_sources_available")) return { rows: [{ available: true }] };
      if (sql.includes("FROM agent_session_chat_sources")) {
        const index = Number(String(parameters?.[2]).replace("task-", ""));
        return { rows: index < sourceCount ? [{ screenshot_task_id: sourceID(index), source_fingerprint: "a".repeat(64) }] : [] };
      }
      if (sql.includes("FROM screenshot_contact_tasks")) {
        const ids = (parameters?.[2] ?? parameters?.[1] ?? []) as string[];
        return { rows: sourceRows.filter(source => ids.includes(source.id)) };
      }
      return { rows: [] };
    });
    const provider = Object.assign(new ScriptedAgentProvider([], { outcome: "reply", title: "Earlier choice",
      body: unavailable ? "Earlier history is unavailable for this run." : "Earlier choice recovered." }), {
      providerId: "claude-agent-sdk" as const, supportsImageInput: true, answer: vi.fn(),
    });
    const original = provider.run.bind(provider);
    const run = vi.spyOn(provider, "run").mockImplementation(async (request, invoke, signal) => {
      expect(request.conversationHistory?.some(message => message.message_id === earlierID)).toBe(false);
      expect(request.conversationHistory?.reduce((sum, message) => sum + message.text.length, 0)).toBeLessThanOrEqual(12_000);
      const tool = request.supplementalTools?.find(candidate => candidate.name === "read_session_history");
      if (unavailable) {
        expect(tool).toBeUndefined();
        expect(request.systemPrompt).toContain("Earlier canonical dialogue is unavailable");
      } else {
        expect(request.observation?.source_refs).toMatchObject({ expires_at: originalTaskExpiry.toISOString() });
        expect(tool).toBeDefined();
        const output = await tool!.execute({ operation: "read", message_id: earlierID }, signal);
        expect(JSON.parse((output.content[0] as { text: string }).text).message.text).toBe(longText);
      }
      return original(request, invoke, signal);
    });
    const result = await executeUnscopedChatTask({ request: { objective: "What did I choose earlier?", session_id: sessionID,
      message_id: currentID, idempotency_key: "synthetic-history-entry" }, auth,
      database: { query, release() {} } as unknown as DatabaseClient, provider: provider as RemoteChatAnswerProviding });
    expect(run).toHaveBeenCalledOnce();
    expect(result.remoteStatus).toBe("agent_completed");
    expect(result.conversationMessageIDs.includes(earlierID)).toBe(!unavailable);
    expect(result.previousTaskIDs.includes("task-0")).toBe(!unavailable);
    expect(result.conversationSources?.length ?? 0).toBe(unavailable ? 0 : sourceCount);
    const canonicalReads = query.mock.calls.flatMap(([sql], index) => sql.startsWith("SELECT *") && sql.includes("FROM agent_sessions") ? [index] : []);
    const firstLiveAuth = query.mock.calls.findIndex(([sql]) => sql.includes("FROM sessions"));
    expect(firstLiveAuth).toBeLessThan(canonicalReads[1]!);
  });
});
