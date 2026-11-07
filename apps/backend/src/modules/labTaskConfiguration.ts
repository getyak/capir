import { snapshotProviderRunConfiguration } from "@talent-signal/agent";
import { WorkspaceConversationFinalOutputSchema, type AgentProvider } from "@talent-signal/agent";
import { bundledPrompt, promptRevision, promptReference, type PromptSnapshot } from "@talent-signal/agent/prompt-registry";
import { configuredAgentPrompt, configuredChatPrompt, type AgentRunConfigurationEvidence, type ChatPromptPreset, type RemoteChatAnswerProviding,
  type RemoteChatAnswerRequest, type RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import { ApiError } from "../lib/apiError.js";

export type LabTaskKind = "relationship_text" | "relationship_image" | "unscoped_chat";
export interface LabTaskModel {
  task: LabTaskKind;
  model: string;
  provider: RemoteChatAnswerProviding;
  promptPresets: ChatPromptPreset[];
}

/** An image choice names the actual admitted image model; it never silently uses a text model. */
export function taskModelCatalog(providers: Iterable<RemoteChatAnswerProviding>): LabTaskModel[] {
  const entries = new Map<string, LabTaskModel>();
  for (const provider of providers) {
    const promptPresets: ChatPromptPreset[] = provider.supportsPromptPresets
      ? ["baseline", "concise", "evidence_first"] : ["baseline"];
    for (const task of ["relationship_text", "unscoped_chat"] as const) {
      if (task === "unscoped_chat" && isAgentProvider(provider) && !provider.runWithPromptPreset) continue;
      entries.set(`${task}:${provider.model}`, { task, model: provider.model, provider, promptPresets });
    }
    if (provider.supportsImageInput && provider.imageModel) {
      entries.set(`relationship_image:${provider.imageModel}`, {
        task: "relationship_image", model: provider.imageModel, provider, promptPresets,
      });
    }
  }
  return [...entries.values()];
}

function isAgentProvider(provider: RemoteChatAnswerProviding): provider is RemoteChatAnswerProviding & AgentProvider {
  return "run" in provider && typeof provider.run === "function";
}

export function taskPromptSnapshot(entry: LabTaskModel): PromptSnapshot {
  return bundledPrompt(entry.task === "unscoped_chat"
    ? isAgentProvider(entry.provider) ? "assistant/workspace" : "assistant/conversation" : "assistant/relationship");
}

export function taskPromptRevision(entry: LabTaskModel, preset: ChatPromptPreset, snapshot = taskPromptSnapshot(entry)): string {
  if (snapshot.name !== taskPromptSnapshot(entry).name || promptRevision(snapshot.text) !== snapshot.revision) throw new Error("Invalid frozen prompt snapshot.");
  if (entry.provider.effectivePrompt) return entry.provider.effectivePrompt(snapshot.text, preset,
    entry.task === "unscoped_chat" && isAgentProvider(entry.provider) ? "workspace" : "relationship").revision;
  if (entry.task === "unscoped_chat" && isAgentProvider(entry.provider)) {
    return configuredAgentPrompt(snapshot.text, preset).revision;
  }
  return configuredChatPrompt(entry.task === "unscoped_chat" ? "unscoped_conversation" : "relationship", preset, snapshot.text).revision;
}

export interface TrialRunMeasurement {
  execution: "remote" | "local_only" | "unknown";
  remote_requests_started: number | null;
  requested_model: string;
  resolved_model: string;
  actual_model: string | null;
  prompt_revision: string;
  actual_prompt_revision: string | null;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  provider_request_id: string | null;
  status: "completed" | "failed";
  error_code: string | null;
}

/** Capture only configuration and timing. The caller persists this after its product transaction ends. */
export function trialProvider(entry: LabTaskModel, preset: ChatPromptPreset,
  measured: (measurement: TrialRunMeasurement) => void, snapshot = taskPromptSnapshot(entry)): RemoteChatAnswerProviding {
  snapshot = Object.freeze({ ...snapshot });
  if (!entry.promptPresets.includes(preset)) throw new ApiError(422, "LAB_PROMPT_UNAVAILABLE", "Choose an admitted prompt preset.");
  const mode = entry.task === "unscoped_chat" ? "unscoped_conversation" : "relationship";
  const promptRevision = taskPromptRevision(entry, preset, snapshot);
  const wrapped: RemoteChatAnswerProviding = {
    providerId: entry.provider.providerId,
    model: entry.model,
    supportsImageInput: entry.task === "relationship_image",
    imageModel: entry.task === "relationship_image" ? entry.model : null,
    supportsPromptPresets: entry.provider.supportsPromptPresets === true,
    async answer(request: RemoteChatAnswerRequest): Promise<RemoteChatAnswerResult> {
      if (entry.task === "unscoped_chat" && isAgentProvider(entry.provider)) {
        throw new Error("The frozen Agent trial cannot fall back to a different prompt template.");
      }
      const start = performance.now();
      let actual: RemoteChatAnswerResult | undefined;
      let status: TrialRunMeasurement["status"] = "failed";
      let dispatched = false;
      try {
        if (((request.images?.length ?? 0) > 0) !== (entry.task === "relationship_image")
          || (request.mode ?? "relationship") !== mode) {
          throw new Error("Task input capability changed.");
        }
        dispatched = true;
        actual = await entry.provider.answer({ ...request, prompt_snapshot: snapshot,
          ...(entry.provider.supportsPromptPresets ? { prompt_preset: preset } : {}) });
        if (actual.model !== entry.model
          || (entry.provider.matchesReportedModel && !entry.provider.matchesReportedModel(actual.reported_model ?? null))
          || (entry.provider.supportsPromptPresets && actual.prompt_revision !== promptRevision)) {
          throw new Error("Actual configuration did not match the trial.");
        }
        status = "completed";
        return actual;
      } finally {
        measured({ execution: actual ? "remote" : dispatched ? "unknown" : "local_only",
          remote_requests_started: actual ? actual.remote_requests_started === undefined ? 1 : actual.remote_requests_started : dispatched ? null : 0,
          requested_model: entry.model, resolved_model: entry.model,
          actual_model: actual ? Object.hasOwn(actual, "reported_model") ? actual.reported_model ?? null : actual.model : null, prompt_revision: promptRevision,
          actual_prompt_revision: actual?.prompt_revision ?? null,
          duration_ms: Math.round(performance.now() - start),
          input_tokens: actual?.usage_reported ? actual.input_tokens : null,
          output_tokens: actual?.usage_reported ? actual.output_tokens : null,
          provider_request_id: actual?.provider_request_id ?? null, status,
          error_code: status === "completed" ? null : "TRIAL_PROVIDER_FAILED_OR_UNVERIFIED" });
      }
    },
  };
  if (entry.task === "unscoped_chat" && isAgentProvider(entry.provider)) {
    const original = entry.provider;
    if (!original.runWithPromptPreset) throw new ApiError(422, "LAB_AGENT_TRIAL_UNAVAILABLE", "This Agent does not support scoped configuration trials.");
    const run: AgentProvider["run"] = async (request, invokeTool, signal) => {
      const start = performance.now();
      let evidence: AgentRunConfigurationEvidence | undefined;
      let status: TrialRunMeasurement["status"] = "failed";
      try {
        const result = await original.runWithPromptPreset!({ ...request, systemPrompt: snapshot.text }, invokeTool, signal, preset, (value) => { evidence = value; });
        WorkspaceConversationFinalOutputSchema.parse(result.structuredOutput);
        if (!evidence || evidence.prompt_revision !== promptRevision
          || ((evidence.requests_started !== 0 || evidence.responses_received > 0) && (!(original.matchesReportedModel ? original.matchesReportedModel(evidence.actual_model) : evidence.actual_model === entry.model) || evidence.actual_prompt_revision !== promptRevision))) {
          throw new Error("Actual Agent configuration did not match the trial.");
        }
        status = "completed";
        return { ...result, prompt: promptReference(snapshot) };
      } finally {
        measured({ requested_model: entry.model, resolved_model: entry.model,
          actual_model: evidence?.actual_model ?? null, prompt_revision: promptRevision,
          actual_prompt_revision: evidence?.actual_prompt_revision ?? null,
          execution: evidence ? evidence.responses_received > 0 || (evidence.requests_started ?? 0) > 0 ? "remote" : evidence.requests_started === 0 ? "local_only" : "unknown" : "unknown",
          remote_requests_started: evidence?.requests_started ?? null,
          duration_ms: Math.round(performance.now() - start), input_tokens: evidence?.input_tokens ?? null,
          output_tokens: evidence?.output_tokens ?? null, provider_request_id: evidence?.provider_request_id ?? null,
          status, error_code: status === "completed" ? null : "TRIAL_AGENT_FAILED_OR_UNVERIFIED" });
      }
    };
    Object.assign(wrapped, { id: original.id, sdkVersion: original.sdkVersion, inputCapabilities: original.inputCapabilities,
      runConfiguration: snapshotProviderRunConfiguration(original.runConfiguration), run });
  }
  return wrapped;
}
