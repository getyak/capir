import {
  CONTRACT_VERSION,
  type RelationshipExternalEffectFollowUp,
  type RelationshipAgentHistory,
  type RelationshipAgentOperation,
} from "@talent-signal/contracts";
import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";
import { getRelationshipScope } from "./people.js";

const EVENT_TYPES = [
  "resource.capture_submitted",
  "identity_resolution.decided",
  "identity.corrected",
  "identity.handle_confirmed",
  "identity.handle_reconfirmed",
  "identity.handle_expired",
  "identity.people_merged",
  "identity.people_merge_reversed",
  "source.authorization_revoked",
  "source.authorization_restored",
  "source.authorization_expired",
  "knowledge_snapshot.published",
  "chat_task.assembled",
  "capture.deleted",
] as const;

interface AgentHistoryRow {
  id: string;
  sequence: string;
  actor_user_id: string | null;
  event_type: (typeof EVENT_TYPES)[number];
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
  capture_id: string | null;
  source_resource_id: string | null;
  resource_kind: string | null;
  resource_display_name: string | null;
  resource_processing_state: string | null;
  identity_case_id: string | null;
  identity_case_status: string | null;
  identity_decision_reason: string | null;
  correction_reason: string | null;
  knowledge_snapshot_id: string | null;
  knowledge_snapshot_status: string | null;
  person_merge_operation_status: "applied" | "reversed" | null;
}

