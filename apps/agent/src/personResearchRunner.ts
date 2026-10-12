import { resolveProductPrompt } from "./promptRegistry.js";
import { fingerprint } from "./fingerprint.js";
import {
  assertPersonResearchAuthorization,
  assertPersonResearchDraftText,
  assertPersonResearchQuery,
  assertPersonResearchRunInputs,
  AgentPersonResearchPolicyError,
} from "./personResearchPolicy.js";
import {
  CreatePersonResearchArtifactInputSchema,
  PersonResearchAgentFinalOutputSchema,
  SearchPublicProfilesInputSchema,
  type CreatePersonResearchArtifactInput,
  type PersonResearchNoActionOutput,
} from "./schemas.js";
import { AgentCapabilityError } from "./runtimePolicy.js";
import { agentUsage, exceededBudget } from "./runBudget.js";
import {
  createResearchToolExecution,
  ResearchToolWriteError,
  writeResearchToolState,
} from "./researchToolExecution.js";
import { SYSTEM_AGENT_RUNTIME } from "./runtimeDependencies.js";
import {
  PERSON_RESEARCH_AGENT_TOOL_NAMES,
  type AgentPersonResearchArtifactCandidate,
  type AgentPersonResearchCheckpoint,
  type AgentPersonResearchNoActionCandidate,
  type AgentPersonResearchPlatform,
  type AgentPersonResearchRunRequest,
  type AgentPersonResearchTerminalReceipt,
  type AgentProviderResult,
  type AgentPublicProfileResult,
  type AgentToolResult,
} from "./types.js";

export { PERSON_RESEARCH_SYSTEM_PROMPT } from "./prompts.js";

type Candidate =
  | {
      kind: "artifact";
      value: AgentPersonResearchArtifactCandidate;
      fingerprint: string;
    }
  | {
      kind: "no_action";
      value: AgentPersonResearchNoActionCandidate;
      fingerprint: string;
    };

class PersonResearchBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function platformForTool(name: string): AgentPersonResearchPlatform | null {
  if (name === "search_douyin_profiles") return "douyin";
  if (name === "search_tiktok_profiles") return "tiktok";
  if (name === "search_weibo_profiles") return "weibo";
  if (name === "search_threads_profiles") return "threads";
  return null;
}

