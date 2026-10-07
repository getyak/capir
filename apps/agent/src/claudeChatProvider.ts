import {runFileTools} from "./runFileTools.js";
import { z } from "zod";
import { responsePreferenceTool, responsePreferenceContext, RESPONSE_PREFERENCE_INSTRUCTIONS } from "./responsePreference.js";
import { MEMORY_CONTEXT_INSTRUCTIONS } from "./memoryContext.js";
import { evidenceImageTools } from "./evidenceImageTool.js";
import { calendarDraftCapability } from "./calendarDraft.js";
import { ClaudeHarnessFailure, ClaudeHarnessInterruption, runClaudeHarness, type ClaudeHarnessResult, type HarnessTool } from "./claudeHarness.js";
import { claudeHarnessConfiguration, type ClaudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import { boundedConversationHistory, type RemoteChatAnswerProviding, type RemoteChatAnswerRequest, type RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import { ContactWorkspaceInputSchema } from "./schemas.js";
import {
  MEMORY_REVIEW_TOOL_DESCRIPTION,
  MemoryReviewInputSchema,
  MemoryReviewToolInputSchema,
  memoryLocatorAdmissionError,
} from "./memorySchemas.js";
import { AGENT_TOOL_CATALOG, contactWorkspaceOperationTools } from "./toolCatalog.js";
import { AGENT_BUDGET_CEILING as DEFAULT_AGENT_BUDGET } from "./runtimePolicy.js";
import { JSON_OUTPUT_PROTOCOL as CONVERSATION_JSON_PROTOCOL } from "./prompts/assistant-conversation.js";
import { JSON_OUTPUT_PROTOCOL as RELATIONSHIP_JSON_PROTOCOL } from "./prompts/assistant-relationship.js";
import { applyChatPreset } from "./relationshipTaskConfiguration.js";
import type { AgentRunConfigurationEvidence, ChatPromptPreset } from "./chatAnswerProvider.js";
import { createHash } from "node:crypto";
import { resolveProductPrompt } from "./promptRegistry.js";
import { CLAUDE_SDK_VERSION } from "./claudeSdkVersion.js";
import type { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolResult } from "./types.js";

export const CLAUDE_NATURAL_OUTPUT_GUIDANCE = "For this SDK execution, respond with natural prose, not a JSON object or a code fence. Structured data is supplied only through product tools. When context.session_title_requested is true, start the final response with exactly one metadata line in the form <session_title>concise title</session_title>, followed by a blank line and the natural prose reply. The title is for a person scanning Sessions weeks later: use the user's language, name the concrete topic or task, prefer verb plus object, keep it on one line and within 32 characters, and never use generic labels such as Reply, Answer, Hello, 回复, 回答, or 你好. Do not emit this metadata line when session_title_requested is false. Never claim a contact, memory or calendar write without a successful tool receipt. Use only tools supplied in this Run. If contact_workspace or its search/read operation tools are supplied and the user asks about a named contact, first search that name from the current message using the supplied contact search tool; a name is sufficient for a read-only lookup, even though it is not sufficient to create a contact. Read a uniquely grounded match so the product can continue in its relationship scope. A successful read completes this routing step: briefly acknowledge the found contact and stop; the product obtains relationship evidence in the scoped continuation. Do not infer missing records from the directory header or keep searching for an unavailable Memory tool. Ask for another identity clue only after the lookup is empty or ambiguous. Missing relationship Memory in an unscoped conversation is not a reason to skip this directory lookup or claim no contact access. If read_relationship_memory is supplied, it retrieves the current governed product snapshot independently of past Session dialogue. Preserve each block's status and source provenance. Cite relationship evidence through cite_evidence before answering factual relationship questions. Complete the source reads and citation selection before composing the final answer; essential conclusions must appear in that final answer, not only in tool prefaces. When asked to recall an existing fact, state it with its source status and stop; do not turn recall into unsolicited planning or offer unavailable write capabilities. For recollection, lead with what the record says, explicitly attributed to that record rather than asserted as a confirmed event. An unconfirmed source report can still answer what was recorded: do not lead with the absence of confirmed facts, repeat that caveat, expose internal status labels such as proposed, or suggest verifying the record unless a material ambiguity prevents answering. Source IDs do not belong in the prose.";

/** Workspace routing has no scoped evidence-reading tools. Keep that unrelated
 * protocol out of image Runs, whose tool round trips resend the visual context. */
export const CLAUDE_WORKSPACE_OUTPUT_GUIDANCE = `Respond in natural prose, not JSON or a code fence. Use tools only through their function interface. If context.session_title_requested is true, begin the final reply with <session_title>concise concrete title in the user's language, within 32 characters</session_title>, then a blank line and the useful answer. Otherwise omit this metadata. Never claim a contact, memory, or calendar was saved without a successful commit receipt. A staged proposal is only ready for human review. For an authored-text question about a named contact, first search the exact current clue; a name is sufficient for a read-only lookup, but never identity confirmation or a contact write. A uniquely authorized contact read completes routing: briefly acknowledge it and stop; the host continues in that relationship scope. For a name-only screenshot, prepare the memory_review contact decision directly; a name cannot authorize private recall. Essential conclusions belong in the final answer. Omit internal IDs and tool terminology.`;

/**
 * Bounded, one-line fallback label derived from the objective. Mirrors the
 * backend canonicalization budget (32 user-perceived characters) without
 * importing backend code; the backend re-canonicalizes for final storage.
 */
export function boundedTitleFallback(objective: string): string {
  const oneLine = objective.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!oneLine) return /\p{Script=Han}/u.test(objective) ? "回复" : "Reply";
  let segmented: string[];
  try {
    segmented = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(oneLine), part => part.segment);
  } catch {
    segmented = Array.from(oneLine);
  }
  let codePoints = 0;
  const accepted: string[] = [];
  for (const segment of segmented) {
    const size = Array.from(segment).length;
    if (accepted.length >= 32 || codePoints + size > 256) break;
    accepted.push(segment);
    codePoints += size;
  }
  return accepted.join("").trim() || (/\p{Script=Han}/u.test(objective) ? "回复" : "Reply");
}

