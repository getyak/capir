import { z } from "zod";

/**
 * GET-128 bounded tool context: the pinned SDK's native discovery entry point.
 *
 * The harness registers this name only for an admitted opt-in Run, and only in
 * the explicit SDK tool list, so a third-party baseUrl cannot silently inflate
 * every tool schema. It never carries product completion authority.
 */
export const TOOL_SEARCH_NAME = "ToolSearch";

/**
 * Narrow opt-in policy for bounded native tool discovery.
 *
 * `"bounded"` defers this Run's registered non-essential MCP catalog tools
 * behind the pinned SDK's local ToolSearch over the registered Run-only
 * catalog. It is admitted only where scoped discovery can be proven: a Run
 * without subagent child manifests. Every other configuration keeps the
 * legacy eager tool context unchanged, and an unprovable opt-in request is
 * rejected outright rather than silently downgraded.
 */
export type ClaudeToolDiscoveryMode = "bounded";

export type ClaudeToolDiscoveryDecision = "legacy" | "admitted" | "rejected";

export function claudeToolDiscoveryDecision(
  toolDiscovery: ClaudeToolDiscoveryMode | undefined,
  subagentCount: number,
): ClaudeToolDiscoveryDecision {
  if (toolDiscovery === undefined) return "legacy";
  return toolDiscovery === "bounded" && subagentCount === 0 ? "admitted" : "rejected";
}

/**
 * Bounded supported ToolSearch input against the pinned CLI's actual contract:
 * `select:<name,...>`, keyword, or `+required` queries plus an optional result
 * cap. Unknown keys, empty or oversized queries and oversized result caps are
 * denied before any discovery runs.
 */
export const ToolSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(4_000),
  max_results: z.number().int().min(1).max(50).optional(),
});
