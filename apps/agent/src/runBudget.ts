import { AGENT_BUDGET_CEILING } from "./runtimePolicy.js";
import type { AgentBudget, AgentProviderResult, AgentUsage } from "./types.js";

export type AgentBudgetViolation = "positive" | "ceiling";

export interface AgentBudgetViolationDetail {
  field: keyof AgentBudget;
  violation: AgentBudgetViolation;
}

/** Keep shared budget mechanics here while each runner owns its public error. */
export function assertAgentBudget(
  budget: AgentBudget,
  onViolation: (detail: AgentBudgetViolationDetail) => never,
): void {
  for (const [field, value] of Object.entries(budget) as Array<
    [keyof AgentBudget, number]
  >) {
    if (!Number.isFinite(value) || value <= 0) {
      onViolation({ field, violation: "positive" });
    }
    if (value > AGENT_BUDGET_CEILING[field]) {
      onViolation({ field, violation: "ceiling" });
    }
  }
}

export function agentUsage(
  startedAtMs: number,
  toolCalls: number,
  provider: AgentProviderResult | null,
  nowMs: number,
): AgentUsage {
  const inputTokens = provider?.inputTokens ?? null;
  const outputTokens = provider?.outputTokens ?? null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: provider?.totalTokens !== undefined ? provider.totalTokens :
      inputTokens === null || outputTokens === null
        ? null
        : inputTokens + outputTokens,
    estimatedUsd: provider?.estimatedUsd ?? null,
    turns: provider?.turns ?? null,
    toolCalls,
    durationMs: Math.max(0, nowMs - startedAtMs),
  };
}

/** The ordering is part of the terminal reason-code contract. */
export function exceededBudget(
  value: AgentUsage,
  budget: AgentBudget,
): string | null {
  if (value.turns !== null && value.turns > budget.maxTurns) {
    return "MAX_TURNS_EXCEEDED";
  }
  if (value.toolCalls > budget.maxToolCalls) {
    return "MAX_TOOL_CALLS_EXCEEDED";
  }
  if (value.totalTokens !== null && value.totalTokens > budget.maxTaskTokens) {
    return "MAX_TASK_TOKENS_EXCEEDED";
  }
  if (
    value.estimatedUsd !== null &&
    value.estimatedUsd > budget.maxEstimatedUsd
  ) {
    return "MAX_COST_EXCEEDED";
  }
  if (value.durationMs > budget.maxDurationMs) {
    return "MAX_DURATION_EXCEEDED";
  }
  return null;
}