function artifactCandidate(
  input: CreatePersonResearchArtifactInput,
  results: ReadonlyMap<string, AgentPublicProfileResult>,
  sourceArtifactID: string,
  queryObservations: AgentPersonResearchCheckpoint["queryObservations"],
): AgentPersonResearchArtifactCandidate {
  if (
    input.observed_clues.some(
      (clue) => clue.source_artifact_id !== sourceArtifactID,
    )
  ) {
    throw new PersonResearchBoundaryError(
      "PERSON_RESEARCH_CLUE_SOURCE_MISMATCH",
      "Every observed identity clue must point to the one authorized screenshot.",
    );
  }
  if (
    input.observed_clues
      .filter((clue) => clue.kind !== "platform")
      .some(
        (clue) =>
          !queryObservations.some(
            (observation) =>
              observation.sourceArtifactID === clue.source_artifact_id &&
              observation.query.normalize("NFKC").trim().toLowerCase() ===
                clue.value.normalize("NFKC").trim().toLowerCase(),
          ),
      )
  ) {
    throw new PersonResearchBoundaryError(
      "PERSON_RESEARCH_CLUE_NOT_SEARCHED",
      "Every non-platform clue in a draft must match a same-Run visible clue used by a provider Tool.",
    );
  }
  const candidateIDs = input.candidates.map((candidate) => candidate.result_id);
  if (new Set(candidateIDs).size !== candidateIDs.length) {
    throw new PersonResearchBoundaryError(
      "PERSON_RESEARCH_CANDIDATE_DUPLICATE",
      "A person-research draft cannot include the same provider result twice.",
    );
  }
  if (input.identity_status === "possible_match" && candidateIDs.length !== 1) {
    throw new PersonResearchBoundaryError(
      "PERSON_RESEARCH_IDENTITY_STATUS_INVALID",
      "possible_match requires exactly one cited candidate; multiple candidates remain ambiguous.",
    );
  }
  const sourceRefs = new Set<string>();
  for (const candidate of input.candidates) {
    if (!results.has(candidate.result_id)) {
      throw new PersonResearchBoundaryError(
        "PERSON_RESEARCH_RESULT_OUT_OF_SCOPE",
        "Every possible match must come from a provider result in this Run.",
      );
    }
    assertPersonResearchDraftText(candidate.match_basis);
    sourceRefs.add(candidate.result_id);
  }
  for (const clue of input.observed_clues) {
    assertPersonResearchDraftText(clue.value);
  }
  assertPersonResearchDraftText(`${input.title}\n${input.summary}\n${input.limitations}`);
  const claims = input.claims.map((claim) => {
    assertPersonResearchDraftText(claim.statement);
    if (
      new Set(claim.source_refs).size !== claim.source_refs.length ||
      claim.source_refs.some(
        (resultID) => !results.has(resultID) || !candidateIDs.includes(resultID),
      )
    ) {
      throw new PersonResearchBoundaryError(
        "PERSON_RESEARCH_CLAIM_SOURCE_INVALID",
        "Every claim must cite a unique same-Run candidate result.",
      );
    }
    claim.source_refs.forEach((resultID) => sourceRefs.add(resultID));
    return {
      statement: claim.statement,
      epistemicStatus: claim.epistemic_status,
      sourceRefs: [...claim.source_refs],
    };
  });
  return {
    title: input.title,
    summary: input.summary,
    limitations: input.limitations,
    identityStatus: input.identity_status,
    observedClues: input.observed_clues.map((clue) => ({
      kind: clue.kind,
      value: clue.value,
      sourceArtifactID: clue.source_artifact_id,
      observationStatus: clue.observation_status,
    })),
    candidates: input.candidates.map((candidate) => ({
      resultID: candidate.result_id,
      matchBasis: candidate.match_basis,
    })),
    claims,
    sources: [...sourceRefs].map((resultID) => {
      const source = results.get(resultID);
      if (!source) {
        throw new PersonResearchBoundaryError(
          "PERSON_RESEARCH_RESULT_OUT_OF_SCOPE",
          "Every source must come from a provider result in this Run.",
        );
      }
      return {
        resultID,
        platform: source.platform,
        profileUrl: source.profileUrl,
        displayName: source.displayName,
        handle: source.handle,
        biography: source.biography,
        avatarUrl: source.avatarUrl,
        verified: source.verified,
        contentHash: source.contentHash,
        retrievedAt: source.retrievedAt,
        providerID: source.providerID,
        providerRequestID: source.providerRequestID,
      };
    }),
  };
}

function noActionCandidate(
  output: PersonResearchNoActionOutput,
): AgentPersonResearchNoActionCandidate {
  return {
    reasonCode: output.reason_code,
    reason: output.reason,
  };
}

