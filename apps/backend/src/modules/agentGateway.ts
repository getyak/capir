import { randomUUID } from "node:crypto";

import { AgentCapabilityError } from "@talent-signal/agent";
import type {
  AgentCapabilityGateway,
  AgentEvidence,
  AgentNoActionCandidate,
  AgentInputArtifactManifestItem,
  AgentProposalCandidate,
  AgentRunScope,
} from "@talent-signal/agent";
import type { StagePursuitProposalRequest } from "@talent-signal/contracts";
import type { Pool } from "pg";

import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { stagePursuitProposal } from "./pursuitProposals.js";
import { readPursuit } from "./pursuits.js";

interface EvidenceRow {
  fragment_id: string;
  text_content: string;
  content_hash: string;
  observed_at: Date | string;
  source_display_name: string;
  retention_scope: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function assertCaptureScope(
  pool: DatabaseClient,
  auth: AuthContext,
  pursuitID: string,
  captureID: string,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT captures.id
     FROM captures
     JOIN pursuit_roles roles
       ON roles.account_id = captures.account_id
      AND roles.pursuit_id = $3
      AND roles.person_id = captures.subject_id
      AND roles.role_type = 'candidate'
      AND roles.status = 'active'
      AND roles.confidence = 'confirmed'
     WHERE captures.account_id = $1
       AND captures.id = $2
       AND captures.status = 'active'
       AND captures.identity_status = 'bound'`,
    [auth.accountId, captureID, pursuitID],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      422,
      "AGENT_CAPTURE_SCOPE_INVALID",
      "The Capture is not identity-bound to a confirmed candidate role in this Pursuit.",
    );
  }
}

async function readAuthorizedEvidence(
  pool: DatabaseClient,
  auth: AuthContext,
  captureID: string,
  evidenceRefs: readonly string[],
): Promise<EvidenceRow[]> {
  if (evidenceRefs.length === 0) return [];
  const result = await pool.query<EvidenceRow>(
    `SELECT
       fragments.id AS fragment_id,
       fragments.text_content,
       fragments.content_hash,
       resources.observed_at,
       resources.display_name AS source_display_name,
       resources.retention_scope
     FROM evidence_fragments fragments
     JOIN source_resources resources
       ON resources.account_id = fragments.account_id
      AND resources.id = fragments.resource_id
     JOIN captures
       ON captures.account_id = fragments.account_id
      AND captures.id = fragments.capture_id
     JOIN source_retention_receipts receipts
       ON receipts.account_id = fragments.account_id
      AND receipts.capture_id = fragments.capture_id
     WHERE fragments.account_id = $1
       AND fragments.capture_id = $2
       AND fragments.id = ANY($3::uuid[])
       AND fragments.status = 'active'
       AND fragments.review_status = 'reviewed'
       AND fragments.attribution_status = 'confirmed'
       AND fragments.text_content IS NOT NULL
       AND resources.processing_state <> 'deleted'
       AND captures.status = 'active'
       AND captures.identity_status = 'bound'
       AND receipts.source_access_state <> 'deleted'
       AND receipts.authorization_state = 'authorized'
       AND (
         receipts.authorization_expires_at IS NULL
         OR receipts.authorization_expires_at > now()
       )
     ORDER BY array_position($3::uuid[], fragments.id)`,
    [auth.accountId, captureID, evidenceRefs],
  );
  if (
    result.rows.length !== evidenceRefs.length ||
    result.rows.some((row) => sha256(row.text_content) !== row.content_hash)
  ) {
    throw new ApiError(
      422,
      "AGENT_EVIDENCE_UNAVAILABLE",
      "Every Agent fragment must remain active, authorized, reviewed, attribution-confirmed, and content-identical.",
    );
  }
  return result.rows;
}

export async function compileAgentScope(
  pool: DatabaseClient,
  auth: AuthContext,
  input: {
    runID: string;
    pursuitID: string;
    pursuitRevision: number;
    captureID: string;
    objective: string;
    evidenceRefs: readonly string[];
    inputArtifactManifest?: readonly AgentInputArtifactManifestItem[];
  },
): Promise<AgentRunScope> {
  const pursuit = await readPursuit(pool, auth.accountId, input.pursuitID);
  if (pursuit.revision !== input.pursuitRevision) {
    throw new ApiError(
      409,
      "AGENT_PURSUIT_BASE_CONFLICT",
      "The Pursuit changed before the Agent context could be frozen.",
      { current_revision: pursuit.revision },
    );
  }
  await assertCaptureScope(pool, auth, input.pursuitID, input.captureID);
  const evidence = await readAuthorizedEvidence(
    pool,
    auth,
    input.captureID,
    input.evidenceRefs,
  );
  return {
    runID: input.runID,
    workspaceID: auth.accountId,
    userID: auth.userId,
    pursuitID: input.pursuitID,
    pursuitRevision: input.pursuitRevision,
    captureID: input.captureID,
    objective: input.objective.trim(),
    evidenceManifest: evidence.map((item) => ({
      fragmentID: item.fragment_id,
      contentHash: item.content_hash,
      inclusionReason:
        "Explicitly selected, reviewed evidence for this one Pursuit run.",
      authorizationScope: item.retention_scope,
    })),
    inputArtifactManifest: [...(input.inputArtifactManifest ?? [])],
  };
}

function mapProposalItems(
  items: AgentProposalCandidate["items"],
  policy: "legacy_review" | "operational_only",
  ownerUserID: string,
): StagePursuitProposalRequest["items"] {
  return items.map((item) => {
    const common = {
      item_key: item.itemKey,
      basis_kind: "evidence_supported" as const,
      epistemic_status: item.epistemicStatus,
      evidence_refs: item.evidenceRefs,
      reason: item.reason,
      effect_summary: item.effectSummary,
    };
    if (policy === "operational_only") {
      const gapLabels = {
        identity_unresolved: [
          "Identity needs review",
          "The person identity remains unresolved in reviewed evidence.",
          "Close when a human confirms or rejects the identity binding.",
        ],
        contact_channel_unavailable: [
          "Contact channel unavailable",
          "No governed contact channel is currently available.",
          "Close when a human verifies an authorized contact channel.",
        ],
        availability_unknown: [
          "Availability remains unknown",
          "Reviewed evidence does not establish current availability.",
          "Close when current availability is confirmed from reviewed evidence.",
        ],
        scheduling_constraint: [
          "Scheduling constraint unresolved",
          "Reviewed evidence names a scheduling constraint that is not resolved.",
          "Close when the scheduling constraint is resolved or expires.",
        ],
        stakeholder_response_pending: [
          "Stakeholder response pending",
          "A required stakeholder response has not been observed.",
          "Close when the response or observation-window outcome is recorded.",
        ],
        evidence_conflict: [
          "Evidence conflict needs review",
          "Reviewed evidence contains a material contradiction.",
          "Close when a human resolves or explicitly preserves the dispute.",
        ],
        source_freshness_expired: [
          "Source freshness expired",
          "The source is no longer fresh enough for this operational dependency.",
          "Close when a fresh governed source is reviewed.",
        ],
      } as const;
      const taskLabels = {
        review_identity: "Review identity evidence",
        review_evidence: "Review the cited evidence",
        ask_clarifying_question: "Ask one clarifying question",
        prepare_message_draft: "Prepare a non-sending message draft",
        wait_until: "Wait for the observation window",
        verify_outcome: "Verify the observed outcome",
      } as const;
      const [prefix, category] = item.itemKey.split(":", 2);
      if (prefix === "operational_gap" && category && category in gapLabels) {
        if (item.change.kind !== "add_gap") {
          throw new AgentCapabilityError(
            "OPERATIONAL_PROPOSAL_SHAPE_INVALID",
            "An operational_gap item can only stage an add_gap review candidate.",
          );
        }
        const [title, basisSummary, closeCondition] =
          gapLabels[category as keyof typeof gapLabels];
        return {
          ...common,
          reason: basisSummary,
          effect_summary: `Would add the operational gap “${title}” for human review only.`,
          change: {
            kind: "add_gap" as const,
            proposed_value: {
              title,
              basis_summary: basisSummary,
              close_condition: closeCondition,
            },
          },
        };
      }
      if (prefix === "recruiter_task" && category && category in taskLabels) {
        if (item.change.kind !== "add_action") {
          throw new AgentCapabilityError(
            "OPERATIONAL_PROPOSAL_SHAPE_INVALID",
            "A recruiter_task item can only stage an add_action review candidate.",
          );
        }
        const title = taskLabels[category as keyof typeof taskLabels];
        return {
          ...common,
          reason: "This is a user-owned operational step, not an assessment of the person.",
          effect_summary: `Would add the user-owned task “${title}” for human review only.`,
          change: {
            kind: "add_action" as const,
            proposed_value: {
              title,
              owner_user_id: ownerUserID,
              due_at: item.change.proposedValue.dueAt,
            },
          },
        };
      }
      throw new AgentCapabilityError(
        "PROHIBITED_PERSON_ASSESSMENT",
        "Governed Tasks only allow enumerated operational_gap or recruiter_task review candidates.",
      );
    }
    switch (item.change.kind) {
      case "set_milestone":
        return {
          ...common,
          change: {
            kind: item.change.kind,
            proposed_value: item.change.proposedValue,
          },
        };
      case "set_pursuit_status":
        return {
          ...common,
          change: {
            kind: item.change.kind,
            proposed_value: item.change.proposedValue,
          },
        };
      case "set_role_status":
        return {
          ...common,
          change: {
            kind: item.change.kind,
            role_id: item.change.roleID,
            proposed_value: item.change.proposedValue,
          },
        };
      case "add_gap":
        return {
          ...common,
          change: {
            kind: item.change.kind,
            proposed_value: {
              title: item.change.proposedValue.title,
              basis_summary: item.change.proposedValue.basisSummary,
              close_condition: item.change.proposedValue.closeCondition,
            },
          },
        };
      case "add_action":
        return {
          ...common,
          change: {
            kind: item.change.kind,
            proposed_value: {
              title: item.change.proposedValue.title,
              owner_user_id: item.change.proposedValue.ownerUserID,
              due_at: item.change.proposedValue.dueAt,
            },
          },
        };
    }
  });
}

export class DatabaseAgentGateway implements AgentCapabilityGateway {
  constructor(
    private readonly pool: Pool,
    private readonly auth: AuthContext,
    private readonly proposalPolicy: "legacy_review" | "operational_only" =
      "legacy_review",
  ) {}

  async readPursuit(scope: AgentRunScope) {
    const pursuit = await readPursuit(
      this.pool,
      this.auth.accountId,
      scope.pursuitID,
    );
    return {
      workspaceID: pursuit.workspace_id,
      pursuitID: pursuit.id,
      revision: pursuit.revision,
      title: pursuit.title,
      status: pursuit.status,
      milestone: pursuit.milestone,
      roles: pursuit.roles,
      gaps: pursuit.gaps,
      actions: pursuit.actions,
    };
  }

  async readEvidence(
    scope: AgentRunScope,
    evidenceRefs: readonly string[],
  ): Promise<readonly AgentEvidence[]> {
    let rows: EvidenceRow[];
    try {
      await assertCaptureScope(
        this.pool,
        this.auth,
        scope.pursuitID,
        scope.captureID,
      );
      rows = await readAuthorizedEvidence(
        this.pool,
        this.auth,
        scope.captureID,
        evidenceRefs,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw new AgentCapabilityError(error.code, error.message);
      }
      throw error;
    }
    return rows.map((item) => ({
      fragmentID: item.fragment_id,
      text: item.text_content,
      observedAt: iso(item.observed_at),
      sourceDisplayName: item.source_display_name,
      attributionStatus: "confirmed",
      reviewStatus: "reviewed",
      availability: "available",
      contentHash: item.content_hash,
    }));
  }

  async commitProposal(
    scope: AgentRunScope,
    candidate: AgentProposalCandidate,
    candidateFingerprint: string,
  ) {
    const result = await stagePursuitProposal(
      this.pool,
      this.auth,
      scope.pursuitID,
      {
        idempotency_key: `agent:${scope.runID}:${candidateFingerprint}`,
        proposal_id: scope.runID,
        capture_id: scope.captureID,
        base_revision: scope.pursuitRevision,
        summary: candidate.summary,
        producer: {
          kind: "agent",
          name: "talent-signal-pursuit-momentum",
          version: "1.0.0",
          run_id: scope.runID,
        },
        items: mapProposalItems(
          candidate.items,
          this.proposalPolicy,
          this.auth.userId,
        ),
      },
    );
    if (result.body.proposal.status !== "needs_review") {
      throw new ApiError(
        500,
        "AGENT_PROPOSAL_READBACK_MISMATCH",
        "The Agent Proposal did not remain review-only after staging.",
      );
    }
    return {
      proposalID: result.body.proposal.id,
      status: "needs_review" as const,
      replayed: result.replayed,
    };
  }

  async commitNoAction(
    scope: AgentRunScope,
    candidate: AgentNoActionCandidate,
    candidateFingerprint: string,
  ) {
    const id = randomUUID();
    const result = await this.pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO agent_no_actions(
         id, account_id, run_id, pursuit_id, capture_id, reason_code, reason,
         missing_evidence_refs, candidate_fingerprint, external_effects
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb)
       ON CONFLICT (account_id, run_id) DO UPDATE
       SET run_id = agent_no_actions.run_id
       RETURNING id, (xmax = 0) AS inserted`,
      [
        id,
        this.auth.accountId,
        scope.runID,
        scope.pursuitID,
        scope.captureID,
        candidate.reasonCode,
        candidate.reason,
        JSON.stringify(candidate.missingEvidenceRefs),
        candidateFingerprint,
      ],
    );
    return {
      noActionID: result.rows[0]?.id ?? id,
      replayed: !(result.rows[0]?.inserted ?? true),
    };
  }
}
