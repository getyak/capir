import { describe, expect, it, vi } from "vitest";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";
import { createConversationHistoryTools } from "./conversationHistoryTools.js";

describe("history capability in the production SDK adapter", () => {
  it("registers the offered read-only tool without replacing inline dialogue or budget", async () => {
    const assertCurrent = vi.fn(async () => {});
    const history = createConversationHistoryTools({ version: "synthetic-canonical-version", assertCurrent,
      messages: [{ message_id: "earlier", role: "user", text: "Earlier synthetic choice: blue" }] });
    const execute = vi.fn(async (_configuration, request: ClaudeHarnessRequest) => {
      const tool = request.tools.find(candidate => candidate.name === "read_session_history");
      expect(tool?.readOnly).toBe(true);
      const result = await tool!.execute({ operation: "read", message_id: "earlier" }, new AbortController().signal);
      expect(JSON.parse((result.content[0] as { text: string }).text).message.text).toContain("blue");
      expect(request.budget.maxTaskTokens).toBe(12_000);
      return { text: "You chose blue.", structuredOutput: null, sessionID: "synthetic", inputTokens: 10,
        outputTokens: 10, estimatedUsd: 0, turns: 1, toolCalls: 1, toolCompletions: [],
        terminalReason: "completed" as const, permissionDenials: [], reportedModels: ["synthetic-model"] };
    });
    const provider = new ClaudeChatProvider(claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic",
      TALENT_SIGNAL_AGENT_MODEL: "synthetic-model" }), execute);
    await provider.run({ runID: "synthetic-run", objective: "What did I choose?", toolManifest: [],
      supplementalTools: history.tools, systemPrompt: history.instructions,
      conversationHistory: [{ message_id: "recent", role: "assistant", text: "Recent bounded dialogue" }],
      scopeSummary: { kind: "workspace_conversation", workspaceID: "synthetic", sessionID: null,
        currentPersonID: null, currentRelationshipContextID: null },
      budget: { maxTurns: 2, maxToolCalls: 2, maxTaskTokens: 12_000, maxEstimatedUsd: 1, maxDurationMs: 60_000 },
    }, vi.fn(), new AbortController().signal);
    expect(execute).toHaveBeenCalledOnce();
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  });
});
