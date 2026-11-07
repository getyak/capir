import {
  BigModelAgentProvider,
  ClaudeAgentSDKProvider,
  claudeHarnessConfiguration,
  OpenRouterAgentProvider,
  type AgentProvider,
} from "@talent-signal/agent";

import {
  BraveWebSearchProvider,
  TavilyWebSearchProvider,
  type AgentWebSearchProvider,
} from "./webSearchProviders.js";
import { TikHubProvider } from "./tikHubProvider.js";
import { ExaProvider } from "./exaProvider.js";
import { createFirecrawlWebFetch } from "./firecrawlWebFetch.js";

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required by the local Agent host.`);
  return value;
}

function positive(environment: NodeJS.ProcessEnv, name: string, fallback: number) {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

export function configuredLocalAgentProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AgentProvider {
  const provider = required(environment, "TALENT_SIGNAL_AGENT_PROVIDER").toLowerCase();
  const model = required(environment, "TALENT_SIGNAL_AGENT_MODEL");
  return configuredAgentProvider(environment, provider, model, false);
}

function configuredAgentProvider(
  environment: NodeJS.ProcessEnv,
  provider: string,
  model: string,
  imageInputEnabled: boolean,
): AgentProvider {
  if (provider === "claude") {
    return new ClaudeAgentSDKProvider(model, undefined,
      claudeHarnessConfiguration({ ...environment, TALENT_SIGNAL_AGENT_MODEL: model }), imageInputEnabled);
  }
  const effort = environment.TALENT_SIGNAL_AGENT_REASONING_EFFORT?.trim();
  if (effort && !["low", "high", "max"].includes(effort)) throw new Error("TALENT_SIGNAL_AGENT_REASONING_EFFORT must be low, high, or max.");
  const reasoning = effort ? { reasoningEffort: effort as "low" | "high" | "max" } : {};
  if (provider === "openrouter") {
    return new OpenRouterAgentProvider({
      apiKey: required(environment, "OPENROUTER_API_KEY"),
      ...reasoning,
      model,
      ...(environment.OPENROUTER_BASE_URL?.trim()
        ? { baseUrl: environment.OPENROUTER_BASE_URL.trim() }
        : {}),
      ...(environment.TALENT_SIGNAL_AGENT_REFERER?.trim()
        ? { referer: environment.TALENT_SIGNAL_AGENT_REFERER.trim() }
        : {}),
      imageInputEnabled,
    });
  }
  if (provider === "zhipu") {
    return new BigModelAgentProvider({
      apiKey: required(environment, "ZHIPU_API_KEY"),
      ...reasoning,
      model,
      inputCnyPerMillion: positive(
        environment,
        "TALENT_SIGNAL_ZHIPU_INPUT_CNY_PER_MILLION",
        2,
      ),
      outputCnyPerMillion: positive(
        environment,
        "TALENT_SIGNAL_ZHIPU_OUTPUT_CNY_PER_MILLION",
        8,
      ),
      cnyPerUsd: positive(environment, "TALENT_SIGNAL_CNY_PER_USD", 7.2),
      ...(environment.ZHIPU_BASE_URL?.trim()
        ? { baseUrl: environment.ZHIPU_BASE_URL.trim() }
        : {}),
    });
  }
  throw new Error(
    "TALENT_SIGNAL_AGENT_PROVIDER must be claude, openrouter, or zhipu.",
  );
}

export function configuredLocalVisionAgentProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AgentProvider {
  if (environment.TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING !== "true") {
    throw new Error(
      "Local screenshot person research requires explicit remote-sensitive-processing admission.",
    );
  }
  const provider = required(
    environment,
    "TALENT_SIGNAL_AGENT_PROVIDER",
  ).toLowerCase();
  const model = required(environment, "TALENT_SIGNAL_AGENT_VISION_MODEL");
  const configured = configuredAgentProvider(environment, provider, model, true);
  if (!configured.inputCapabilities.imageUnderstanding) {
    throw new Error(
      "The configured local Agent vision model must support image understanding.",
    );
  }
  return configured;
}

export interface LocalToolProviderRegistration {
  id: "brave" | "tavily" | "exa";
  capability: "public_web_search";
  secretPath: "/agent-host";
  credentialNames: readonly string[];
  subscriptionOwner: "vendor_account";
  automaticFallback: false;
  create(environment: NodeJS.ProcessEnv): AgentWebSearchProvider;
}

export const LOCAL_WEB_SEARCH_PROVIDER_REGISTRY: Readonly<
  Record<LocalToolProviderRegistration["id"], LocalToolProviderRegistration>
> = Object.freeze({
  exa: {
    id: "exa",
    capability: "public_web_search",
    secretPath: "/agent-host",
    credentialNames: ["EXA_API_KEY"],
    subscriptionOwner: "vendor_account",
    automaticFallback: false,
    create: (environment) => new ExaProvider({ apiKey: required(environment, "EXA_API_KEY") }),
  },
  brave: {
    id: "brave",
    capability: "public_web_search",
    secretPath: "/agent-host",
    credentialNames: ["BRAVE_SEARCH_API_KEY"],
    subscriptionOwner: "vendor_account",
    automaticFallback: false,
    create: (environment) =>
      new BraveWebSearchProvider({
        apiKey: required(environment, "BRAVE_SEARCH_API_KEY"),
        ...(environment.BRAVE_SEARCH_BASE_URL?.trim()
          ? { baseUrl: environment.BRAVE_SEARCH_BASE_URL.trim() }
          : {}),
      }),
  },
  tavily: {
    id: "tavily",
    capability: "public_web_search",
    secretPath: "/agent-host",
    credentialNames: ["TAVILY_API_KEY"],
    subscriptionOwner: "vendor_account",
    automaticFallback: false,
    create: (environment) =>
      new TavilyWebSearchProvider({
        apiKey: required(environment, "TAVILY_API_KEY"),
        ...(environment.TAVILY_BASE_URL?.trim()
          ? { baseUrl: environment.TAVILY_BASE_URL.trim() }
          : {}),
      }),
  },
});

export function configuredLocalWebSearchProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AgentWebSearchProvider {
  const provider = required(
    environment,
    "TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER",
  ).toLowerCase();
  if (provider in LOCAL_WEB_SEARCH_PROVIDER_REGISTRY) {
    return LOCAL_WEB_SEARCH_PROVIDER_REGISTRY[
      provider as LocalToolProviderRegistration["id"]
    ].create(environment);
  }
  throw new Error(
    "TALENT_SIGNAL_AGENT_WEB_SEARCH_PROVIDER must be brave, tavily, or exa.",
  );
}

export function configuredFirecrawlWebFetch(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return createFirecrawlWebFetch({
    apiKey: required(environment, "FIRECRAWL_API_KEY"),
    zeroDataRetention:
      environment.TALENT_SIGNAL_FIRECRAWL_ZERO_DATA_RETENTION === "true",
  });
}

export interface LocalPersonProfileProviderRegistration {
  id: "tikhub";
  capability: "public_person_profile_research";
  secretPath: "/agent-host";
  credentialNames: readonly ["TIKHUB_API_KEY", "TIKHUB_BASE_URL"];
  subscriptionOwner: "vendor_account";
  automaticFallback: false;
  create(environment: NodeJS.ProcessEnv): TikHubProvider;
}

export const LOCAL_PERSON_PROFILE_PROVIDER_REGISTRY: Readonly<
  Record<"tikhub", LocalPersonProfileProviderRegistration>
> = Object.freeze({
  tikhub: {
    id: "tikhub",
    capability: "public_person_profile_research",
    secretPath: "/agent-host",
    credentialNames: ["TIKHUB_API_KEY", "TIKHUB_BASE_URL"],
    subscriptionOwner: "vendor_account",
    automaticFallback: false,
    create: (environment) =>
      new TikHubProvider({
        apiKey: required(environment, "TIKHUB_API_KEY"),
        baseUrl: required(environment, "TIKHUB_BASE_URL"),
      }),
  },
});

export function configuredLocalPersonProfileProvider(
  environment: NodeJS.ProcessEnv = process.env,
): TikHubProvider {
  return LOCAL_PERSON_PROFILE_PROVIDER_REGISTRY.tikhub.create(environment);
}
