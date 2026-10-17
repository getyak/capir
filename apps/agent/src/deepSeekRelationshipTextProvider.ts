/**
 * DeepSeek relationship text provider.
 *
 * A text-only `RemoteChatAnswerProviding` for real `.answer` product tasks. It
 * exercises the same shared product serializer/parser seam as
 * `ZhipuChatAnswerProvider.answer` — no evaluator-only copy of the wire or the
 * citation rules exists. Images and full tool-agent behavior are unsupported:
 * images are explicitly rejected and no `run`/`runWithPromptPreset` surface is
 * exposed. An explicitly opted-in host uses its text-answer branch for both
 * relationship and unscoped conversation; this provides no tool-agent capability.
 *
 * Documented request profile (https://api-docs.deepseek.com/zh-cn/, parent
 * verified 2026-10-18): `POST https://api.deepseek.com/chat/completions`,
 * requested model `deepseek-flash` (documented mutable alias, never claimed to
 * pin immutable weights), explicit `thinking {type:"disabled"}`, temperature 0,
 * max_tokens 1600, `response_format json_object`, `stream:false`, timeout
 * 15000 ms, single attempt without retries.
 */

import { captureProductStep } from "./productRunCapture.js";
import type { RuntimeObserver } from "./runtimeObservationOutbox.js";
import type { RuntimeObservationSession, RuntimeObservationSpan } from "./runtimeObservation.js";
import { redactObservationMedia } from "./chatAnswerProviderMultimodal.js";
import {
  parseChatAnswerTextTask,
  reportedCacheTokenSplit,
  serializeChatAnswerTextTask,
} from "./chatAnswerTextTask.js";
import {
  DEEPSEEK_TEXT_TASK_MODEL,
  DEEPSEEK_TEXT_TASK_POLICY,
  DEEPSEEK_TEXT_TASK_REPORTED_MODELS,
  deepSeekLoadedRelationshipTextTaskConfiguration,
} from "./relationshipTaskConfiguration.js";
import type {
  RemoteChatAnswerProviding,
  RemoteChatAnswerRequest,
  RemoteChatAnswerResult,
} from "./chatAnswerProvider.js";

export const DEEPSEEK_CHAT_BASE_URL = "https://api.deepseek.com";

interface DeepSeekChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

function reportedTokenUsage(usage: DeepSeekChatResponse["usage"]) {
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    && typeof output === "number" && Number.isSafeInteger(output) && output >= 0
    && Number.isSafeInteger(input + output)
    ? { input, output } : null;
}

export interface DeepSeekRelationshipTextProviderOptions {
  observer?: RuntimeObserver | null;
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
}

export class DeepSeekRelationshipTextProvider implements RemoteChatAnswerProviding {
  readonly providerId = "deepseek-chat-completions" as const;
  readonly model: string;
  readonly supportsImageInput = false;
  readonly supportsPromptPresets = true;
  get imageModel(): string | null { return null; }
  get loadedTaskConfiguration() { return this.loadedConfiguration; }

  private readonly observer: RuntimeObserver | null;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly loadedConfiguration: ReturnType<typeof deepSeekLoadedRelationshipTextTaskConfiguration>;

  constructor(options: DeepSeekRelationshipTextProviderOptions) {
    this.observer = options.observer ?? null;
    this.apiKey = options.apiKey.trim();
    this.observer?.addCredential(this.apiKey);
    if (!this.apiKey) throw new Error("A DeepSeek Chat API key is required.");
    this.model = options.model.trim();
    // Validates the pinned requestable identity and builds the DeepSeek policy
    // digest (profile version plus honest alias identity policy).
    this.loadedConfiguration = deepSeekLoadedRelationshipTextTaskConfiguration(this.model);
    this.fetcher = options.fetcher ?? fetch;
  }

  /** The alias or its exact documented resolved identity; never anything else. */
  matchesReportedModel(reported: string | null): boolean {
    return reported !== null && DEEPSEEK_TEXT_TASK_REPORTED_MODELS.includes(reported);
  }

  async answer(request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    const observation = request.observation
      ? this.observer?.start(request.observation, redactObservationMedia(request)) ?? null
      : null;
    let output: RemoteChatAnswerResult | undefined;
    try { output = await this.answerInternal(request, observation); return output; }
    finally { await this.observer?.complete(observation, output, output ? "ok" : "error"); }
  }

  private async answerInternal(
    request: RemoteChatAnswerRequest, observation: RuntimeObservationSession | null,
  ): Promise<RemoteChatAnswerResult> {
    if (request.images?.length) {
      throw new Error("DeepSeek relationship text tasks do not admit images.");
    }
    const task = await serializeChatAnswerTextTask(request, { imagesAdmitted: false });
    const payload = await this.requestCompletion({
      model: this.model,
      messages: task.messages,
      ...task.wire,
      thinking: { type: "disabled" },
    }, request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(DEEPSEEK_TEXT_TASK_POLICY.maxDurationMs)])
      : AbortSignal.timeout(DEEPSEEK_TEXT_TASK_POLICY.maxDurationMs), observation, task.prompt.revision);
    if (!payload || !this.matchesReportedModel(payload.model ?? null)) {
      throw new Error("DeepSeek Chat returned a different or missing model.");
    }
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek Chat returned no answer content.");
    const answer = parseChatAnswerTextTask(content, request, "DeepSeek Chat");
    const usage = reportedTokenUsage(payload.usage);
    return {
      ...answer,
      ...reportedCacheTokenSplit(usage ? payload.usage : null),
      provider_id: this.providerId,
      model: this.model,
      reported_model: payload.model ?? null,
      provider_request_id: payload.id?.trim() || null,
      input_tokens: usage?.input ?? 0,
      output_tokens: usage?.output ?? 0,
      usage_reported: usage !== null,
      prompt_revision: task.prompt.revision,
      prompt_snapshot: task.snapshot,
    };
  }

  /** One attempt only: DeepSeek text tasks never perform real network retries. */
  private async requestCompletion(body: Record<string, unknown>, signal: AbortSignal,
    observation: RuntimeObservationSession | null, revision: string): Promise<DeepSeekChatResponse | null> {
    const execute = () => captureProductStep("chat.completions", "llm", body, async () => {
      const response = await this.fetcher(`${DEEPSEEK_CHAT_BASE_URL}/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw new Error(`DeepSeek Chat request failed with ${response.status}.`);
      return await response.json().catch(() => null) as DeepSeekChatResponse | null;
    }, { provider: this.providerId, model: body.model, prompt_revision: revision });
    return observation ? observation.step("chat.completions", "llm", redactObservationMedia(body), execute,
      { model: String(body.model), provider: this.providerId, prompt_revision: revision }, (payload): RuntimeObservationSpan["usage"] => {
        const usage = reportedTokenUsage(payload?.usage);
        return { input_tokens: usage?.input ?? null, output_tokens: usage?.output ?? null,
          source: usage ? "provider" : "unavailable", cost_usd: null, cost_source: "unavailable", accounting: "leaf" };
      }) : execute();
  }
}

export { DEEPSEEK_TEXT_TASK_MODEL, DEEPSEEK_TEXT_TASK_POLICY };
