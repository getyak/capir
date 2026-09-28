import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";

const obj = { additionalProperties: false } as const;
const id = Type.String({ format: "uuid" });
const stamp = Type.String({ format: "date-time" });
const text = (maxLength: number) => Type.String({ maxLength });
const optional = <T extends TSchema>(schema: T) =>
  Type.Optional(Type.Union([schema, Type.Null()]));

/** The three logical Memory scopes. Not a database or image split. */
export const MemoryScopeSchema = Type.Union([
  Type.Literal("self"),
  Type.Literal("person"),
  Type.Literal("relationship"),
]);
export const MemoryStatementKindSchema = Type.Union([
  Type.Literal("fact"),
  Type.Literal("source_statement"),
  Type.Literal("user_opinion"),
]);
export const MemoryOperationSchema = Type.Union([
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("contest"),
]);
export const MemoryAdmissionSchema = Type.Union([
  Type.Literal("eligible"),
  Type.Literal("needs_judgment"),
  Type.Literal("ineligible"),
]);
export const MemoryJudgmentSchema = Type.Union([
  Type.Literal("ordinary"),
  Type.Literal("conflict"),
  Type.Literal("sensitive"),
  Type.Literal("ambiguous_attribution"),
  Type.Literal("stale_target"),
  Type.Literal("self_scope_escape"),
]);
export const MemoryDecisionSchema = Type.Union([
  Type.Literal("accept"),
  Type.Literal("keep_old"),
  Type.Literal("accept_new"),
  Type.Literal("retain_conflict"),
  Type.Literal("skip"),
]);
export const MemoryTimeStatusSchema = Type.Union([
  Type.Literal("known"),
  Type.Literal("unknown"),
  Type.Literal("future"),
  Type.Literal("past"),
]);
export const MemorySurfaceSchema = Type.Union([
  Type.Literal("chat"),
  Type.Literal("people"),
  Type.Literal("relationship"),
]);
export const MemoryContactDecisionSchema = Type.Union([
  Type.Literal("existing"),
  Type.Literal("new"),
  Type.Literal("none"),
]);
export const MemoryContactStatusSchema = Type.Union([
  Type.Literal("resolved"),
  Type.Literal("ambiguous"),
  Type.Literal("pending"),
]);
export const MemorySubjectKindSchema = Type.Union([
  Type.Literal("owner_self"),
  Type.Literal("resolved_subject"),
  Type.Literal("proposal_target"),
]);
export const MemoryRelationshipKindSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("resolved_context"),
  Type.Literal("proposal_target_context"),
]);
export const MemoryProposalStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("partially_committed"),
  Type.Literal("committed"),
  Type.Literal("dismissed"),
  Type.Literal("expired"),
]);
export const MemoryItemStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("superseded"),
  Type.Literal("invalidated"),
  Type.Literal("deleted"),
]);
export const MemoryProposalItemStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("committed"),
  Type.Literal("skipped"),
]);
export const MemoryCommitStatusSchema = Type.Union([
  Type.Literal("applied"),
  Type.Literal("undone"),
]);
export const MemoryProjectionStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("rebuilt"),
  Type.Literal("not_required"),
]);
export const MemorySensitivitySchema = Type.Union([
  Type.Literal("normal"),
  Type.Literal("sensitive"),
]);

/** Host-admitted source locator. Never a model-invented file reference. */
export const MemorySourceLocatorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("message"),
      session_id: optional(id),
      message_id: optional(id),
      character_start: Type.Optional(Type.Integer({ minimum: 0, maximum: 200_000 })),
      character_end: Type.Optional(Type.Integer({ minimum: 0, maximum: 200_000 })),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("image_region"),
      artifact_id: text(200),
      session_id: optional(id),
      image_index: Type.Optional(Type.Integer({ minimum: 0, maximum: 9 })),
      region: optional(
        Type.Object(
          {
            x: Type.Number({ minimum: 0, maximum: 1 }),
            y: Type.Number({ minimum: 0, maximum: 1 }),
            width: Type.Number({ minimum: 0, maximum: 1 }),
            height: Type.Number({ minimum: 0, maximum: 1 }),
          },
          obj,
        ),
      ),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("document"),
      source_resource_id: optional(id),
      locator: Type.Record(Type.String(), Type.Unknown()),
    },
    obj,
  ),
]);

