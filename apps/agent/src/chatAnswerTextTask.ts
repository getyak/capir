/**
 * Shared product text-task seam.
 *
 * One Chat answer message serializer and one answer parser for every remote
 * text provider. `ZhipuChatAnswerProvider.answer` (text-only) and
 * `DeepSeekRelationshipTextProvider.answer` both exercise exactly this
 * implementation, so citation allowlist, JSON shape, source/prompt candidate
 * rules, and governed transport limits cannot drift per provider. Provider
 * labels appear only in error text; existing Zhipu error semantics are
 * preserved byte-identical.
 *
 * Image assembly and full tool-agent runs stay outside this seam by design.
 */

import { createHash } from "node:crypto";
import type { PromptSnapshot } from "./promptRegistry.js";
import { resolveProductPrompt } from "./promptRegistry.js";
import { RELATIONSHIP_SYSTEM_PROMPT, UNSCOPED_CONVERSATION_SYSTEM_PROMPT } from "./prompts.js";
import { applyChatPreset, loadedRelationshipTaskPrompt } from "./relationshipTaskConfiguration.js";
import type {
  ChatPromptPreset,
  RemoteChatAnswerRequest,
  RemoteChatAnswerResult,
  RemoteChatImageInput,
} from "./chatAnswerProvider.js";

export const MAX_CONTEXT_CHARACTERS = 48_000;
export const MAX_PROVIDER_CONTENT_CHARACTERS = 16_000;

/** Shared text-task wire fields; providers add only model and thinking policy. */
export const CHAT_ANSWER_TEXT_WIRE = Object.freeze({
  response_format: Object.freeze({ type: "json_object" }),
  temperature: 0,
  max_tokens: 1_600,
  stream: false,
});

export function boundedConversationHistory(
  messages: readonly import("./types.js").ConversationMessage[] = [],
  currentMessageID?: string,
): import("./types.js").ConversationMessage[] {
  let remaining = 12_000;
  const selected: import("./types.js").ConversationMessage[] = [];
  for (const message of messages.slice(-12).reverse()) {
    if (message.message_id === currentMessageID || !message.text.trim()) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.text.slice(0, Math.min(2_000, remaining));
    if (!text) break;
    selected.push({ message_id: message.message_id, role: message.role, text });
    remaining -= text.length;
  }
  return selected.reverse();
}

const SCREENSHOT_INTERPRETATION_BOUNDARY = "Use only the existing labeled canonical screenshot summary as unconfirmed interpretation. Do not add participants, shared intent, agreement, dates, or time zones. Do not invent concrete dates even as examples; use [date] and [timezone] placeholders or ask directly. For missing timing ask the specific date/time-zone question or suggest reviewing the existing capture. Do not default to requesting the same screenshot again. This context grants no reviewed evidence or action authority.";

function hasScreenshotConversationContext(messages: readonly import("./types.js").ConversationMessage[] = []) {
  return boundedConversationHistory(messages).some((message) =>
    message.role === "assistant" && message.text.includes('"kind":"prior_screenshot_context"'));
}

export function restrictScreenshotPrompt(
  configured: { text: string; revision: string },
  messages: readonly import("./types.js").ConversationMessage[] = [],
  canonicalAdmission = false,
) {
  // This marker only adds restrictions; it never admits citations or Tools.
  if (!canonicalAdmission && !hasScreenshotConversationContext(messages)) return configured;
  const text = `${configured.text}\n\n${SCREENSHOT_INTERPRETATION_BOUNDARY}`;
  return { text, revision: createHash("sha256").update(text).digest("hex").slice(0, 16) };
}

export function conversationContext(messages: readonly import("./types.js").ConversationMessage[] = []) {
  return {
    authority: "conversation_only_not_evidence_or_tool_authorization",
    messages: boundedConversationHistory(messages),
  };
}

export const CHAT_PROMPT_PRESETS = ["baseline", "concise", "evidence_first"] as const;

