import { captureProductStep } from "./productRunCapture.js";
import { createHash } from "node:crypto";
import { configuredClaudeChatProvider } from "./claudeChatProvider.js";
import { DeepSeekRelationshipTextProvider } from "./deepSeekRelationshipTextProvider.js";
import { createEnvironmentRuntimeObserver, type RuntimeObserver } from "./runtimeObservationOutbox.js";
import { type RuntimeObservationContext, type RuntimeObservationSession, type RuntimeObservationSpan } from "./runtimeObservation.js";
import { AGENT_TOOL_CATALOG, agentToolJsonSchema, contactWorkspaceOperationTools } from "./toolCatalog.js";
import { RELATIONSHIP_SYSTEM_PROMPT, WORKSPACE_OUTPUT_GUIDANCE } from "./prompts.js";
import { type PromptSnapshot } from "./promptRegistry.js";
import { chatModelReasoningEffort, DEEPSEEK_TEXT_TASK_MODEL, loadedRelationshipTaskConfiguration } from "./relationshipTaskConfiguration.js";
import {
  CHAT_ANSWER_TEXT_WIRE,
  CHAT_PROMPT_PRESETS,
  conversationContext,
  parseChatAnswerJson,
  parseChatAnswerTextTask,
  positiveInteger,
  reportedCacheTokenSplit,
  restrictScreenshotPrompt,
  serializeChatAnswerTextTask,
} from "./chatAnswerTextTask.js";
import { agentImageModel, redactObservationMedia, userImageParts, zhipuAgentUserTurn } from "./chatAnswerProviderMultimodal.js";
import { WorkspaceConversationFinalOutputSchema } from "./schemas.js";
import type { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolResult, ConversationMessage } from "./types.js";

type RemoteChatBlockKind = "answer" | "question_set" | "clarification";

export interface RemoteChatContextBlock {
  block_id: string;
  block_key: string;
  type: string;
  status: string;
  headline: string;
  summary: string;
  items: string[];
  evidence_fragment_ids: string[];
}

export type ChatPromptPreset = "baseline" | "concise" | "evidence_first";

export interface RemoteChatAnswerRequest {
  runFiles?: import("./runFileTools.js").RunFileAdmission;
  /** Host-only traversal from an admitted Memory fragment to its original pixels. */
  readEvidenceImage?: (evidenceID: string, signal: AbortSignal) => Promise<{
    evidence_id: string; task_id: string; source_resource_id: string; source_image_index: number;
    image: import("./contactIntakeSchemas.js").ScreenshotContactTaskRequest["image"];
    assertCurrent: () => Promise<void>;
  }>;
  calendarContext?: import("./calendarDraft.js").CalendarDraftContext;
  /** Host-captured reference time, shared with frozen evaluation input. */
  reference_time?: string;
  /** Internal frozen Lab configuration, never accepted from a public request. */
  prompt_snapshot?: PromptSnapshot;
  /** Host-provided trace identity; never accepted as observation authority from public input. */
  observation?: RuntimeObservationContext;
  continuation?: import("./claudeHarnessContinuation.js").HarnessContinuationFactory;
  /** Host-only source admission captured before compiling private context. */
  assertCurrent?: () => Promise<void>;
  /** Host cancellation, composed by the provider with its own governor. */
  signal?: AbortSignal;
  responsePreference?: import("./responsePreference.js").ResponsePreference;
  prompt_preset?: ChatPromptPreset;
  mode?: "relationship" | "unscoped_conversation";
  objective: string;
  /** Host-owned first-result gate for optional Session display metadata. */
  session_title_requested?: boolean;
  /** Canonical Session dialogue, validated for the current account and scope. */
  conversation_history?: readonly ConversationMessage[];
  /** Internal canonical-source admission, never accepted from public Chat input. */
  permits_unconfirmed_session_context_answer?: boolean;
  context_blocks: RemoteChatContextBlock[];
  allowed_citation_ids: string[];
  images?: RemoteChatImageInput[];
  memoryReview?: import("./memorySchemas.js").RemoteChatMemoryReviewHooks;
}

