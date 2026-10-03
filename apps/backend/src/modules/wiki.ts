import { randomUUID } from "node:crypto";

import type {
  CompileKnowledgeRequest,
  CompilationQuality,
  KnowledgeBlock,
  KnowledgeDependency,
  KnowledgeSnapshot,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import {
  assessCompilationPublication,
  deriveCompilationQuality,
} from "./compilationQuality.js";

const COMPILER_NAME = "deterministic-relationship-wiki";
const COMPILER_VERSION = "0.4.0";
const POLICY_VERSION = "relationship-wiki.v1";

interface ScopeRow {
  subject_label: string;
  assignment_label: string;
}

interface StateRow {
  id: string;
  field: string;
  value_text: string;
  status: "active" | "contested" | "expired" | "superseded";
  valid_from: Date;
  valid_until: Date | null;
  evidence_fragment_id: string | null;
}

interface ConflictRow {
  id: string;
  field: string;
  proposal_status: "proposed" | "ambiguous" | "superseded";
  review_status: "pending" | "unresolved";
  proposed_value: string | null;
  evidence_quote: string | null;
  temporal_relation: "new" | "reinforces" | "supersedes";
  supersedes_state_id: string | null;
  evidence_fragment_id: string | null;
}

interface ActionRow {
  id: string;
  target_text: string;
  reason_text: string;
  due_text: string;
  evidence_ids: string[];
}

interface ResourceFragmentRow {
  resource_id: string;
  resource_kind:
    | "conversation_screenshot"
    | "conversation_transcript"
    | "resume"
    | "document"
    | "public_url"
    | "personal_note"
    | "contact_record";
  display_name: string;
  source_locator: string | null;
  observed_at: Date;
  duplicate_of_resource_id: string | null;
  fragment_id: string;
  text_content: string | null;
  attributed_actor: string;
  attribution_status: "confirmed" | "proposed" | "unknown";
  review_status: "proposed" | "reviewed" | "rejected";
}

export interface ResearchSnapshotRow {
  snapshot_id: string;
  task_id: string;
  resource_id: string;
  canonical_url: string;
  retrieved_at: Date;
  freshness_until: Date;
  authorization_scope: string;
  fragment_id: string;
  text_content: string | null;
  review_status: "proposed" | "reviewed" | "rejected";
  is_stale: boolean;
}

interface SnapshotRow {
  id: string;
  account_id: string;
  subject_id: string;
  assignment_id: string | null;
  source_state_cursor: string;
  compiler_name: string;
  compiler_version: string;
  policy_version: string;
  status: KnowledgeSnapshot["status"];
  quality: CompilationQuality;
  compiled_at: Date;
}

interface BlockRow {
  id: string;
  block_key: string;
  block_type: KnowledgeBlock["type"];
  status: KnowledgeBlock["status"];
  structured_content: KnowledgeBlock["content"];
  valid_from: Date | null;
  valid_until: Date | null;
  freshness_until: Date | null;
  sensitivity: KnowledgeBlock["sensitivity"];
  semantic_hash: string;
}

interface DependencyRow {
  block_id: string;
  dependency_type: KnowledgeDependency["type"];
  dependency_id: string;
  inclusion_reason: string;
  authorization_scope: string;
}

export interface WikiMutationResult {
  body: KnowledgeSnapshot;
  replayed: boolean;
  status: number;
}

function dependency(
  type: KnowledgeDependency["type"],
  id: string,
  inclusionReason: string,
  authorizationScope: string,
): KnowledgeDependency {
  return {
    type,
    id,
    inclusion_reason: inclusionReason,
    authorization_scope: authorizationScope,
  };
}

function block(input: Omit<KnowledgeBlock, "id" | "semantic_hash">): KnowledgeBlock {
  const id = randomUUID();
  return {
    id,
    ...input,
    semantic_hash: sha256(
      JSON.stringify({
        block_key: input.block_key,
        type: input.type,
        status: input.status,
        content: input.content,
        valid_from: input.valid_from,
        valid_until: input.valid_until,
        freshness_until: input.freshness_until,
        dependencies: input.dependencies,
      }),
    ),
  };
}

function factBlockType(field: string): KnowledgeBlock["type"] {
  if (
    field.startsWith("professional_history.") ||
    field === "current_role" ||
    field === "current_employer"
  ) {
    return "professional_history";
  }
  switch (field) {
    case "decision_deadline":
      return "deadline";
    case "relocation_requirement":
    case "work_mode_constraint":
    case "work_mode_preference":
    case "availability":
    case "notice_period":
    case "location":
      return "constraint";
    case "competing_process":
      return "meaningful_change";
    default:
      return "relationship_history";
  }
}

function factHeadline(
  field: string,
  value: string,
  status: StateRow["status"],
): string {
  const label = field.replaceAll("_", " ");
  const headline =
    `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}`;
  return status === "contested" ? `Recheck · ${headline}` : headline;
}

function blockStatus(state: StateRow["status"]): KnowledgeBlock["status"] {
  switch (state) {
    case "active":
      return "confirmed";
    case "contested":
      return "contested";
    case "expired":
      return "expired";
    case "superseded":
      return "superseded";
  }
}

function compact(value: string, maximum: number): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function resourceBlock(
  resource: {
    id: string;
    kind: ResourceFragmentRow["resource_kind"];
    displayName: string;
    sourceLocator: string | null;
    observedAt: Date;
    fragments: ResourceFragmentRow[];
  },
  authorizationScope: string,
): KnowledgeBlock {
  const sourceDependency = dependency(
    "source_resource",
    resource.id,
    "This block is a compressed projection of one governed source resource.",
    authorizationScope,
  );
  const fragmentDependencies = resource.fragments
    .slice(0, 99)
    .map((fragment) =>
      dependency(
        "evidence_fragment",
        fragment.fragment_id,
        "This exact fragment supports the source-level projection and remains separately reviewable.",
        authorizationScope,
      ),
    );
  const dependencies = [sourceDependency, ...fragmentDependencies];
  const excerpts = resource.fragments
    .flatMap((fragment) =>
      fragment.text_content ? [compact(fragment.text_content, 900)] : [],
    )
    .slice(0, 20);
  const observedDate = resource.observedAt.toISOString();

  switch (resource.kind) {
    case "personal_note":
      return block({
        block_key: `resource.personal-note.${resource.id}`,
        type: "relationship_history",
        status: resource.fragments.every(
          (fragment) => fragment.review_status === "reviewed",
        )
          ? "confirmed"
          : "proposed",
        content: {
          headline: `Personal note · ${resource.displayName}`,
          summary:
            excerpts[0] ??
            "The user saved a personal note; it is not a statement attributed to the other person.",
          items: [
            `Recorded ${observedDate}`,
            ...(resource.fragments.some(
              (fragment) => fragment.review_status !== "reviewed",
            )
              ? ["Review the source excerpt before relying on this note."]
              : []),
            ...excerpts.slice(1),
          ].slice(0, 20),
        },
        valid_from: observedDate,
        valid_until: null,
        freshness_until: null,
        sensitivity: "restricted",
        dependencies,
      });
    case "resume":
    case "document":
      return block({
        block_key: `resource.${resource.kind}.${resource.id}`,
        type: "professional_history",
        status: "proposed",
        content: {
          headline: `${
            resource.kind === "resume" ? "Resume" : "Document"
          } · ${resource.displayName}`,
          summary:
            "Extracted document evidence. Treat statements as source claims until the user reviews and confirms the relevant facts.",
          items: excerpts,
        },
        valid_from: observedDate,
        valid_until: null,
        freshness_until: null,
        sensitivity: "restricted",
        dependencies,
      });
    case "public_url":
      return block({
        block_key: `resource.public-url.${resource.id}`,
        type: "relationship_history",
        status: "proposed",
        content: {
          headline: `Research seed · ${resource.displayName}`,
          summary:
            "The URL is saved for scoped research; no page content has been fetched or promoted to a person fact.",
          items: [
            ...(resource.sourceLocator ? [resource.sourceLocator] : []),
            ...excerpts,
          ].slice(0, 20),
        },
        valid_from: observedDate,
        valid_until: null,
        freshness_until: null,
        sensitivity: "restricted",
        dependencies,
      });
    case "contact_record":
      return block({
        block_key: `resource.contact-record.${resource.id}`,
        type: "relationship_history",
        status: "proposed",
        content: {
          headline: `Imported contact record · ${resource.displayName}`,
          summary:
            "Imported fields remain source claims until identity and field-level review are complete.",
          items: excerpts,
        },
        valid_from: observedDate,
        valid_until: null,
        freshness_until: null,
        sensitivity: "restricted",
        dependencies,
      });
    case "conversation_screenshot":
    case "conversation_transcript":
      return block({
        block_key: `resource.conversation.${resource.id}`,
        type: "relationship_history",
        status: "proposed",
        content: {
          headline: `Conversation evidence · ${resource.displayName}`,
          summary:
            "Reviewed source fragments are available for fact-level confirmation; this block does not promote the conversation into confirmed state.",
          items: excerpts.slice(0, 6),
        },
        valid_from: observedDate,
        valid_until: null,
        freshness_until: null,
        sensitivity: "highly_restricted",
        dependencies,
      });
  }
}

export function researchBlock(
  research: ResearchSnapshotRow,
  relationshipAuthorizationScope: string,
): KnowledgeBlock {
  const dependencies = [
    dependency(
      "research_snapshot",
      research.snapshot_id,
      "This block comes from the immutable retrieval record for the approved public page.",
      compact(research.authorization_scope, 500),
    ),
    dependency(
      "source_resource",
      research.resource_id,
      "The fetched page remains a governed and independently deletable source resource.",
      relationshipAuthorizationScope,
    ),
    dependency(
      "evidence_fragment",
      research.fragment_id,
      "The visible excerpt retains its exact reviewable source fragment.",
      relationshipAuthorizationScope,
    ),
  ];
  if (research.is_stale) {
    return block({
      block_key: `research.stale.${research.snapshot_id}`,
      type: "open_question",
      status: "expired",
      content: {
        headline: `Refresh stale public research · ${new URL(research.canonical_url).hostname}`,
        summary:
          "The prior public-page snapshot remains traceable but its content is not projected into the current Wiki after the freshness deadline.",
        items: [
          research.canonical_url,
          `Retrieved ${research.retrieved_at.toISOString()}`,
          `Freshness ended ${research.freshness_until.toISOString()}`,
        ],
      },
      valid_from: null,
      valid_until: research.freshness_until.toISOString(),
      freshness_until: research.freshness_until.toISOString(),
      sensitivity: "restricted",
      dependencies,
    });
  }
  const excerpt = research.text_content
    ? compact(research.text_content, 1_200)
    : "The public page snapshot contained no reviewable text.";
  return block({
    block_key: `research.snapshot.${research.snapshot_id}`,
    type: "sourced_research",
    status: "proposed",
    content: {
      headline: `Public research · ${new URL(research.canonical_url).hostname}`,
      summary:
        "A bounded public-page snapshot. It is context for human review, not a confirmed fact about the person.",
      items: [
        research.canonical_url,
        `Retrieved ${research.retrieved_at.toISOString()} · extraction ${research.review_status}`,
        excerpt,
      ],
    },
    valid_from: research.retrieved_at.toISOString(),
    valid_until: null,
    freshness_until: research.freshness_until.toISOString(),
    sensitivity: "restricted",
    dependencies,
  });
}

export async function loadSnapshot(
  client: Pool | PoolClient,
  accountId: string,
  personId: string,
  relationshipContextId: string,
  snapshotId?: string,
): Promise<KnowledgeSnapshot> {
  const result = await client.query<SnapshotRow>(
    `SELECT
       id, account_id, subject_id, assignment_id, source_state_cursor::text,
       compiler_name, compiler_version, policy_version, status, quality,
       compiled_at
     FROM knowledge_snapshots
     WHERE account_id = $1
       AND subject_id = $2
       AND assignment_id = $3
       AND ($4::uuid IS NULL OR id = $4)
       AND ($4::uuid IS NOT NULL OR status = 'published')
     ORDER BY compiled_at DESC, id DESC
     LIMIT 1`,
    [accountId, personId, relationshipContextId, snapshotId ?? null],
  );
  const snapshot = result.rows[0];
  if (!snapshot) {
    throw new ApiError(
      404,
      "WIKI_SNAPSHOT_NOT_FOUND",
      "No compiled Wiki is available for this person and relationship context.",
    );
  }

  const staleAuthorization = await client.query<{ capture_id: string }>(
    `WITH dependency_captures AS (
       SELECT resources.capture_id
       FROM knowledge_blocks blocks
       JOIN knowledge_dependencies dependencies
         ON dependencies.account_id = blocks.account_id
        AND dependencies.block_id = blocks.id
        AND dependencies.dependency_type = 'source_resource'
       JOIN source_resources resources
         ON resources.account_id = dependencies.account_id
        AND resources.id = dependencies.dependency_id
       WHERE blocks.account_id = $1
         AND blocks.snapshot_id = $2
       UNION
       SELECT fragments.capture_id
       FROM knowledge_blocks blocks
       JOIN knowledge_dependencies dependencies
         ON dependencies.account_id = blocks.account_id
        AND dependencies.block_id = blocks.id
        AND dependencies.dependency_type = 'evidence_fragment'
       JOIN evidence_fragments fragments
         ON fragments.account_id = dependencies.account_id
        AND fragments.id = dependencies.dependency_id
       WHERE blocks.account_id = $1
         AND blocks.snapshot_id = $2
       UNION
       SELECT assertions.capture_id
       FROM knowledge_blocks blocks
       JOIN knowledge_dependencies dependencies
         ON dependencies.account_id = blocks.account_id
        AND dependencies.block_id = blocks.id
        AND dependencies.dependency_type = 'fact_version'
       JOIN confirmed_states states
         ON states.account_id = dependencies.account_id
        AND states.id = dependencies.dependency_id
       JOIN proposed_assertions assertions
         ON assertions.account_id = states.account_id
        AND assertions.id = states.source_assertion_id
       WHERE blocks.account_id = $1
         AND blocks.snapshot_id = $2
     )
     SELECT captures.capture_id
     FROM dependency_captures captures
     JOIN source_retention_receipts receipts
       ON receipts.account_id = $1
      AND receipts.capture_id = captures.capture_id
     WHERE receipts.authorization_state <> 'authorized'
        OR (
          receipts.authorization_expires_at IS NOT NULL
          AND receipts.authorization_expires_at <= now()
        )
     LIMIT 1`,
    [accountId, snapshot.id],
  );
  if (staleAuthorization.rows[0]) {
    throw new ApiError(
      409,
      "WIKI_SOURCE_AUTHORIZATION_STALE",
      "This Wiki snapshot depends on source authorization that is no longer active. Recompile the relationship before using it.",
    );
  }

  const blocksResult = await client.query<BlockRow>(
    `SELECT
       id, block_key, block_type, status, structured_content, valid_from,
       valid_until, freshness_until, sensitivity, semantic_hash
     FROM knowledge_blocks
     WHERE account_id = $1
       AND snapshot_id = $2
       AND status <> 'deleted'
     ORDER BY
       CASE block_type
         WHEN 'identity_context' THEN 0
         WHEN 'current_dependency' THEN 10
         WHEN 'conflict' THEN 20
         WHEN 'decision_driver' THEN 30
         WHEN 'constraint' THEN 31
         WHEN 'commitment' THEN 32
         WHEN 'deadline' THEN 33
         WHEN 'meaningful_change' THEN 34
         WHEN 'open_question' THEN 35
         WHEN 'professional_history' THEN 40
         WHEN 'sourced_research' THEN 50
         WHEN 'relationship_history' THEN 60
         WHEN 'observed_outcome' THEN 70
         WHEN 'next_action' THEN 90
         WHEN 'no_action' THEN 90
         ELSE 80
       END,
       block_key,
       id`,
    [accountId, snapshot.id],
  );
  const blockIds = blocksResult.rows.map((item) => item.id);
  const dependenciesResult =
    blockIds.length === 0
      ? { rows: [] as DependencyRow[] }
      : await client.query<DependencyRow>(
          `SELECT
             block_id, dependency_type, dependency_id, inclusion_reason,
             authorization_scope
           FROM knowledge_dependencies
           WHERE account_id = $1
             AND block_id = ANY($2::uuid[])
           ORDER BY created_at, id`,
          [accountId, blockIds],
        );
  const dependenciesByBlock = new Map<string, KnowledgeDependency[]>();
  for (const item of dependenciesResult.rows) {
    const dependencies = dependenciesByBlock.get(item.block_id) ?? [];
    dependencies.push({
      type: item.dependency_type,
      id: item.dependency_id,
      inclusion_reason: item.inclusion_reason,
      authorization_scope: item.authorization_scope,
    });
    dependenciesByBlock.set(item.block_id, dependencies);
  }

  return {
    id: snapshot.id,
    account_id: snapshot.account_id,
    person_id: snapshot.subject_id,
    relationship_context_id: snapshot.assignment_id,
    source_state_cursor: Number(snapshot.source_state_cursor),
    compiler: {
      name: snapshot.compiler_name,
      version: snapshot.compiler_version,
      policy_version: snapshot.policy_version,
    },
    status: snapshot.status,
    blocks: blocksResult.rows.map((item) => ({
      id: item.id,
      block_key: item.block_key,
      type: item.block_type,
      status: item.status,
      content: item.structured_content,
      valid_from: item.valid_from?.toISOString() ?? null,
      valid_until: item.valid_until?.toISOString() ?? null,
      freshness_until: item.freshness_until?.toISOString() ?? null,
      sensitivity: item.sensitivity,
      dependencies: dependenciesByBlock.get(item.id) ?? [],
      semantic_hash: item.semantic_hash,
    })),
    quality: snapshot.quality,
    compiled_at: snapshot.compiled_at.toISOString(),
  };
}

export async function getRelationshipWiki(
  pool: Pool,
  auth: AuthContext,
  personId: string,
  relationshipContextId: string,
): Promise<KnowledgeSnapshot> {
  return loadSnapshot(
    pool,
    auth.accountId,
    personId,
    relationshipContextId,
  );
}

export async function compileRelationshipWiki(
  pool: Pool,
  auth: AuthContext,
  personId: string,
  relationshipContextId: string,
  request: CompileKnowledgeRequest,
  options: { auditActorUserId?: string | null } = {},
): Promise<WikiMutationResult> {
  return inTransaction(pool, async (client) => {
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "compile_relationship_wiki",
      request.idempotency_key,
      {
        person_id: personId,
        relationship_context_id: relationshipContextId,
        ...request,
      },
    );
    if (idempotency.replay) {
      const replay =
        typeof idempotency.replay.body === "object" &&
        idempotency.replay.body !== null &&
        "snapshot_id" in idempotency.replay.body
          ? String(idempotency.replay.body.snapshot_id)
          : null;
      if (!replay) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_STATE_UNAVAILABLE",
          "The prior Wiki compilation could not be resolved.",
        );
      }
      return {
        body: await loadSnapshot(
          client,
          auth.accountId,
          personId,
          relationshipContextId,
          replay,
        ),
        replayed: true,
        status: idempotency.replay.status,
      };
    }

    const scopeResult = await client.query<ScopeRow>(
      `SELECT
         subjects.display_label AS subject_label,
         assignments.display_label AS assignment_label
       FROM subjects
       JOIN assignments
         ON assignments.account_id = subjects.account_id
        AND assignments.subject_id = subjects.id
       WHERE subjects.account_id = $1
         AND subjects.id = $2
         AND assignments.id = $3
         AND subjects.status = 'active'
         AND assignments.status = 'active'
       FOR UPDATE`,
      [auth.accountId, personId, relationshipContextId],
    );
    const scope = scopeResult.rows[0];
    if (!scope) {
      throw new ApiError(
        404,
        "RELATIONSHIP_CONTEXT_NOT_FOUND",
        "The active person and relationship context were not found together.",
      );
    }
    const authorizationScope =
      `person:${personId}:relationship-context:${relationshipContextId}`;

    const statesResult = await client.query<StateRow>(
      `SELECT
         states.id, states.field, states.value_text, states.status,
         states.valid_from, states.valid_until,
         COALESCE(
           direct_fragments.id,
           legacy_fragments.id
         ) AS evidence_fragment_id
       FROM confirmed_states states
       JOIN proposed_assertions assertions
         ON assertions.account_id = states.account_id
        AND assertions.id = states.source_assertion_id
       JOIN captures
         ON captures.account_id = assertions.account_id
        AND captures.id = assertions.capture_id
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       JOIN evidence_items evidence
         ON evidence.account_id = assertions.account_id
        AND evidence.id = assertions.evidence_id
       LEFT JOIN evidence_fragments direct_fragments
         ON direct_fragments.account_id = assertions.account_id
        AND direct_fragments.id = assertions.evidence_fragment_id
        AND direct_fragments.status = 'active'
       LEFT JOIN evidence_fragments legacy_fragments
         ON assertions.evidence_fragment_id IS NULL
        AND legacy_fragments.account_id = evidence.account_id
        AND legacy_fragments.capture_id = evidence.capture_id
        AND legacy_fragments.locator->>'source_message_id'
            = evidence.source_message_id
        AND legacy_fragments.status = 'active'
       WHERE states.account_id = $1
         AND states.subject_id = $2
         AND states.assignment_id = $3
         AND captures.status = 'active'
         AND receipts.authorization_state = 'authorized'
         AND (
           receipts.authorization_expires_at IS NULL
           OR receipts.authorization_expires_at > now()
         )
         AND states.status IN (
           'active', 'contested', 'expired', 'superseded'
         )
         AND states.value_text IS NOT NULL
       ORDER BY states.field, states.valid_from, states.id`,
      [auth.accountId, personId, relationshipContextId],
    );
    const conflictsResult = await client.query<ConflictRow>(
      `SELECT
         assertions.id,
         assertions.field,
         assertions.proposal_status,
         assertions.review_status,
         assertions.proposed_value,
         assertions.evidence_quote,
         assertions.temporal_relation,
         assertions.supersedes_state_id,
         COALESCE(
           direct_fragments.id,
           legacy_fragments.id
         ) AS evidence_fragment_id
       FROM proposed_assertions assertions
       JOIN captures
         ON captures.account_id = assertions.account_id
        AND captures.id = assertions.capture_id
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       JOIN evidence_items evidence
         ON evidence.account_id = assertions.account_id
        AND evidence.id = assertions.evidence_id
       LEFT JOIN evidence_fragments direct_fragments
         ON direct_fragments.account_id = assertions.account_id
        AND direct_fragments.id = assertions.evidence_fragment_id
        AND direct_fragments.status = 'active'
       LEFT JOIN evidence_fragments legacy_fragments
         ON assertions.evidence_fragment_id IS NULL
        AND legacy_fragments.account_id = evidence.account_id
        AND legacy_fragments.capture_id = evidence.capture_id
        AND legacy_fragments.locator->>'source_message_id'
            = evidence.source_message_id
        AND legacy_fragments.status = 'active'
       WHERE assertions.account_id = $1
         AND captures.subject_id = $2
         AND captures.assignment_id = $3
         AND captures.status = 'active'
         AND receipts.authorization_state = 'authorized'
         AND (
           receipts.authorization_expires_at IS NULL
           OR receipts.authorization_expires_at > now()
         )
         AND assertions.review_status IN ('pending', 'unresolved')
       ORDER BY assertions.created_at, assertions.id`,
      [auth.accountId, personId, relationshipContextId],
    );
    const actionResult = await client.query<ActionRow>(
      `SELECT
         actions.id, actions.target_text, actions.reason_text,
         actions.due_text, actions.evidence_ids
       FROM action_proposals actions
       JOIN captures
         ON captures.account_id = actions.account_id
        AND captures.id = actions.capture_id
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE actions.account_id = $1
         AND captures.subject_id = $2
         AND captures.assignment_id = $3
         AND captures.status = 'active'
         AND receipts.authorization_state = 'authorized'
         AND (
           receipts.authorization_expires_at IS NULL
           OR receipts.authorization_expires_at > now()
         )
         AND actions.status NOT IN ('deleted', 'revoked', 'failed')
         AND actions.target_text IS NOT NULL
         AND actions.reason_text IS NOT NULL
         AND actions.due_text IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(actions.required_assertion_ids) required(id)
           LEFT JOIN proposed_assertions assertions
             ON assertions.account_id = actions.account_id
            AND assertions.id = required.id
           WHERE assertions.id IS NULL
              OR assertions.review_status <> 'confirmed'
         )
       ORDER BY actions.created_at DESC, actions.id DESC
       LIMIT 1`,
      [auth.accountId, personId, relationshipContextId],
    );
    const resourceFragmentsResult =
      await client.query<ResourceFragmentRow>(
        `SELECT
           resources.id AS resource_id,
           resources.resource_kind,
           resources.display_name,
           resources.source_locator,
           resources.observed_at,
           resources.duplicate_of_resource_id,
           fragments.id AS fragment_id,
           fragments.text_content,
           fragments.attributed_actor,
           fragments.attribution_status,
           fragments.review_status
         FROM source_resources resources
         JOIN captures
           ON captures.account_id = resources.account_id
          AND captures.id = resources.capture_id
         JOIN source_retention_receipts receipts
           ON receipts.account_id = captures.account_id
          AND receipts.capture_id = captures.id
         JOIN evidence_fragments fragments
           ON fragments.account_id = resources.account_id
          AND fragments.resource_id = resources.id
          AND fragments.status = 'active'
          AND fragments.review_status <> 'rejected'
         WHERE resources.account_id = $1
           AND captures.subject_id = $2
           AND captures.assignment_id = $3
           AND captures.identity_status = 'bound'
           AND captures.status = 'active'
           AND receipts.authorization_state = 'authorized'
           AND (
             receipts.authorization_expires_at IS NULL
             OR receipts.authorization_expires_at > now()
           )
           AND resources.processing_state <> 'deleted'
           AND resources.duplicate_of_resource_id IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM research_snapshots snapshots
             WHERE snapshots.account_id = resources.account_id
               AND snapshots.resource_id = resources.id
               AND snapshots.status <> 'deleted'
           )
         ORDER BY resources.observed_at, resources.created_at,
                  resources.id, fragments.sequence, fragments.id`,
        [auth.accountId, personId, relationshipContextId],
      );
    const researchResult = await client.query<ResearchSnapshotRow>(
      `SELECT
         snapshots.id AS snapshot_id,
         snapshots.task_id,
         snapshots.resource_id,
         snapshots.canonical_url,
         snapshots.retrieved_at,
         snapshots.freshness_until,
         tasks.authorization_scope,
         fragments.id AS fragment_id,
         fragments.text_content,
         fragments.review_status,
         (
           snapshots.status = 'stale'
           OR snapshots.freshness_until <= now()
         ) AS is_stale
       FROM research_snapshots snapshots
       JOIN research_tasks tasks
         ON tasks.account_id = snapshots.account_id
        AND tasks.id = snapshots.task_id
       JOIN source_resources resources
         ON resources.account_id = snapshots.account_id
        AND resources.id = snapshots.resource_id
       JOIN captures
         ON captures.account_id = resources.account_id
        AND captures.id = resources.capture_id
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       JOIN evidence_fragments fragments
         ON fragments.account_id = resources.account_id
        AND fragments.resource_id = resources.id
        AND fragments.status = 'active'
        AND fragments.review_status <> 'rejected'
       WHERE snapshots.account_id = $1
         AND captures.subject_id = $2
         AND captures.assignment_id = $3
         AND captures.identity_status = 'bound'
         AND captures.status = 'active'
         AND receipts.authorization_state = 'authorized'
         AND (
           receipts.authorization_expires_at IS NULL
           OR receipts.authorization_expires_at > now()
         )
         AND resources.processing_state <> 'deleted'
         AND snapshots.status IN ('active', 'stale')
         AND tasks.status IN ('completed', 'partial')
       ORDER BY snapshots.retrieved_at DESC, snapshots.id, fragments.sequence`,
      [auth.accountId, personId, relationshipContextId],
    );
    const sourceResult = await client.query<{ id: string }>(
      `SELECT resources.id
       FROM source_resources resources
       JOIN captures
         ON captures.account_id = resources.account_id
        AND captures.id = resources.capture_id
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE resources.account_id = $1
         AND captures.subject_id = $2
         AND captures.assignment_id = $3
         AND resources.processing_state <> 'deleted'
         AND captures.status = 'active'
         AND receipts.authorization_state = 'authorized'
         AND (
           receipts.authorization_expires_at IS NULL
           OR receipts.authorization_expires_at > now()
         )
       ORDER BY resources.created_at DESC, resources.id DESC
       LIMIT 1`,
      [auth.accountId, personId, relationshipContextId],
    );
    const cursorResult = await client.query<{ cursor: string }>(
      `SELECT COALESCE(MAX(sequence), 0)::text AS cursor
       FROM audit_events
       WHERE account_id = $1`,
      [auth.accountId],
    );

    const missingFactEvidence = statesResult.rows.find(
      (state) => state.evidence_fragment_id === null,
    );
    if (missingFactEvidence) {
      throw new ApiError(
        409,
        "WIKI_EVIDENCE_FRAGMENT_MISSING",
        "A confirmed fact cannot be compiled until its source has a typed evidence fragment.",
        { fact_version_id: missingFactEvidence.id },
      );
    }

    const blocks: KnowledgeBlock[] = [
      block({
        block_key: "identity.context",
        type: "identity_context",
        status: "confirmed",
        content: {
          headline: scope.subject_label,
          summary: `Active relationship context: ${scope.assignment_label}`,
          items: [scope.assignment_label],
        },
        valid_from: null,
        valid_until: null,
        freshness_until: null,
        sensitivity: "restricted",
        dependencies: [
          dependency(
            "identity_binding",
            personId,
            "The authenticated account selected this stable person.",
            authorizationScope,
          ),
          dependency(
            "relationship_context",
            relationshipContextId,
            "The compiled facts and actions are limited to this relationship context.",
            authorizationScope,
          ),
        ],
      }),
    ];

    for (const state of statesResult.rows) {
      blocks.push(
        block({
          block_key: `fact.${state.field}.${state.id}`,
          type: factBlockType(state.field),
          status: blockStatus(state.status),
          content: {
            headline: factHeadline(
              state.field,
              state.value_text,
              state.status,
            ),
            items:
              state.status === "contested"
                ? [
                    "This previously confirmed version is no longer safe to treat as current without review.",
                  ]
                : [],
          },
          valid_from: state.valid_from.toISOString(),
          valid_until: state.valid_until?.toISOString() ?? null,
          freshness_until: state.valid_until?.toISOString() ?? null,
          sensitivity: "restricted",
          dependencies: [
            dependency(
              "fact_version",
              state.id,
              "This block is a deterministic projection of a reviewed temporal fact version.",
              authorizationScope,
            ),
            dependency(
              "evidence_fragment",
              state.evidence_fragment_id as string,
              "The confirmed fact retains its exact reviewed source fragment.",
              authorizationScope,
            ),
          ],
        }),
      );
    }

    for (const conflict of conflictsResult.rows) {
      if (!conflict.evidence_fragment_id) {
        continue;
      }
      const isConflict =
        conflict.proposal_status === "ambiguous" ||
        conflict.temporal_relation === "supersedes";
      const fieldLabel = conflict.field
        .replace(/^professional_history\./, "professional history ")
        .replaceAll("_", " ");
      blocks.push(
        block({
          block_key: `${
            isConflict ? "conflict" : "open-question"
          }.${conflict.field}.${conflict.id}`,
          type: isConflict ? "conflict" : "open_question",
          status: isConflict ? "contested" : "proposed",
          content: {
            headline: `${
              isConflict ? "Resolve conflicting claim" : "Review proposed fact"
            }: ${fieldLabel}`,
            ...(conflict.proposed_value
              ? { summary: conflict.proposed_value }
              : {}),
            items: [
              ...(conflict.evidence_quote
                ? [`Exact source: “${conflict.evidence_quote}”`]
                : []),
              `Review state: ${conflict.review_status}`,
              ...(conflict.temporal_relation === "supersedes"
                ? ["This proposal would replace the active confirmed value."]
                : []),
            ],
          },
          valid_from: null,
          valid_until: null,
          freshness_until: null,
          sensitivity: "restricted",
          dependencies: [
            dependency(
              "evidence_fragment",
              conflict.evidence_fragment_id,
              isConflict
                ? "The conflicting source claim remains visible instead of silently overwriting confirmed state."
                : "The unconfirmed source claim remains visible for human review.",
              authorizationScope,
            ),
            ...(conflict.supersedes_state_id
              ? [
                  dependency(
                    "fact_version",
                    conflict.supersedes_state_id,
                    "This is the active confirmed fact version that the proposal may supersede.",
                    authorizationScope,
                  ),
                ]
              : []),
          ],
        }),
      );
    }

    const resources = new Map<
      string,
      {
        id: string;
        kind: ResourceFragmentRow["resource_kind"];
        displayName: string;
        sourceLocator: string | null;
        observedAt: Date;
        fragments: ResourceFragmentRow[];
      }
    >();
    for (const item of resourceFragmentsResult.rows) {
      const existing = resources.get(item.resource_id);
      if (existing) {
        existing.fragments.push(item);
      } else {
        resources.set(item.resource_id, {
          id: item.resource_id,
          kind: item.resource_kind,
          displayName: item.display_name,
          sourceLocator: item.source_locator,
          observedAt: item.observed_at,
          fragments: [item],
        });
      }
    }
    for (const resource of resources.values()) {
      blocks.push(resourceBlock(resource, authorizationScope));
    }
    for (const research of researchResult.rows) {
      blocks.push(researchBlock(research, authorizationScope));
    }

    const action = actionResult.rows[0];
    if (action) {
      const actionEvidence = await client.query<{ id: string }>(
        `SELECT fragments.id
         FROM evidence_items evidence
         JOIN source_retention_receipts receipts
           ON receipts.account_id = evidence.account_id
          AND receipts.capture_id = evidence.capture_id
         JOIN evidence_fragments fragments
           ON fragments.account_id = evidence.account_id
          AND fragments.capture_id = evidence.capture_id
          AND fragments.locator->>'source_message_id'
              = evidence.source_message_id
          AND fragments.status = 'active'
         WHERE evidence.account_id = $1
           AND evidence.id = ANY($2::uuid[])
           AND receipts.authorization_state = 'authorized'
           AND (
             receipts.authorization_expires_at IS NULL
             OR receipts.authorization_expires_at > now()
           )
         ORDER BY fragments.sequence, fragments.id`,
        [auth.accountId, action.evidence_ids],
      );
      if (actionEvidence.rows.length === 0) {
        throw new ApiError(
          409,
          "WIKI_ACTION_EVIDENCE_MISSING",
          "A proposed next action cannot be compiled without active evidence fragments.",
        );
      }
      const actionDependencies = actionEvidence.rows.map((item) =>
        dependency(
          "evidence_fragment",
          item.id,
          "The user-owned next move cites this reviewed source fragment.",
          authorizationScope,
        ),
      );
      blocks.push(
        block({
          block_key: "attention.current-dependency",
          type: "current_dependency",
          status: "proposed",
          content: {
            headline: action.reason_text,
            items: [],
          },
          valid_from: null,
          valid_until: null,
          freshness_until: null,
          sensitivity: "restricted",
          dependencies: actionDependencies,
        }),
        block({
          block_key: "attention.next-action",
          type: "next_action",
          status: "proposed",
          content: {
            headline: action.target_text,
            summary: action.reason_text,
            items: [action.due_text],
          },
          valid_from: null,
          valid_until: null,
          freshness_until: null,
          sensitivity: "restricted",
          dependencies: actionDependencies,
        }),
      );
    } else {
      const latestSource = sourceResult.rows[0]?.id;
      blocks.push(
        block({
          block_key: "attention.no-action",
          type: "no_action",
          status: "confirmed",
          content: {
            headline:
              conflictsResult.rows.length > 0
                ? "No action until the unresolved evidence is clarified."
                : "No supported next action is ready.",
            items: [
              conflictsResult.rows.length > 0
                ? "Revisit when the unresolved evidence has been reviewed."
                : latestSource
                  ? "Revisit when a reviewed source changes the confirmed relationship state."
                  : "Revisit when reviewed evidence or a confirmed dependency enters this context.",
            ],
          },
          valid_from: null,
          valid_until: null,
          freshness_until: null,
          sensitivity: "restricted",
          dependencies: [
            latestSource
              ? dependency(
                  "source_resource",
                  latestSource,
                  "The latest active source contains no confirmed basis for a next action.",
                  authorizationScope,
                )
              : dependency(
                  "relationship_context",
                  relationshipContextId,
                  "The active relationship context currently has no supported next action.",
                  authorizationScope,
                ),
          ],
        }),
      );
    }

    const quality = deriveCompilationQuality({
      blocks,
      expectedAuthorizationScope: authorizationScope,
      expectedConfirmedStateCount: statesResult.rows.length,
      expectedReviewClaimCount: conflictsResult.rows.filter(
        (claim) => claim.evidence_fragment_id !== null,
      ).length,
      reviewClaimsMissingEvidence: conflictsResult.rows.filter(
        (claim) => claim.evidence_fragment_id === null,
      ).length,
      identityBound: true,
    });
    const compiledAt = new Date();
    const snapshot: KnowledgeSnapshot = {
      id: randomUUID(),
      account_id: auth.accountId,
      person_id: personId,
      relationship_context_id: relationshipContextId,
      source_state_cursor: Number(cursorResult.rows[0]?.cursor ?? "0"),
      compiler: {
        name: COMPILER_NAME,
        version: COMPILER_VERSION,
        policy_version: POLICY_VERSION,
      },
      status: "published",
      blocks,
      quality,
      compiled_at: compiledAt.toISOString(),
    };
    const publication = assessCompilationPublication(snapshot);
    if (!publication.eligible) {
      throw new ApiError(
        409,
        "WIKI_PUBLICATION_REJECTED",
        "The compiled Wiki did not satisfy the publication contract.",
        publication.issues,
      );
    }

    await client.query(
      `UPDATE knowledge_snapshots
       SET status = 'superseded'
       WHERE account_id = $1
         AND subject_id = $2
         AND assignment_id = $3
         AND status = 'published'`,
      [auth.accountId, personId, relationshipContextId],
    );
    await client.query(
      `INSERT INTO knowledge_snapshots(
         id, account_id, subject_id, assignment_id, source_state_cursor,
         compiler_name, compiler_version, policy_version, status, quality,
         compiled_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, $10)`,
      [
        snapshot.id,
        auth.accountId,
        personId,
        relationshipContextId,
        snapshot.source_state_cursor,
        COMPILER_NAME,
        COMPILER_VERSION,
        POLICY_VERSION,
        quality,
        compiledAt,
      ],
    );
    for (const item of blocks) {
      await client.query(
        `INSERT INTO knowledge_blocks(
           id, account_id, snapshot_id, block_key, block_type, status,
           structured_content, valid_from, valid_until, freshness_until,
           sensitivity, semantic_hash
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )`,
        [
          item.id,
          auth.accountId,
          snapshot.id,
          item.block_key,
          item.type,
          item.status,
          item.content,
          item.valid_from,
          item.valid_until,
          item.freshness_until,
          item.sensitivity,
          item.semantic_hash,
        ],
      );
      for (const itemDependency of item.dependencies) {
        await client.query(
          `INSERT INTO knowledge_dependencies(
             id, account_id, block_id, dependency_type, dependency_id,
             inclusion_reason, authorization_scope
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            auth.accountId,
            item.id,
            itemDependency.type,
            itemDependency.id,
            itemDependency.inclusion_reason,
            itemDependency.authorization_scope,
          ],
        );
      }
    }
    await appendAudit(
      client,
      {
        accountId: auth.accountId,
        actorUserId:
          options.auditActorUserId === undefined
            ? auth.userId
            : options.auditActorUserId,
      },
      "knowledge_snapshot.published",
      "knowledge_snapshot",
      snapshot.id,
      {
        person_id: personId,
        relationship_context_id: relationshipContextId,
        objective: request.objective,
        source_state_cursor: snapshot.source_state_cursor,
        block_count: blocks.length,
        compiler_name: COMPILER_NAME,
        compiler_version: COMPILER_VERSION,
        policy_version: POLICY_VERSION,
      },
    );
    await completeIdempotency(client, idempotency, 201, {
      snapshot_id: snapshot.id,
    });
    return {
      body: await loadSnapshot(
        client,
        auth.accountId,
        personId,
        relationshipContextId,
        snapshot.id,
      ),
      replayed: false,
      status: 201,
    };
  });
}
