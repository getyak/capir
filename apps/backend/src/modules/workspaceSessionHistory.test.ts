import { describe, expect, it, vi } from "vitest";
import { ScriptedAgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const earlierID = "10000000-0000-4000-8000-000000000001";
const currentID = "10000000-0000-4000-8000-000000000002";
const sessionID = "10000000-0000-4000-8000-000000000003";
const earlier = "Earlier synthetic choice: blue.";

describe("workspace history tool construction", () => {
  it("offers the real read capability while preserving bounded inline dialogue and current-message authority", async () => {
    const assertHistory = vi.fn(async () => {});
    const stage = vi.fn<WorkspaceMemoryLookup["stage"]>();
    const provider = new ScriptedAgentProvider([], { outcome: "reply", title: "Earlier choice", body: "You chose blue." });
    const originalRun = provider.run.bind(provider);
    let denial: AgentToolResult | undefined;
    vi.spyOn(provider, "run").mockImplementation(async (request, invoke, signal) => {
      expect(request.conversationHistory).toEqual([{ message_id: "recent", role: "assistant", text: "Recent bounded context" }]);
      const tool = request.supplementalTools?.find(candidate => candidate.name === "read_session_history");
      expect(tool).toBeDefined();
      const reply = await tool!.execute({ operation: "read", message_id: earlierID }, signal);
      expect((reply.content[0] as { text: string }).text).toContain(earlier);
      expect(request.systemPrompt).toContain("no match cannot establish semantic absence");
      // Reading an old user message must not make it a current authored source.
      denial = await invoke("memory_review", { operation: "propose", contact_decision: "none", items: [{
        scope: "self", operation: "add", statement_kind: "source_statement", display_text: "Blue is preferred",
        source_excerpt: earlier, source_locator: { kind: "message", session_id: sessionID, message_id: earlierID },
        time_status: "unknown", sensitivity: "normal", reason: "Earlier dialogue is not current authority",
      }] });
      return originalRun(request, invoke, signal);
    });
    await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", objective: "What did I choose earlier?",
      messageID: currentID, sessionID, provider, contacts: { search: vi.fn(), read: vi.fn() },
      memory: { recall: async () => ({ items: [] }), stage },
      conversationHistory: [{ message_id: "recent", role: "assistant", text: "Recent bounded context" }],
      sessionHistory: { messages: [{ message_id: earlierID, role: "user", text: earlier }], version: "canonical-1", assertCurrent: assertHistory },
    });
    expect(assertHistory).toHaveBeenCalledTimes(2);
    expect(denial).toMatchObject({ ok: false, error: { code: "MEMORY_SOURCE_UNGROUNDED" } });
    expect(stage).not.toHaveBeenCalled();
  });
});