export interface RemoteChatImageInput {
  file_name: string;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic" | "image/heif";
  data: Uint8Array;
}

export interface RemoteChatAnswerResult {
  calendarDraft?: import("@talent-signal/contracts").CalendarDraft;
  /** First-result display metadata only; never a response-block heading. */
  session_title?: string;
  kind: RemoteChatBlockKind;
  title: string;
  body: string;
  citation_ids: string[];
  provider_id: "zhipu-chat-completions" | "claude-agent-sdk" | "deepseek-chat-completions";
  model: string;
  provider_request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  usage_reported?: boolean;
  /** Optional cache split from actual provider usage; null when unknown. */
  cache_hit_tokens?: number | null;
  cache_miss_tokens?: number | null;
  reported_model?: string | null;
  /** null when the SDK does not expose transport attempts. */
  remote_requests_started?: number | null;
  prompt_revision?: string;
  prompt_snapshot?: PromptSnapshot;
  memoryProposal?: import("./memorySchemas.js").RemoteChatMemoryProposalReference;
}

export interface AgentRunConfigurationEvidence {
  actual_model: string | null;
  prompt_revision: string;
  actual_prompt_revision: string | null;
  requests_started: number | null;
  responses_received: number;
  input_tokens: number | null;
  output_tokens: number | null;
  provider_request_id: string | null;
}

