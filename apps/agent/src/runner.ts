import {
  PursuitAgentFinalOutputSchema,
  type PursuitNoActionOutput,
  ReadEvidenceInputSchema,
  ReadPursuitInputSchema,
  StageProposalInputSchema,
  type StageProposalInput,
} from "./schemas.js";
import { fingerprint } from "./fingerprint.js";
import { agentCapabilityManifest } from "./toolCatalog.js";
import {
  AGENT_BUDGET_CEILING,
  AgentCapabilityError,
} from "./runtimePolicy.js";
import { agentUsage, assertAgentBudget, exceededBudget } from "./runBudget.js";
import { SYSTEM_AGENT_RUNTIME } from "./runtimeDependencies.js";
import {
  PURSUIT_AGENT_TOOL_NAMES,
  type AgentBudget,
  type AgentEvidence,
  type AgentFingerprints,
  type AgentNoActionCandidate,
  type AgentProposalCandidate,
  type AgentRunRequest,
  type AgentRunScope,
  type AgentTerminalReceipt,
  type AgentToolName,
  type AgentToolResult,
} from "./types.js";

export { AGENT_BUDGET_CEILING, AgentCapabilityError } from "./runtimePolicy.js";

export const DEFAULT_AGENT_BUDGET: Readonly<AgentBudget> = Object.freeze({
  ...AGENT_BUDGET_CEILING,
});

type TerminalCandidate =
  | {
      kind: "proposal";
      value: AgentProposalCandidate;
      fingerprint: string;
    }
  | {
      kind: "no_action";
      value: AgentNoActionCandidate;
      fingerprint: string;
    };

class AgentBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class AgentConfigurationError extends Error {}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function assertBudget(budget: AgentBudget): void {
  assertAgentBudget(budget, ({ field, violation }) => {
    throw new AgentConfigurationError(
      violation === "positive"
        ? `${field} must be positive.`
        : `${field} exceeds the V1 ceiling.`,
    );
  });
}

function assertConfiguration(request: AgentRunRequest): void {
  assertBudget(request.budget);
  if (!sameValues(request.definition.toolManifest, PURSUIT_AGENT_TOOL_NAMES)) {
    throw new AgentConfigurationError(
      "The Pursuit Agent tool manifest must match its governed definition.",
    );
  }
  const capabilities = agentCapabilityManifest(request.definition.toolManifest);
  const candidateCapabilities = capabilities.filter(
    (capability) => capability.consequence === "durable_candidate",
  );
  if (
    candidateCapabilities.length !== 1 ||
    candidateCapabilities.some(
      (capability) =>
        capability.openWorld ||
        capability.reversibility !== "discardable" ||
        capability.idempotency !== "content_fingerprint",
    )
  ) {
    throw new AgentConfigurationError(
      "Each Agent definition requires one closed-world, discardable, fingerprinted candidate capability.",
    );
  }
  if (capabilities.some((capability) => capability.openWorld)) {
    throw new AgentConfigurationError(
      "The Pursuit Agent definition cannot expose an open-world capability.",
    );
  }
  if (
    new Set(request.definition.toolManifest).size !==
    request.definition.toolManifest.length
  ) {
    throw new AgentConfigurationError("The Agent tool manifest contains duplicates.");
  }
  if (request.scope.pursuitRevision < 1) {
    throw new AgentConfigurationError("The Pursuit revision must be positive.");
  }
  if (request.scope.evidenceManifest.length > 50) {
    throw new AgentConfigurationError("The evidence manifest exceeds its V1 bound.");
  }
  const inputArtifactManifest = request.scope.inputArtifactManifest ?? [];
  if (inputArtifactManifest.length > 5) {
    throw new AgentConfigurationError(
      "The Agent input artifact manifest exceeds its V1 bound.",
    );
  }
  const evidenceRefs = request.scope.evidenceManifest.map(
    (item) => item.fragmentID,
  );
  if (new Set(evidenceRefs).size !== evidenceRefs.length) {
    throw new AgentConfigurationError("The evidence manifest contains duplicates.");
  }
  if (
    request.scope.evidenceManifest.some(
      (item) => !/^[0-9a-f]{64}$/.test(item.contentHash),
    )
  ) {
    throw new AgentConfigurationError(
      "Every evidence manifest item requires a SHA-256 content hash.",
    );
  }
  const artifactIDs = inputArtifactManifest.map(
    (item) => item.artifactID,
  );
  if (new Set(artifactIDs).size !== artifactIDs.length) {
    throw new AgentConfigurationError(
      "The Agent input artifact manifest contains duplicates.",
    );
  }
  if (
    inputArtifactManifest.some(
      (item) =>
        !/^[0-9a-f]{64}$/.test(item.contentHash) ||
        item.byteSize < 0 ||
        !["text", "image"].includes(item.kind),
    )
  ) {
    throw new AgentConfigurationError(
      "Every Agent input artifact requires a valid type, size, and SHA-256 hash.",
    );
  }
  const providerParts = request.providerInputParts ?? [];
  if (
    providerParts.length !== inputArtifactManifest.length ||
    providerParts.some((part, index) => {
      const manifest = inputArtifactManifest[index];
      return (
        manifest?.artifactID !== part.artifactID ||
        manifest.kind !== part.kind ||
        manifest.mimeType !== part.mimeType ||
        manifest.byteSize !== part.byteSize ||
        manifest.contentHash !== part.contentHash
      );
    })
  ) {
    throw new AgentConfigurationError(
      "Provider input content does not match the immutable artifact manifest.",
    );
  }
  if (
    providerParts.some(
      (part) =>
        (part.kind === "text" && !request.provider.inputCapabilities.text) ||
        (part.kind === "image" && !request.provider.inputCapabilities.image),
    )
  ) {
    throw new AgentConfigurationError(
      "The configured provider does not support one or more governed input artifacts.",
    );
  }
}