export function splitFirstTurnSessionTitle(text: string, objective: string): { title: string; body: string } {
  // Remove the envelope independently from validating its optional metadata.
  const match = text.match(/^\s*<session_title>([\s\S]*?)<\/session_title>[ \t]*(?:\r?\n[ \t]*)*/u);
  let body = (match ? text.slice(match[0].length) : text).trim();
  while (body.startsWith("<session_title>")) {
    const extra = body.match(/^<session_title>[\s\S]*?<\/session_title>\s*/u);
    if (extra) body = body.slice(extra[0].length).trim();
    else {
      // An unclosed metadata line is unusable; retain subsequent answer lines.
      const newline = body.indexOf("\n");
      body = newline < 0 ? "" : body.slice(newline + 1).trim();
    }
  }
  const candidate = match?.[1]?.trim();
  const title = candidate && !/[<>\r\n]/u.test(candidate) && Array.from(candidate).length <= 256
    ? candidate : boundedTitleFallback(objective);
  return {
    title,
    body,
  };
}

export function configuredClaudeChatPrompt(text: string, preset: ChatPromptPreset = "baseline", scope: "relationship" | "workspace" = "relationship") {
  // Remove only the formal legacy transport clause; preserve all task/source policy.
  const protocols = [
    CONVERSATION_JSON_PROTOCOL,
    RELATIONSHIP_JSON_PROTOCOL,
    'Return JSON {"kind":"answer"|"clarification","title":string,"body":string,"citation_ids":[]}.',
    'Return JSON {"kind":"answer"|"question_set"|"clarification","title":string,"body":string,"citation_ids":string[]}.',
  ];
  const natural = protocols.reduce((prompt, protocol) => prompt.replace(protocol, ""), text);
  return applyChatPreset(`${natural}\n\n${scope === "workspace" ? CLAUDE_WORKSPACE_OUTPUT_GUIDANCE : CLAUDE_NATURAL_OUTPUT_GUIDANCE}`, preset);
}