export function configuredChatPrompt(mode: RemoteChatAnswerRequest["mode"] = "relationship",
  preset: ChatPromptPreset = "baseline", promptText?: string): { text: string; revision: string } {
  if (!CHAT_PROMPT_PRESETS.includes(preset)) throw new Error("Unregistered Chat prompt preset.");
  const base = promptText ?? (mode === "unscoped_conversation" ? UNSCOPED_CONVERSATION_SYSTEM_PROMPT : RELATIONSHIP_SYSTEM_PROMPT);
  return applyChatPreset(base, preset);
}

/** Exact effective system text and revision after request-specific screenshot restrictions. */
export function configuredChatRequestPrompt(request: RemoteChatAnswerRequest, snapshot: PromptSnapshot) {
  return restrictScreenshotPrompt(configuredChatPrompt(request.mode ?? "relationship", request.prompt_preset, snapshot.text),
    request.conversation_history, request.permits_unconfirmed_session_context_answer);
}

export function positiveInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function requiredString(
  value: unknown,
  name: string,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} ${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`${label} ${name} is empty or too long.`);
  }
  return trimmed;
}

export function parseChatAnswerJson(content: string, label = "Zhipu Chat"): Record<string, unknown> {
  if (content.length > MAX_PROVIDER_CONTENT_CHARACTERS) {
    throw new Error(`${label} returned an oversized response.`);
  }
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const parsed = JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} did not return one JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

type ChatAnswerTextFields = Pick<RemoteChatAnswerResult, "kind" | "title" | "body" | "citation_ids" | "session_title">;