function buildFingerprints(request: AgentRunRequest): AgentFingerprints {
  return {
    definition: fingerprint({
      name: request.definition.name,
      version: request.definition.version,
      policyVersion: request.definition.policyVersion,
      contractVersion: request.definition.contractVersion,
    }),
    systemPrompt: fingerprint(request.definition.systemPrompt),
    toolManifest: fingerprint(request.definition.toolManifest),
    sdk: fingerprint({
      provider: request.provider.id,
      sdkVersion: request.provider.sdkVersion,
    }),
    model: fingerprint(request.provider.model),
    policy: fingerprint(request.definition.policyVersion),
    contract: fingerprint(request.definition.contractVersion),
    context: fingerprint({
      workspaceID: request.scope.workspaceID,
      userID: request.scope.userID,
      pursuitID: request.scope.pursuitID,
      pursuitRevision: request.scope.pursuitRevision,
      captureID: request.scope.captureID,
      objective: request.scope.objective,
      evidenceManifest: request.scope.evidenceManifest,
      inputArtifactManifest: request.scope.inputArtifactManifest ?? [],
    }),
  };
}

function proposalCandidate(input: StageProposalInput): AgentProposalCandidate {
  return {
    summary: input.summary,
    items: input.items.map((item) => {
      const common = {
        itemKey: item.item_key,
        epistemicStatus: item.epistemic_status,
        evidenceRefs: item.evidence_refs,
        reason: item.reason,
        effectSummary: item.effect_summary,
      };
      switch (item.change_kind) {
        case "set_milestone":
          return {
            ...common,
            change: {
              kind: item.change_kind,
              proposedValue: item.proposed_value,
            },
          };
        case "set_pursuit_status":
          return {
            ...common,
            change: {
              kind: item.change_kind,
              proposedValue: item.proposed_value,
            },
          };
        case "set_role_status":
          return {
            ...common,
            change: {
              kind: item.change_kind,
              roleID: item.role_id,
              proposedValue: item.proposed_value,
            },
          };
        case "add_gap":
          return {
            ...common,
            change: {
              kind: item.change_kind,
              proposedValue: {
                title: item.proposed_value.title,
                basisSummary: item.proposed_value.basis_summary,
                closeCondition: item.proposed_value.close_condition,
              },
            },
          };
        case "add_action":
          return {
            ...common,
            change: {
              kind: item.change_kind,
              proposedValue: {
                title: item.proposed_value.title,
                ownerUserID: item.proposed_value.owner_user_id,
                dueAt: item.proposed_value.due_at,
              },
            },
          };
      }
    }),
  };
}

function noActionCandidate(input: PursuitNoActionOutput): AgentNoActionCandidate {
  return {
    reasonCode: input.reason_code,
    reason: input.reason,
    missingEvidenceRefs: input.missing_evidence_refs,
  };
}

function evidenceMatchesManifest(
  evidence: readonly AgentEvidence[],
  refs: readonly string[],
  scope: AgentRunScope,
): boolean {
  if (
    evidence.length !== refs.length ||
    new Set(evidence.map((item) => item.fragmentID)).size !== evidence.length
  ) {
    return false;
  }
  const manifest = new Map(
    scope.evidenceManifest.map((item) => [item.fragmentID, item]),
  );
  return evidence.every((item) => {
    const expected = manifest.get(item.fragmentID);
    return (
      refs.includes(item.fragmentID) &&
      expected?.contentHash === item.contentHash &&
      item.availability === "available" &&
      item.reviewStatus === "reviewed" &&
      item.attributionStatus === "confirmed"
    );
  });
}

