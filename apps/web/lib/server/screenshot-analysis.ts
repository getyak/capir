import { resolveProductPrompt } from "@talent-signal/agent/prompt-registry";
import "server-only";

import {
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

import {
  parseScreenshotCaptureDraft,
  type ScreenshotAnalysisMeta,
  type ScreenshotCaptureDraft,
  type ScreenshotOwnerRole,
} from "../screenshot-capture";
import {
  SCREENSHOT_PROMPT_VERSION,
  analyzeScreenshotWithArk,
  getArkAvailability,
  screenshotPrompt,
} from "./ark";
import {
  analyzeScreenshotWithBigModel,
  getBigModelAvailability,
} from "./bigModel";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_SCREENSHOT_MODEL =
  "qwen/qwen3-vl-30b-a3b-instruct";

let openRouterProxy: { url: string; dispatcher: Dispatcher } | null = null;

type OpenRouterResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type OpenRouterRequestInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  cache: "no-store";
  signal: AbortSignal;
};

function screenshotAnalysisSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(45_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type ScreenshotAnalysis = {
  draft: ScreenshotCaptureDraft;
  meta: ScreenshotAnalysisMeta;
};

export type ScreenshotAnalysisUnavailableReason =
  | "ai_disabled"
  | "provider_credentials_missing"
  | "sensitive_processing_disabled";

function screenshotAnalysisUnavailableReason(
  credentialConfigured: boolean,
): ScreenshotAnalysisUnavailableReason | null {
  if (process.env.TALENT_SIGNAL_AI_ENABLED !== "true") {
    return "ai_disabled";
  }
  if (!sensitiveProcessingAllowed()) {
    return "sensitive_processing_disabled";
  }
  return credentialConfigured ? null : "provider_credentials_missing";
}

export function classifyScreenshotAnalysisFailure(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      const message = current.message.toLocaleLowerCase();
      if (
        current.name === "TimeoutError" ||
        message.includes("timed out") ||
        message.includes("timeout")
      ) {
        return "provider_timeout" as const;
      }
      if (
        message.includes("fetch failed") ||
        message.includes("econnrefused") ||
        message.includes("enotfound") ||
        message.includes("network")
      ) {
        return "provider_network_failed" as const;
      }
      current = current.cause;
      continue;
    }
    break;
  }
  return "analysis_failed" as const;
}

function sensitiveProcessingAllowed() {
  return process.env.TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING === "true";
}