export interface RemoteChatAnswerProviding {
  readonly loadedTaskConfiguration?: ReturnType<typeof loadedRelationshipTaskConfiguration>;
  readonly providerId: "zhipu-chat-completions" | "claude-agent-sdk" | "deepseek-chat-completions";
  readonly model: string;
  readonly supportsImageInput: boolean;
  readonly imageModel?: string | null;
  readonly supportsPromptPresets?: boolean;
  effectivePrompt?(text: string, preset: ChatPromptPreset, scope?: "relationship" | "workspace"): { text: string; revision: string };
  matchesReportedModel?(reported: string | null): boolean;
  answer(request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult>;
  runWithPromptPreset?(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
    signal: AbortSignal,
    preset: ChatPromptPreset,
    observed: (evidence: AgentRunConfigurationEvidence) => void,
  ): Promise<AgentProviderResult>;
}

interface ZhipuChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

interface ZhipuChatAnswerProviderOptions {
  observer?: RuntimeObserver | null;
  apiKey: string;
  model: string;
  visionModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
export { RELATIONSHIP_SYSTEM_PROMPT } from "./prompts.js";

export { CHAT_PROMPT_PRESETS, boundedConversationHistory, configuredChatPrompt, configuredChatRequestPrompt } from "./chatAnswerTextTask.js";
export { DeepSeekRelationshipTextProvider } from "./deepSeekRelationshipTextProvider.js";

const PROMPT_STYLE: Record<ChatPromptPreset, string> = {
  baseline: "",
  concise: "Keep the answer brief; lead with the useful conclusion.",
  evidence_first: "Lead with the evidence, then explain uncertainty and useful next steps.",
};

export function configuredAgentPrompt(systemPrompt: string, preset: ChatPromptPreset = "baseline") {
  if (!CHAT_PROMPT_PRESETS.includes(preset)) throw new Error("Unregistered Chat prompt preset.");
  const base = `${systemPrompt}\n\n${WORKSPACE_OUTPUT_GUIDANCE}`;
  const text = PROMPT_STYLE[preset] ? `${base}\n\n${PROMPT_STYLE[preset]}` : base;
  return { text, revision: createHash("sha256").update(text).digest("hex").slice(0, 16) };
}

function validatedBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "open.bigmodel.cn" ||
    parsed.pathname.replace(/\/+$/u, "") !== "/api/paas/v4"
  ) {
    throw new Error("The Zhipu Chat base URL must use the official v4 endpoint.");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
}

function resolvedContactSelection(result: AgentToolResult): {
  personID: string;
  relationshipContextID: string;
} | null {
  if (
    !result.ok ||
    result.name !== "contact_workspace" ||
    !result.data ||
    typeof result.data !== "object" ||
    Array.isArray(result.data)
  ) {
    return null;
  }
  const data = result.data as Record<string, unknown>;
  if (
    data.operation !== "read" ||
    !data.person ||
    typeof data.person !== "object" ||
    Array.isArray(data.person) ||
    !data.relationship_context ||
    typeof data.relationship_context !== "object" ||
    Array.isArray(data.relationship_context)
  ) {
    return null;
  }
  const personID = (data.person as Record<string, unknown>).id;
  const relationshipContextID = (
    data.relationship_context as Record<string, unknown>
  ).id;
  if (
    typeof personID !== "string" ||
    !personID.trim() ||
    typeof relationshipContextID !== "string" ||
    !relationshipContextID.trim()
  ) {
    return null;
  }
  return {
    personID: personID.trim(),
    relationshipContextID: relationshipContextID.trim(),
  };
}

function explicitNamedRelationshipClue(objective: string): string | null {
  // This optional shortcut must never backtrack over an uncontrolled objective.
  // Oversized questions continue through the ordinary Agent path, unmodified.
  const question = objective.trim();
  if (question.length > 1024) return null;
  const withoutPunctuation = (text: string, punctuation: string): string => {
    let end = text.length;
    while (end > 0 && punctuation.includes(text[end - 1]!)) end--;
    return text.slice(0, end).trimEnd();
  };
  const english = withoutPunctuation(question, "?!.");
  const clues: string[] = [];
  for (const words of [
    ["what", "changed", "with"],
    ["what", "has", "changed", "with"],
    ["what", "do", "we", "know", "about"],
  ]) {
    let cursor = 0;
    let matches = true;
    for (const word of words) {
      if (english.slice(cursor, cursor + word.length).toLowerCase() !== word) { matches = false; break; }
      cursor += word.length;
      if (cursor >= english.length || !/\s/u.test(english[cursor]!)) { matches = false; break; }
      while (cursor < english.length && /\s/u.test(english[cursor]!)) cursor++;
    }
    if (matches) clues.push(english.slice(cursor));
  }
  const chinese = withoutPunctuation(question, "？?。!！");
  for (const suffix of ["有什么变化", "发生了什么变化", "现在怎么样", "目前怎么样"]) {
    if (chinese.endsWith(suffix)) clues.push(chinese.slice(0, -suffix.length));
  }
  for (const candidate of clues) {
    const clue = candidate.trim();
    if (
      clue &&
      clue.length >= 2 &&
      clue.length <= 200 &&
      !/[*%\n\r\u2028\u2029]/u.test(clue) &&
      !new Set([
        "all contacts",
        "everyone",
        "the candidate",
        "the contact",
        "the relationship",
        "them",
        "全部联系人",
        "所有人",
        "候选人",
        "联系人",
        "这段关系",
        "他们",
      ]).has(clue.toLocaleLowerCase())
    ) {
      return clue;
    }
  }
  return null;
}

function uniqueContactSearchSelection(result: AgentToolResult): {
  personID: string;
  relationshipContextID: string;
} | null {
  if (
    !result.ok ||
    result.name !== "contact_workspace" ||
    !result.data ||
    typeof result.data !== "object" ||
    Array.isArray(result.data)
  ) {
    return null;
  }
  const data = result.data as Record<string, unknown>;
  if (data.operation !== "search" || !Array.isArray(data.results)) {
    return null;
  }
  if (typeof data.result_count === "number" && data.result_count > data.results.length) return null;
  const pairs = data.results.flatMap((rawPerson) => {
    if (!rawPerson || typeof rawPerson !== "object" || Array.isArray(rawPerson)) {
      return [];
    }
    const person = rawPerson as Record<string, unknown>;
    const personID = person.person_id;
    if (
      typeof personID !== "string" ||
      !personID.trim() ||
      !Array.isArray(person.relationship_contexts)
    ) {
      return [];
    }
    return person.relationship_contexts.flatMap((rawContext) => {
      if (!rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)) {
        return [];
      }
      const contextID = (rawContext as Record<string, unknown>).id;
      return typeof contextID === "string" && contextID.trim()
        ? [{
            personID: personID.trim(),
            relationshipContextID: contextID.trim(),
          }]
        : [];
    });
  });
  return pairs.length === 1 ? pairs[0]! : null;
}