/** Adapts natural SDK output to the existing cross-client product response. */
export class ClaudeChatProvider implements RemoteChatAnswerProviding, AgentProvider {
  readonly providerId = "claude-agent-sdk" as const;
  readonly id = "claude-agent-sdk";
  readonly sdkVersion = CLAUDE_SDK_VERSION;
  readonly supportsPromptPresets = true;
  readonly effectivePrompt = configuredClaudeChatPrompt;
  matchesReportedModel(reported: string | null): boolean {
    return reported === this.model || (this.configuration.baseUrl === "https://api.hao.ai/anthropic"
      && this.model.startsWith("anthropic/") && reported === this.model.slice("anthropic/".length));
  }
  readonly supportsImageInput: boolean;
  readonly inputCapabilities;
  readonly model: string;
  get imageModel() { return this.supportsImageInput ? this.model : null; }
  constructor(private readonly configuration: ClaudeHarnessConfiguration,
    private readonly execute: typeof runClaudeHarness = runClaudeHarness,
    imageInputEnabled = false,
  ) {
    this.model = configuration.model;
    this.supportsImageInput = imageInputEnabled;
    this.inputCapabilities = { text: true, image: imageInputEnabled, imageUnderstanding: imageInputEnabled, steering: true };
  }

  async answer(request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
    if (!request.objective.trim()) throw new Error("CLAUDE_CHAT_OBJECTIVE_REQUIRED");
    if (request.reference_time !== undefined && !Number.isFinite(Date.parse(request.reference_time))) throw new Error("CLAUDE_CHAT_REFERENCE_TIME_INVALID");
    if (request.mode === "unscoped_conversation" && (request.context_blocks.length || request.allowed_citation_ids.length)) {
      throw new Error("CLAUDE_CHAT_UNSCOPED_CONTEXT_DENIED");
    }
    if (request.images?.length && !this.supportsImageInput) throw new Error("CLAUDE_CHAT_IMAGE_NOT_ADMITTED");
    const snapshot = request.prompt_snapshot ?? await resolveProductPrompt(request.mode === "unscoped_conversation" ? "assistant/conversation" : "assistant/relationship");
    const prompt = configuredClaudeChatPrompt(snapshot.text, request.prompt_preset);
    const sessionTitleRequested = request.session_title_requested === true;
    const allowed = new Set(request.allowed_citation_ids);
    let citations: string[] = [];
    const tools: HarnessTool[] = allowed.size ? [{
      name: "cite_evidence", description: "Select exact allowed source IDs supporting the answer. Does not modify records.",
      schema: z.strictObject({ source_ids: z.array(z.string()).min(1).max(20) }), readOnly: true, alwaysLoad: true,
      execute: async (input) => {
        const ids = input.source_ids as string[];
        if (ids.some((id) => !allowed.has(id))) return { content: [{ type: "text", text: "CITATION_OUTSIDE_CURRENT_SCOPE: use only the supplied allowed source IDs." }], isError: true };
        citations = [...new Set(ids)];
        return { content: [{ type: "text", text: JSON.stringify({ cited_source_ids: citations }) }] };
      },
    }] : [];
    if (request.mode !== "unscoped_conversation" && request.context_blocks.length) tools.push({
      name: "read_relationship_memory",
      description: "Read the current authorized relationship Memory from the product database snapshot. Filter by block type, or omit the filter to read all available blocks. The identity_context always accompanies filtered blocks and identifies whose relationship these records belong to; a source fragment need not repeat that person's name. Returns source IDs and confirmed/unconfirmed status; does not write or use earlier Session transcripts. For simple recollection, answer what the record says and stop. Preserve imprecise dates and unspecified details as recorded; resolving them or contacting the person is needed only if the user asks to schedule or act, not merely to remember. Attribution to the record is enough to distinguish an unconfirmed report without an unsolicited verification task.",
      schema: z.strictObject({ block_types: z.array(z.string().min(1).max(80)).max(20).optional() }),
      readOnly: true, alwaysLoad: true,
      execute: async input => {
        const types = input.block_types as string[] | undefined;
        const blocks = request.context_blocks.filter(block => !types?.length || types.includes(block.type));
        return { content: [{ type: "text", text: JSON.stringify({ authority: "governed_relationship_snapshot_not_execution_permission",
          identity_context: request.context_blocks.filter(block => block.type === "identity_context"),
          blocks, available_block_types: [...new Set(request.context_blocks.map(block => block.type))] }) }] };
      },
    });
    const imageGuards = new Map<string, () => Promise<void>>();
    let memoryProposal: RemoteChatAnswerResult["memoryProposal"];
    if (request.memoryReview) {
      const hooks = request.memoryReview;
      tools.push({
        name: "memory_review",
        description: MEMORY_REVIEW_TOOL_DESCRIPTION,
        schema: MemoryReviewToolInputSchema,
        readOnly: false,
        alwaysLoad: true,
        execute: async (input) => {
          const parsedMemory = MemoryReviewInputSchema.safeParse(input);
          if (!parsedMemory.success) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "TOOL_INPUT_INVALID" }) }], isError: true };
          }
          const review = parsedMemory.data;
          if (review.operation === "recall") {
            if (review.scope === "self") return { content: [{ type: "text", text: "MEMORY_SCOPE_NOT_AVAILABLE" }], isError: true };
            const recalled = await hooks.recall({ scope: review.scope, cursor: review.cursor });
            return { content: [{ type: "text", text: JSON.stringify({
              authority: "accepted_relationship_memory_not_execution_permission",
              ...recalled,
            }) }] };
          }
          const locatorError = memoryLocatorAdmissionError(
            review.items,
            images.map((_image, index) => `image-${index}`),
          );
          if (locatorError) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "MEMORY_SOURCE_NOT_ADMITTED" }) }], isError: true };
          }
          const staged = await hooks.stage({
            contact_decision: review.contact_decision,
            person_display_label: review.person_display_label ?? null,
            items: review.items,
          });
          if (!staged) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "no_material_change" }) }] };
          }
          memoryProposal = {
            proposal_id: staged.proposal_id,
            proposal_revision: staged.proposal_revision,
            item_count: staged.item_count,
            default_selected_count: staged.default_selected_count,
          };
          return { content: [{ type: "text", text: JSON.stringify({
            status: "needs_review",
            proposal_id: staged.proposal_id,
            proposal_revision: staged.proposal_revision,
            item_count: staged.item_count,
            default_selected_count: staged.default_selected_count,
          }) }] };
        },
      });
    }
    const abort = new AbortController();
    const external = request.signal;
    if (external) {
      if (external.aborted) abort.abort(external.reason);
      else external.addEventListener("abort", () => abort.abort(external.reason), { once: true });
    }
    const assertCurrent = async () => { await request.assertCurrent?.(); for (const guard of imageGuards.values()) await guard(); };
    const sourceImageTools = evidenceImageTools(request, this.supportsImageInput, (id, guard) => imageGuards.set(id, guard));
    tools.push(...responsePreferenceTool(request.responsePreference), ...sourceImageTools);
    const files = runFileTools(request.mode !== "unscoped_conversation" && request.assertCurrent ? request.runFiles : undefined);
    tools.push(...files.tools);
    const calendar = calendarDraftCapability(request.calendarContext, request.objective);
    tools.push(...calendar.tools);
    const images = (request.images ?? []).map((image, index) => ({ kind: "image" as const,
      artifactID: `image-${index}`, mimeType: image.media_type, byteSize: image.data.byteLength,
      contentHash: createHash("sha256").update(image.data).digest("hex"), dataBase64: Buffer.from(image.data).toString("base64") }));
    const result = await this.execute(this.configuration, {
      ...(request.observation ? { observation: request.observation } : {}),
      ...(request.continuation && !sourceImageTools.length ? { continuation: request.continuation } : {}),
      imageToolResults: Boolean(sourceImageTools.length),
      objective: request.objective, systemPrompt: [prompt.text, calendar.instructions, request.responsePreference ? RESPONSE_PREFERENCE_INSTRUCTIONS : "", files.tools.length ? "For a requested calculation or file export, lead with the result and artifact name, and attribute the inputs to the record once. Read source review status from evidence_review; a proposed relationship block does not make the reviewed source excerpt unreviewed. Do not expose internal status words such as proposed or repeat an uncertainty caveat after already attributing the result to recorded data. Preserve any actual ambiguity that affects the calculation." : ""].filter(Boolean).join("\n\n"), tools, images,
      context: JSON.stringify({ calendar_clock: calendar.clock, reference_time: request.reference_time, conversation: boundedConversationHistory(request.conversation_history),
        session_title_requested: sessionTitleRequested,
        run_files: files.inventory,
        memory_inventory: request.context_blocks.map(block => ({ type: block.type, status: block.status })),
        allowed_citation_ids: request.allowed_citation_ids, response_preference_available: Boolean(request.responsePreference),
        assistant_service_preference: responsePreferenceContext(request.responsePreference) }),
      ...(request.calendarContext ? { preparationReady: () => Boolean(calendar.draft()) } : {}),
      effort: "medium", budget: { ...DEFAULT_AGENT_BUDGET, maxDurationMs: 60_000 }, assertCurrent,
    }, abort.signal);
    await assertCurrent();
    const parsedOutput = splitFirstTurnSessionTitle(result.text, request.objective);
    const body = parsedOutput.body;
    if ((!body && !calendar.draft()) || body.length > 16_000) throw new Error("CLAUDE_CHAT_ANSWER_INVALID");
    // No citation receipt means the host cannot label prose as a grounded answer.
    const kind = request.mode !== "unscoped_conversation" && allowed.size > 0 && !citations.length ? "clarification" : "answer";
    return { kind, title: /\p{Script=Han}/u.test(request.objective) ? "回复" : "Reply", body,
      ...(sessionTitleRequested ? { session_title: parsedOutput.title } : {}),
      ...(calendar.draft() ? { calendarDraft: calendar.draft()! } : {}),
      citation_ids: citations, provider_id: this.providerId, model: this.model, provider_request_id: result.sessionID,
      ...(memoryProposal ? { memoryProposal } : {}),
      input_tokens: result.inputTokens, output_tokens: result.outputTokens, usage_reported: true,
      reported_model: result.reportedModels.length === 1 ? result.reportedModels[0]! : null, remote_requests_started: null,
      prompt_revision: prompt.revision, prompt_snapshot: snapshot };
  }

  async run(request: AgentProviderRequest, invokeTool: (name: string, input: unknown, executionSignal?: AbortSignal) => Promise<AgentToolResult>, signal: AbortSignal): Promise<AgentProviderResult> {
    return this.runInternal(request, invokeTool, signal, "baseline");
  }

  async runWithPromptPreset(request: AgentProviderRequest, invokeTool: Parameters<AgentProvider["run"]>[1],
    signal: AbortSignal, preset: ChatPromptPreset, observed: (evidence: AgentRunConfigurationEvidence) => void): Promise<AgentProviderResult> {
    const prompt = request.outputMode === "json" ? applyChatPreset(request.systemPrompt, preset)
      : configuredClaudeChatPrompt(request.systemPrompt, preset, "workspace");
    let receipt: Omit<ClaudeHarnessResult, "text" | "structuredOutput"> | ClaudeHarnessInterruption["receipt"] | undefined;
    try {
      return await this.runInternal(request, invokeTool, signal, preset, value => { receipt = value; });
    } catch (error) {
      if (error instanceof ClaudeHarnessFailure || error instanceof ClaudeHarnessInterruption) receipt = error.receipt;
      throw error;
    } finally {
      observed({ actual_model: receipt?.reportedModels.length === 1 ? receipt.reportedModels[0]! : null,
        prompt_revision: prompt.revision, actual_prompt_revision: receipt ? prompt.revision : null,
        requests_started: null, responses_received: receipt?.modelResponses ?? 0,
        input_tokens: receipt && !("usageComplete" in receipt && receipt.usageComplete === false) ? receipt.inputTokens : null,
        output_tokens: receipt && !("usageComplete" in receipt && receipt.usageComplete === false) ? receipt.outputTokens : null,
        provider_request_id: receipt?.sessionID ?? null });
    }
  }

  private async runInternal(request: AgentProviderRequest, invokeTool: Parameters<AgentProvider["run"]>[1], signal: AbortSignal,
    preset: ChatPromptPreset, observed?: (receipt: ClaudeHarnessResult) => void): Promise<AgentProviderResult> {
    if (request.scopeSummary.kind !== "workspace_conversation") throw new Error("CLAUDE_CHAT_SCOPE_UNSUPPORTED");
    const userImages = (request.inputParts ?? []).filter(part => part.kind === "image");
    const userImageNotes = (request.inputParts ?? []).filter(part => part.kind === "text")
      .map(part => ({ artifact_id: part.artifactID, text: part.text }));
    if (userImages.length > 0 && !this.supportsImageInput) throw new Error("CLAUDE_CHAT_IMAGE_NOT_ADMITTED");
    let receipt: Record<string, unknown> | null = null;
    const sessionTitleRequested = request.sessionTitleRequested === true;
    const calendar = calendarDraftCapability(request.calendarContext, request.objective);
    let searched = false;
    const tools: HarnessTool[] = request.toolManifest.flatMap((name): HarnessTool[] => {
      const definition = AGENT_TOOL_CATALOG[name];
      // Each SDK tool receives its actual required fields, not the lossy union
      // envelope. Every operation still invokes the same governed host seam.
      const variants = name === "contact_workspace"
        ? ContactWorkspaceInputSchema.options.map(schema => {
          const operation = schema.shape.operation.value;
          const description = contactWorkspaceOperationTools().find(entry => entry.operation === operation)!;
          return { name: description.name, description: description.description,
            schema: (schema as z.ZodObject).omit({ operation: true }), readOnly: operation === "search" || operation === "read", operation };
        })
        : [{ name, description: definition.description, schema: definition.schema, readOnly: definition.readOnly, operation: undefined }];
      return variants.map(variant => ({ name: variant.name, description: variant.description,
        schema: variant.schema, readOnly: variant.readOnly, alwaysLoad: true,
        execute: async (input, executionSignal) => {
          executionSignal.throwIfAborted();
          if (name === "contact_workspace") {
            request.onProgress?.(variant.operation === "search" ? "contact_lookup" : "contact_read");
          }
          // Validate even direct adapter dispatch; operation is host-selected.
          const parsed = variant.schema.safeParse(input);
          if (!parsed.success) return { content: [{ type: "text", text: JSON.stringify({ error: "TOOL_INPUT_INVALID" }) }], isError: true };
          const result = await invokeTool(name, variant.operation ? { ...parsed.data, operation: variant.operation } : parsed.data, executionSignal);
          if (result.ok) {
            const data = result.data as Record<string, any> | undefined;
            if (data?.operation === "search") searched = true;
            if (data?.operation === "read" && data.person?.id && data.relationship_context?.id) receipt = {
              outcome: "use_contact", person_id: data.person.id, relationship_context_id: data.relationship_context.id,
            };
            // A Memory proposal reference travels outside the contact event and
            // must never masquerade as a contact-change fingerprint.
            if (name === "contact_workspace" && result.candidateFingerprint) receipt = { outcome: "contact_change_proposal", candidate_fingerprint: result.candidateFingerprint };
          }
          return { content: [{ type: "text", text: JSON.stringify(result) }], isError: !result.ok };
        } }));
    });
    tools.push(...responsePreferenceTool(request.responsePreference), ...calendar.tools, ...(request.supplementalTools ?? []));
    // Host-observed partial text is a forming response only. A host callback
    // exception or abort must never trigger a fallback model execution here.
    const onText = request.outputMode !== "json" && request.onVisibleText
      ? (text: string) => { try { request.onVisibleText?.(text); } catch { /* observation never gates the Run */ } }
      : undefined;
    const supplied = request.observation;
    const trusted = supplied?.run_id === request.runID && supplied.workspace_id === request.scopeSummary.workspaceID
      && supplied.authorization_scope === "workspace_conversation" ? supplied : undefined;
    const outcome = await this.execute(this.configuration, { ...((request.continuation && userImages.length === 0) ? { continuation: request.continuation } : {}), ...(trusted ? { observation: trusted } : {}), objective: request.objective,
      ...(request.messageID ? { messageID: request.messageID } : {}),
      ...(request.steering ? { steering: request.steering } : {}),
      ...(request.calendarContext && request.outputMode !== "json" ? { preparationReady: () => Boolean(calendar.draft()) } : {}),
      ...(request.onToolCompletion ? { onToolCompletion: request.onToolCompletion } : {}),
      ...(onText ? { onText } : {}),
      ...(userImages.length > 0 ? { images: userImages } : {}),
      systemPrompt: [request.outputMode === "json" ? applyChatPreset(request.systemPrompt, preset).text
        : configuredClaudeChatPrompt(request.systemPrompt, preset, "workspace").text, calendar.instructions,
        request.responsePreference ? RESPONSE_PREFERENCE_INSTRUCTIONS : "",
        request.selfMemoryContext ? MEMORY_CONTEXT_INSTRUCTIONS : ""].filter(Boolean).join("\n\n"), tools,
      context: JSON.stringify({ calendar_clock: calendar.clock, scope: request.scopeSummary, conversation: boundedConversationHistory(request.conversationHistory),
        session_title_requested: sessionTitleRequested,
        input_images: userImages.map(part => ({ artifact_id: part.artifactID, mime_type: part.mimeType, byte_size: part.byteSize, content_hash: part.contentHash })),
        input_notes: userImageNotes,
        response_preference_available: Boolean(request.responsePreference),
        assistant_service_preference: responsePreferenceContext(request.responsePreference),
        private_self_memory: request.selfMemoryContext }),
      effort: "low", budget: request.budget, assertCurrent: async () => { signal.throwIfAborted(); await request.assertCurrent?.(); },
    }, signal);
    observed?.(outcome);
    if (request.outputMode === "json") {
      let structuredOutput: unknown = outcome.structuredOutput;
      if (structuredOutput == null) {
        try { structuredOutput = JSON.parse(outcome.text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/```\s*$/u, "")); }
        catch { throw new Error("CLAUDE_CHAT_STRUCTURED_OUTPUT_INVALID"); }
      }
      if (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput)) {
        throw new Error("CLAUDE_CHAT_STRUCTURED_OUTPUT_INVALID");
      }
      return { structuredOutput, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
        estimatedUsd: outcome.estimatedUsd, turns: outcome.turns, permissionDenials: outcome.permissionDenials,
        toolCompletions: outcome.toolCompletions, sessionID: outcome.sessionID, terminalReason: outcome.terminalReason };
    }
    const parsedOutput = splitFirstTurnSessionTitle(outcome.text, request.objective);
    const body = parsedOutput.body;
    // Empty assistant text is legal when real work completed: genuine tool
    // receipts carry the execution record and nothing is fabricated to fill
    // the answer.
    // Empty prose is valid; execution truth remains in the run receipt.
    return { ...(calendar.draft() ? { calendarDraft: calendar.draft()! } : {}),
      ...(sessionTitleRequested ? { sessionTitle: parsedOutput.title } : {}),
      structuredOutput: receipt ?? { outcome: searched && body.trim() ? "clarification" : "reply",
      title: /\p{Script=Han}/u.test(request.objective) ? "回复" : "Reply", body },
      inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, estimatedUsd: outcome.estimatedUsd,
      turns: outcome.turns, permissionDenials: outcome.permissionDenials, toolCompletions: outcome.toolCompletions,
      sessionID: outcome.sessionID, terminalReason: outcome.terminalReason };
  }
}

export function configuredClaudeChatProvider(environment: NodeJS.ProcessEnv) {
  return new ClaudeChatProvider(claudeHarnessConfiguration(environment), runClaudeHarness,
    environment.TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING === "true");
}