function openRouterEndpoint() {
  const configured = (
    process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL
  ).replace(/\/+$/, "");
  const parsed = new URL(configured);
  if (parsed.protocol !== "https:" || parsed.hostname !== "openrouter.ai") {
    throw new Error("OPENROUTER_BASE_URL 必须使用 OpenRouter 官方主机。");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/chat/completions`;
}

function openRouterScreenshotModel() {
  return (
    process.env.TALENT_SIGNAL_OPENROUTER_SCREENSHOT_MODEL ??
    DEFAULT_OPENROUTER_SCREENSHOT_MODEL
  );
}

function openRouterProxyUrl() {
  const configured = process.env.TALENT_SIGNAL_OPENROUTER_PROXY_URL?.trim();
  if (!configured) {
    return null;
  }
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "TALENT_SIGNAL_OPENROUTER_PROXY_URL must use HTTP or HTTPS.",
    );
  }
  return parsed.toString();
}

function openRouterProxyDispatcher(proxyUrl: string) {
  if (!openRouterProxy || openRouterProxy.url !== proxyUrl) {
    openRouterProxy = {
      url: proxyUrl,
      dispatcher: new ProxyAgent(proxyUrl),
    };
  }
  return openRouterProxy.dispatcher;
}

async function fetchOpenRouter(
  endpoint: string,
  init: OpenRouterRequestInit,
  fetchImpl?: typeof fetch,
) {
  if (fetchImpl) {
    return fetchImpl(endpoint, init);
  }
  const proxyUrl = openRouterProxyUrl();
  if (!proxyUrl) {
    return fetch(endpoint, init);
  }
  return undiciFetch(endpoint, {
    ...init,
    dispatcher: openRouterProxyDispatcher(proxyUrl),
  });
}

function openRouterProviderOrder() {
  const value = process.env.TALENT_SIGNAL_OPENROUTER_PROVIDER_ORDER;
  if (!value) {
    return undefined;
  }
  const order = value
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider) => /^[a-z0-9/-]+$/.test(provider));
  return order.length > 0 ? order : undefined;
}

export function getScreenshotAnalysisAvailability() {
  const aiEnabled = process.env.TALENT_SIGNAL_AI_ENABLED === "true";
  const sensitiveAllowed = sensitiveProcessingAllowed();
  const ark = getArkAvailability();
  const bigModel = getBigModelAvailability();
  const selectedProvider =
    process.env.TALENT_SIGNAL_SCREENSHOT_PROVIDER?.trim() || "auto";
  if (selectedProvider === "zhipu") {
    return {
      ...bigModel,
      unavailable_reason: screenshotAnalysisUnavailableReason(
        Boolean(process.env.ZHIPU_API_KEY),
      ),
    };
  }
  if (selectedProvider === "ark") {
    return {
      ...ark,
      unavailable_reason: screenshotAnalysisUnavailableReason(
        Boolean(process.env.ARK_API_KEY),
      ),
    };
  }
  if (selectedProvider === "openrouter") {
    const credentialConfigured = Boolean(process.env.OPENROUTER_API_KEY);
    return {
      enabled:
        aiEnabled && sensitiveAllowed && credentialConfigured,
      provider: "OpenRouter" as const,
      screenshot_model: openRouterScreenshotModel(),
      unavailable_reason:
        screenshotAnalysisUnavailableReason(credentialConfigured),
    };
  }
  if (selectedProvider !== "auto") {
    throw new Error(
      "TALENT_SIGNAL_SCREENSHOT_PROVIDER must be auto, ark, zhipu, or openrouter.",
    );
  }
  if (aiEnabled && sensitiveAllowed && process.env.ARK_API_KEY) {
    return {
      enabled: true,
      provider: "Volcano Ark" as const,
      screenshot_model: ark.screenshot_model,
      unavailable_reason: null,
    };
  }
  if (aiEnabled && sensitiveAllowed && process.env.OPENROUTER_API_KEY) {
    return {
      enabled: true,
      provider: "OpenRouter" as const,
      screenshot_model: openRouterScreenshotModel(),
      unavailable_reason: null,
    };
  }
  return {
    enabled: false,
    provider: process.env.ARK_API_KEY
      ? ("Volcano Ark" as const)
      : ("OpenRouter" as const),
    screenshot_model: process.env.ARK_API_KEY
      ? ark.screenshot_model
      : openRouterScreenshotModel(),
    unavailable_reason: screenshotAnalysisUnavailableReason(
      Boolean(process.env.ARK_API_KEY || process.env.OPENROUTER_API_KEY),
    ),
  };
}

async function analyzeWithOpenRouter(input: {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  contactName: string;
  assignmentLabel: string;
  screenshotOwner: ScreenshotOwnerRole;
  sourceSha256: string;
  preProviderMinimization?: ScreenshotAnalysisMeta["pre_provider_minimization"];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ScreenshotAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const availability = getScreenshotAnalysisAvailability();
  if (
    !availability.enabled ||
    availability.provider !== "OpenRouter" ||
    !apiKey
  ) {
    throw new Error("尚未配置 OpenRouter 截图分析。");
  }
  const promptSnapshot = await resolveProductPrompt("capture/screenshot");
  input.signal?.throwIfAborted();
  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const response = await fetchOpenRouter(openRouterEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
      "X-Title": "capri screenshot evidence review",
    },
    body: JSON.stringify({
      model: availability.screenshot_model,
      messages: [
        {
          role: "system",
          content: promptSnapshot.text,
        },
        {
          role: "user",
          content: [
            { type: "text", text: screenshotPrompt(input) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      // The complete evidence contract is enforced by
      // parseScreenshotCaptureDraft after the provider returns. Requesting
      // native json_schema routing here excludes otherwise eligible ZDR
      // vision endpoints for schemas with nullable unions.
      response_format: { type: "json_object" },
      provider: {
        allow_fallbacks: true,
        data_collection: "deny",
        require_parameters: true,
        zdr: true,
        ...(openRouterProviderOrder()
          ? { order: openRouterProviderOrder() }
          : {}),
      },
      max_tokens: 5000,
    }),
    cache: "no-store",
    signal: screenshotAnalysisSignal(input.signal),
  }, input.fetchImpl);
  if (!response.ok) {
    let providerDetail = "";
    try {
      const errorPayload = (await response.json()) as {
        error?:
          | {
              message?: string;
              metadata?: { raw?: string; provider_name?: string };
            }
          | string;
        message?: string;
      };
      const message =
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : errorPayload.error?.message ?? errorPayload.message;
      if (typeof message === "string" && message.trim()) {
        providerDetail = ` ${message.replace(/\s+/g, " ").trim().slice(0, 300)}`;
      }
      if (
        typeof errorPayload.error === "object" &&
        typeof errorPayload.error.metadata?.raw === "string"
      ) {
        providerDetail += ` ${errorPayload.error.metadata.raw
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300)}`;
      }
    } catch {
      // The authenticated API route still returns a generic message to clients.
    }
    throw new Error(
      `OpenRouter screenshot analysis failed with ${response.status}.${providerDetail}`,
    );
  }
  const payload = (await response.json()) as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter 未返回结构化截图分析。");
  }
  return {
    draft: parseScreenshotCaptureDraft(content, {
      require_visual_direction: true,
      screenshot_owner: input.screenshotOwner,
    }),
    meta: {
      provider: "OpenRouter",
      model: payload.model ?? availability.screenshot_model,
      ...(payload.id ? { request_id: payload.id } : {}),
      prompt_version: SCREENSHOT_PROMPT_VERSION,
      ...(input.preProviderMinimization
        ? { pre_provider_minimization: input.preProviderMinimization }
        : {}),
      source_sha256: input.sourceSha256,
      raw_image_stored_by_talent_signal: false,
    },
  };
}

export async function analyzeScreenshot(input: {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  contactName: string;
  assignmentLabel: string;
  screenshotOwner: ScreenshotOwnerRole;
  sourceSha256: string;
  preProviderMinimization?: ScreenshotAnalysisMeta["pre_provider_minimization"];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ScreenshotAnalysis> {
  const availability = getScreenshotAnalysisAvailability();
  if (!availability.enabled) {
    throw new Error("尚未配置截图分析。");
  }
  if (availability.provider === "OpenRouter") {
    return analyzeWithOpenRouter(input);
  }
  if (availability.provider === "Zhipu BigModel") {
    const result = await analyzeScreenshotWithBigModel(input);
    return {
      draft: result.draft,
      meta: {
        ...result.meta,
        prompt_version: SCREENSHOT_PROMPT_VERSION,
        ...(input.preProviderMinimization
          ? { pre_provider_minimization: input.preProviderMinimization }
          : {}),
        source_sha256: input.sourceSha256,
      },
    };
  }
  const result = await analyzeScreenshotWithArk(input);
  return {
    draft: result.draft,
    meta: {
      ...result.meta,
      prompt_version: SCREENSHOT_PROMPT_VERSION,
      ...(input.preProviderMinimization
        ? { pre_provider_minimization: input.preProviderMinimization }
        : {}),
      source_sha256: input.sourceSha256,
    },
  };
}