/**
 * A model/user candidate. It cannot assert that it was admitted: the host
 * supplies the admitted source context out of band.
 */
/**
 * Explicit candidate dependence. `independent_self` is a private self
 * statement; `contact`/`relationship` depend on the proposal target even when
 * no stable UUID exists yet.
 */
export const MemoryDependenceKindSchema = Type.Union([
  Type.Literal("independent_self"),
  Type.Literal("contact"),
  Type.Literal("relationship"),
]);

export const MemoryProposalCandidateSchema = Type.Object(
  {
    scope: MemoryScopeSchema,
    operation: MemoryOperationSchema,
    statement_kind: MemoryStatementKindSchema,
    dependence_kind: Type.Optional(MemoryDependenceKindSchema),
    display_text: Type.String({ minLength: 1, maxLength: 1_000 }),
    subject_id: optional(id),
    relationship_context_id: optional(id),
    speaker: optional(text(200)),
    reporter: optional(text(200)),
    valid_time: optional(stamp),
    observed_time: optional(stamp),
    time_status: MemoryTimeStatusSchema,
    sensitivity: MemorySensitivitySchema,
    source_excerpt: Type.String({ minLength: 1, maxLength: 4_000 }),
    source_locator: MemorySourceLocatorSchema,
    previous_memory_item_id: optional(id),
    previous_text: optional(text(1_000)),
    previous_revision: optional(Type.Integer({ minimum: 1 })),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  obj,
);

/**
 * Untrusted staging request. `session_id`/`source_message_id` are references;
 * the server loads the authenticated original message and ordered attachments
 * itself. The request cannot carry an admitted source text or artifact list.
 */
export const MemoryIdentityAuthoritySchema = Type.Union([
  Type.Literal("tentative"),
  Type.Literal("stable_handle"),
  Type.Literal("human_selection"),
]);

export const MemoryProposalStageRequestSchema = Type.Object(
  {
    idempotency_key: id,
    surface: MemorySurfaceSchema,
    session_id: optional(id),
    source_task_id: optional(id),
    source_message_id: optional(id),
    person_id: optional(id),
    relationship_context_id: optional(id),
    contact_decision: MemoryContactDecisionSchema,
    identity_authority: Type.Optional(MemoryIdentityAuthoritySchema),
    identity_clue: optional(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal("email"),
            Type.Literal("phone"),
            Type.Literal("wechat"),
            Type.Literal("linkedin_url"),
            Type.Literal("public_profile_url"),
            Type.Literal("source_native_id"),
          ]),
          value: Type.String({ minLength: 1, maxLength: 500 }),
        },
        obj,
      ),
    ),
    new_contact: optional(
      Type.Object(
        {
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          relationship_context: Type.String({ maxLength: 200 }),
          source_locator: optional(MemorySourceLocatorSchema),
        },
        obj,
      ),
    ),
    proposer: Type.Object(
      {
        kind: Type.Union([Type.Literal("agent"), Type.Literal("human")]),
        name: text(160),
        version: text(80),
      },
      obj,
    ),
    items: Type.Array(MemoryProposalCandidateSchema, {
      minItems: 0,
      maxItems: 40,
    }),
  },
  obj,
);

export const MemoryProposalRecordSchema = Type.Object(
  {
    proposal_id: id,
    revision: Type.Integer({ minimum: 1 }),
    status: MemoryProposalStatusSchema,
    surface: MemorySurfaceSchema,
    contact_decision: MemoryContactDecisionSchema,
    contact_status: MemoryContactStatusSchema,
    identity_authority: MemoryIdentityAuthoritySchema,
    person_id: optional(id),
    relationship_context_id: optional(id),
    relationship_display_label: optional(text(200)),
    person_display_label: optional(text(200)),
    item_count: Type.Integer({ minimum: 0 }),
    default_selected_count: Type.Integer({ minimum: 0 }),
    created_at: stamp,
    expires_at: stamp,
  },
  obj,
);

export const MemoryProposalListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    proposals: Type.Array(MemoryProposalRecordSchema, { maxItems: 50 }),
  },
  obj,
);

