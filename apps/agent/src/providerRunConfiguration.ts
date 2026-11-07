/** Host intent for AgentProvider.run only. Omission does not establish the
 * provider's effective effort; an undescribed adapter remains unknown. */
export type ProviderRunConfiguration = Readonly<{
  version: "agent-run-reasoning.v1";
  reasoning: Readonly<
    | { mode: "omitted" }
    | { mode: "explicit"; effort: "low" | "medium" | "high" | "max" }
    | { mode: "not_applicable" }
    | { mode: "unknown" }
  >;
}>;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Strict, detached, deeply frozen snapshot. Undefined is an explicit unknown
 * for a new execution; stored legacy absence is handled by its record owner. */
export function snapshotProviderRunConfiguration(value: unknown): ProviderRunConfiguration {
  try {
    if (value === undefined) return Object.freeze({ version: "agent-run-reasoning.v1", reasoning: Object.freeze({ mode: "unknown" }) });
    if (!object(value) || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, "version")
      || !Object.hasOwn(value, "reasoning")) throw new Error();
    // Accessors may change between reads. Validate and clone the same captured
    // values, never a second value obtained after validation.
    const version = value.version, reasoning = value.reasoning;
    if (version !== "agent-run-reasoning.v1" || !object(reasoning) || !Object.hasOwn(reasoning, "mode")) throw new Error();
    const mode = reasoning.mode;
    if (mode === "explicit") {
      if (Reflect.ownKeys(reasoning).length !== 2 || !Object.hasOwn(reasoning, "effort")) throw new Error();
      const effort = reasoning.effort;
      if (typeof effort !== "string" || !["low", "medium", "high", "max"].includes(effort)) throw new Error();
      return Object.freeze({ version, reasoning: Object.freeze({ mode, effort: effort as "low" | "medium" | "high" | "max" }) });
    }
    if (Reflect.ownKeys(reasoning).length !== 1 || (mode !== "omitted" && mode !== "not_applicable" && mode !== "unknown")) throw new Error();
    return Object.freeze({ version, reasoning: Object.freeze({ mode }) });
  } catch { throw new Error("AGENT_PROVIDER_RUN_CONFIGURATION_INVALID"); }
}

/** Exact model capabilities verified from the model owner's contracts. Never
 * infer support from a name regex or a provider's generic effort enum.
 * https://raw.githubusercontent.com/zai-org/GLM-5/main/README.md
 * https://openrouter.ai/z-ai/glm-5.3-20260816 */
export function validatedGlmReasoningEffort(provider: "zhipu" | "openrouter", model: string,
  value: unknown): "low" | "high" | "max" | undefined {
  if (value === undefined) return undefined;
  const accepted: readonly string[] = provider === "zhipu"
    ? model === "glm-5.3" ? ["low", "high", "max"] : model === "glm-5.2" ? ["high", "max"] : []
    : model === "z-ai/glm-5.3" ? ["low", "high", "max"] : [];
  if (typeof value !== "string" || !accepted.includes(value)) throw new Error("AGENT_REASONING_EFFORT_UNSUPPORTED");
  return value as "low" | "high" | "max";
}

export function glmRunConfiguration(effort: "low" | "high" | "max" | undefined): ProviderRunConfiguration {
  return snapshotProviderRunConfiguration({ version: "agent-run-reasoning.v1", reasoning: effort === undefined
    ? { mode: "omitted" } : { mode: "explicit", effort } });
}