export function parseChatAnswerText(
  value: Record<string, unknown>,
  allowedCitationIds: readonly string[],
  options: { label?: string; permitsAttachmentOnlyAnswer?: boolean } = {},
): ChatAnswerTextFields {
  const label = options.label ?? "Zhipu Chat";
  const kind = requiredString(value.kind, "kind", 40, label);
  if (!new Set<RemoteChatAnswerResult["kind"]>([
    "answer",
    "question_set",
    "clarification",
  ]).has(kind as RemoteChatAnswerResult["kind"])) {
    throw new Error(`${label} returned an unsupported response kind.`);
  }
  const title = requiredString(value.title, "title", 160, label);
  const body = requiredString(value.body, "body", 4_000, label);
  // Optional display metadata cannot invalidate a usable, evidence-checked answer.
  const candidateTitle = typeof value.session_title === "string" ? value.session_title.trim() : "";
  const sessionTitle = candidateTitle && Array.from(candidateTitle).length <= 256
    ? candidateTitle : undefined;
  if (!Array.isArray(value.citation_ids)) {
    throw new Error(`${label} citation_ids must be an array.`);
  }
  const citationIds = [...new Set(value.citation_ids.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} returned an invalid citation ID.`);
    }
    return item.trim();
  }))];
  if (citationIds.length > 20) {
    throw new Error(`${label} returned too many citations.`);
  }
  const allowed = new Set(allowedCitationIds);
  if (citationIds.some((id) => !allowed.has(id))) {
    throw new Error(`${label} cited evidence outside the governed manifest.`);
  }
  if (
    kind !== "clarification" &&
    citationIds.length === 0 &&
    !options.permitsAttachmentOnlyAnswer
  ) {
    throw new Error(`Evidence-based ${label} output requires a citation.`);
  }
  return {
    kind: kind as RemoteChatAnswerResult["kind"],
    title,
    body,
    citation_ids: citationIds,
    ...(sessionTitle ? { session_title: sessionTitle } : {}),
  };
}

/** One shared answer parser: JSON-object shape plus citation/manifest rules. */
export function parseChatAnswerTextTask(
  content: string,
  request: RemoteChatAnswerRequest,
  label = "Zhipu Chat",
): ChatAnswerTextFields {
  const images = request.images ?? [];
  return parseChatAnswerText(parseChatAnswerJson(content, label), request.allowed_citation_ids, {
    label,
    permitsAttachmentOnlyAnswer: images.length > 0
      || (request.mode ?? "relationship") === "unscoped_conversation"
      || request.permits_unconfirmed_session_context_answer === true,
  });
}

/**
 * Optional cache split from actual provider usage. Both counts must be
 * nonnegative safe integers summing prompt_tokens; anything partial, malformed or
 * inconsistent is unknown and stays null. Unknown is never fabricated as zero.
 */
export function reportedCacheTokenSplit(usage: unknown): {
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
} {
  const record = usage && typeof usage === "object" && !Array.isArray(usage)
    ? usage as Record<string, unknown> : null;
  const isCount = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  const hit = record?.prompt_cache_hit_tokens;
  const miss = record?.prompt_cache_miss_tokens;
  const prompt = record?.prompt_tokens;
  if (!isCount(hit) || !isCount(miss) || !isCount(prompt) || !Number.isSafeInteger(hit + miss) || hit + miss !== prompt) {
    return { cache_hit_tokens: null, cache_miss_tokens: null };
  }
  return { cache_hit_tokens: hit, cache_miss_tokens: miss };
}

export interface ChatAnswerTextTask {
  mode: "relationship" | "unscoped_conversation";
  images: RemoteChatImageInput[];
  snapshot: PromptSnapshot;
  prompt: { text: string; revision: string };
  contextPayload: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  wire: typeof CHAT_ANSWER_TEXT_WIRE;
}

/**
 * Serialize one governed text-only answer task: request guards, context
 * payload, prompt-snapshot candidate rule, system/user messages, and the
 * shared wire fields. Providers supply only model, thinking policy and
 * transport.
 */
export async function serializeChatAnswerTextTask(
  request: RemoteChatAnswerRequest,
  options: { imagesAdmitted?: boolean } = {},
): Promise<ChatAnswerTextTask> {
  const objective = request.objective.trim();
  if (!objective) throw new Error("A Chat objective is required.");
  const mode = request.mode ?? "relationship";
  if (request.reference_time !== undefined && !Number.isFinite(Date.parse(request.reference_time))) throw new Error("Frozen Chat reference time is invalid.");
  const images = request.images ?? [];
  if (
    mode === "unscoped_conversation" &&
    (request.context_blocks.length > 0 ||
      request.allowed_citation_ids.length > 0)
  ) {
    throw new Error(
      "Unscoped Chat cannot receive relationship context or citations.",
    );
  }
  if (images.length > 0 && !options.imagesAdmitted) {
    throw new Error("Remote Chat image processing is not admitted.");
  }
  if (images.length > 10) {
    throw new Error("Remote Chat accepts at most ten governed images.");
  }
  const imageBytes = images.reduce((total, image) => total + image.data.byteLength, 0);
  if (imageBytes > 20 * 1024 * 1024) {
    throw new Error("Remote Chat images exceed the governed processing limit.");
  }
  const contextPayload = JSON.stringify({
    mode,
    objective,
    session_title_requested: request.session_title_requested === true,
    ...(request.reference_time === undefined ? {} : { frozen_reference_time: request.reference_time }),
    previous_dialogue: conversationContext(request.conversation_history),
    ...(request.permits_unconfirmed_session_context_answer ? { answer_boundary: "You may answer conversationally from the labeled unconfirmed screenshot interpretation without citations. Attribute it as an unconfirmed prior interpretation; do not promote it to reviewed facts or action authority. Cite only current allowed evidence when making relationship fact claims. Do not add participants, shared intent, agreement, dates, or time zones. For missing timing ask the specific date/time-zone question or suggest reviewing the existing capture; do not default to uploading the same screenshot again." } : {}),
    context_blocks: request.context_blocks,
    allowed_citation_ids: request.allowed_citation_ids,
  });
  if (contextPayload.length > MAX_CONTEXT_CHARACTERS) {
    throw new Error("The governed Chat context is too large for remote processing.");
  }

  const promptName = mode === "unscoped_conversation" ? "assistant/conversation" : "assistant/relationship";
  const snapshot = request.prompt_snapshot ?? (mode === "relationship" && images.length === 0 && request.prompt_preset === undefined
    ? loadedRelationshipTaskPrompt() : await resolveProductPrompt(promptName));
  if (snapshot.name !== promptName) throw new Error("Frozen prompt task mismatch.");
  const prompt = configuredChatRequestPrompt(request, snapshot);
  return {
    mode,
    images,
    snapshot,
    prompt,
    contextPayload,
    messages: [{ role: "system", content: prompt.text }, { role: "user", content: contextPayload }],
    wire: CHAT_ANSWER_TEXT_WIRE,
  };
}
