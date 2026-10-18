import { describe, expect, it } from "vitest";
import {
  claudeToolDiscoveryDecision,
  ToolSearchInputSchema,
  TOOL_SEARCH_NAME,
  type ClaudeToolDiscoveryMode,
} from "./claudeToolContextPolicy.js";

describe("bounded tool discovery policy", () => {
  it("admits only an explicit bounded opt-in without child manifests", () => {
    expect(claudeToolDiscoveryDecision(undefined, 0)).toBe("legacy");
    expect(claudeToolDiscoveryDecision(undefined, 2)).toBe("legacy");
    expect(claudeToolDiscoveryDecision("bounded", 0)).toBe("admitted");
  });

  it("rejects every opt-in whose scoped discovery cannot be proven", () => {
    for (const subagentCount of [1, 2, 50]) {
      expect(claudeToolDiscoveryDecision("bounded", subagentCount)).toBe("rejected");
    }
  });

  it("pins the native discovery name outside the product namespace", () => {
    expect(TOOL_SEARCH_NAME).toBe("ToolSearch");
    expect(TOOL_SEARCH_NAME.startsWith("mcp__talent_signal__")).toBe(false);
  });

  it("accepts only bounded supported query forms", () => {
    for (const input of [
      { query: "select:memory_review" },
      { query: "contact memory review" },
      { query: "+slack send" },
      { query: "x".repeat(4_000), max_results: 50 },
      { query: "memory", max_results: 1 },
    ]) {
      expect(ToolSearchInputSchema.safeParse(input).success).toBe(true);
    }
  });

  it("denies empty, oversized, hostile and unknown-field discovery input", () => {
    for (const input of [
      {},
      { query: "" },
      { query: "x".repeat(4_001) },
      { query: "memory", max_results: 0 },
      { query: "memory", max_results: 51 },
      { query: "memory", max_results: 1.5 },
      { query: "memory", max_results: "10" },
      { query: "memory", exfiltrate: "PRIVATE_KEY" },
      { query: "memory", max_results: 10, extra: true },
    ]) {
      expect(ToolSearchInputSchema.safeParse(input).success).toBe(false);
    }
    // Unknown keys are rejected before any value could reach diagnostics.
    const denied = ToolSearchInputSchema.safeParse({ query: "memory", exfiltrate: "PRIVATE_KEY" });
    expect(denied.success).toBe(false);
  });

  it("keeps the opt-in surface a single closed mode", () => {
    const modes: ClaudeToolDiscoveryMode[] = ["bounded"];
    expect(modes).toHaveLength(1);
    expect(claudeToolDiscoveryDecision("bounded" as ClaudeToolDiscoveryMode, 0)).toBe("admitted");
  });
});