export const MemoryProposalItemSchema = Type.Object(
  {
    id,
    scope: MemoryScopeSchema,
    subject_kind: MemorySubjectKindSchema,
    relationship_kind: MemoryRelationshipKindSchema,
    operation: MemoryOperationSchema,
    statement_kind: MemoryStatementKindSchema,
    display_text: Type.String({ minLength: 1, maxLength: 1_000 }),
    original_display_text: Type.String({ minLength: 1, maxLength: 1_000 }),
    previous_text: optional(text(1_000)),
    previous_memory_item_id: optional(id),
    previous_revision: optional(Type.Integer({ minimum: 1 })),
    subject_id: optional(id),
    relationship_context_id: optional(id),
    speaker: optional(text(200)),
    reporter: optional(text(200)),
    valid_time: optional(stamp),
    observed_time: optional(stamp),
    time_status: MemoryTimeStatusSchema,
    sensitivity: MemorySensitivitySchema,
    admission_status: MemoryAdmissionSchema,
    judgment_kind: MemoryJudgmentSchema,
    judgment_reason: optional(text(500)),
    default_selected: Type.Boolean(),
    reason: text(500),
    source_excerpt: text(4_000),
    source_locator: MemorySourceLocatorSchema,
    added_revision: Type.Integer({ minimum: 1 }),
    status: MemoryProposalItemStatusSchema,
  },
  obj,
);

export const MemoryReviewDraftSchema = Type.Object(
  {
    contact_decision: MemoryContactDecisionSchema,
    selected_item_ids: Type.Array(id, { maxItems: 200 }),
    edited_text: Type.Record(id, Type.String({ maxLength: 1_000 })),
    item_decisions: Type.Record(id, MemoryDecisionSchema),
    revision: Type.Integer({ minimum: 0 }),
    updated_at: stamp,
  },
  obj,
);

export const MemoryReviewDraftRequestSchema = Type.Object(
  {
    expected_review_revision: Type.Integer({ minimum: 0 }),
    contact_decision: MemoryContactDecisionSchema,
    selected_item_ids: Type.Array(id, { maxItems: 200 }),
    edited_text: Type.Record(id, Type.String({ maxLength: 1_000 })),
    item_decisions: Type.Record(id, MemoryDecisionSchema),
  },
  obj,
);

/**
 * Restricted surfaces never receive private self text, IDs, or hidden counts.
 * Counts only ever describe the visible item set. `review_credential` is
 * returned exactly once, when the purpose-bound scope is created.
 */
export const MemorySourceStatusSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("unavailable"),
]);

export const MemoryReviewViewSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    review_scope_id: id,
    review_revision: Type.Integer({ minimum: 0 }),
    purpose: MemorySurfaceSchema,
    proposal_id: id,
    proposal_revision: Type.Integer({ minimum: 1 }),
    allowed_scope: Type.Union([
      Type.Literal("all"),
      Type.Literal("person_relationship"),
      Type.Literal("relationship"),
    ]),
    person_id: optional(id),
    relationship_context_id: optional(id),
    person_display_label: optional(text(200)),
    relationship_display_label: optional(text(200)),
    pursuit_id: optional(id),
    pursuit_role_id: optional(id),
    pursuit_role_evidence_fragment_id: optional(id),
    pursuit_capture_id: optional(id),
    pursuit_capture_version: optional(Type.Integer({ minimum: 1 })),
    /* Exact originating source Session/message; the BFF binds a Chat
     * capability to this and never trusts a browser target claim. */
    source_session_id: optional(id),
    source_message_id: optional(id),
    contact_decision: MemoryContactDecisionSchema,
    contact_status: MemoryContactStatusSchema,
    status: MemoryProposalStatusSchema,
    expires_at: stamp,
    visible_item_count: Type.Integer({ minimum: 0 }),
    visible_default_selected_count: Type.Integer({ minimum: 0 }),
    source_status: MemorySourceStatusSchema,
    source_unavailable_visible_item_count: Type.Integer({ minimum: 0 }),
    items: Type.Array(MemoryProposalItemSchema, { maxItems: 200 }),
    draft: Type.Union([MemoryReviewDraftSchema, Type.Null()]),
  },
  obj,
);

