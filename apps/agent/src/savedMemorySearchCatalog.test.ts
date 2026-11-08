import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import { SavedMemorySearchInputSchema, SavedMemorySearchToolInputSchema } from "./savedMemorySearchSchema.js";
import { AGENT_TOOL_CATALOG, agentCapabilityManifest, agentToolJsonSchema } from "./toolCatalog.js";
import { ALL_AGENT_TOOL_NAMES, PERSON_RESEARCH_AGENT_TOOL_NAMES, PURSUIT_AGENT_TOOL_NAMES,
  RESEARCH_AGENT_TOOL_NAMES, WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES, type AgentToolName } from "./types.js";

// Protocol registration only: the injected executor observes the real provider
// request without an SDK/provider call, host tool dispatch or authority grant.
async function registeredSurface(manifest: readonly AgentToolName[], json = false): Promise<ClaudeHarnessRequest> {
  let captured: ClaudeHarnessRequest | undefined;
  const configuration = claudeHarnessConfiguration({
    ANTHROPIC_API_KEY: "synthetic-protocol-fixture", TALENT_SIGNAL_AGENT_MODEL: "synthetic-model",
  });
  const provider = new ClaudeChatProvider(configuration, async (_configuration, request) => {
    captured = request;
    return { text: "Synthetic protocol observation.",
      structuredOutput: { outcome: "reply", title: "Synthetic", body: "No tool was invoked." },
      sessionID: "synthetic-protocol-session", inputTokens: 0, outputTokens: 0, estimatedUsd: 0,
      turns: 1, toolCalls: 0, toolCompletions: [], terminalReason: "completed", permissionDenials: [],
      reportedModels: ["synthetic-model"] };
  });
  await provider.run({ runID: "synthetic-protocol-run", objective: "Inspect the registered protocol.",
    systemPrompt: "Synthetic protocol fixture.", ...(json ? { outputMode: "json" as const } : {}),
    scopeSummary: { kind: "workspace_conversation", workspaceID: "synthetic-workspace", sessionID: null,
      currentPersonID: null, currentRelationshipContextID: null },
    toolManifest: manifest,
    budget: { maxTurns: 2, maxToolCalls: 2, maxTaskTokens: 12_000, maxEstimatedUsd: 1, maxDurationMs: 60_000 },
  }, async () => { throw new Error("This protocol observation must not dispatch a host tool."); }, new AbortController().signal);
  expect(captured).toBeDefined();
  return captured!;
}

describe("explicit saved Memory search protocol", () => {
  it("provides an actual object schema to both the catalog and JSON transport", () => {
    const tool = AGENT_TOOL_CATALOG.search_saved_memory;
    expect(tool.schema).toBe(SavedMemorySearchToolInputSchema);
    expect(tool.schema).toBeInstanceOf(z.ZodObject);
    expect(tool).toMatchObject({ readOnly: true, openWorld: false, capabilityClass: "scoped_read",
      consequence: "none", approval: "none", reversibility: "not_applicable", idempotency: "safe_read" });
    expect(agentToolJsonSchema("search_saved_memory")).toMatchObject({ type: "object", additionalProperties: false,
      properties: { terms: { type: "array", minItems: 1, maxItems: 8 }, limit: { default: 10 } } });
    expect(tool.schema.safeParse({ terms: ["literal"], person_id: "not-an-authority" }).success).toBe(false);
    for (const required of ["ANY", "partial", "semantic absence", "untrusted", "budgets"])
      expect(tool.description).toContain(required);
  });

  it("keeps the original host and transport Unicode and aggregate quotas", () => {
    const terms = [" a_%\\ ", "e\u0301", "é", "🪷".repeat(120)];
    expect(terms[3]).toHaveLength(240);
    for (const schema of [SavedMemorySearchInputSchema, SavedMemorySearchToolInputSchema]) {
      expect(schema.parse({ terms })).toEqual({ terms, limit: 10 });
      expect(schema.safeParse({ terms: ["🪷".repeat(121)] }).success).toBe(false);
      expect(schema.safeParse({ terms: Array(8).fill("🪷".repeat(120)) }).success).toBe(false);
    }
  });

  it("keeps the named inventory separate from every existing default manifest", () => {
    expect(ALL_AGENT_TOOL_NAMES).toContain("search_saved_memory");
    for (const manifest of [PURSUIT_AGENT_TOOL_NAMES, RESEARCH_AGENT_TOOL_NAMES,
      PERSON_RESEARCH_AGENT_TOOL_NAMES, WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES]) {
      expect(manifest).not.toContain("search_saved_memory");
      expect(agentCapabilityManifest(manifest).map(tool => tool.name)).not.toContain("search_saved_memory");
    }
    expect(WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES).toEqual(["contact_workspace", "memory_review", "mcp_connections"]);
  });

  it.each([false, true])("does not register search in the default SDK surface (JSON: %s)", async json => {
    const request = await registeredSurface(WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES, json);
    expect(request.tools.map(tool => tool.name)).not.toContain("search_saved_memory");
    expect(request.toolDiscovery).toBe(json ? undefined : "bounded");
  });

  it("registers search only when it is explicitly present in the provider request", async () => {
    const request = await registeredSurface([...WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES, "search_saved_memory"]);
    const search = request.tools.filter(tool => tool.name === "search_saved_memory");
    expect(search).toHaveLength(1);
    expect(search[0]?.schema).toBe(SavedMemorySearchToolInputSchema);
    expect(search[0]?.readOnly).toBe(true);
    expect(request.toolDiscovery).toBe("bounded");
  });
});
