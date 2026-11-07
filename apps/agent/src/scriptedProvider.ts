import { snapshotProviderRunConfiguration } from "./providerRunConfiguration.js";
import type {
  AgentProvider,
  AgentProviderRequest,
  AgentProviderResult,
  AgentToolResult,
} from "./types.js";

export interface ScriptedAgentStep {
  tool: string;
  input: unknown;
}

export type ScriptedOutput =
  | Record<string, unknown>
  | readonly unknown[]
  | string
  | number
  | boolean
  | null
  | ((results: readonly AgentToolResult[]) => unknown);

export class ScriptedAgentProvider implements AgentProvider {
  readonly id = "deterministic";
  readonly model = "talent-signal-scripted-v1";
  readonly sdkVersion = "deterministic-provider.v1";
  readonly runConfiguration = snapshotProviderRunConfiguration({ version: "agent-run-reasoning.v1", reasoning: { mode: "not_applicable" } });
  readonly inputCapabilities = {
    text: true,
    image: true,
    imageUnderstanding: false,
  } as const;

  constructor(
    private readonly steps: readonly ScriptedAgentStep[],
    private readonly output: ScriptedOutput,
    private readonly diagnostics: Partial<
      Pick<
        AgentProviderResult,
        | "inputTokens"
        | "outputTokens"
        | "estimatedUsd"
        | "turns"
        | "permissionDenials"
      >
    > = {},
  ) {}

  async run(
    _request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    const results: AgentToolResult[] = [];
    for (const step of this.steps) {
      if (signal.aborted) throw signal.reason;
      results.push(await invokeTool(step.tool, step.input));
    }
    if (signal.aborted) throw signal.reason;
    return {
      structuredOutput:
        typeof this.output === "function" ? this.output(results) : this.output,
      inputTokens: this.diagnostics.inputTokens ?? 256,
      outputTokens: this.diagnostics.outputTokens ?? 64,
      estimatedUsd: this.diagnostics.estimatedUsd ?? 0,
      turns: this.diagnostics.turns ?? 1,
      permissionDenials: this.diagnostics.permissionDenials ?? [],
    };
  }
}