export const MemoryOpenReviewRequestSchema = Type.Object(
  {
    purpose: MemorySurfaceSchema,
    person_id: optional(id),
    relationship_context_id: optional(id),
    pursuit_id: optional(id),
    pursuit_role_id: optional(id),
    pursuit_role_evidence_fragment_id: optional(id),
    pursuit_capture_id: optional(id),
    pursuit_capture_version: optional(Type.Integer({ minimum: 1 })),
    session_id: optional(id),
  },
  obj,
);

export const MemoryReviewResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    review_credential: optional(Type.String({ minLength: 16, maxLength: 200 })),
    review: MemoryReviewViewSchema,
  },
  obj,
);

export const MemoryCommitRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_proposal_revision: Type.Integer({ minimum: 1 }),
    contact_decision: MemoryContactDecisionSchema,
    identity_authority: Type.Optional(MemoryIdentityAuthoritySchema),
    person_id: optional(id),
    relationship_context_id: optional(id),
    selected_item_ids: Type.Array(id, { maxItems: 200 }),
    edited_text: Type.Record(id, Type.String({ maxLength: 1_000 })),
    item_decisions: Type.Record(id, MemoryDecisionSchema),
    expected_item_versions: Type.Record(id, Type.Integer({ minimum: 1 })),
    new_contact: optional(
      Type.Object(
        {
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          identity_clue: optional(
            Type.Object(
              {
                type: Type.Union([
                  Type.Literal("email"),
                  Type.Literal("phone"),
                  Type.Literal("wechat"),
                  Type.Literal("linkedin_url"),
                  Type.Literal("public_profile_url"),
                  Type.Literal("source_native_id"),
                ]),
                value: Type.String({ minLength: 1, maxLength: 500 }),
              },
              obj,
            ),
          ),
          relationship_context: Type.String({ maxLength: 200 }),
        },
        obj,
      ),
    ),
    reason: text(500),
  },
  obj,
);

/** One explicit Session card decision; a new contact has its own operation. */
export const MemoryItemDecisionRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_proposal_revision: Type.Integer({ minimum: 1 }),
    expected_review_revision: Type.Integer({ minimum: 0 }),
    item_id: id,
    expected_item_added_revision: Type.Integer({ minimum: 1 }),
    expected_item_version: Type.Optional(Type.Integer({ minimum: 1 })),
    contact_decision: Type.Union([Type.Literal("existing"), Type.Literal("none")]),
    decision: MemoryDecisionSchema,
    edited_text: Type.Optional(Type.String({ maxLength: 1_000 })),
    reason: text(500),
  },
  obj,
);

export const MemoryReceiptSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    commit_id: id,
    operation_key: id,
    proposal_id: id,
    proposal_revision: Type.Integer({ minimum: 1 }),
    status: MemoryCommitStatusSchema,
    contact_decision: MemoryContactDecisionSchema,
    created_person_id: optional(id),
    person_display_label: optional(text(200)),
    created_relationship_context_id: optional(id),
    undo_contact_outcome: optional(Type.Union([Type.Literal("retained"), Type.Literal("reclaimed")])),
    undo_context_outcome: optional(Type.Union([Type.Literal("retained"), Type.Literal("reclaimed")])),
    item_count: Type.Integer({ minimum: 0 }),
    /** Decisions that actually wrote or updated a Memory row; keep_old/skip excluded. */
    applied_item_count: Type.Integer({ minimum: 0 }),
    created_item_ids: Type.Array(id, { maxItems: 200 }),
    updated_item_ids: Type.Array(id, { maxItems: 200 }),
    skipped_item_ids: Type.Array(id, { maxItems: 200 }),
    kept_old_item_ids: Type.Array(id, { maxItems: 200 }),
    decisions: Type.Array(
      Type.Object(
        {
          proposal_item_id: id,
          decision: MemoryDecisionSchema,
          memory_item_id: optional(id),
        },
        obj,
      ),
      { maxItems: 200 },
    ),
    undo: Type.Object(
      {
        token: id,
        allowed: Type.Boolean(),
        limits: Type.Array(text(200), { maxItems: 10 }),
      },
      obj,
    ),
    projection_status: MemoryProjectionStatusSchema,
    created_at: stamp,
    undone_at: optional(stamp),
  },
  obj,
);

