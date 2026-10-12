import { resolveProductPrompt } from "./promptRegistry.js";
import { fingerprint } from "./fingerprint.js";
import {
  assertPublicResearchAuthorization,
  assertPublicResearchQuery,
  AgentPublicResearchPolicyError,
} from "./publicResearchPolicy.js";
import {
  PublicResearchAgentFinalOutputSchema,
  CreateResearchArtifactInputSchema,
  FetchWebInputSchema,
  SearchWebInputSchema,
  type CreateResearchArtifactInput,
  type PublicResearchNoActionOutput,
} from "./schemas.js";
import {
  AgentCapabilityError,
} from "./runtimePolicy.js";
import { agentUsage, assertAgentBudget, exceededBudget } from "./runBudget.js";
import {
  createResearchToolExecution,
  ResearchToolWriteError,
  writeResearchToolState,
} from "./researchToolExecution.js";
import { SYSTEM_AGENT_RUNTIME } from "./runtimeDependencies.js";
import {
  RESEARCH_AGENT_TOOL_NAMES,
  type AgentBudget,
  type AgentFetchedWebPage,
  type AgentPublicResearchNoActionCandidate,
  type AgentProviderResult,
  type AgentPublicResearchCheckpoint,
  type AgentPublicResearchRunRequest,
  type AgentPublicResearchTerminalReceipt,
  type AgentResearchArtifactCandidate,
  type AgentToolResult,
  type AgentWebSearchResult,
} from "./types.js";

export { PUBLIC_RESEARCH_SYSTEM_PROMPT } from "./prompts.js";

type ResearchCandidate =
  | {
      kind: "artifact";
      value: AgentResearchArtifactCandidate;
      fingerprint: string;
    }
  | {
      kind: "no_action";
      value: AgentPublicResearchNoActionCandidate;
      fingerprint: string;
    };

interface PublicResearchRunState {
  candidate: ResearchCandidate | null;
  boundaryFailure: PublicResearchBoundaryError | null;
}

class PublicResearchBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertBudget(budget: AgentBudget): void {
  assertAgentBudget(budget, ({ field, violation }) => {
    throw new AgentPublicResearchPolicyError(
      "AGENT_BUDGET_INVALID",
      violation === "positive"
        ? `${field} must be positive.`
        : `${field} exceeds the Agent ceiling.`,
    );
  });
}

function artifactCandidate(
  input: CreateResearchArtifactInput,
  fetchedPages: ReadonlyMap<string, AgentFetchedWebPage>,
): AgentResearchArtifactCandidate {
  const sourceRefs = new Set<string>();
  const claims = input.claims.map((claim) => {
    if (new Set(claim.source_refs).size !== claim.source_refs.length) {
      throw new PublicResearchBoundaryError(
        "ARTIFACT_SOURCE_DUPLICATE",
        "A research claim cannot cite one fetched page more than once.",
      );
    }
    for (const resultID of claim.source_refs) {
      if (!fetchedPages.has(resultID)) {
        throw new PublicResearchBoundaryError(
          "ARTIFACT_SOURCE_NOT_FETCHED",
          "Every research claim must cite only pages fetched in this run.",
        );
      }
      sourceRefs.add(resultID);
    }
    return {
      statement: claim.statement,
      sourceRefs: [...claim.source_refs],
    };
  });
  return {
    title: input.title,
    summary: input.summary,
    limitations: input.limitations,
    claims,
    sources: [...sourceRefs].map((resultID) => {
      const page = fetchedPages.get(resultID);
      if (!page) {
        throw new PublicResearchBoundaryError(
          "ARTIFACT_SOURCE_NOT_FETCHED",
          "Every research claim must cite only pages fetched in this run.",
        );
      }
      return {
        resultID,
        url: page.canonicalUrl,
        title: page.title,
        contentHash: page.contentHash,
        retrievedAt: page.retrievedAt,
      };
    }),
  };
}

function noActionCandidate(
  input: PublicResearchNoActionOutput,
): AgentPublicResearchNoActionCandidate {
  return {
    reasonCode: input.reason_code,
    reason: input.reason,
    missingEvidenceRefs: input.missing_evidence_refs,
  };
}