export class ZhipuChatAnswerProvider
  implements RemoteChatAnswerProviding, AgentProvider
{
  readonly id = "zhipu-chat-agent";
  readonly sdkVersion = "zhipu-chat-completions.v1";
  readonly providerId = "zhipu-chat-completions" as const;
  readonly model: string;
  readonly supportsImageInput: boolean;
  readonly supportsPromptPresets = true;
  get loadedTaskConfiguration() { return loadedRelationshipTaskConfiguration(this.model, this.timeoutMs); }
  get imageModel(): string | null { return this.visionModel; }
  readonly inputCapabilities;

  private readonly observer: RuntimeObserver | null;
  private readonly apiKey: string;
  private readonly visionModel: string | null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: ZhipuChatAnswerProviderOptions) {
    this.observer = options.observer ?? null;
    this.apiKey = options.apiKey.trim();
    this.observer?.addCredential(this.apiKey);
    this.model = options.model.trim();
    if (!this.apiKey) throw new Error("A Zhipu Chat API key is required.");
    if (
      !/^glm-[a-z0-9.-]+$/u.test(this.model) ||
      /(?:latest|auto)/u.test(this.model)
    ) {
      throw new Error("Configure one explicitly pinned GLM Chat model.");
    }
    const visionModel = options.visionModel?.trim() || null;
    if (
      visionModel &&
      (!/^glm-[a-z0-9.-]+$/u.test(visionModel) ||
        /(?:latest|auto)/u.test(visionModel))
    ) {
      throw new Error("Configure one explicitly pinned GLM vision model.");
    }
    this.visionModel = visionModel;
    this.supportsImageInput = visionModel !== null;
    this.inputCapabilities = Object.freeze({
      text: true,
      image: this.supportsImageInput,
      imageUnderstanding: this.supportsImageInput,
    });
    this.baseUrl = validatedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1_000 ||
      this.timeoutMs > 30_000
    ) {
      throw new Error("Zhipu Chat timeout must be between 1000 and 30000 ms.");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  async answer(request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    const observation = request.observation ? this.observer?.start(request.observation, redactObservationMedia({
      ...request, images: request.images?.map((image) => ({ file_name: image.file_name,
        media_type: image.media_type, data_base64: Buffer.from(image.data).toString("base64") })),
    })) ?? null : null;
    let output: RemoteChatAnswerResult | undefined;
    try { output = await this.answerInternal(request, observation); return output; }
    finally { await this.observer?.complete(observation, output, output ? "ok" : "error"); }
  }

  private async answerInternal(
    request: RemoteChatAnswerRequest, observation: RuntimeObservationSession | null,
  ): Promise<RemoteChatAnswerResult> {
    const task = await serializeChatAnswerTextTask(request, { imagesAdmitted: this.visionModel !== null });
    const selectedModel = task.images.length > 0 ? this.visionModel! : this.model;
    const messages = task.images.length === 0
      ? task.messages
      : [
          task.messages[0]!,
          {
            role: "user",
            content: [
              { type: "text", text: task.contextPayload },
              ...task.images.map((image) => ({
                type: "image_url",
                image_url: {
                  url: `data:${image.media_type};base64,${Buffer.from(image.data).toString("base64")}`,
                },
              })),
            ],
          },
        ];
    const payload = await this.requestCompletion({
        model: selectedModel,
        messages,
        ...CHAT_ANSWER_TEXT_WIRE,
        thinking: { type: "enabled" },
        ...(chatModelReasoningEffort(selectedModel) ? { reasoning_effort: chatModelReasoningEffort(selectedModel) } : {}),
      }, AbortSignal.timeout(this.timeoutMs), observation, task.prompt.revision);
    if (!payload || payload.model !== selectedModel) {
      throw new Error("Zhipu Chat returned a different or missing model.");
    }
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Zhipu Chat returned no answer content.");
    const answer = parseChatAnswerTextTask(content, request, "Zhipu Chat");
    return {
      ...answer,
      ...reportedCacheTokenSplit(payload.usage),
      provider_id: this.providerId,
      model: selectedModel,
      provider_request_id: payload.id?.trim() || null,
      input_tokens: positiveInteger(payload.usage?.prompt_tokens),
      output_tokens: positiveInteger(payload.usage?.completion_tokens),
      usage_reported: Number.isInteger(payload.usage?.prompt_tokens)
        && Number.isInteger(payload.usage?.completion_tokens),
      prompt_revision: task.prompt.revision,
      prompt_snapshot: task.snapshot,
    };
  }

  async run(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
    signal: AbortSignal,
  ): Promise<AgentProviderResult> {
    return this.runInternal(request, invokeTool, signal, "baseline");
  }

  async runWithPromptPreset(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
    signal: AbortSignal,
    preset: ChatPromptPreset,
    observed: (evidence: AgentRunConfigurationEvidence) => void,
  ): Promise<AgentProviderResult> {
    const revision = restrictScreenshotPrompt(
      configuredAgentPrompt(request.systemPrompt, preset), request.conversationHistory,
    ).revision;
    let started = 0, received = 0, inputTokens = 0, outputTokens = 0;
    let usageReported = true;
    let actualModel: string | null = null, requestID: string | null = null;
    try {
      return await this.runInternal(request, invokeTool, signal, preset, (payload) => {
        if (!payload) { started += 1; return; }
        received += 1;
        actualModel = payload.model ?? null;
        requestID = payload.id?.trim() || requestID;
        usageReported = usageReported && Number.isInteger(payload.usage?.prompt_tokens)
          && Number.isInteger(payload.usage?.completion_tokens);
        inputTokens += positiveInteger(payload.usage?.prompt_tokens);
        outputTokens += positiveInteger(payload.usage?.completion_tokens);
      });
    } finally {
      const completeUsage = usageReported && started === received;
      observed({ actual_model: actualModel, prompt_revision: revision,
        actual_prompt_revision: received > 0 ? revision : null,
        requests_started: started, responses_received: received,
        input_tokens: completeUsage ? inputTokens : null, output_tokens: completeUsage ? outputTokens : null,
        provider_request_id: requestID });
    }
  }

  private async requestCompletion(body: Record<string, unknown>, signal: AbortSignal,
    observation: RuntimeObservationSession | null, revision: string): Promise<ZhipuChatResponse | null> {
    const execute = () => captureProductStep("chat.completions", "llm", body, async () => {
      const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw new Error(`Zhipu Chat request failed with ${response.status}.`);
      return await response.json().catch(() => null) as ZhipuChatResponse | null;
    }, { provider: this.providerId, model: body.model, prompt_revision: revision });
    return observation ? observation.step("chat.completions", "llm", redactObservationMedia(body), execute,
      { model: String(body.model), provider: this.providerId, prompt_revision: revision }, (payload): RuntimeObservationSpan["usage"] => {
        const input = payload?.usage?.prompt_tokens, output = payload?.usage?.completion_tokens;
        const reported = Number.isInteger(input) && input! >= 0 && Number.isInteger(output) && output! >= 0;
        return { input_tokens: reported ? input! : null, output_tokens: reported ? output! : null,
          source: reported ? "provider" : "unavailable", cost_usd: null, cost_source: "unavailable", accounting: "leaf" };
      }) : execute();
  }

  private async runInternal(request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>, signal: AbortSignal,
    preset: ChatPromptPreset, observed?: (payload: ZhipuChatResponse | null) => void): Promise<AgentProviderResult> {
    const workspaceID = request.scopeSummary.kind === "workspace_conversation" ? request.scopeSummary.workspaceID : null;
    const supplied = request.observation;
    const trusted = supplied && supplied.run_id === request.runID && supplied.workspace_id === workspaceID
      && supplied.authorization_scope === "workspace_conversation" ? supplied : null;
    const observation = workspaceID ? this.observer?.start(trusted ?? { run_id: request.runID,
      workspace_id: workspaceID, authorization_scope: "workspace_conversation",
      source_session_id: request.scopeSummary.kind === "workspace_conversation" ? request.scopeSummary.sessionID : null }, redactObservationMedia(request)) ?? null : null;
    let output: AgentProviderResult | undefined;
    try {
      output = await this.runInternalBody(request, (name, input) => captureProductStep(name, "tool", input,
        () => observation ? observation.step(name, "tool", input, () => invokeTool(name, input)) : invokeTool(name, input)), signal, preset, observed, observation);
      return output;
    } finally { await this.observer?.complete(observation, output, output ? "ok" : "error"); }
  }

  private async runInternalBody(
    request: AgentProviderRequest,
    invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
    signal: AbortSignal,
    preset: ChatPromptPreset,
    observed?: (payload: ZhipuChatResponse | null) => void,
    observation: RuntimeObservationSession | null = null,
  ): Promise<AgentProviderResult> {
    if (request.scopeSummary.kind !== "workspace_conversation") {
      throw new Error(
        "The Chat Agent adapter only admits workspace conversation Runs.",
      );
    }
    const explicitClue = request.toolManifest.includes("contact_workspace")
      ? explicitNamedRelationshipClue(request.objective) : null;
    if (explicitClue) {
      if (signal.aborted) throw signal.reason;
      const search = await invokeTool("contact_workspace", {
        operation: "search",
        query: explicitClue,
        maximum_results: 4,
      });
      if (!search.ok) {
        throw new Error(
          `The explicit contact search was denied: ${search.error?.code ?? "UNKNOWN"}.`,
        );
      }
      if (signal.aborted) throw signal.reason;
      const candidate = uniqueContactSearchSelection(search);
      if (candidate) {
        const read = await invokeTool("contact_workspace", {
          operation: "read",
          person_id: candidate.personID,
          relationship_context_id: candidate.relationshipContextID,
        });
        const selection = resolvedContactSelection(read);
        if (!selection) {
          throw new Error(
            `The explicit contact read was denied: ${read.error?.code ?? "INVALID_RESULT"}.`,
          );
        }
        return {
          structuredOutput: {
            outcome: "use_contact",
            person_id: selection.personID,
            relationship_context_id: selection.relationshipContextID,
          },
          inputTokens: 0,
          outputTokens: 0,
          estimatedUsd: 0,
          turns: 0,
          permissionDenials: [],
          terminalReason: "completed",
        };
      }
      const usesChinese = /\p{Script=Han}/u.test(request.objective);
      return {
        structuredOutput: {
          outcome: "clarification",
          title: usesChinese ? "需要确认关系" : "Which relationship do you mean?",
          body: usesChinese
            ? `没有唯一匹配到“${explicitClue}”的关系。请选择一个结果，或再提供一条准确的身份或关系线索。`
            : `I could not uniquely match “${explicitClue}” to one relationship. Choose one result or share one more exact identity or relationship clue.`,
        },
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
        turns: 0,
        permissionDenials: [],
        terminalReason: "completed",
      };
    }
    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: restrictScreenshotPrompt(
          configuredAgentPrompt(request.systemPrompt, preset), request.conversationHistory,
        ).text,
      },
      {
        role: "user",
        content: zhipuAgentUserTurn(request.inputParts, {
          objective: request.objective,
          session_title_requested: request.sessionTitleRequested === true,
          previous_dialogue: conversationContext(request.conversationHistory),
          immutable_scope: request.scopeSummary,
        }),
      },
    ];
    const imageModel = agentImageModel(userImageParts(request.inputParts), this.visionModel, this.model);
    const contactOperations = request.toolManifest.includes("contact_workspace")
      ? contactWorkspaceOperationTools()
      : [];
    const availableTools = request.toolManifest.flatMap<{
      type: string;
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>((name) => name === "contact_workspace"
      ? contactOperations.map((tool) => ({ type: "function", function: {
          name: tool.name,
          description: `${tool.description} This function performs only ${tool.operation}; do not send an operation field.`,
          parameters: tool.parameters,
        } }))
      : [{ type: "function", function: {
          name, description: AGENT_TOOL_CATALOG[name].description, parameters: agentToolJsonSchema(name),
        } }]);
    let inputTokens = 0;
    let outputTokens = 0;
    let lastResponseID: string | undefined;
    const permissionDenials: string[] = [];

    for (let turn = 1; turn <= request.budget.maxTurns; turn += 1) {
      if (signal.aborted) throw signal.reason;
      observed?.(null);
      const payload = await this.requestCompletion({
          model: imageModel,
          messages,
          tools: availableTools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          thinking: { type: "enabled" },
          ...(chatModelReasoningEffort(imageModel) ? { reasoning_effort: chatModelReasoningEffort(imageModel) } : {}),
          temperature: 0,
          max_tokens: 1_600,
          stream: false,
        }, AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]), observation,
        restrictScreenshotPrompt(configuredAgentPrompt(request.systemPrompt, preset), request.conversationHistory).revision);
      if (!payload || payload.model !== imageModel) {
        throw new Error("Zhipu Chat Agent returned a different or missing model.");
      }
      observed?.(payload);
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("Zhipu Chat Agent returned no message.");
      lastResponseID = payload.id?.trim() || lastResponseID;
      inputTokens += positiveInteger(payload.usage?.prompt_tokens);
      outputTokens += positiveInteger(payload.usage?.completion_tokens);
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        return {
          structuredOutput: message.content
            ? parseChatAnswerJson(message.content)
            : null,
          inputTokens,
          outputTokens,
          estimatedUsd: 0,
          turns: turn,
          permissionDenials,
          ...(lastResponseID ? { sessionID: lastResponseID } : {}),
          terminalReason: "completed",
        };
      }
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        ...(message.reasoning_content
          ? { reasoning_content: message.reasoning_content }
          : {}),
        tool_calls: calls,
      });
      for (const call of calls) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(call.function.arguments) as unknown;
        } catch {
          parsed = call.function.arguments;
        }
        const operation = contactOperations.find((tool) => tool.name === call.function.name)?.operation;
        const canonicalName = operation ? "contact_workspace" : call.function.name;
        const suppliedOperation = operation && parsed && typeof parsed === "object" && !Array.isArray(parsed)
          && "operation" in parsed;
        const authorized = request.toolManifest.some((name) => name === canonicalName);
        const result: AgentToolResult = !authorized
          ? { ok: false, callID: call.id, name: canonicalName,
              error: { code: "TOOL_NOT_ALLOWED", message: "This function is outside the current immutable Tool manifest." } }
          : suppliedOperation
          ? { ok: false, callID: call.id, name: canonicalName,
              error: { code: "TOOL_INPUT_INVALID", message: "The native function fixes its operation; omit the operation field." } }
          : await invokeTool(canonicalName, operation && parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? { ...parsed, operation } : parsed);
        if (!result.ok) {
          permissionDenials.push(
            `${canonicalName}:${result.error?.code ?? "DENIED"}`,
          );
        }
        if (result.ok && result.name === "contact_workspace" && result.candidateFingerprint) {
          // The host already validated and staged this exact review-only draft.
          // Do not spend another model turn echoing its fingerprint or lose the
          // draft when the successful Tool used the final allowed turn.
          return {
            structuredOutput: {
              outcome: "contact_change_proposal",
              candidate_fingerprint: result.candidateFingerprint,
            },
            inputTokens,
            outputTokens,
            estimatedUsd: 0,
            turns: turn,
            permissionDenials,
            ...(lastResponseID ? { sessionID: lastResponseID } : {}),
            terminalReason: "completed",
          };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        const selection = resolvedContactSelection(result);
        if (selection) {
          return {
            structuredOutput: {
              outcome: "use_contact",
              person_id: selection.personID,
              relationship_context_id: selection.relationshipContextID,
            },
            inputTokens,
            outputTokens,
            estimatedUsd: 0,
            turns: turn,
            permissionDenials,
            ...(lastResponseID ? { sessionID: lastResponseID } : {}),
            terminalReason: "completed",
          };
        }
      }
    }
    return {
      structuredOutput: null,
      inputTokens,
      outputTokens,
      estimatedUsd: 0,
      turns: request.budget.maxTurns,
      permissionDenials,
      ...(lastResponseID ? { sessionID: lastResponseID } : {}),
      terminalReason: "max_turns",
    };
  }
}