export const MemoryOperationReadbackSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    operation_key: id,
    state: Type.Union([
      Type.Literal("applied"),
      Type.Literal("undone"),
      Type.Literal("pending"),
      Type.Literal("unavailable"),
      Type.Literal("source_revoked"),
    ]),
    receipt: Type.Union([MemoryReceiptSchema, Type.Null()]),
  },
  obj,
);

export const MemoryUndoRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_commit_revision: Type.Integer({ minimum: 1 }),
    reason: text(500),
  },
  obj,
);

export const MemoryRecallItemSchema = Type.Object(
  {
    id,
    scope: MemoryScopeSchema,
    statement_kind: MemoryStatementKindSchema,
    display_text: Type.String({ minLength: 1, maxLength: 1_000 }),
    original_display_text: Type.String({ minLength: 1, maxLength: 1_000 }),
    subject_id: optional(id),
    relationship_context_id: optional(id),
    speaker: optional(text(200)),
    reporter: optional(text(200)),
    valid_time: optional(stamp),
    observed_time: optional(stamp),
    time_status: MemoryTimeStatusSchema,
    sensitivity: MemorySensitivitySchema,
    version: Type.Integer({ minimum: 1 }),
    supersedes_id: optional(id),
    conflict_group_id: optional(id),
    evidence_retained: Type.Boolean(),
    evidence_refs: Type.Array(
      Type.Object(
        {
          excerpt: text(4_000),
          locator: MemorySourceLocatorSchema,
          capture_id: optional(id),
          source_resource_id: optional(id),
          source_session_id: optional(id),
          source_message_id: optional(id),
          source_artifact_id: optional(text(200)),
        },
        obj,
      ),
      { maxItems: 10 },
    ),
    created_at: stamp,
  },
  obj,
);

export const MemoryRecallResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    surface: MemorySurfaceSchema,
    person_id: optional(id),
    relationship_context_id: optional(id),
    items: Type.Array(MemoryRecallItemSchema, { maxItems: 100 }),
    has_more: Type.Optional(Type.Boolean()),
    next_cursor: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  },
  obj,
);

export const MemoryItemMutationRequestSchema = Type.Object(
  {
    entry_scope: Type.Optional(Type.Object({
      purpose: MemorySurfaceSchema, person_id: optional(id), relationship_context_id: optional(id),
      pursuit_id: optional(id), pursuit_role_id: optional(id), pursuit_role_evidence_fragment_id: optional(id),
      pursuit_capture_id: optional(id), pursuit_capture_version: optional(Type.Integer({ minimum: 1 })),
    }, obj)),
    operation: Type.Union([Type.Literal("correct"), Type.Literal("delete")]),
    idempotency_key: id,
    expected_version: Type.Integer({ minimum: 1 }),
    display_text: optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    reason: text(500),
  },
  obj,
);

export const MemoryItemMutationResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    operation_key: id,
    item: Type.Union([MemoryRecallItemSchema, Type.Null()]),
    status: MemoryItemStatusSchema,
  },
  obj,
);

export const MemoryCommitResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    replayed: Type.Boolean(),
    receipt: MemoryReceiptSchema,
  },
  obj,
);

export const MemoryItemDecisionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    kind: Type.Union([Type.Literal("committed"), Type.Literal("skipped")]),
    item_id: id,
    replayed: Type.Boolean(),
    receipt: Type.Union([MemoryReceiptSchema, Type.Null()]),
    proposal_revision: Type.Integer({ minimum: 1 }),
    remaining_pending_item_count: Type.Integer({ minimum: 0 }),
  },
  obj,
);

export const MemoryUndoResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    replayed: Type.Boolean(),
    receipt: MemoryReceiptSchema,
  },
  obj,
);

/**
 * Guarded identity rebase. Restoring the same contact keeps the frozen
 * selections; choosing another person regenerates the proposal and never moves
 * the prior person's memory. Ambiguity is resolved or skipped, not guessed.
 */
export const MemoryProposalRebaseRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_proposal_revision: Type.Integer({ minimum: 1 }),
    contact_decision: MemoryContactDecisionSchema,
    identity_authority: Type.Optional(MemoryIdentityAuthoritySchema),
    person_id: optional(id),
    relationship_context_id: optional(id),
    new_contact: optional(
      Type.Object(
        {
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          relationship_context: Type.String({ maxLength: 200 }),
        },
        obj,
      ),
    ),
    reason: text(500),
  },
  obj,
);

