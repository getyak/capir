import { describe, expect, it, vi } from "vitest";
import { ScriptedAgentProvider } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const root = "10000000-0000-4000-8000-000000000001";
const update = "10000000-0000-4000-8000-000000000002";
const proposalID = "10000000-0000-4000-8000-000000000003";
const reply = { structuredOutput: { outcome: "reply", title: "分析", body: "继续解释原内容。" },
  inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
const steering = () => ({ nextBatchAtSafePoint: vi.fn(async () => ({ messages: [
  { messageID: update, acceptedAt: new Date().toISOString(), text: "no_action，不要保存，继续分析" },
]})) });

describe("later no-save steering withdraws pending proposals", () => {
  it("withdraws the exact staged Memory proposal before dropping its reference", async () => {
    const withdraw = vi.fn(async () => ({ proposalID, revision: 2, status: "withdrawn" as const }));
    const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => ({ proposalID, proposalRevision: 1,
      itemCount: 1, defaultSelectedCount: 0, scopeCounts: { self: 1, person: 0, relationship: 0 },
      contactStatus: "pending", personID: null, personDisplayLabel: null }));
    const provider = new ScriptedAgentProvider([], reply.structuredOutput);
    vi.spyOn(provider, "run").mockImplementation(async (request, invoke, signal) => {
      expect((await invoke("memory_review", { operation: "propose", contact_decision: "none", items: [{
        scope: "self", operation: "add", statement_kind: "source_statement", display_text: "先给结论",
        source_excerpt: "先给结论", source_locator: { kind: "message", session_id: null, message_id: root },
        time_status: "known", sensitivity: "normal", reason: "Explicit preference",
      }] })).ok).toBe(true);
      await request.steering!.nextBatchAtSafePoint();
      return reply;
    });
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "以后先给结论", provider, steering: steering(), contacts: { search: async () => [], read: vi.fn() },
      memory: { recall: async () => ({ items: [] }), stage, withdraw } });
    expect(withdraw).toHaveBeenCalledExactlyOnceWith({ proposalID, expectedRevision: 1, sourceMessageID: root });
    expect(result.memoryProposal).toBeNull();
    expect(result.block.body).toContain("继续解释");
  });

  it("withdraws every staged MCP request, not only the last visible card", async () => {
    const ids = [proposalID, "10000000-0000-4000-8000-000000000004"];
    const handle = vi.fn(async () => { const id = ids[handle.mock.calls.length - 1]!;
      return { ok: true, data: { request_id: id, call_id: id, kind: "choice", state: "pending" } }; });
    const withdrawPending = vi.fn(async () => ({ requests: ids.map(requestID => ({ requestID, revision: 2,
      state: "rejected" as const, status: "withdrawn" as const })) }));
    const provider = new ScriptedAgentProvider([], reply.structuredOutput);
    vi.spyOn(provider, "run").mockImplementation(async (request, invoke, signal) => {
      for (const n of [1, 2]) expect((await invoke("mcp_connections", { operation: "propose_choice",
        purpose: `Synthetic choice ${n}`, options: JSON.stringify([{ id: "a", label: "A" }, { id: "b", label: "B" }]) })).ok).toBe(true);
      await request.steering!.nextBatchAtSafePoint();
      return reply;
    });
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID: root,
      objective: "比较两组选择", provider, steering: steering(), contacts: { search: async () => [], read: vi.fn() },
      mcpConnections: { handle, withdrawPending } });
    expect(handle).toHaveBeenCalledTimes(2);
    expect(withdrawPending).toHaveBeenCalledOnce();
    expect(result.block.mcp_interaction).toBeUndefined();
  });
});
