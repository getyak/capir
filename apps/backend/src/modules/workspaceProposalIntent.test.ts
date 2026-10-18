import { describe, expect, it, vi } from "vitest";
import { ClaudeChatProvider, ScriptedAgentProvider, claudeHarnessConfiguration } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore } from "./workspaceConversationAgent.js";

const messageID = "10000000-0000-4000-8000-000000000001";
const contact = { search: async () => [], read: vi.fn() };
const proposals = [
  { operation: "propose_call", connection_id: messageID, arguments: "{}", tool_name: "lookup", purpose: "Synthetic lookup" },
  { operation: "propose_choice", options: JSON.stringify([{ id: "one", label: "One" }, { id: "two", label: "Two" }]), purpose: "Synthetic choice" },
  { operation: "propose_add", auth_mode: "anonymous", friendly_name: "Synthetic server", server_url: "https://example.invalid/mcp", purpose: "Synthetic connection" },
];

describe("host no-action applies to every operation proposal", () => {
  it.each(proposals)("does not dispatch $operation when the user asks for no_action", async input => {
    const handle = vi.fn(async () => ({ ok: true, data: {} }));
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: "no_action; explain the available options", contacts: contact, mcpConnections: { handle },
      provider: new ScriptedAgentProvider([{ tool: "mcp_connections", input }],
        { outcome: "reply", title: "Options", body: "The options can be compared without preparing a change." }) });
    expect(result.block.body).toContain("compared");
    expect(result.block.mcp_interaction).toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
  });

  it("keeps read-only connector discovery available for the answer", async () => {
    const handle = vi.fn(async () => ({ ok: true, data: { connections: [] } }));
    await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: "no_action; list the available connections", contacts: contact, mcpConnections: { handle },
      provider: new ScriptedAgentProvider([{ tool: "mcp_connections", input: { operation: "list" } }],
        { outcome: "reply", title: "Connections", body: "No connections are configured." }) });
    expect(handle).toHaveBeenCalledOnce();
  });

  it("passes the host refusal into the actual calendar tool adapter", async () => {
    const configuration = claudeHarnessConfiguration({ ANTHROPIC_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_MODEL: "synthetic" });
    const provider = new ClaudeChatProvider(configuration, async (_configuration, request) => {
      const tool = request.tools.find(tool => tool.name === "stage_calendar_draft")!;
      const receipt = await tool.execute({ title: "Synthetic meeting", starts_at: "2026-09-10T15:00:00+08:00",
        ends_at: "2026-09-10T15:30:00+08:00", time_zone: "Asia/Shanghai", source_excerpt: "Tomorrow at 3pm for 30 minutes" }, new AbortController().signal);
      expect(receipt.isError).toBe(true);
      return { text: "The time can be explained without a calendar proposal.", structuredOutput: null,
        sessionID: "synthetic", inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, toolCalls: 1,
        toolCompletions: [], terminalReason: "completed", permissionDenials: [], reportedModels: ["synthetic"] };
    });
    const result = await executeWorkspaceConversationAgentCore({ workspaceID: "synthetic", messageID,
      objective: "Tomorrow at 3pm for 30 minutes. no_action", provider, contacts: contact,
      calendarContext: { sourceRequestID: messageID, referenceTime: "2026-09-09T02:00:00Z", timeZone: "Asia/Shanghai" } });
    expect(result.providerResult.calendarDraft).toBeUndefined();
  });
});