export const MemoryProposalRebaseResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    replayed: Type.Boolean(),
    proposal: MemoryProposalRecordSchema,
    review_credential: Type.Union([Type.String({ minLength: 16, maxLength: 200 }), Type.Null()]),
  },
  obj,
);

/**
 * Source/revision-scoped no-save. An empty item_ids list dismisses the whole
 * reviewed scope; a non-empty list dismisses only those visible items.
 */
export const MemoryDismissRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_review_revision: Type.Integer({ minimum: 0 }),
    item_ids: Type.Array(id, { maxItems: 200 }),
    reason: text(500),
  },
  obj,
);

export const MemoryDismissResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    replayed: Type.Boolean(),
    dismissed_item_ids: Type.Array(id, { maxItems: 200 }),
    proposal_status: MemoryProposalStatusSchema,
  },
  obj,
);

/**
 * One authorized person/relationship association reachable from a Pursuit.
 * The resolver verifies the current account and Pursuit first and never
 * returns private self fields.
 */
export const MemoryPursuitScopeSchema = Type.Object(
  {
    person_id: id,
    person_display_label: text(200),
    relationship_context_id: optional(id),
    relationship_display_label: optional(text(200)),
    role_id: optional(id),
    role_evidence_fragment_id: optional(id),
    capture_id: optional(id),
    capture_version: optional(Type.Integer({ minimum: 1 })),
    has_pending_review: Type.Boolean(),
  },
  obj,
);

export const MemoryPursuitScopesResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    pursuit_id: id,
    pursuit_display_label: optional(text(300)),
    scopes: Type.Array(MemoryPursuitScopeSchema, { maxItems: 50 }),
  },
  obj,
);

/**
 * Scope-bound operation view. A restricted projection contains only the
 * effects visible to the current purpose/target; whole-batch undo is allowed
 * only when every original effect is visible and actionable here.
 */
export const MemoryScopedOperationViewSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    operation_key: id,
    commit_id: optional(id),
    dismissed_item_id: optional(id),
    commit_revision: optional(Type.Integer({ minimum: 1 })),
    state: Type.Union([
      Type.Literal("applied"),
      Type.Literal("undone"),
      Type.Literal("pending"),
      Type.Literal("skipped"),
      Type.Literal("unavailable"),
      Type.Literal("source_revoked"),
      Type.Literal("scope_mismatch"),
    ]),
    purpose: MemorySurfaceSchema,
    person_id: optional(id),
    relationship_context_id: optional(id),
    pursuit_id: optional(id),
    pursuit_role_id: optional(id),
    pursuit_role_evidence_fragment_id: optional(id),
    pursuit_capture_id: optional(id),
    pursuit_capture_version: optional(Type.Integer({ minimum: 1 })),
    source_session_id: optional(id),
    visible_effect_count: Type.Integer({ minimum: 0 }),
    visible_receipt: Type.Union([MemoryReceiptSchema, Type.Null()]),
    undo: Type.Object(
      {
        allowed: Type.Boolean(),
        limits: Type.Array(text(200), { maxItems: 10 }),
      },
      obj,
    ),
  },
  obj,
);

export const MemoryOperationUndoRequestSchema = Type.Object(
  {
    idempotency_key: id,
    expected_commit_revision: Type.Integer({ minimum: 1 }),
    purpose: MemorySurfaceSchema,
    person_id: optional(id),
    relationship_context_id: optional(id),
    session_id: optional(id),
    pursuit_id: optional(id),
    pursuit_role_id: optional(id),
    pursuit_role_evidence_fragment_id: optional(id),
    pursuit_capture_id: optional(id),
    pursuit_capture_version: optional(Type.Integer({ minimum: 1 })),
    reason: text(500),
  },
  obj,
);

export const MemoryOperationUndoResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    replayed: Type.Boolean(),
    receipt: MemoryReceiptSchema,
  },
  obj,
);

export type MemoryIdentityAuthority = Static<
  typeof MemoryIdentityAuthoritySchema
