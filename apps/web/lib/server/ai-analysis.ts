import { resolveProductPrompt } from "@talent-signal/agent/prompt-registry";
import { modelEvidenceSchema, parseModelEvidence } from "../ai-evidence";
import { buildAnalysis, type AnalysisResult } from "../signals";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODELS = [
  "deepseek/deepseek-v4-pro",
  "anthropic/claude-opus-5",
  "deepseek/deepseek-v4-flash-0731",
] as const;

type ProviderResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type AiAvailability = {
  enabled: boolean;
  provider: "OpenRouter";
};

export type AiAnalysis = {
  result: AnalysisResult;
  meta: {
    mode: "ai";
    model: string;
    provider: "OpenRouter";
    requestId?: string;
  };
};

function isPublicProductionDemoAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.TALENT_SIGNAL_ALLOW_PUBLIC_AI_DEMO === "true"
  );
}

export function getAiAvailability(): AiAvailability {
  return {
    enabled:
      process.env.TALENT_SIGNAL_AI_ENABLED === "true" &&
      Boolean(process.env.OPENROUTER_API_KEY) &&
      isPublicProductionDemoAllowed(),
    provider: "OpenRouter",
  };
}

function getModels() {
  return [
    process.env.TALENT_SIGNAL_LLM_MODEL_GENERAL ?? DEFAULT_MODELS[0],
    process.env.TALENT_SIGNAL_LLM_MODEL_HEAVY ?? DEFAULT_MODELS[1],
    process.env.TALENT_SIGNAL_LLM_MODEL_FAST ?? DEFAULT_MODELS[2],
  ].filter((model, index, models) => models.indexOf(model) === index);
}

function getEndpoint() {
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL
  ).replace(/\/+$/, "");
  return `${baseUrl}/chat/completions`;
}

export async function analyzeWithAi(
  conversation: string,
  candidateContext: string,
  sourceSpeaker: "candidate",
): Promise<AiAnalysis> {
  const availability = getAiAvailability();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!availability.enabled || !apiKey) {
    throw new Error("尚未配置 AI 分析。");
  }

  const response = await fetch(getEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
      "X-Title": "capri evidence review",
    },
    body: JSON.stringify({
      models: getModels(),
      messages: [
        {
          role: "system",
          content: (await resolveProductPrompt("capture/text")).text,
        },
        {
          role: "user",
          content: JSON.stringify({
            candidate_context: candidateContext,
            source_speaker: sourceSpeaker,
            conversation,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "candidate_momentum_evidence",
          strict: true,
          schema: modelEvidenceSchema,
        },
      },
      provider: {
        allow_fallbacks: true,
        data_collection: "deny",
        require_parameters: true,
        zdr: true,
      },
      max_tokens: 2200,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`AI 提供方请求失败，状态码：${response.status}。`);
  }

  const payload = (await response.json()) as ProviderResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("AI 提供方未返回结构化内容。");
  }

  const evidence = parseModelEvidence(content, conversation);
  return {
    result: buildAnalysis(evidence),
    meta: {
      mode: "ai",
      model: payload.model ?? getModels()[0],
      provider: "OpenRouter",
      requestId: payload.id,
    },
  };
}
