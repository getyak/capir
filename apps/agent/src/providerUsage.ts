import type { AgentBudget } from "./types.js";

const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const cost = (value: unknown): number | null => {
  if (typeof value === "string") {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
};
const sum = (a: number | null, b: number | null, count = false): number | null => {
  if (a === null || b === null) return null;
  return count ? tokenCount(a + b) : cost(a + b);
};

/** A missing round poisons only that field; a later subtotal cannot repair it. */
export class ProviderUsageLedger {
  private input: number | null = 0;
  private output: number | null = 0;
  private total: number | null = 0;
  private usd: number | null = 0;
  private knownTokens = 0;
  private knownUsd = 0;

  constructor(private readonly estimate?: (input: number, output: number) => number) {}

  record(value: unknown): void {
    const usage = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    const input = tokenCount(usage.prompt_tokens), output = tokenCount(usage.completion_tokens);
    const components = sum(input, output, true);
    const reportedTotal = tokenCount(usage.total_tokens);
    const knownComponents = (input ?? 0) + (output ?? 0);
    const total = reportedTotal !== null
      && (reportedTotal < knownComponents || (components !== null && reportedTotal !== components))
      ? null : reportedTotal ?? components;
    const usd = this.estimate
      ? input !== null && output !== null ? cost(this.estimate(input, output)) : null
      : cost(usage.cost);
    this.input = sum(this.input, input, true);
    this.output = sum(this.output, output, true);
    this.total = sum(this.total, total, true);
    this.usd = sum(this.usd, usd);
    // Even incomplete reporting cannot erase a known lower bound on spending.
    this.knownTokens += Math.max(reportedTotal ?? 0, knownComponents);
    this.knownUsd += usd ?? 0;
  }

  result() {
    return { inputTokens: this.input, outputTokens: this.output, totalTokens: this.total, estimatedUsd: this.usd };
  }

  boundary(budget: AgentBudget, hasTools: boolean): "budget_exhausted" | "provider_usage_unavailable" | undefined {
    if (this.knownTokens > budget.maxTaskTokens || (hasTools && this.knownTokens >= budget.maxTaskTokens)
      || this.knownUsd > budget.maxEstimatedUsd || (hasTools && this.knownUsd >= budget.maxEstimatedUsd)) {
      return "budget_exhausted";
    }
    if (this.total === null || this.usd === null) return "provider_usage_unavailable";
    return undefined;
  }
}
