import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_PERSON_PROFILE_PROVIDER_REGISTRY,
  LOCAL_WEB_SEARCH_PROVIDER_REGISTRY,
  configuredFirecrawlWebFetch,
  configuredLocalPersonProfileProvider,
  configuredLocalAgentProvider,
  configuredLocalVisionAgentProvider,
  configuredLocalWebSearchProvider,
} from "./providerConfig.js";

describe("local third-party Tool provider registry", () => {

  it.each(["openrouter", "zhipu"])("forwards explicit reasoning intent through the shared %s factory", async provider => {
    for (const effort of [undefined, "", "  ", "low", "high", "max"]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
        model: provider === "zhipu" ? "glm-5.3" : "z-ai/glm-5.3", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.000001 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetcher);
      const actual = configuredLocalAgentProvider({
        TALENT_SIGNAL_AGENT_PROVIDER: provider, TALENT_SIGNAL_AGENT_MODEL: provider === "zhipu" ? "glm-5.3" : "z-ai/glm-5.3",
        OPENROUTER_API_KEY: "synthetic", ZHIPU_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_REASONING_EFFORT: effort,
      });
      expect(actual).toMatchObject({ runConfiguration: { version: "agent-run-reasoning.v1",
        reasoning: effort?.trim() ? { mode: "explicit", effort } : { mode: "omitted" } } });
      try {
        await actual.run({ runID: "synthetic-run", objective: "Synthetic no-action", systemPrompt: "Use no tools.",
          scopeSummary: { kind: "pursuit", workspaceID: "synthetic-workspace", pursuitID: "synthetic-pursuit", pursuitRevision: 1, evidenceRefs: [] },
          toolManifest: [], budget: { maxTurns: 2, maxToolCalls: 2, maxDurationMs: 5000, maxTaskTokens: 1000, maxEstimatedUsd: 1 } },
          async () => { throw new Error("Unexpected tool dispatch"); }, new AbortController().signal);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
        if (effort?.trim()) expect(body.reasoning_effort).toBe(effort);
        else expect(Object.hasOwn(body, "reasoning_effort")).toBe(false);
      } finally { vi.unstubAllGlobals(); }
    }
    expect(() => configuredLocalAgentProvider({ TALENT_SIGNAL_AGENT_PROVIDER: provider,
      TALENT_SIGNAL_AGENT_MODEL: provider === "zhipu" ? "glm-5.3" : "z-ai/glm-5.3",
      OPENROUTER_API_KEY: "synthetic", ZHIPU_API_KEY: "synthetic", TALENT_SIGNAL_AGENT_REASONING_EFFORT: "medium" })).toThrow();
  });

  it("does not invent a reasoning capability for the shared vision factory", () => {
    const environment = { TALENT_SIGNAL_AGENT_PROVIDER: "zhipu", TALENT_SIGNAL_AGENT_VISION_MODEL: "glm-4.6v-flash",
      TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING: "true", ZHIPU_API_KEY: "synthetic" };
    expect(configuredLocalVisionAgentProvider(environment)).toMatchObject({
      runConfiguration: { version: "agent-run-reasoning.v1", reasoning: { mode: "omitted" } } });
    expect(() => configuredLocalVisionAgentProvider({ ...environment, TALENT_SIGNAL_AGENT_REASONING_EFFORT: "high" })).toThrow();
  });

  it("binds only the explicit Claude environment and requires a dedicated Hao credential", () => {
    const environment = {
      TALENT_SIGNAL_AGENT_PROVIDER: "claude", TALENT_SIGNAL_AGENT_MODEL: "anthropic/claude-sonnet-5",
      TALENT_SIGNAL_AGENT_VISION_MODEL: "anthropic/claude-sonnet-5",
      TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING: "true",
      ANTHROPIC_BASE_URL: "https://api.hao.ai/anthropic", HAO_ANTHROPIC_API_KEY: "synthetic-hao-key",
    };
    expect(configuredLocalAgentProvider(environment).id).toBe("claude-agent-sdk");
    expect(configuredLocalVisionAgentProvider(environment).inputCapabilities.imageUnderstanding).toBe(true);
    expect(() => configuredLocalAgentProvider({ ...environment, HAO_ANTHROPIC_API_KEY: "",
      ANTHROPIC_API_KEY: "other-gateway", CLAUDE_CODE_OAUTH_TOKEN: "ambient-oauth" })).toThrow("CREDENTIAL_AMBIGUOUS_OR_MISSING");
    expect(() => configuredLocalAgentProvider({ ...environment, ANTHROPIC_BASE_URL: "https://unadmitted.invalid" })).toThrow("ENDPOINT_NOT_ADMITTED");
  });

  it("declares credential and subscription ownership without fallback", () => {
    expect(Object.keys(LOCAL_WEB_SEARCH_PROVIDER_REGISTRY).sort()).toEqual([
      "brave",
      "exa",
      "tavily",
    ]);
    for (const registration of Object.values(
      LOCAL_WEB_SEARCH_PROVIDER_REGISTRY,
    )) {
      expect(registration).toMatchObject({
        capability: "public_web_search",
        secretPath: "/agent-host",
        subscriptionOwner: "vendor_account",
        automaticFallback: false,
      });
      expect(registration.credentialNames).toHaveLength(1);
    }
  });

  it("fails closed for an unknown provider or a missing provider key", () => {
    expect(() =>
      configuredLocalWebSearchProvider({
        TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER: "unknown",
      }),
    ).toThrow("must be brave, tavily, or exa");
    expect(() =>
      configuredLocalWebSearchProvider({
        TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER: "brave",
      }),
    ).toThrow("BRAVE_SEARCH_API_KEY is required");
    expect(() => configuredFirecrawlWebFetch({})).toThrow(
      "FIRECRAWL_API_KEY is required",
    );
    expect(
      configuredFirecrawlWebFetch({ FIRECRAWL_API_KEY: "synthetic" }),
    ).toBeTypeOf("function");
  });

  it("keeps TikHub and the vision model in the local person-research boundary", () => {
    expect(LOCAL_PERSON_PROFILE_PROVIDER_REGISTRY.tikhub).toMatchObject({
      capability: "public_person_profile_research",
      secretPath: "/agent-host",
      subscriptionOwner: "vendor_account",
      automaticFallback: false,
      credentialNames: ["TIKHUB_API_KEY", "TIKHUB_BASE_URL"],
    });
    expect(() => configuredLocalPersonProfileProvider({})).toThrow(
      "TIKHUB_API_KEY is required",
    );
    expect(() =>
      configuredLocalVisionAgentProvider({
        TALENT_SIGNAL_AGENT_PROVIDER: "zhipu",
        TALENT_SIGNAL_AGENT_VISION_MODEL: "glm-4.6v-flash",
        TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING: "false",
        ZHIPU_API_KEY: "synthetic",
      }),
    ).toThrow("explicit remote-sensitive-processing admission");
    expect(() =>
      configuredLocalVisionAgentProvider({
        TALENT_SIGNAL_AGENT_PROVIDER: "zhipu",
        TALENT_SIGNAL_AGENT_VISION_MODEL: "glm-5.2",
        TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING: "true",
        ZHIPU_API_KEY: "synthetic",
      }),
    ).toThrow("must support image understanding");
    expect(
      configuredLocalVisionAgentProvider({
        TALENT_SIGNAL_AGENT_PROVIDER: "zhipu",
        TALENT_SIGNAL_AGENT_VISION_MODEL: "glm-4.6v-flash",
        TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING: "true",
        ZHIPU_API_KEY: "synthetic",
      }).inputCapabilities.imageUnderstanding,
    ).toBe(true);
  });
});