export function createEnvironmentChatAnswerProvider(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): RemoteChatAnswerProviding | null {
  const admission = environment.TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING
    ?.trim()
    .toLowerCase();
  if (!admission || admission === "false") return null;
  if (admission !== "true") {
    throw new Error(
      "TALENT_SIGNAL_ALLOW_REMOTE_CHAT_PROCESSING must be true or false.",
    );
  }
  if (environment.TALENT_SIGNAL_CHAT_PROVIDER?.trim() === "claude") {
    return configuredClaudeChatProvider(environment);
  }
  if (environment.TALENT_SIGNAL_CHAT_PROVIDER?.trim() === "deepseek") {
    const apiKey = environment.DEEPSEEK_API_KEY?.trim();
    const model = environment.TALENT_SIGNAL_CHAT_MODEL?.trim();
    if (!apiKey) throw new Error("Remote Chat DeepSeek admission requires DEEPSEEK_API_KEY.");
    if (model !== DEEPSEEK_TEXT_TASK_MODEL) {
      throw new Error("Remote Chat DeepSeek admission requires TALENT_SIGNAL_CHAT_MODEL=deepseek-flash.");
    }
    if (environment.TALENT_SIGNAL_CHAT_VISION_MODEL?.trim()) {
      throw new Error("DeepSeek relationship text tasks do not accept a vision model.");
    }
    return new DeepSeekRelationshipTextProvider({
      observer: createEnvironmentRuntimeObserver(environment),
      apiKey,
      model,
      fetcher,
    });
  }
  if (environment.TALENT_SIGNAL_CHAT_PROVIDER?.trim() !== "zhipu") {
    throw new Error("Remote Chat admission requires TALENT_SIGNAL_CHAT_PROVIDER=zhipu, claude or deepseek.");
  }
  const apiKey = environment.ZHIPU_API_KEY?.trim();
  const model = environment.TALENT_SIGNAL_CHAT_MODEL?.trim();
  if (!apiKey) throw new Error("Remote Chat admission requires ZHIPU_API_KEY.");
  if (!model) {
    throw new Error("Remote Chat admission requires TALENT_SIGNAL_CHAT_MODEL.");
  }
  const timeoutRaw = environment.TALENT_SIGNAL_CHAT_TIMEOUT_MS?.trim();
  const visionModel = environment.TALENT_SIGNAL_CHAT_VISION_MODEL?.trim();
  const sensitiveAdmission = environment.TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING
    ?.trim()
    .toLowerCase();
  if (visionModel && sensitiveAdmission !== "true") {
    throw new Error(
      "Remote Chat vision requires TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING=true.",
    );
  }
  return new ZhipuChatAnswerProvider({
    observer: createEnvironmentRuntimeObserver(environment),
    apiKey,
    model,
    ...(sensitiveAdmission === "true" && visionModel ? { visionModel } : {}),
    baseUrl: environment.ZHIPU_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS,
    fetcher,
  });
}

export const CHAT_PROMPT_REVISION = createHash("sha256")
  .update(RELATIONSHIP_SYSTEM_PROMPT).digest("hex").slice(0, 16);