function checkpoint(
  searchResults: ReadonlyMap<string, AgentWebSearchResult>,
  fetchedPages: ReadonlyMap<string, AgentFetchedWebPage>,
  searchCalls: number,
  fetchCalls: number,
  toolCalls: number,
  sequence: number,
): AgentPublicResearchCheckpoint {
  return {
    searchResults: [...searchResults.values()],
    fetchedPages: [...fetchedPages.values()],
    searchCalls,
    fetchCalls,
    toolCalls,
    sequence,
  };
}

export async function runPublicResearchAgent(
  request: AgentPublicResearchRunRequest,
): Promise<AgentPublicResearchTerminalReceipt> {
  const runtime = request.runtime ?? SYSTEM_AGENT_RUNTIME;
  assertBudget(request.budget);
  if (!request.scope.runID.trim() || !request.scope.objective.trim()) {
    throw new AgentPublicResearchPolicyError(
      "PUBLIC_RESEARCH_SCOPE_INVALID",
      "A local public-research run requires a run ID and objective.",
    );
  }
  if (!request.scope.providerID.trim()) {
    throw new AgentPublicResearchPolicyError(
      "PUBLIC_RESEARCH_PROVIDER_REQUIRED",
      "A local public-research run requires one pinned search provider.",
    );
  }
  const authorization = assertPublicResearchAuthorization(
    request.scope.authorization,
  );
  const scope = Object.freeze({
    ...request.scope,
    authorization,
  });
  const startedAtMs = runtime.nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  await request.journal.start({
    scope,
    budget: request.budget,
    modelProviderID: request.provider.id,
    model: request.provider.model,
    sdkVersion: request.provider.sdkVersion,
    startedAt,
  });
  const restored = await request.journal.loadCheckpoint(scope.runID);
  const searchResults = new Map(
    (restored?.searchResults ?? []).map((result) => [result.resultID, result]),
  );
  const fetchedPages = new Map(
    (restored?.fetchedPages ?? []).map((page) => [page.resultID, page]),
  );
  let searchCalls = restored?.searchCalls ?? 0;
  let fetchCalls = restored?.fetchCalls ?? 0;
  let toolCalls = restored?.toolCalls ?? 0;
  let sequence = restored?.sequence ?? 0;
  const runState: PublicResearchRunState = {
    candidate: null,
    boundaryFailure: null,
  };
  let providerResult: AgentProviderResult | null = null;
  let terminalCompletionStarted = false;
  const permissionDenials: string[] = [];
  const timeoutController = new AbortController();
  const timeout = runtime.setTimeout(
    () => timeoutController.abort(new Error("Agent duration budget exhausted.")),
    request.budget.maxDurationMs,
  );
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort(request.signal?.reason);
  const onTimeout = () => abort.abort(timeoutController.signal.reason);
  request.signal?.addEventListener("abort", onExternalAbort, { once: true });
  timeoutController.signal.addEventListener("abort", onTimeout, { once: true });

  const saveCheckpoint = () =>
    request.journal.saveCheckpoint(
      scope.runID,
      checkpoint(
        searchResults,
        fetchedPages,
        searchCalls,
        fetchCalls,
        toolCalls,
        sequence,
      ),
    );

  // One per-invocation FIFO chain: concurrent provider tool callbacks execute
  // one at a time so counter pre-saves, dispatches, checkpoint writes, and
  // journal appends cannot interleave. Different Runs use different chains.
  const toolExecution = createResearchToolExecution();

  const failureCode = (error: unknown) =>
    error instanceof AgentCapabilityError ||
    error instanceof AgentPublicResearchPolicyError ||
    error instanceof PublicResearchBoundaryError
      ? error.code
      : "PROVIDER_OR_COMMIT_FAILED";

  const complete = async (
    status: AgentPublicResearchTerminalReceipt["status"],
    reasonCode: string,
    artifactID: string | null = null,
    noActionID: string | null = null,
  ) => {
    // No in-flight tool write may race provider/terminal settlement.
    await toolExecution.drain();
    if (terminalCompletionStarted) {
      throw new Error("The public-research terminal commit was already attempted.");
    }
    terminalCompletionStarted = true;
    const receipt: AgentPublicResearchTerminalReceipt = {
      runID: scope.runID,
      status,
      reasonCode,
      artifactID,
      noActionID,
      candidateFingerprint: runState.candidate?.fingerprint ?? null,
      externalEffects: [],
      usage: agentUsage(startedAtMs, toolCalls, providerResult, runtime.nowMs()),
      permissionDenials: [
        ...new Set([
          ...permissionDenials,
          ...(providerResult?.permissionDenials ?? []),
        ]),
      ],
      providerSessionID: providerResult?.sessionID ?? null,
      completedAt: new Date(runtime.nowMs()).toISOString(),
    };
    sequence += 1;
    const terminalEvent = {
      runID: scope.runID,
      sequence,
      kind: "terminal",
      occurredAt: receipt.completedAt,
      status,
      outputFingerprint: fingerprint(receipt),
      metadata: { reason_code: reasonCode, external_effect_count: 0 },
    } as const;
    const stored = await request.journal.complete(receipt);
    await request.journal.append(terminalEvent);
    return stored;
  };

  const invokeTool = (
    requestedName: string,
    rawInput: unknown,
    executionSignal?: AbortSignal,
  ): Promise<AgentToolResult> =>
    toolExecution.enqueue(() =>
      executeTool(requestedName, rawInput, executionSignal),
    );

  const executeTool = async (
    requestedName: string,
    rawInput: unknown,
    executionSignal?: AbortSignal,
  ): Promise<AgentToolResult> => {
    // Cancellation of queued work is checked at actual execution, before any
    // gateway dispatch.
    const toolSignal = executionSignal ? AbortSignal.any([abort.signal, executionSignal]) : abort.signal;
    toolCalls += 1;
    const callID = runtime.randomUUID();
    const occurredAt = new Date(runtime.nowMs()).toISOString();
    const append = async (result: AgentToolResult) => {
      sequence += 1;
      const event = {
        runID: scope.runID,
        sequence,
        kind: "tool_call",
        occurredAt,
        toolName: requestedName,
        status: result.ok ? "allowed" : "denied",
        inputFingerprint: fingerprint(rawInput),
        outputFingerprint: fingerprint(result),
        metadata: {
          call_id: callID,
          error_code: result.error?.code ?? null,
        },
      } as const;
      try {
        await writeResearchToolState(saveCheckpoint);
        await writeResearchToolState(() => request.journal.append(event));
      } catch (error) {
        // A failed event write consumes no journal slot: the counter stays
        // aligned with the appended journal so the fail-closed terminal can
        // still be recorded.
        sequence -= 1;
        throw error;
      }
      return result;
    };
    const deny = async (code: string, message: string) => {
      permissionDenials.push(`${requestedName}:${code}`);
      runState.boundaryFailure ??= new PublicResearchBoundaryError(code, message);
      return append({
        ok: false,
        callID,
        name: requestedName,
        error: { code, message },
      });
    };
    if (toolSignal.aborted) {
      return deny("RUN_CANCELLED", "The run is no longer active.");
    }
    if (toolCalls > request.budget.maxToolCalls) {
      return deny("MAX_TOOL_CALLS_EXCEEDED", "The tool-call budget is exhausted.");
    }
    if (!new Set<string>(RESEARCH_AGENT_TOOL_NAMES).has(requestedName)) {
      return deny(
        "TOOL_NOT_ALLOWED",
        "The requested capability is absent from the local research manifest.",
      );
    }
    try {
      if (requestedName === "search_web") {
        const input = SearchWebInputSchema.parse(rawInput);
        assertPublicResearchQuery(input.query, authorization);
        searchCalls += 1;
        if (searchCalls > authorization.maximumSearchCount) {
          return deny(
            "MAX_WEB_SEARCH_CALLS_EXCEEDED",
            "The public-web search budget is exhausted.",
          );
        }
        // A possibly dispatched operation consumes its allowance
        // conservatively: the incremented counter is durable before any
        // provider/network call, so interruption can never refund or replay it.
        await writeResearchToolState(saveCheckpoint);
        const results = await request.gateway.searchWeb(
          scope,
          {
            query: input.query,
            maximumResults: input.maximum_results,
            recencyDays: input.recency_days,
          },
          toolSignal,
        );
        toolSignal.throwIfAborted();
        const normalized = results.map((result) => {
          if (result.providerID !== scope.providerID) {
            throw new PublicResearchBoundaryError(
              "WEB_SEARCH_PROVIDER_MISMATCH",
              "A search observation came from a provider outside the immutable run scope.",
            );
          }
          const resultID = fingerprint({
            runID: scope.runID,
            providerID: result.providerID,
            url: result.url,
          });
          const item = { ...result, resultID };
          searchResults.set(resultID, item);
          return item;
        });
        return append({ ok: true, callID, name: requestedName, data: normalized });
      }
      if (requestedName === "fetch_web") {
        const input = FetchWebInputSchema.parse(rawInput);
        const discovered = searchResults.get(input.result_id);
        if (!discovered) {
          return deny(
            "WEB_RESULT_OUT_OF_SCOPE",
            "fetch_web accepts only a result discovered in this local run.",
          );
        }
        fetchCalls += 1;
        if (fetchCalls > authorization.maximumFetchCount) {
          return deny(
            "MAX_WEB_FETCH_CALLS_EXCEEDED",
            "The public-web fetch budget is exhausted.",
          );
        }
        // The fetch allowance is durable before dispatch for the same
        // conservative interrupted-call accounting.
        await writeResearchToolState(saveCheckpoint);
        const fetched = await request.gateway.fetchWeb(
          scope,
          discovered,
          toolSignal,
        );
        toolSignal.throwIfAborted();
        const page = { ...fetched, resultID: input.result_id };
        if (
          page.providerID !== discovered.providerID ||
          !/^[0-9a-f]{64}$/u.test(page.contentHash)
        ) {
          return deny(
            "WEB_FETCH_READBACK_MISMATCH",
            "Fetched content did not preserve its discovered provider and content identity.",
          );
        }
        fetchedPages.set(input.result_id, page);
        return append({ ok: true, callID, name: requestedName, data: page });
      }
      const input = CreateResearchArtifactInputSchema.parse(rawInput);
      const value = artifactCandidate(input, fetchedPages);
      const candidateFingerprint = fingerprint(value);
      if (
        runState.candidate &&
        (runState.candidate.kind !== "artifact" ||
          runState.candidate.fingerprint !== candidateFingerprint)
      ) {
        return deny(
          "TERMINAL_CANDIDATE_CONFLICT",
          "A run may form only one terminal candidate.",
        );
      }
      runState.candidate = {
        kind: "artifact",
        value,
        fingerprint: candidateFingerprint,
      };
      return append({
        ok: true,
        callID,
        name: requestedName,
        candidateFingerprint,
      });
    } catch (error) {
      // A failed local journal write is fatal, never a model-visible denial.
      if (error instanceof ResearchToolWriteError) throw error;
      if (
        error instanceof AgentCapabilityError ||
        error instanceof AgentPublicResearchPolicyError ||
        error instanceof PublicResearchBoundaryError
      ) {
        return deny(error.code, error.message);
      }
      // Fixed generic fallback: an untyped exception message is untrusted
      // transport/input text and never enters model context.
      return deny(
        "TOOL_INPUT_INVALID",
        "The tool input is invalid. Repair the call against the declared tool schema and retry.",
      );
    }
  };

  try {
    if (request.signal?.aborted) {
      return complete("cancelled", "CANCELLED_BEFORE_PROVIDER_START");
    }
    providerResult = await request.provider.run(
      {
        runID: scope.runID,
        objective: scope.objective,
        systemPrompt: (await resolveProductPrompt("research/company")).text,
        scopeSummary: {
          kind: "public_research",
          authorization,
          providerID: scope.providerID,
        },
        toolManifest: Object.freeze([...RESEARCH_AGENT_TOOL_NAMES]),
        budget: request.budget,
        inputParts: [],
      },
      invokeTool,
      abort.signal,
    ).finally(() => toolExecution.drain());
    await toolExecution.drain();
    const fatal = toolExecution.failure();
    if (fatal !== null) {
      return complete("failed", failureCode(fatal));
    }
    sequence += 1;
    const providerEvent = {
      runID: scope.runID,
      sequence,
      kind: "provider_result",
      occurredAt: new Date(runtime.nowMs()).toISOString(),
      status: "received",
      outputFingerprint: fingerprint(providerResult.structuredOutput),
      metadata: {
        turns: providerResult.turns,
        permission_denial_count: providerResult.permissionDenials.length,
      },
    } as const;
    try {
      await saveCheckpoint();
      await request.journal.append(providerEvent);
    } catch (error) {
      sequence -= 1;
      throw error;
    }
    if (request.signal?.aborted) {
      return complete("cancelled", "CANCELLED_BY_REQUESTER");
    }
    if (timeoutController.signal.aborted) {
      return complete("budget_exhausted", "MAX_DURATION_EXCEEDED");
    }
    if (
      providerResult.terminalReason === "max_turns" ||
      providerResult.terminalReason === "budget_exhausted"
    ) {
      return complete(
        "budget_exhausted",
        providerResult.terminalReason === "max_turns"
          ? "PROVIDER_MAX_TURNS"
          : "PROVIDER_BUDGET_EXHAUSTED",
      );
    }
    if (providerResult.terminalReason === "structured_output_retry_exhausted") {
      return complete("quarantined", "STRUCTURED_OUTPUT_RETRY_EXHAUSTED");
    }
    const budgetReason = exceededBudget(
      agentUsage(startedAtMs, toolCalls, providerResult, runtime.nowMs()),
      request.budget,
    );
    if (budgetReason) return complete("budget_exhausted", budgetReason);
    if (runState.boundaryFailure) {
      await request.journal.recordOutput({
        runID: scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(providerResult.structuredOutput),
        structuredOutput: providerResult.structuredOutput,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete("quarantined", runState.boundaryFailure.code);
    }
    const output = PublicResearchAgentFinalOutputSchema.safeParse(
      providerResult.structuredOutput,
    );
    if (!output.success) {
      await request.journal.recordOutput({
        runID: scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(providerResult.structuredOutput),
        structuredOutput: providerResult.structuredOutput,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete("quarantined", "STRUCTURED_OUTPUT_INVALID");
    }
    if (output.data.outcome === "no_action") {
      if (
        output.data.missing_evidence_refs.length > 0 ||
        runState.candidate
      ) {
        await request.journal.recordOutput({
          runID: scope.runID,
          status: "quarantined",
          outputFingerprint: fingerprint(output.data),
          structuredOutput: output.data,
          recordedAt: new Date(runtime.nowMs()).toISOString(),
        });
        return complete(
          "quarantined",
          runState.candidate
            ? "TERMINAL_OUTPUT_MISMATCH"
            : "NO_ACTION_REFERENCE_OUT_OF_SCOPE",
        );
      }
      const value = noActionCandidate(output.data);
      runState.candidate = {
        kind: "no_action",
        value,
        fingerprint: fingerprint(value),
      };
    } else if (
      !runState.candidate ||
      runState.candidate.kind !== "artifact" ||
      output.data.candidate_fingerprint !== runState.candidate.fingerprint
    ) {
      await request.journal.recordOutput({
        runID: scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(output.data),
        structuredOutput: output.data,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete(
        "quarantined",
        runState.candidate
          ? "TERMINAL_OUTPUT_MISMATCH"
          : "TERMINAL_CANDIDATE_REQUIRED",
      );
    }
    await request.journal.recordOutput({
      runID: scope.runID,
      status: "validated",
      outputFingerprint: fingerprint(output.data),
      structuredOutput: output.data,
      recordedAt: new Date(runtime.nowMs()).toISOString(),
    });
    if (runState.candidate.kind === "artifact") {
      const committed = await request.gateway.commitResearchArtifact(
        scope,
        runState.candidate.value,
        runState.candidate.fingerprint,
      );
      if (committed.status !== "draft") {
        return complete("quarantined", "RESEARCH_ARTIFACT_READBACK_MISMATCH");
      }
      return complete(
        "artifact_created",
        committed.replayed ? "ARTIFACT_REPLAYED" : "ARTIFACT_CREATED",
        committed.artifactID,
      );
    }
    const committed = await request.gateway.commitNoAction(
      scope,
      runState.candidate.value,
      runState.candidate.fingerprint,
    );
    return complete(
      "no_action",
      committed.replayed ? "NO_ACTION_REPLAYED" : "NO_ACTION_RECORDED",
      null,
      committed.noActionID,
    );
  } catch (error) {
    if (terminalCompletionStarted) throw error;
    if (request.signal?.aborted) {
      return complete("cancelled", "CANCELLED_BY_REQUESTER");
    }
    if (timeoutController.signal.aborted) {
      return complete("budget_exhausted", "MAX_DURATION_EXCEEDED");
    }
    return complete("failed", failureCode(error));
  } finally {
    runtime.clearTimeout(timeout);
    request.signal?.removeEventListener("abort", onExternalAbort);
    timeoutController.signal.removeEventListener("abort", onTimeout);
  }
}