>;
export type MemoryDependenceKind = Static<typeof MemoryDependenceKindSchema>;
export type MemoryDismissRequest = Static<typeof MemoryDismissRequestSchema>;
export type MemoryDismissResponse = Static<typeof MemoryDismissResponseSchema>;
export type MemorySourceStatus = Static<typeof MemorySourceStatusSchema>;
export type MemoryPursuitScope = Static<typeof MemoryPursuitScopeSchema>;
export type MemoryPursuitScopesResponse = Static<
  typeof MemoryPursuitScopesResponseSchema
>;
export type MemoryScopedOperationView = Static<
  typeof MemoryScopedOperationViewSchema
>;
export type MemoryOperationUndoRequest = Static<
  typeof MemoryOperationUndoRequestSchema
>;
export type MemoryOperationUndoResponse = Static<
  typeof MemoryOperationUndoResponseSchema
>;
export type MemoryProposalReference = {
  proposal_id: string;
  revision: number;
};

export type MemoryScope = Static<typeof MemoryScopeSchema>;
export type MemoryStatementKind = Static<typeof MemoryStatementKindSchema>;
export type MemoryOperation = Static<typeof MemoryOperationSchema>;
export type MemoryAdmission = Static<typeof MemoryAdmissionSchema>;
export type MemoryJudgment = Static<typeof MemoryJudgmentSchema>;
export type MemoryDecision = Static<typeof MemoryDecisionSchema>;
export type MemoryTimeStatus = Static<typeof MemoryTimeStatusSchema>;
export type MemorySurface = Static<typeof MemorySurfaceSchema>;
export type MemoryContactDecision = Static<typeof MemoryContactDecisionSchema>;
export type MemoryContactStatus = Static<typeof MemoryContactStatusSchema>;
export type MemorySubjectKind = Static<typeof MemorySubjectKindSchema>;
export type MemoryRelationshipKind = Static<typeof MemoryRelationshipKindSchema>;
export type MemorySourceLocator = Static<typeof MemorySourceLocatorSchema>;
export type MemoryProposalCandidate = Static<
  typeof MemoryProposalCandidateSchema
>;
export type MemoryProposalStageRequest = Static<
  typeof MemoryProposalStageRequestSchema
>;
export type MemoryProposalRecord = Static<typeof MemoryProposalRecordSchema>;
export type MemoryProposalListResponse = Static<
  typeof MemoryProposalListResponseSchema
>;
export type MemoryProposalItem = Static<typeof MemoryProposalItemSchema>;
export type MemoryReviewDraft = Static<typeof MemoryReviewDraftSchema>;
export type MemoryReviewDraftRequest = Static<
  typeof MemoryReviewDraftRequestSchema
>;
export type MemoryReviewView = Static<typeof MemoryReviewViewSchema>;
export type MemoryOpenReviewRequest = Static<
  typeof MemoryOpenReviewRequestSchema
>;
export type MemoryReviewResponse = Static<typeof MemoryReviewResponseSchema>;
export type MemoryCommitRequest = Static<typeof MemoryCommitRequestSchema>;
export type MemoryItemDecisionRequest = Static<typeof MemoryItemDecisionRequestSchema>;
export type MemoryItemDecisionResponse = Static<typeof MemoryItemDecisionResponseSchema>;
export type MemoryReceipt = Static<typeof MemoryReceiptSchema>;
export type MemoryOperationReadback = Static<
  typeof MemoryOperationReadbackSchema
>;
export type MemoryUndoRequest = Static<typeof MemoryUndoRequestSchema>;
export type MemoryRecallItem = Static<typeof MemoryRecallItemSchema>;
export type MemoryRecallResponse = Static<typeof MemoryRecallResponseSchema>;
export type MemoryItemMutationRequest = Static<
  typeof MemoryItemMutationRequestSchema
>;
export type MemoryItemMutationResponse = Static<
  typeof MemoryItemMutationResponseSchema
>;
export type MemoryCommitResponse = Static<typeof MemoryCommitResponseSchema>;
export type MemoryUndoResponse = Static<typeof MemoryUndoResponseSchema>;
export type MemoryProposalRebaseRequest = Static<
  typeof MemoryProposalRebaseRequestSchema
>;
export type MemoryProposalRebaseResponse = Static<
  typeof MemoryProposalRebaseResponseSchema
>;