interface ExternalEffectFollowUpRow {
  action_id: string;
  capture_id: string;
  action_status: "completed" | "executing" | "unknown";
  action_type: string;
  target_text: string | null;
  reason_text: string | null;
  destination_key: string | null;
  authorization_state: "revoked" | "expired";
  authorization_decision_id: string | null;
  authorization_changed_at: Date;
  attempt_id: string | null;
  attempt_status: "running" | "verified" | "failed" | "unknown" | null;
  attempt_started_at: Date | null;
  attempt_finished_at: Date | null;
  observation_id: string | null;
  observation_match_status:
    | "matched"
    | "mismatched"
    | "unavailable"
    | null;
  observation_observed_at: Date | null;
  outcome_id: string | null;
  outcome_status: "verified" | "failed" | "unknown" | null;
  outcome_summary: string | null;
  outcome_created_at: Date | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function count(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function bounded(value: string, maximum = 500): string {
  return value.length <= maximum
    ? value
    : `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function operationStatus(
  row: AgentHistoryRow,
): RelationshipAgentOperation["status"] {
  if (row.event_type === "resource.capture_submitted") {
    return row.resource_processing_state === "deleted"
      ? "retracted"
      : "completed";
  }
  if (row.event_type === "identity_resolution.decided") {
    if (row.metadata.decision === "leave_unresolved") {
      return row.identity_case_status === "pending"
        ? "staged"
        : "superseded";
    }
    return row.identity_case_status === "resolved"
      ? "completed"
      : "superseded";
  }
  if (row.event_type === "identity.corrected") {
    return row.metadata.prior_person_id === row.metadata.scope_person_id &&
      row.metadata.prior_relationship_context_id ===
        row.metadata.scope_relationship_context_id
      ? "retracted"
      : "completed";
  }
  if (row.event_type === "identity.people_merge_reversed") {
    return "retracted";
  }
  if (row.event_type === "identity.handle_expired") {
    return "retracted";
  }
  if (
    row.event_type === "identity.people_merged" &&
    row.person_merge_operation_status === "reversed"
  ) {
    return "retracted";
  }
  if (
    row.event_type === "source.authorization_revoked" ||
    row.event_type === "source.authorization_expired"
  ) {
    return "retracted";
  }
  if (row.event_type === "knowledge_snapshot.published") {
    switch (row.knowledge_snapshot_status) {
      case "published":
        return "completed";
      case "abstained":
        return "abstained";
      case "deleted":
        return "retracted";
      default:
        return "superseded";
    }
  }
  if (row.event_type === "capture.deleted") {
    return "retracted";
  }
  return "completed";
}

function operationCopy(row: AgentHistoryRow): {
  detail: string;
  kind: RelationshipAgentOperation["kind"];
  title: string;
} {
  const metadata = row.metadata;
  switch (row.event_type) {
    case "resource.capture_submitted": {
      if (row.resource_processing_state === "deleted") {
        return {
          kind: "source_captured",
          title: "Governed source later deleted",
          detail:
            "Its private content and derived artifacts were removed; only audit-safe lineage remains.",
        };
      }
      const displayName =
        row.resource_display_name &&
        row.resource_display_name !== "[deleted]"
          ? row.resource_display_name
          : "Governed source";
      const fragments = count(metadata.fragment_count);
      const channel = text(metadata.channel)?.replaceAll("_", " ");
      const resourceKind =
        row.resource_kind?.replaceAll("_", " ") ?? "source";
      return {
        kind: "source_captured",
        title: "Governed source attached",
        detail: bounded(
          `${displayName} · ${resourceKind}${
            channel ? ` via ${channel}` : ""
          } · ${fragments} ${fragments === 1 ? "fragment" : "fragments"}.`,
        ),
      };
    }
    case "identity_resolution.decided": {
      if (metadata.decision === "leave_unresolved") {
        return {
          kind: "identity_review",
          title: "Identity left unresolved",
          detail: bounded(
            row.identity_decision_reason
              ? `Review note: ${row.identity_decision_reason}`
              : "The source stayed outside every person Wiki pending stronger identity evidence.",
          ),
        };
      }
      return {
        kind: "identity_review",
        title: "Source identity resolved",
        detail: bounded(
          row.identity_decision_reason
            ? `Decision basis: ${row.identity_decision_reason}`
            : "The user selected this person and relationship before the source entered the Wiki.",
        ),
      };
    }
    case "identity.corrected": {
      const movedOut =
        metadata.prior_person_id === metadata.scope_person_id &&
        metadata.prior_relationship_context_id ===
          metadata.scope_relationship_context_id;
      return {
        kind: "identity_correction",
        title: movedOut
          ? "Source moved out of this relationship"
          : "Source moved into this relationship",
        detail: bounded(
          !movedOut && row.correction_reason
            ? `Decision basis: ${row.correction_reason}`
            : `${count(metadata.capture_ids_rebound)} governed ${
                count(metadata.capture_ids_rebound) === 1
                  ? "capture was"
                  : "captures were"
              } ${
                movedOut
                  ? "moved out; dependent state was retracted or reopened for review."
                  : "moved in; dependent state was reopened for review."
              }`,
        ),
      };
    }
    case "identity.handle_confirmed":
    case "identity.handle_reconfirmed": {
      const policyVersion = text(
        metadata.freshness_policy_version,
      );
      const validityBasis = text(metadata.validity_basis);
      const overrideReason = text(
        metadata.validity_override_reason,
      );
      const policyDetail = policyVersion
        ? ` Policy ${policyVersion}${
            validityBasis === "human_override"
              ? `; human override: ${overrideReason ?? "reason unavailable"}`
              : "; default interval"
          }.`
        : "";
      return {
        kind: "identity_review",
        title:
          row.event_type === "identity.handle_confirmed"
            ? "Identity clue confirmed"
            : "Identity clue reconfirmed",
        detail: bounded(
          `${text(metadata.handle_type)?.replaceAll("_", " ") ?? "Identity"} clue ${
            text(metadata.display_hint) ?? "masked"
          } is source-linked and usable for account-scoped matching until ${
            text(metadata.valid_until) ?? "its review deadline"
          }.${policyDetail}`,
        ),
      };
    }
    case "identity.handle_expired":
      return {
        kind: "identity_review",
        title: "Identity clue needs fresh confirmation",
        detail: bounded(
          `${text(metadata.handle_type)?.replaceAll("_", " ") ?? "Identity"} clue ${
            text(metadata.display_hint) ?? "masked"
          } reached its independent freshness deadline. It remains in history but cannot act as a confirmed match until the user supplies a fresh governed contact source.`,
        ),
      };
    case "identity.people_merged":
      return {
        kind: "identity_merge",
        title: "Duplicate person page merged",
        detail: bounded(
          `${count(metadata.affected_relationship_context_ids)} relationship ${
            count(metadata.affected_relationship_context_ids) === 1
              ? "context"
              : "contexts"
          } and ${count(metadata.captures_rebound)} governed ${
            count(metadata.captures_rebound) === 1
              ? "source was"
              : "sources were"
          } moved to the retained person with provenance intact. Decision basis: ${
            text(metadata.reason) ?? "duplicate identity confirmed"
          }`,
        ),
      };
    case "identity.people_merge_reversed":
      return {
        kind: "identity_merge",
        title: "Person merge reversed",
        detail: bounded(
          `${count(metadata.affected_relationship_context_ids)} relationship ${
            count(metadata.affected_relationship_context_ids) === 1
              ? "context was"
              : "contexts were"
          } restored to the prior person. Decision basis: ${
            text(metadata.reason) ?? "separate identities confirmed"
          }`,
        ),
      };
    case "source.authorization_revoked":
      return {
        kind: "source_authorization",
        title: "Source access revoked",
        detail: bounded(
          `${count(metadata.affected_capture_ids)} governed ${
            count(metadata.affected_capture_ids) === 1
              ? "capture was"
              : "captures were"
          } removed from relationship memory; ${count(
            metadata.states_retracted,
          )} confirmed ${
            count(metadata.states_retracted) === 1 ? "state was" : "states were"
          } retracted. Decision basis: ${
            text(metadata.reason) ?? "authorization withdrawn"
          }`,
        ),
      };
    case "source.authorization_restored":
      return {
        kind: "source_authorization",
        title: "Source access restored for review",
        detail: bounded(
          `${count(metadata.affected_capture_ids)} governed ${
            count(metadata.affected_capture_ids) === 1
              ? "capture is"
              : "captures are"
          } available again; ${count(metadata.claims_reopened)} ${
            count(metadata.claims_reopened) === 1 ? "claim remains" : "claims remain"
          } pending human review. No prior conclusion or action was restored automatically. Decision basis: ${
            text(metadata.reason) ?? "authorization restored"
          }`,
        ),
      };
    case "source.authorization_expired":
      return {
        kind: "source_authorization",
        title: "Source authorization expired",
        detail: bounded(
          `${count(metadata.affected_capture_ids)} governed ${
            count(metadata.affected_capture_ids) === 1
              ? "capture was"
              : "captures were"
          } removed from relationship memory when its authorization deadline elapsed; ${count(
            metadata.states_retracted,
          )} confirmed ${
            count(metadata.states_retracted) === 1 ? "state was" : "states were"
          } retracted.${
            count(metadata.external_effects_requiring_follow_up) > 0
              ? ` ${count(
                  metadata.external_effects_requiring_follow_up,
                )} external ${
                  count(metadata.external_effects_requiring_follow_up) === 1
                    ? "effect requires"
                    : "effects require"
                } user follow-up.`
              : ""
          }`,
        ),
      };
    case "knowledge_snapshot.published": {
      const blockCount = count(metadata.block_count);
      const version = text(metadata.compiler_version);
      return {
        kind: "wiki_compilation",
        title:
          row.knowledge_snapshot_status === "published"
            ? "Wiki snapshot published"
            : row.knowledge_snapshot_status === "abstained"
              ? "Wiki compiler abstained"
              : "Earlier Wiki snapshot replaced",
        detail: `${blockCount} ${
          blockCount === 1 ? "block" : "blocks"
        } compiled${version ? ` with compiler ${version}` : ""}; every material block keeps governed dependencies.`,
      };
    }
    case "chat_task.assembled": {
      const blockCount = count(metadata.included_block_count);
      const disposition =
        text(metadata.disposition)?.replaceAll("_", " ") ?? "answer";
      return {
        kind: "chat_brief",
        title: "Source-linked brief assembled",
        detail: `${disposition} · ${blockCount} ${
          blockCount === 1 ? "Wiki block" : "Wiki blocks"
        } pinned to an immutable snapshot.`,
      };
    }
    case "capture.deleted":
      return {
        kind: "source_deletion",
        title: "Governed source lineage deleted",
        detail: `${count(metadata.derivatives_deleted)} derived ${
          count(metadata.derivatives_deleted) === 1
            ? "record was"
            : "records were"
        } removed; audit references retain no deleted source content.`,
      };
  }
}

function mapOperation(
  row: AgentHistoryRow,
  personId: string,
  relationshipContextId: string,
): RelationshipAgentOperation {
  const scopedRow = {
    ...row,
    metadata: {
      ...row.metadata,
      scope_person_id: personId,
      scope_relationship_context_id: relationshipContextId,
    },
  };
  const copy = operationCopy(scopedRow);
  return {
    id: row.id,
    sequence: Number(row.sequence),
    kind: copy.kind,
    status: operationStatus(scopedRow),
    title: copy.title,
    detail: copy.detail,
    occurred_at: row.occurred_at.toISOString(),
    actor_kind: row.actor_user_id ? "recruiter" : "system",
    person_id: personId,
    relationship_context_id: relationshipContextId,
    references: {
      capture_id:
        row.capture_id ?? text(row.metadata.capture_id),
      source_resource_id:
        row.source_resource_id ??
        text(row.metadata.source_resource_id) ??
        text(row.metadata.resource_id),
      identity_case_id: row.identity_case_id,
      knowledge_snapshot_id:
        row.knowledge_snapshot_id ??
        text(row.metadata.knowledge_snapshot_id),
      person_merge_operation_id:
        text(row.metadata.operation_id),
    },
    provenance: {
      event_type: row.event_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
    },
  };
}

function mapExternalEffectFollowUp(
  row: ExternalEffectFollowUpRow,
): RelationshipExternalEffectFollowUp {
  return {
    action_id: row.action_id,
    capture_id: row.capture_id,
    action_status: row.action_status,
    action_type: row.action_type,
    target: row.target_text,
    reason: row.reason_text,
    destination_key: row.destination_key,
    authorization: {
      state: row.authorization_state,
      decision_id: row.authorization_decision_id,
      changed_at: row.authorization_changed_at.toISOString(),
    },
    attempt:
      row.attempt_id &&
      row.attempt_status &&
      row.attempt_started_at
        ? {
            id: row.attempt_id,
            status: row.attempt_status,
            started_at: row.attempt_started_at.toISOString(),
            finished_at:
              row.attempt_finished_at?.toISOString() ?? null,
          }
        : null,
    observation:
      row.observation_id &&
      row.observation_match_status &&
      row.observation_observed_at
        ? {
            id: row.observation_id,
            match_status: row.observation_match_status,
            observed_at:
              row.observation_observed_at.toISOString(),
          }
        : null,
    outcome:
      row.outcome_id &&
      row.outcome_status &&
      row.outcome_summary &&
      row.outcome_created_at
        ? {
            id: row.outcome_id,
            status: row.outcome_status,
            summary: row.outcome_summary,
            created_at: row.outcome_created_at.toISOString(),
          }
        : null,
    requires_recruiter_decision: true,
  };
}

export async function getRelationshipAgentHistory(
  pool: Pool,
  auth: AuthContext,
  personId: string,
  relationshipContextId: string,
): Promise<RelationshipAgentHistory> {
  await getRelationshipScope(
    pool,
    auth,
    personId,
    relationshipContextId,
  );
  const result = await pool.query<AgentHistoryRow>(
    `SELECT
       events.id,
       events.sequence::text,
       events.actor_user_id,
       events.event_type,
       events.entity_type,
       events.entity_id,
       events.metadata,
       events.occurred_at,
       COALESCE(resource_captures.id, event_captures.id) AS capture_id,
       resources.id AS source_resource_id,
       resources.resource_kind,
       resources.display_name AS resource_display_name,
       resources.processing_state AS resource_processing_state,
       COALESCE(identity_cases.id, capture_identity_case.id)
         AS identity_case_id,
       COALESCE(identity_cases.status, capture_identity_case.status)
         AS identity_case_status,
       identity_decision.reason AS identity_decision_reason,
       correction.reason AS correction_reason,
       snapshots.id AS knowledge_snapshot_id,
       snapshots.status AS knowledge_snapshot_status,
       merge_operation.status AS person_merge_operation_status
     FROM audit_events events
     LEFT JOIN source_resources resources
       ON events.entity_type = 'source_resource'
      AND resources.account_id = events.account_id
      AND resources.id = events.entity_id
     LEFT JOIN captures resource_captures
       ON resource_captures.account_id = resources.account_id
      AND resource_captures.id = resources.capture_id
     LEFT JOIN captures event_captures
       ON events.entity_type = 'capture'
      AND event_captures.account_id = events.account_id
      AND event_captures.id = events.entity_id
     LEFT JOIN identity_resolution_cases identity_cases
       ON events.entity_type = 'identity_resolution_case'
      AND identity_cases.account_id = events.account_id
      AND identity_cases.id = events.entity_id
     LEFT JOIN identity_resolution_cases capture_identity_case
       ON capture_identity_case.account_id = resource_captures.account_id
      AND capture_identity_case.capture_id = resource_captures.id
     LEFT JOIN LATERAL (
       SELECT decisions.reason
       FROM identity_resolution_decisions decisions
       WHERE decisions.account_id = events.account_id
         AND decisions.case_id = identity_cases.id
         AND decisions.decision = events.metadata->>'decision'
       ORDER BY ABS(
         EXTRACT(EPOCH FROM decisions.decided_at - events.occurred_at)
       ), decisions.id
       LIMIT 1
     ) identity_decision ON true
     LEFT JOIN identity_correction_decisions correction
       ON events.event_type = 'identity.corrected'
      AND correction.account_id = events.account_id
      AND correction.id = (events.metadata->>'decision_id')::uuid
     LEFT JOIN knowledge_snapshots snapshots
       ON events.entity_type = 'knowledge_snapshot'
      AND snapshots.account_id = events.account_id
      AND snapshots.id = events.entity_id
     LEFT JOIN person_merge_operations merge_operation
       ON events.event_type IN (
         'identity.people_merged',
         'identity.people_merge_reversed'
       )
      AND merge_operation.account_id = events.account_id
      AND merge_operation.id = (events.metadata->>'operation_id')::uuid
     WHERE events.account_id = $1
       AND events.event_type = ANY($4::text[])
       AND (
         (
           events.event_type = 'resource.capture_submitted'
           AND (
             (
               events.metadata->>'person_id' = $2::text
               AND events.metadata->>'relationship_context_id' = $3::text
             )
             OR (
               events.metadata->>'person_id' IS NULL
               AND capture_identity_case.resolved_subject_id = $2::uuid
               AND capture_identity_case.resolved_assignment_id = $3::uuid
             )
             OR (
               NOT (events.metadata ? 'person_id')
               AND resource_captures.subject_id = $2::uuid
               AND resource_captures.assignment_id = $3::uuid
               AND NOT EXISTS (
                 SELECT 1
                 FROM identity_correction_decisions prior_correction
                 WHERE prior_correction.account_id = events.account_id
                   AND resource_captures.id =
                     ANY(prior_correction.affected_capture_ids)
               )
             )
           )
         )
         OR (
           events.event_type = 'identity_resolution.decided'
           AND (
             (
               events.metadata->>'person_id' = $2::text
               AND events.metadata->>'relationship_context_id' = $3::text
             )
             OR (
               identity_cases.resolved_subject_id = $2::uuid
               AND identity_cases.resolved_assignment_id = $3::uuid
             )
           )
         )
         OR (
           events.event_type = 'identity.corrected'
           AND (
             (
               events.metadata->>'person_id' = $2::text
               AND events.metadata->>'relationship_context_id' = $3::text
             )
             OR (
               events.metadata->>'prior_person_id' = $2::text
               AND events.metadata->>'prior_relationship_context_id' = $3::text
             )
           )
         )
         OR (
           events.event_type IN (
             'identity.handle_confirmed',
             'identity.handle_reconfirmed',
             'identity.handle_expired'
           )
           AND events.metadata->>'person_id' = $2::text
         )
         OR (
           events.event_type IN (
             'identity.people_merged',
             'identity.people_merge_reversed'
           )
           AND (
             events.metadata->>'source_person_id' = $2::text
             OR events.metadata->>'target_person_id' = $2::text
           )
         )
         OR (
           events.event_type IN (
             'source.authorization_revoked',
             'source.authorization_restored',
             'source.authorization_expired'
           )
           AND events.metadata->>'person_id' = $2::text
           AND events.metadata->>'relationship_context_id' = $3::text
         )
         OR (
           events.event_type IN (
             'knowledge_snapshot.published',
             'chat_task.assembled'
           )
           AND events.metadata->>'person_id' = $2::text
           AND events.metadata->>'relationship_context_id' = $3::text
         )
         OR (
           events.event_type = 'capture.deleted'
           AND event_captures.subject_id = $2::uuid
           AND event_captures.assignment_id = $3::uuid
         )
       )
     ORDER BY events.sequence DESC
     LIMIT 50`,
    [auth.accountId, personId, relationshipContextId, EVENT_TYPES],
  );
  const operations = result.rows.map((row) =>
    mapOperation(row, personId, relationshipContextId),
  );
  const followUpResult = await pool.query<ExternalEffectFollowUpRow>(
    `SELECT
       actions.id AS action_id,
       actions.capture_id,
       actions.status AS action_status,
       actions.action_type,
       actions.target_text,
       actions.reason_text,
       COALESCE(
         observation.destination_key,
         actions.exact_preview #>> '{target,destination_key}'
       ) AS destination_key,
       CASE
         WHEN receipts.authorization_state = 'revoked' THEN 'revoked'
         ELSE 'expired'
       END AS authorization_state,
       CASE
         WHEN authorization_decision.authorization_state =
           CASE
             WHEN receipts.authorization_state = 'revoked'
               THEN 'revoked'
             ELSE 'expired'
           END
           THEN authorization_decision.id
         ELSE NULL
       END AS authorization_decision_id,
       CASE
         WHEN receipts.authorization_state = 'authorized'
           THEN receipts.authorization_expires_at
         ELSE receipts.authorization_changed_at
       END AS authorization_changed_at,
       attempt.id AS attempt_id,
       attempt.status AS attempt_status,
       attempt.started_at AS attempt_started_at,
       attempt.finished_at AS attempt_finished_at,
       observation.id AS observation_id,
       observation.match_status AS observation_match_status,
       observation.observed_at AS observation_observed_at,
       outcome.id AS outcome_id,
       outcome.status AS outcome_status,
       outcome.summary AS outcome_summary,
       outcome.created_at AS outcome_created_at
     FROM action_proposals actions
     JOIN captures
       ON captures.account_id = actions.account_id
      AND captures.id = actions.capture_id
     JOIN source_retention_receipts receipts
       ON receipts.account_id = actions.account_id
      AND receipts.capture_id = actions.capture_id
     LEFT JOIN LATERAL (
       SELECT attempts.*
       FROM effect_attempts attempts
       WHERE attempts.account_id = actions.account_id
         AND attempts.action_id = actions.id
       ORDER BY attempts.attempt_number DESC, attempts.id
       LIMIT 1
     ) attempt ON true
     LEFT JOIN LATERAL (
       SELECT observations.*
       FROM effect_observations observations
       WHERE observations.account_id = actions.account_id
         AND observations.attempt_id = attempt.id
       ORDER BY observations.observed_at DESC, observations.id
       LIMIT 1
     ) observation ON true
     LEFT JOIN LATERAL (
       SELECT outcomes.*
       FROM outcomes
       WHERE outcomes.account_id = actions.account_id
         AND outcomes.attempt_id = attempt.id
       ORDER BY outcomes.created_at DESC, outcomes.id
       LIMIT 1
     ) outcome ON true
     LEFT JOIN LATERAL (
       SELECT decisions.id, decisions.authorization_state
       FROM source_authorization_decisions decisions
       WHERE decisions.account_id = actions.account_id
         AND actions.capture_id = ANY(decisions.affected_capture_ids)
       ORDER BY decisions.decided_at DESC, decisions.id
       LIMIT 1
     ) authorization_decision ON true
     WHERE actions.account_id = $1
       AND captures.subject_id = $2
       AND captures.assignment_id = $3
       AND actions.status IN ('completed', 'executing', 'unknown')
       AND (
         receipts.authorization_state IN ('revoked', 'expired')
         OR (
           receipts.authorization_state = 'authorized'
           AND receipts.authorization_expires_at IS NOT NULL
           AND receipts.authorization_expires_at <= now()
         )
       )
     ORDER BY
       COALESCE(
         outcome.created_at,
         observation.observed_at,
         attempt.started_at,
         actions.updated_at
       ) DESC,
       actions.id
     LIMIT 50`,
    [auth.accountId, personId, relationshipContextId],
  );
  return {
    contract_version: CONTRACT_VERSION,
    person_id: personId,
    relationship_context_id: relationshipContextId,
    operations,
    external_effect_follow_ups: followUpResult.rows.map(
      mapExternalEffectFollowUp,
    ),
    next_cursor: operations[0]?.sequence ?? 0,
  };
}