export async function runBoundedAgent(
  request: AgentRunRequest,
): Promise<AgentTerminalReceipt> {
  const runtime = request.runtime ?? SYSTEM_AGENT_RUNTIME;
  request = Object.freeze({
    ...request,
    definition: Object.freeze({
      ...request.definition,
      toolManifest: Object.freeze([...request.definition.toolManifest]),
    }),
    scope: Object.freeze({
      ...request.scope,
      evidenceManifest: Object.freeze(
        request.scope.evidenceManifest.map((item) => Object.freeze({ ...item })),
      ),
      inputArtifactManifest: Object.freeze(
        (request.scope.inputArtifactManifest ?? []).map((item) =>
          Object.freeze({ ...item }),
        ),
      ),
    }),
    providerInputParts: Object.freeze(
      (request.providerInputParts ?? []).map((item) => Object.freeze({ ...item })),
    ),
    budget: Object.freeze({ ...request.budget }),
  });
  assertConfiguration(request);
  const startedAtMs = runtime.nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  const fingerprints = buildFingerprints(request);
  let sequence = 0;
  let toolCalls = 0;
  const runState: {
    terminalCandidate: TerminalCandidate | null;
    boundaryFailure: AgentBoundaryError | null;
  } = {
    terminalCandidate: null,
    boundaryFailure: null,
  };
  let providerResult: Awaited<ReturnType<typeof request.provider.run>> | null = null;
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

  const complete = async (
    status: AgentTerminalReceipt["status"],
    reasonCode: string,
    proposalID: string | null = null,
    noActionID: string | null = null,
  ): Promise<AgentTerminalReceipt> => {
    if (terminalCompletionStarted) {
      throw new Error("The Agent terminal commit was already attempted.");
    }
    terminalCompletionStarted = true;
    const resultUsage = agentUsage(
      startedAtMs,
      toolCalls,
      providerResult,
      runtime.nowMs(),
    );
    const receipt: AgentTerminalReceipt = {
      runID: request.scope.runID,
      status,
      reasonCode,
      proposalID,
      noActionID,
      candidateFingerprint: runState.terminalCandidate?.fingerprint ?? null,
      externalEffects: [],
      fingerprints,
      usage: resultUsage,
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
    await request.journal.append({
      runID: request.scope.runID,
      sequence,
      kind: "terminal",
      occurredAt: receipt.completedAt,
      status,
      outputFingerprint: fingerprint(receipt),
      metadata: {
        reason_code: reasonCode,
        external_effect_count: 0,
      },
    });
    return request.journal.complete(receipt);
  };

  const invokeTool = async (
    requestedName: string,
    rawInput: unknown,
  ): Promise<AgentToolResult> => {
    toolCalls += 1;
    const callID = runtime.randomUUID();
    const occurredAt = new Date(runtime.nowMs()).toISOString();
    const inputFingerprint = fingerprint(rawInput);
    const append = async (result: AgentToolResult): Promise<AgentToolResult> => {
      sequence += 1;
      await request.journal.append({
        runID: request.scope.runID,
        sequence,
        kind: "tool_call",
        occurredAt,
        toolName: requestedName,
        status: result.ok ? "allowed" : "denied",
        inputFingerprint,
        outputFingerprint: fingerprint(result),
        metadata: {
          call_id: callID,
          error_code: result.error?.code ?? null,
        },
      });
      return result;
    };
    const deny = async (code: string, message: string): Promise<AgentToolResult> => {
      permissionDenials.push(`${requestedName}:${code}`);
      runState.boundaryFailure ??= new AgentBoundaryError(code, message);
      return append({
        ok: false,
        callID,
        name: requestedName,
        error: { code, message },
      });
    };

    if (abort.signal.aborted) {
      return deny("RUN_CANCELLED", "The run is no longer active.");
    }
    if (toolCalls > request.budget.maxToolCalls) {
      return deny("MAX_TOOL_CALLS_EXCEEDED", "The tool-call budget is exhausted.");
    }
    if (!request.definition.toolManifest.includes(requestedName as AgentToolName)) {
      return deny(
        "TOOL_NOT_ALLOWED",
        "The requested capability is absent from the immutable tool manifest.",
      );
    }

    try {
      switch (requestedName as AgentToolName) {
        case "read_pursuit": {
          ReadPursuitInputSchema.parse(rawInput);
          const pursuit = await request.gateway.readPursuit(request.scope);
          if (
            pursuit.workspaceID !== request.scope.workspaceID ||
            pursuit.pursuitID !== request.scope.pursuitID ||
            pursuit.revision !== request.scope.pursuitRevision
          ) {
            return deny(
              "PURSUIT_READBACK_MISMATCH",
              "Canonical Pursuit readback differs from the immutable run scope.",
            );
          }
          return append({ ok: true, callID, name: requestedName, data: pursuit });
        }
        case "read_evidence": {
          const input = ReadEvidenceInputSchema.parse(rawInput);
          const allowed = new Set(
            request.scope.evidenceManifest.map((item) => item.fragmentID),
          );
          if (input.evidence_refs.some((ref) => !allowed.has(ref))) {
            return deny(
              "EVIDENCE_OUT_OF_SCOPE",
              "At least one requested fragment is absent from the context manifest.",
            );
          }
          const evidence = await request.gateway.readEvidence(
            request.scope,
            input.evidence_refs,
          );
          if (!evidenceMatchesManifest(evidence, input.evidence_refs, request.scope)) {
            return deny(
              "EVIDENCE_READBACK_MISMATCH",
              "Evidence authority or content identity changed after the run snapshot.",
            );
          }
          return append({ ok: true, callID, name: requestedName, data: evidence });
        }
        case "stage_pursuit_proposal": {
          const parsed = StageProposalInputSchema.parse(rawInput);
          const allowed = new Set(
            request.scope.evidenceManifest.map((item) => item.fragmentID),
          );
          if (
            parsed.items.some((item) =>
              item.evidence_refs.some((ref) => !allowed.has(ref)),
            )
          ) {
            return deny(
              "PROPOSAL_EVIDENCE_OUT_OF_SCOPE",
              "A Proposal item cites evidence outside the immutable manifest.",
            );
          }
          const value = proposalCandidate(parsed);
          const candidateFingerprint = fingerprint(value);
          if (
            runState.terminalCandidate &&
            (runState.terminalCandidate.kind !== "proposal" ||
              runState.terminalCandidate.fingerprint !== candidateFingerprint)
          ) {
            return deny(
              "TERMINAL_CANDIDATE_CONFLICT",
              "A run may form only one terminal candidate.",
            );
          }
          runState.terminalCandidate = {
            kind: "proposal",
            value,
            fingerprint: candidateFingerprint,
          };
          return append({
            ok: true,
            callID,
            name: requestedName,
            candidateFingerprint,
          });
        }
      }
      return deny(
        "TOOL_NOT_ALLOWED",
        "The requested capability is absent from the immutable tool manifest.",
      );
    } catch (error) {
      if (error instanceof AgentCapabilityError) {
        return deny(error.code, error.message);
      }
      if (error instanceof AgentBoundaryError) {
        return deny(error.code, error.message);
      }
      return deny(
        "TOOL_INPUT_INVALID",
        "The tool input is invalid. Repair the call against the declared tool schema and retry.",
      );
    }
  };

  try {
    await request.journal.start({
      scope: request.scope,
      budget: request.budget,
      providerID: request.provider.id,
      model: request.provider.model,
      sdkVersion: request.provider.sdkVersion,
      fingerprints,
      startedAt,
    });
    if (request.signal?.aborted) {
      return complete("cancelled", "CANCELLED_BEFORE_PROVIDER_START");
    }

    providerResult = await request.provider.run(
      {
        runID: request.scope.runID,
        objective: request.scope.objective,
        systemPrompt: request.definition.systemPrompt,
        scopeSummary: {
          kind: "pursuit",
          workspaceID: request.scope.workspaceID,
          pursuitID: request.scope.pursuitID,
          pursuitRevision: request.scope.pursuitRevision,
          evidenceRefs: request.scope.evidenceManifest.map(
            (item) => item.fragmentID,
          ),
        },
        toolManifest: request.definition.toolManifest,
        budget: request.budget,
        inputParts: request.providerInputParts ?? [],
      },
      invokeTool,
      abort.signal,
    );
    sequence += 1;
    await request.journal.append({
      runID: request.scope.runID,
      sequence,
      kind: "provider_result",
      occurredAt: new Date(runtime.nowMs()).toISOString(),
      status: "received",
      outputFingerprint: fingerprint(providerResult.structuredOutput),
      metadata: {
        turns: providerResult.turns,
        permission_denial_count: providerResult.permissionDenials.length,
      },
    });

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
    const resultUsage = agentUsage(
      startedAtMs,
      toolCalls,
      providerResult,
      runtime.nowMs(),
    );
    const budgetReason = exceededBudget(resultUsage, request.budget);
    if (budgetReason) return complete("budget_exhausted", budgetReason);

    if (runState.boundaryFailure) {
      await request.journal.recordOutput({
        runID: request.scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(providerResult.structuredOutput),
        structuredOutput: providerResult.structuredOutput,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete("quarantined", runState.boundaryFailure.code);
    }

    const output = PursuitAgentFinalOutputSchema.safeParse(
      providerResult.structuredOutput,
    );
    if (!output.success) {
      await request.journal.recordOutput({
        runID: request.scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(providerResult.structuredOutput),
        structuredOutput: providerResult.structuredOutput,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete("quarantined", "STRUCTURED_OUTPUT_INVALID");
    }

    if (output.data.outcome === "no_action") {
      const allowed = new Set(
        request.scope.evidenceManifest.map((item) => item.fragmentID),
      );
      if (
        output.data.missing_evidence_refs.some((ref) => !allowed.has(ref))
      ) {
        await request.journal.recordOutput({
          runID: request.scope.runID,
          status: "quarantined",
          outputFingerprint: fingerprint(output.data),
          structuredOutput: output.data,
          recordedAt: new Date(runtime.nowMs()).toISOString(),
        });
        return complete("quarantined", "NO_ACTION_REFERENCE_OUT_OF_SCOPE");
      }
      if (runState.terminalCandidate) {
        await request.journal.recordOutput({
          runID: request.scope.runID,
          status: "quarantined",
          outputFingerprint: fingerprint(output.data),
          structuredOutput: output.data,
          recordedAt: new Date(runtime.nowMs()).toISOString(),
        });
        return complete("quarantined", "TERMINAL_OUTPUT_MISMATCH");
      }
      const value = noActionCandidate(output.data);
      runState.terminalCandidate = {
        kind: "no_action",
        value,
        fingerprint: fingerprint(value),
      };
    } else if (
      !runState.terminalCandidate ||
      output.data.outcome !== runState.terminalCandidate.kind ||
      output.data.candidate_fingerprint !== runState.terminalCandidate.fingerprint
    ) {
      await request.journal.recordOutput({
        runID: request.scope.runID,
        status: "quarantined",
        outputFingerprint: fingerprint(providerResult.structuredOutput),
        structuredOutput: providerResult.structuredOutput,
        recordedAt: new Date(runtime.nowMs()).toISOString(),
      });
      return complete(
        "quarantined",
        runState.terminalCandidate
          ? "TERMINAL_OUTPUT_MISMATCH"
          : "TERMINAL_CANDIDATE_REQUIRED",
      );
    }

    await request.journal.recordOutput({
      runID: request.scope.runID,
      status: "validated",
      outputFingerprint: fingerprint(output.data),
      structuredOutput: output.data,
      recordedAt: new Date(runtime.nowMs()).toISOString(),
    });
    if (runState.terminalCandidate.kind === "proposal") {
      const committed = await request.gateway.commitProposal(
        request.scope,
        runState.terminalCandidate.value,
        runState.terminalCandidate.fingerprint,
      );
      if (committed.status !== "needs_review") {
        return complete("quarantined", "PROPOSAL_READBACK_MISMATCH");
      }
      return complete(
        "proposal_staged",
        committed.replayed ? "PROPOSAL_REPLAYED" : "PROPOSAL_STAGED",
        committed.proposalID,
      );
    }
    const committed = await request.gateway.commitNoAction(
      request.scope,
      runState.terminalCandidate.value,
      runState.terminalCandidate.fingerprint,
    );
    return complete(
      "no_action",
      committed.replayed ? "NO_ACTION_REPLAYED" : "NO_ACTION_RECORDED",
      null,
      committed.noActionID,
    );
  } catch (error) {
    // A journal failure while appending or committing the terminal receipt
    // must escape to the durable owner. Retrying `complete` here would create a
    // second terminal event and obscure the real infrastructure failure.
    if (terminalCompletionStarted) throw error;
    if (request.signal?.aborted) {
      return complete("cancelled", "CANCELLED_BY_REQUESTER");
    }
    if (timeoutController.signal.aborted) {
      return complete("budget_exhausted", "MAX_DURATION_EXCEEDED");
    }
    return complete(
      "failed",
      error instanceof AgentBoundaryError
        ? error.code
        : "PROVIDER_OR_COMMIT_FAILED",
    );
  } finally {
    runtime.clearTimeout(timeout);
    request.signal?.removeEventListener("abort", onExternalAbort);
    timeoutController.signal.removeEventListener("abort", onTimeout);
  }
}