export async function runPersonResearchAgent(
  request: AgentPersonResearchRunRequest,
): Promise<AgentPersonResearchTerminalReceipt> {
  const runtime = request.runtime ?? SYSTEM_AGENT_RUNTIME;
  assertPersonResearchRunInputs(request);
  const authorization = assertPersonResearchAuthorization(request.scope.authorization);
  const scope = Object.freeze({ ...request.scope, authorization });
  const startedAtMs = runtime.nowMs();
  await request.journal.start({
    scope,
    budget: request.budget,
    modelProviderID: request.provider.id,
    model: request.provider.model,
    sdkVersion: request.provider.sdkVersion,
    startedAt: new Date(startedAtMs).toISOString(),
  });
  const restored = await request.journal.loadCheckpoint(scope.runID);
  const profileResults = new Map(
    (restored?.profileResults ?? []).map((result) => [result.resultID, result]),
  );
  const queryObservations = [...(restored?.queryObservations ?? [])];
  let providerCalls = restored?.providerCalls ?? 0;
  let toolCalls = restored?.toolCalls ?? 0;
  let sequence = restored?.sequence ?? 0;
  const runState: {
    candidate: Candidate | null;
    boundaryFailure: PersonResearchBoundaryError | null;
  } = { candidate: null, boundaryFailure: null };
  let providerResult: AgentProviderResult | null = null;
  let terminalStarted = false;
  const permissionDenials: string[] = [];
  const timeoutController = new AbortController();
  const timeout = runtime.setTimeout(
    () => timeoutController.abort(new Error("Agent duration budget exhausted.")),
    request.budget.maxDurationMs,
  );
  const abort = new AbortController();
  const externalAbort = () => abort.abort(request.signal?.reason);
  const durationAbort = () => abort.abort(timeoutController.signal.reason);
  request.signal?.addEventListener("abort", externalAbort, { once: true });
  timeoutController.signal.addEventListener("abort", durationAbort, { once: true });

  const saveCheckpoint = () =>
    request.journal.saveCheckpoint(scope.runID, {
      profileResults: [...profileResults.values()],
      queryObservations,
      providerCalls,
      toolCalls,
      sequence,
    } satisfies AgentPersonResearchCheckpoint);

  // One per-invocation FIFO chain: concurrent provider tool callbacks execute
  // one at a time so counter pre-saves, dispatches, checkpoint writes, and
  // journal appends cannot interleave. Different Runs use different chains.
  const toolExecution = createResearchToolExecution();

  const failureCode = (error: unknown) =>
    error instanceof AgentCapabilityError ||
    error instanceof AgentPersonResearchPolicyError ||
    error instanceof PersonResearchBoundaryError
      ? error.code
      : "PROVIDER_OR_COMMIT_FAILED";

  const complete = async (
    status: AgentPersonResearchTerminalReceipt["status"],
    reasonCode: string,
    artifactID: string | null = null,
    noActionID: string | null = null,
  ) => {
    // No in-flight tool write may race provider/terminal settlement.
    await toolExecution.drain();
    if (terminalStarted) throw new Error("The person-research terminal commit was already attempted.");
    terminalStarted = true;
    const receipt: AgentPersonResearchTerminalReceipt = {
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
    await saveCheckpoint();
    const stored = await request.journal.complete(receipt);
    await request.journal.append({
      runID: scope.runID,
      sequence,
      kind: "terminal",
      occurredAt: receipt.completedAt,
      status,
      outputFingerprint: fingerprint(receipt),
      metadata: { reason_code: reasonCode, external_effect_count: 0 },
    });
    return stored;
  };

  const invokeTool = (
    requestedName: string,
    rawInput: unknown,
  ): Promise<AgentToolResult> =>
    toolExecution.enqueue(() => executeTool(requestedName, rawInput));

  const executeTool = async (
    requestedName: string,
    rawInput: unknown,
  ): Promise<AgentToolResult> => {
    // Cancellation of queued work is checked at actual execution, before any
    // gateway dispatch.
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
        metadata: { call_id: callID, error_code: result.error?.code ?? null },
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
      runState.boundaryFailure ??= new PersonResearchBoundaryError(code, message);
      return append({
        ok: false,
        callID,
        name: requestedName,
        error: { code, message },
      });
    };
    if (abort.signal.aborted) return deny("RUN_CANCELLED", "The Run is no longer active.");
    if (toolCalls > request.budget.maxToolCalls) {
      return deny("MAX_TOOL_CALLS_EXCEEDED", "The tool-call budget is exhausted.");
    }
    if (!new Set<string>(PERSON_RESEARCH_AGENT_TOOL_NAMES).has(requestedName)) {
      return deny("TOOL_NOT_ALLOWED", "The requested capability is absent from the person-research manifest.");
    }
    try {
      const platform = platformForTool(requestedName);
      if (platform) {
        if (!authorization.allowedPlatforms.includes(platform)) {
          return deny(
            "PERSON_RESEARCH_PLATFORM_NOT_AUTHORIZED",
            "The selected platform is outside this Run's authorization.",
          );
        }
        const input = SearchPublicProfilesInputSchema.parse(rawInput);
        if (input.source_artifact_id !== scope.inputArtifactManifest[0]!.artifactID) {
          return deny(
            "PERSON_RESEARCH_QUERY_SOURCE_MISMATCH",
            "A public-profile query must point to the one authorized screenshot.",
          );
        }
        const query = assertPersonResearchQuery(input.visible_identity_clue);
        if (
          !queryObservations.some(
            (observation) =>
              observation.platform === platform &&
              observation.query === query &&
              observation.sourceArtifactID === input.source_artifact_id,
          )
        ) {
          queryObservations.push({
            platform,
            query,
            sourceArtifactID: input.source_artifact_id,
            observationStatus: "unreviewed_screenshot_observation",
          });
        }
        providerCalls += 1;
        if (providerCalls > authorization.maximumProviderCalls) {
          return deny(
            "MAX_PERSON_PROFILE_CALLS_EXCEEDED",
            "The public-profile provider-call budget is exhausted.",
          );
        }
        // A possibly dispatched operation consumes its allowance
        // conservatively: the incremented counter is durable before any
        // provider/network call, so interruption can never refund or replay it.
        await writeResearchToolState(saveCheckpoint);
        const results = await request.gateway.searchProfiles(
          scope,
          {
            platform,
            query,
            maximumResults: Math.min(
              input.maximum_results,
              authorization.maximumResultsPerCall,
            ),
          },
          abort.signal,
        );
        const normalized = results.map((result) => {
          if (
            result.platform !== platform ||
            result.providerID !== scope.providerID ||
            !/^[0-9a-f]{64}$/u.test(result.contentHash)
          ) {
            throw new PersonResearchBoundaryError(
              "PERSON_RESEARCH_PROVIDER_READBACK_MISMATCH",
              "A profile observation did not preserve the pinned platform, provider, and content identity.",
            );
          }
          const resultID = fingerprint({
            runID: scope.runID,
            providerID: result.providerID,
            platform: result.platform,
            profileID: result.profileID,
            profileUrl: result.profileUrl,
            contentHash: result.contentHash,
          });
          const item = { ...result, resultID };
          profileResults.set(resultID, item);
          return item;
        });
        return append({ ok: true, callID, name: requestedName, data: normalized });
      }
      const input = CreatePersonResearchArtifactInputSchema.parse(rawInput);
      const value = artifactCandidate(
        input,
        profileResults,
        scope.inputArtifactManifest[0]!.artifactID,
        queryObservations,
      );
      const candidateFingerprint = fingerprint(value);
      if (
        runState.candidate &&
        (runState.candidate.kind !== "artifact" ||
          runState.candidate.fingerprint !== candidateFingerprint)
      ) {
        return deny(
          "TERMINAL_CANDIDATE_CONFLICT",
          "A Run may form only one terminal candidate.",
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
        error instanceof AgentPersonResearchPolicyError ||
        error instanceof PersonResearchBoundaryError
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
    if (request.signal?.aborted) return complete("cancelled", "CANCELLED_BEFORE_PROVIDER_START");
    providerResult = await request.provider.run(
      {
        runID: scope.runID,
        objective: scope.objective,
        systemPrompt: (await resolveProductPrompt("research/person")).text,
        scopeSummary: {
          kind: "person_public_profile_research",
          authorization,
          providerID: scope.providerID,
          inputArtifactIDs: scope.inputArtifactManifest.map((item) => item.artifactID),
        },
        toolManifest: Object.freeze([...PERSON_RESEARCH_AGENT_TOOL_NAMES]),
        budget: request.budget,
        inputParts: request.providerInputParts,
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
    if (request.signal?.aborted) return complete("cancelled", "CANCELLED_BY_REQUESTER");
    if (timeoutController.signal.aborted) return complete("budget_exhausted", "MAX_DURATION_EXCEEDED");
    if (providerResult.terminalReason === "max_turns" || providerResult.terminalReason === "budget_exhausted") {
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
    const output = PersonResearchAgentFinalOutputSchema.safeParse(providerResult.structuredOutput);
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
      if (runState.candidate) {
        return complete("quarantined", "TERMINAL_OUTPUT_MISMATCH");
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
      const committed = await request.gateway.commitPersonResearchArtifact(
        scope,
        runState.candidate.value,
        runState.candidate.fingerprint,
      );
      if (committed.status !== "draft") {
        return complete("quarantined", "PERSON_RESEARCH_ARTIFACT_READBACK_MISMATCH");
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
    if (terminalStarted) throw error;
    if (request.signal?.aborted) return complete("cancelled", "CANCELLED_BY_REQUESTER");
    if (timeoutController.signal.aborted) return complete("budget_exhausted", "MAX_DURATION_EXCEEDED");
    return complete("failed", failureCode(error));
  } finally {
    runtime.clearTimeout(timeout);
    request.signal?.removeEventListener("abort", externalAbort);
    timeoutController.signal.removeEventListener("abort", durationAbort);
  }
}
