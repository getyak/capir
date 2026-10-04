import { CalendarDraftSchema } from "./calendarDraftSchemas.js";
import { Type, type Static } from "@sinclair/typebox";

import {
  CHAT_RESPONSE_BLOCK_KINDS,
  CONTRACT_VERSION,
  EVIDENCE_FRAGMENT_KINDS,
  IDENTITY_HANDLE_TYPES,
  INPUT_CHANNELS,
  KNOWLEDGE_BLOCK_TYPES,
  KNOWLEDGE_DEPENDENCY_TYPES,
  SOURCE_RESOURCE_KINDS,
} from "./constants.js";
import { SourceRetentionRequestSchema } from "./schemas.js";
import { TelemetryContextSchema } from "./telemetrySchemas.js";
import { LabFeatureAdoptionReceiptSchema } from "./labFeatureSchemas.js";

const Id = Type.String({ format: "uuid" });
const Timestamp = Type.String({ format: "date-time" });
const IdempotencyKey = Type.String({ minLength: 1, maxLength: 128 });

export const RelationshipContextIntentSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal("existing"),
      relationship_context_id: Id,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("proposed"),
      label: Type.String({ minLength: 1, maxLength: 200 }),
      purpose: Type.String({ minLength: 1, maxLength: 240 }),
      role: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    },
    { additionalProperties: false },
  ),
]);

export const IdentityHandleHintSchema = Type.Object(
  {
    type: Type.Union(
      IDENTITY_HANDLE_TYPES.map((type) => Type.Literal(type)),
    ),
    value: Type.String({ minLength: 1, maxLength: 500 }),
    source_client_resource_id: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    valid_until: Type.Optional(Timestamp),
    validity_override_reason: Type.Optional(
      Type.String({ minLength: 12, maxLength: 500 }),
    ),
  },
  { additionalProperties: false },
);

export const PersonScopeIntentSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal("new_person"),
      display_label: Type.String({ minLength: 1, maxLength: 200 }),
      relationship_context: Type.Object(
        {
          status: Type.Literal("proposed"),
          label: Type.String({ minLength: 1, maxLength: 200 }),
          purpose: Type.String({ minLength: 1, maxLength: 240 }),
          role: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        },
        { additionalProperties: false },
      ),
      binding_basis: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("confirmed"),
      person_id: Id,
      relationship_context: RelationshipContextIntentSchema,
      binding_basis: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("proposed"),
      candidate_person_id: Id,
      relationship_context: Type.Optional(RelationshipContextIntentSchema),
      match_reasons: Type.Array(
        Type.String({ minLength: 1, maxLength: 500 }),
        { minItems: 1, maxItems: 20 },
      ),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("candidates"),
      candidate_person_ids: Type.Array(Id, {
        minItems: 2,
        maxItems: 20,
        uniqueItems: true,
      }),
      display_name_hint: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
      relationship_context: Type.Optional(RelationshipContextIntentSchema),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("unresolved"),
      display_name_hint: Type.Optional(
        Type.String({ minLength: 1, maxLength: 200 }),
      ),
      handles: Type.Array(IdentityHandleHintSchema, {
        maxItems: 20,
      }),
      relationship_context: Type.Optional(RelationshipContextIntentSchema),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
]);

export const SourceResourceInputSchema = Type.Object(
  {
    client_resource_id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union(
      SOURCE_RESOURCE_KINDS.map((kind) => Type.Literal(kind)),
    ),
    display_name: Type.String({ minLength: 1, maxLength: 240 }),
    media_type: Type.String({ minLength: 1, maxLength: 120 }),
    observed_at: Timestamp,
    source_timezone: Type.Union([
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.Null(),
    ]),
    byte_size: Type.Optional(Type.Integer({ minimum: 0 })),
    content_hash: Type.Optional(
      Type.String({ pattern: "^[a-f0-9]{64}$" }),
    ),
    source_locator: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1_000 }),
    ),
    authorization_expires_at: Type.Optional(Timestamp),
    payload_ref: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1_000 }),
    ),
    discovered_from_client_resource_id: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    discovered_from_resource_id: Type.Optional(Id),
    retention: SourceRetentionRequestSchema,
  },
  { additionalProperties: false },
);

export const MultichannelCaptureIntentSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    idempotency_key: IdempotencyKey,
    channel: Type.Union(
      INPUT_CHANNELS.map((channel) => Type.Literal(channel)),
    ),
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
    captured_at: Timestamp,
    source_timezone: Type.Union([
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.Null(),
    ]),
    person_scope: PersonScopeIntentSchema,
    resources: Type.Array(SourceResourceInputSchema, {
      minItems: 1,
      maxItems: 20,
    }),
  },
  {
    $id: "MultichannelCaptureIntent",
    additionalProperties: false,
  },
);

const NormalizedBoundingBoxSchema = Type.Object(
  {
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const SharedEvidenceLocatorSchemas = [
  Type.Object(
    {
      kind: Type.Literal("message"),
      source_message_id: Type.String({ minLength: 1, maxLength: 128 }),
      message_timestamp: Type.Optional(Timestamp),
      sequence: Type.Integer({ minimum: 0 }),
      speaker_side: Type.Union([
        Type.Literal("left"),
        Type.Literal("right"),
        Type.Literal("unknown"),
      ]),
      source_image_index: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 9 }),
      ),
      speaker_label: Type.Optional(
        Type.String({ minLength: 1, maxLength: 600 }),
      ),
      visible_time_text: Type.Optional(
        Type.String({ minLength: 1, maxLength: 600 }),
      ),
      bounding_box: Type.Optional(NormalizedBoundingBoxSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("page_text"),
      page: Type.Integer({ minimum: 1 }),
      paragraph: Type.Optional(Type.Integer({ minimum: 1 })),
      bounding_box: Type.Optional(NormalizedBoundingBoxSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document_text"),
      paragraph: Type.Integer({ minimum: 1 }),
      section_label: Type.Optional(
        Type.String({ minLength: 1, maxLength: 120 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document_region"),
      page: Type.Integer({ minimum: 1 }),
      region_label: Type.String({ minLength: 1, maxLength: 120 }),
      bounding_box: NormalizedBoundingBoxSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("url_excerpt"),
      canonical_url: Type.String({ format: "uri", maxLength: 2_000 }),
      retrieved_at: Timestamp,
      selector: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      start_character: Type.Optional(Type.Integer({ minimum: 0 })),
      end_character: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("contact_field"),
      field: Type.String({ minLength: 1, maxLength: 120 }),
      source_record_version: Type.String({ minLength: 1, maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
] as const;

export const EvidenceLocatorInputSchema = Type.Union([
  ...SharedEvidenceLocatorSchemas,
  Type.Object(
    {
      kind: Type.Literal("note_revision"),
      revision: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export const EvidenceLocatorSchema = Type.Union([
  ...SharedEvidenceLocatorSchemas,
  Type.Object(
    {
      kind: Type.Literal("note_revision"),
      revision: Type.Integer({ minimum: 1 }),
      author_user_id: Id,
    },
    { additionalProperties: false },
  ),
]);

const EvidenceAttributionSchema = Type.Object(
  {
    actor_kind: Type.Union([
      Type.Literal("candidate"),
      Type.Literal("recruiter"),
      Type.Literal("client"),
      Type.Literal("document_author"),
      Type.Literal("public_source"),
      Type.Literal("unknown"),
    ]),
    status: Type.Union([
      Type.Literal("confirmed"),
      Type.Literal("proposed"),
      Type.Literal("unknown"),
    ]),
  },
  { additionalProperties: false },
);

const EvidenceParserSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    version: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);

export const EvidenceFragmentInputSchema = Type.Object(
  {
    client_resource_id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union(
      EVIDENCE_FRAGMENT_KINDS.map((kind) => Type.Literal(kind)),
    ),
    sequence: Type.Integer({ minimum: 0 }),
    text: Type.String({ minLength: 1, maxLength: 40_000 }),
    locator: EvidenceLocatorInputSchema,
    attribution: EvidenceAttributionSchema,
    review_status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("reviewed"),
    ]),
    parser: EvidenceParserSchema,
  },
  { additionalProperties: false },
);

export const EvidenceFragmentSchema = Type.Object(
  {
    last_review_id: Type.Optional(Type.Union([Id, Type.Null()])),
    id: Id,
    account_id: Id,
    capture_id: Id,
    resource_id: Id,
    kind: Type.Union(
      EVIDENCE_FRAGMENT_KINDS.map((kind) => Type.Literal(kind)),
    ),
    sequence: Type.Integer({ minimum: 0 }),
    text: Type.Union([
      Type.String({ minLength: 1, maxLength: 40_000 }),
      Type.Null(),
    ]),
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    locator: EvidenceLocatorSchema,
    attribution: EvidenceAttributionSchema,
    review_status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("reviewed"),
      Type.Literal("rejected"),
    ]),
    parser: EvidenceParserSchema,
    created_at: Timestamp,
  },
  { $id: "EvidenceFragment", additionalProperties: false },
);

export const ReviewedPublicProfileInputSchema = Type.Object(
  {
    result_id: Type.String({ minLength: 1, maxLength: 128 }),
    provider_id: Type.String({ minLength: 1, maxLength: 120 }),
    platform: Type.String({ minLength: 1, maxLength: 80 }),
    profile_url: Type.String({ format: "uri", maxLength: 2_000 }),
    display_name: Type.String({ minLength: 1, maxLength: 200 }),
    handle: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    avatar_url: Type.Optional(Type.String({ format: "uri", maxLength: 2_000 })),
    avatar_rights_basis: Type.Optional(
      Type.Union([
        Type.Literal("provider_display_license"),
        Type.Literal("profile_owner_consent"),
      ]),
    ),
    verified: Type.Optional(Type.Boolean()),
    match_basis: Type.String({ minLength: 1, maxLength: 1_000 }),
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    retrieved_at: Timestamp,
    card_headline: Type.Optional(
      Type.String({ minLength: 1, maxLength: 240 }),
    ),
    use_avatar: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ResourceCaptureRequestSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    idempotency_key: IdempotencyKey,
    channel: Type.Union(
      INPUT_CHANNELS.map((channel) => Type.Literal(channel)),
    ),
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
    captured_at: Timestamp,
    source_timezone: Type.Union([
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.Null(),
    ]),
    person_scope: PersonScopeIntentSchema,
    resource: SourceResourceInputSchema,
    confirmed_identity_handles: Type.Optional(
      Type.Array(IdentityHandleHintSchema, {
        minItems: 1,
        maxItems: 5,
      }),
    ),
    reviewed_public_profile: Type.Optional(ReviewedPublicProfileInputSchema),
    fragments: Type.Array(EvidenceFragmentInputSchema, {
      minItems: 1,
      maxItems: 500,
    }),
  },
  { $id: "ResourceCaptureRequest", additionalProperties: false },
);

export const ResourceCaptureResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    capture_id: Id,
    identity: Type.Object(
      {
        status: Type.Union([
          Type.Literal("bound"),
          Type.Literal("needs_review"),
          Type.Literal("unresolved"),
        ]),
        person_id: Type.Union([Id, Type.Null()]),
        relationship_context_id: Type.Union([Id, Type.Null()]),
        resolution_case_id: Type.Union([Id, Type.Null()]),
        candidate_person_ids: Type.Array(Id, {
          maxItems: 20,
          uniqueItems: true,
        }),
        person_display_label: Type.Optional(
          Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
        ),
        relationship_display_label: Type.Optional(
          Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
        ),
      },
      { additionalProperties: false },
    ),
    resource: Type.Object(
      {
        id: Id,
        client_resource_id: Type.String({ minLength: 1, maxLength: 128 }),
        kind: Type.Union(
          SOURCE_RESOURCE_KINDS.map((kind) => Type.Literal(kind)),
        ),
        processing_state: Type.Union([
          Type.Literal("needs_identity_review"),
          Type.Literal("needs_fact_review"),
          Type.Literal("ready"),
        ]),
        duplicate_of_resource_id: Type.Union([Id, Type.Null()]),
        fragment_count: Type.Integer({ minimum: 1, maximum: 500 }),
      },
      { additionalProperties: false },
    ),
    created_at: Timestamp,
  },
  { $id: "ResourceCaptureResponse", additionalProperties: false },
);

export const IdentityResolutionCandidateSchema = Type.Object(
  {
    person_id: Id,
    display_label: Type.String({ minLength: 1, maxLength: 200 }),
    context_count: Type.Integer({ minimum: 0 }),
    capture_count: Type.Integer({ minimum: 0 }),
    relationship_contexts: Type.Array(
      Type.Object(
        {
          id: Id,
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 20 },
    ),
    match_reasons: Type.Array(
      Type.String({ minLength: 1, maxLength: 500 }),
      { maxItems: 20 },
    ),
  },
  { additionalProperties: false },
);

export const IdentityResolutionCaseSchema = Type.Object(
  {
    id: Id,
    capture_id: Id,
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("resolved"),
      Type.Literal("dismissed"),
      Type.Literal("superseded"),
    ]),
    version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    display_name_hint: Type.Union([
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Null(),
    ]),
    relationship_context: Type.Union([
      RelationshipContextIntentSchema,
      Type.Null(),
    ]),
    source: Type.Object(
      {
        resource_id: Id,
        kind: Type.Union(
          SOURCE_RESOURCE_KINDS.map((kind) => Type.Literal(kind)),
        ),
        display_name: Type.String({ minLength: 1, maxLength: 240 }),
        observed_at: Timestamp,
        excerpt: Type.String({ minLength: 1, maxLength: 4_000 }),
        fragment_count: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    candidates: Type.Array(IdentityResolutionCandidateSchema, {
      maxItems: 20,
    }),
    latest_decision: Type.Union([
      Type.Object(
        {
          decision: Type.Union([
            Type.Literal("bind_existing"),
            Type.Literal("create_new"),
            Type.Literal("leave_unresolved"),
          ]),
          reason: Type.String({ minLength: 1, maxLength: 500 }),
          decided_at: Timestamp,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    resolved_person_id: Type.Union([Id, Type.Null()]),
    resolved_relationship_context_id: Type.Union([Id, Type.Null()]),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { $id: "IdentityResolutionCase", additionalProperties: false },
);

const IdentityDecisionCommon = {
  idempotency_key: IdempotencyKey,
  expected_case_version: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
};

export const IdentityResolutionDecisionRequestSchema = Type.Union(
  [
    Type.Object(
      {
        ...IdentityDecisionCommon,
        decision: Type.Literal("bind_existing"),
        selected_person_id: Id,
        relationship_context: RelationshipContextIntentSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...IdentityDecisionCommon,
        decision: Type.Literal("create_new"),
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        relationship_context: Type.Object(
          {
            status: Type.Literal("proposed"),
            label: Type.String({ minLength: 1, maxLength: 200 }),
            purpose: Type.String({ minLength: 1, maxLength: 240 }),
            role: Type.Optional(
              Type.String({ minLength: 1, maxLength: 120 }),
            ),
          },
          { additionalProperties: false },
        ),
        binding_basis: Type.String({ minLength: 1, maxLength: 500 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...IdentityDecisionCommon,
        decision: Type.Literal("leave_unresolved"),
      },
      { additionalProperties: false },
    ),
  ],
  {
    $id: "IdentityResolutionDecisionRequest",
  },
);

export const IdentityResolutionDecisionResponseSchema = Type.Object(
  {
    case_id: Id,
    capture_id: Id,
    case_status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("resolved"),
    ]),
    case_version: Type.Integer({ minimum: 1 }),
    decision: Type.Union([
      Type.Literal("bind_existing"),
      Type.Literal("create_new"),
      Type.Literal("leave_unresolved"),
    ]),
    identity_status: Type.Union([
      Type.Literal("bound"),
      Type.Literal("unresolved"),
    ]),
    person_id: Type.Union([Id, Type.Null()]),
    relationship_context_id: Type.Union([Id, Type.Null()]),
    resource_processing_state: Type.Union([
      Type.Literal("needs_identity_review"),
      Type.Literal("needs_fact_review"),
      Type.Literal("ready"),
    ]),
    identity_handles_confirmed: Type.Integer({ minimum: 0 }),
    decided_at: Timestamp,
  },
  {
    $id: "IdentityResolutionDecisionResponse",
    additionalProperties: false,
  },
);

const IdentityCorrectionCommon = {
  idempotency_key: IdempotencyKey,
  expected_capture_version: Type.Integer({ minimum: 1 }),
  expected_person_id: Id,
  expected_relationship_context_id: Id,
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  binding_basis: Type.String({ minLength: 1, maxLength: 500 }),
};

export const CaptureIdentityCorrectionRequestSchema = Type.Union(
  [
    Type.Object(
      {
        ...IdentityCorrectionCommon,
        target: Type.Object(
          {
            status: Type.Literal("existing_person"),
            person_id: Id,
            relationship_context: RelationshipContextIntentSchema,
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...IdentityCorrectionCommon,
        target: Type.Object(
          {
            status: Type.Literal("new_person"),
            display_label: Type.String({ minLength: 1, maxLength: 200 }),
            relationship_context: Type.Object(
              {
                status: Type.Literal("proposed"),
                label: Type.String({ minLength: 1, maxLength: 200 }),
                purpose: Type.String({ minLength: 1, maxLength: 240 }),
                role: Type.Optional(
                  Type.String({ minLength: 1, maxLength: 120 }),
                ),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  ],
  {
    $id: "CaptureIdentityCorrectionRequest",
  },
);

export const CaptureIdentityCorrectionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    decision_id: Id,
    root_capture_id: Id,
    capture_ids_rebound: Type.Array(Id, {
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
    }),
    prior_person_id: Id,
    prior_relationship_context_id: Id,
    person_id: Id,
    relationship_context_id: Id,
    root_capture_version: Type.Integer({ minimum: 2 }),
    states_retracted: Type.Integer({ minimum: 0 }),
    prior_states_reopened_for_review: Type.Integer({ minimum: 0 }),
    claims_reopened: Type.Integer({ minimum: 0 }),
    actions_revoked: Type.Integer({ minimum: 0 }),
    completed_actions_requiring_follow_up: Type.Integer({ minimum: 0 }),
    identity_handles_returned_to_review: Type.Integer({ minimum: 0 }),
    knowledge_snapshots_invalidated: Type.Array(Id, {
      maxItems: 1_000,
      uniqueItems: true,
    }),
    decided_at: Timestamp,
  },
  {
    $id: "CaptureIdentityCorrectionResponse",
    additionalProperties: false,
  },
);

export const PersonMergeReviewItemSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("display_label_difference"),
      Type.Literal("contextual_fact_difference"),
      Type.Literal("identity_handle_difference"),
      Type.Literal("unresolved_identity_case"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    detail: Type.String({ minLength: 1, maxLength: 1_000 }),
    evidence_ids: Type.Array(Id, {
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const PersonMergeBlockerSchema = Type.Object(
  {
    code: Type.Union([
      Type.Literal("unresolved_external_effect"),
      Type.Literal("pending_identity_case"),
    ]),
    message: Type.String({ minLength: 1, maxLength: 500 }),
    count: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const PersonMergePreviewSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    preview_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    source_person: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        version: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    target_person: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        version: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    contexts_to_move: Type.Array(
      Type.Object(
        {
          id: Id,
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          active_capture_count: Type.Integer({ minimum: 0 }),
          active_fact_count: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    active_capture_count: Type.Integer({ minimum: 0 }),
    active_identity_handle_count: Type.Integer({ minimum: 0 }),
    review_items: Type.Array(PersonMergeReviewItemSchema, {
      maxItems: 100,
    }),
    blockers: Type.Array(PersonMergeBlockerSchema, { maxItems: 20 }),
    reversible: Type.Literal(true),
  },
  { $id: "PersonMergePreview", additionalProperties: false },
);

export const PersonMergeRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    source_person_id: Id,
    target_person_id: Id,
    expected_source_version: Type.Integer({ minimum: 1 }),
    expected_target_version: Type.Integer({ minimum: 1 }),
    expected_preview_digest: Type.String({
      pattern: "^[a-f0-9]{64}$",
    }),
    decision: Type.Literal("merge_people"),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "PersonMergeRequest", additionalProperties: false },
);

export const PersonMergeResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    operation_id: Id,
    status: Type.Union([
      Type.Literal("applied"),
      Type.Literal("reversed"),
    ]),
    source_person_id: Id,
    target_person_id: Id,
    source_person_version: Type.Integer({ minimum: 2 }),
    target_person_version: Type.Integer({ minimum: 2 }),
    affected_relationship_context_ids: Type.Array(Id, {
      maxItems: 500,
      uniqueItems: true,
    }),
    relationship_context_ids_requiring_recompilation: Type.Array(Id, {
      maxItems: 500,
      uniqueItems: true,
    }),
    captures_rebound: Type.Integer({ minimum: 0 }),
    states_rebound: Type.Integer({ minimum: 0 }),
    identity_handles_rebound: Type.Integer({ minimum: 0 }),
    research_tasks_rebound: Type.Integer({ minimum: 0 }),
    knowledge_snapshots_invalidated: Type.Array(Id, {
      maxItems: 1_000,
      uniqueItems: true,
    }),
    reversal_available: Type.Boolean(),
    decided_at: Timestamp,
    reversed_at: Type.Union([Timestamp, Type.Null()]),
  },
  { $id: "PersonMergeResponse", additionalProperties: false },
);

export const PersonMergeReversalRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    decision: Type.Literal("reverse_person_merge"),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  {
    $id: "PersonMergeReversalRequest",
    additionalProperties: false,
  },
);

export const PersonMergeReversalPreviewSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    operation_id: Id,
    status: Type.Union([
      Type.Literal("applied"),
      Type.Literal("reversed"),
    ]),
    source_person: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        status: Type.Union([
          Type.Literal("active"),
          Type.Literal("merged"),
          Type.Literal("deleted"),
        ]),
      },
      { additionalProperties: false },
    ),
    target_person: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        status: Type.Union([
          Type.Literal("active"),
          Type.Literal("merged"),
          Type.Literal("deleted"),
        ]),
      },
      { additionalProperties: false },
    ),
    contexts_to_restore: Type.Array(
      Type.Object(
        {
          id: Id,
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          active_capture_count: Type.Integer({ minimum: 0 }),
          active_fact_count: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    original_reason: Type.String({ minLength: 1, maxLength: 500 }),
    decided_at: Timestamp,
    reversed_at: Type.Union([Timestamp, Type.Null()]),
    blockers: Type.Array(
      Type.Object(
        {
          code: Type.Union([
            Type.Literal("operation_already_reversed"),
            Type.Literal("identity_state_changed"),
            Type.Literal("new_relationship_dependencies"),
          ]),
          message: Type.String({ minLength: 1, maxLength: 500 }),
          count: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10 },
    ),
    reversal_available: Type.Boolean(),
  },
  {
    $id: "PersonMergeReversalPreview",
    additionalProperties: false,
  },
);

export const SourceAuthorizationDecisionRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    expected_capture_version: Type.Integer({ minimum: 1 }),
    decision: Type.Union([
      Type.Literal("revoke"),
      Type.Literal("restore"),
    ]),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    authorization_expires_at: Type.Optional(Timestamp),
  },
  {
    $id: "SourceAuthorizationDecisionRequest",
    additionalProperties: false,
  },
);

export const SourceAuthorizationDecisionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    decision_id: Id,
    root_capture_id: Id,
    affected_capture_ids: Type.Array(Id, {
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
    }),
    decision: Type.Union([
      Type.Literal("revoke"),
      Type.Literal("restore"),
      Type.Literal("expire"),
    ]),
    prior_authorization_state: Type.Union([
      Type.Literal("authorized"),
      Type.Literal("revoked"),
      Type.Literal("expired"),
    ]),
    authorization_state: Type.Union([
      Type.Literal("authorized"),
      Type.Literal("revoked"),
      Type.Literal("expired"),
    ]),
    authorization_expires_at: Type.Union([Timestamp, Type.Null()]),
    person_id: Id,
    relationship_context_id: Id,
    root_capture_version: Type.Integer({ minimum: 2 }),
    states_retracted: Type.Integer({ minimum: 0 }),
    prior_states_reopened_for_review: Type.Integer({ minimum: 0 }),
    claims_reopened: Type.Integer({ minimum: 0 }),
    actions_revoked: Type.Integer({ minimum: 0 }),
    completed_actions_requiring_follow_up: Type.Integer({ minimum: 0 }),
    external_effects_requiring_follow_up: Type.Integer({ minimum: 0 }),
    identity_handles_returned_to_review: Type.Integer({ minimum: 0 }),
    knowledge_snapshots_invalidated: Type.Array(Id, {
      maxItems: 1_000,
      uniqueItems: true,
    }),
    compilation: Type.Union([
      Type.Object(
        {
          snapshot_id: Id,
          status: Type.Union([
            Type.Literal("published"),
            Type.Literal("abstained"),
            Type.Literal("draft"),
            Type.Literal("superseded"),
            Type.Literal("deleted"),
          ]),
          verdict: Type.Union([
            Type.Literal("gold"),
            Type.Literal("review_required"),
            Type.Literal("abstain"),
          ]),
          block_count: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    compilation_error: Type.Union([
      Type.String({ minLength: 1, maxLength: 500 }),
      Type.Null(),
    ]),
    decided_at: Timestamp,
  },
  {
    $id: "SourceAuthorizationDecisionResponse",
    additionalProperties: false,
  },
);

export const RelationshipResourceListItemSchema = Type.Object(
  {
    id: Id,
    capture_id: Id,
    capture_version: Type.Integer({ minimum: 1 }),
    kind: Type.Union(
      SOURCE_RESOURCE_KINDS.map((kind) => Type.Literal(kind)),
    ),
    input_channel: Type.Union(
      INPUT_CHANNELS.map((channel) => Type.Literal(channel)),
    ),
    display_name: Type.String({ minLength: 1, maxLength: 240 }),
    media_type: Type.String({ minLength: 1, maxLength: 120 }),
    source_locator: Type.Union([
      Type.String({ minLength: 1, maxLength: 1_000 }),
      Type.Null(),
    ]),
    observed_at: Timestamp,
    processing_state: Type.Union([
      Type.Literal("received"),
      Type.Literal("parsing"),
      Type.Literal("needs_identity_review"),
      Type.Literal("needs_fact_review"),
      Type.Literal("ready"),
      Type.Literal("failed"),
    ]),
    duplicate_of_resource_id: Type.Union([Id, Type.Null()]),
    discovered_from_resource_id: Type.Union([Id, Type.Null()]),
    fragment_count: Type.Integer({ minimum: 0 }),
    proposed_fragment_count: Type.Integer({ minimum: 0 }),
    pending_claim_count: Type.Integer({ minimum: 0 }),
    conflicted_claim_count: Type.Integer({ minimum: 0 }),
    source_access_state: Type.Union([
      Type.Literal("available"),
      Type.Literal("purged"),
      Type.Literal("deleted"),
    ]),
    source_authorization_state: Type.Union([
      Type.Literal("authorized"),
      Type.Literal("revoked"),
      Type.Literal("expired"),
    ]),
    source_authorization_expires_at: Type.Union([
      Timestamp,
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const RelationshipResourceListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    person_id: Id,
    relationship_context_id: Id,
    resources: Type.Array(RelationshipResourceListItemSchema, {
      maxItems: 200,
    }),
  },
  {
    $id: "RelationshipResourceListResponse",
    additionalProperties: false,
  },
);

export const ResourceClaimProposalSchema = Type.Object(
  {
    id: Id,
    review_token: Type.Optional(
      Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" }),
    ),
    review_blockers: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        maxItems: 10,
        uniqueItems: true,
      }),
    ),
    field: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-z][a-z0-9_.-]*$",
    }),
    proposal_status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("ambiguous"),
      Type.Literal("superseded"),
    ]),
    review_status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("confirmed"),
      Type.Literal("dismissed"),
      Type.Literal("unresolved"),
    ]),
    proposed_value: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_000 }),
      Type.Null(),
    ]),
    evidence_fragment_id: Id,
    evidence_quote: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_000 }),
      Type.Null(),
    ]),
    subject_kind: Type.Union([
      Type.Literal("candidate"),
      Type.Literal("hiring_manager"),
      Type.Literal("unknown"),
    ]),
    temporal_relation: Type.Union([
      Type.Literal("new"),
      Type.Literal("reinforces"),
      Type.Literal("supersedes"),
    ]),
    supersedes_state_id: Type.Union([Id, Type.Null()]),
    prior_confirmed_value: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_000 }),
      Type.Null(),
    ]),
    reviewed_value: Type.Optional(Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()])),
    last_decision_id: Type.Optional(Type.Union([Id, Type.Null()])),
    version: Type.Integer({ minimum: 1 }),
    producer: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        version: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
    created_at: Timestamp,
  },
  {
    $id: "ResourceClaimProposal",
    additionalProperties: false,
  },
);

export const RelationshipResourceDetailSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    resource: RelationshipResourceListItemSchema,
    fragments: Type.Array(EvidenceFragmentSchema, {
      maxItems: 500,
    }),
    claim_proposals: Type.Array(ResourceClaimProposalSchema, {
      maxItems: 200,
    }),
  },
  { $id: "RelationshipResourceDetail", additionalProperties: false },
);

export const EvidenceFragmentReviewRequestSchema = Type.Object(
  {
    confirmed_speaker: Type.Optional(Type.Union([Type.Literal("candidate"), Type.Literal("recruiter"), Type.Literal("client")])),
    idempotency_key: IdempotencyKey,
    expected_review_status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("reviewed"),
      Type.Literal("rejected"),
    ]),
    expected_last_review_id: Type.Union([Id, Type.Null()]),
    decision: Type.Union([
      Type.Literal("reviewed"),
      Type.Literal("rejected"),
    ]),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  {
    $id: "EvidenceFragmentReviewRequest",
    additionalProperties: false,
  },
);

export const EvidenceFragmentReviewResponseSchema = Type.Object(
  {
    fragment_id: Id,
    resource_id: Id,
    review_id: Id,
    prior_review_id: Type.Union([Id, Type.Null()]),
    review_status: Type.Union([
      Type.Literal("reviewed"),
      Type.Literal("rejected"),
    ]),
    resource_processing_state: Type.Union([
      Type.Literal("needs_fact_review"),
      Type.Literal("ready"),
      Type.Literal("failed"),
    ]),
    decided_at: Timestamp,
  },
  {
    $id: "EvidenceFragmentReviewResponse",
    additionalProperties: false,
  },
);

export const PublicResearchRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    person_id: Id,
    relationship_context_id: Id,
    seed_resource_id: Id,
    purpose: Type.String({ minLength: 1, maxLength: 500 }),
    expected_seed_url: Type.String({ format: "uri", maxLength: 2_000 }),
    authorization: Type.Object(
      {
        decision: Type.Literal("approve_public_research"),
        allowed_domain: Type.String({ minLength: 1, maxLength: 253 }),
        maximum_page_count: Type.Integer({ minimum: 1, maximum: 5 }),
        maximum_link_depth: Type.Integer({ minimum: 0, maximum: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "PublicResearchRequest", additionalProperties: false },
);

export const PublicResearchPageSchema = Type.Object(
  {
    canonical_url: Type.String({ format: "uri", maxLength: 2_000 }),
    resource_id: Id,
    capture_id: Id,
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    retrieved_at: Timestamp,
  },
  { additionalProperties: false },
);

export const PublicResearchResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    task_id: Id,
    seed_resource_id: Id,
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("partial"),
      Type.Literal("failed"),
    ]),
    authorization_scope: Type.String({
      minLength: 1,
      maxLength: 1_000,
    }),
    pages: Type.Array(PublicResearchPageSchema, { maxItems: 5 }),
    warnings: Type.Array(
      Type.String({ minLength: 1, maxLength: 500 }),
      { maxItems: 20 },
    ),
    created_at: Timestamp,
    completed_at: Type.Union([Timestamp, Type.Null()]),
  },
  { $id: "PublicResearchResponse", additionalProperties: false },
);

export const KnowledgeDependencySchema = Type.Object(
  {
    type: Type.Union(
      KNOWLEDGE_DEPENDENCY_TYPES.map((type) => Type.Literal(type)),
    ),
    id: Id,
    inclusion_reason: Type.String({ minLength: 1, maxLength: 500 }),
    authorization_scope: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

export const KnowledgeBlockSchema = Type.Object(
  {
    id: Id,
    block_key: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-z0-9][a-z0-9._:-]*$",
    }),
    type: Type.Union(
      KNOWLEDGE_BLOCK_TYPES.map((type) => Type.Literal(type)),
    ),
    status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("confirmed"),
      Type.Literal("contested"),
      Type.Literal("expired"),
      Type.Literal("superseded"),
      Type.Literal("deleted"),
    ]),
    content: Type.Object(
      {
        headline: Type.String({ minLength: 1, maxLength: 500 }),
        summary: Type.Optional(
          Type.String({ minLength: 1, maxLength: 4_000 }),
        ),
        items: Type.Array(
          Type.String({ minLength: 1, maxLength: 1_000 }),
          { maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
    valid_from: Type.Union([Timestamp, Type.Null()]),
    valid_until: Type.Union([Timestamp, Type.Null()]),
    freshness_until: Type.Union([Timestamp, Type.Null()]),
    sensitivity: Type.Union([
      Type.Literal("normal"),
      Type.Literal("restricted"),
      Type.Literal("highly_restricted"),
    ]),
    dependencies: Type.Array(KnowledgeDependencySchema, {
      minItems: 1,
      maxItems: 100,
    }),
    semantic_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

const CompilationGateSchema = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
]);

export const CompilationQualitySchema = Type.Object(
  {
    verdict: Type.Union([
      Type.Literal("gold"),
      Type.Literal("review_required"),
      Type.Literal("abstain"),
    ]),
    gates: Type.Object(
      {
        identity_binding: CompilationGateSchema,
        provenance: CompilationGateSchema,
        scope_authorization: CompilationGateSchema,
        temporal_integrity: CompilationGateSchema,
        prohibited_inference: CompilationGateSchema,
        deletion_lineage: CompilationGateSchema,
      },
      { additionalProperties: false },
    ),
    measures: Type.Object(
      {
        task_relevance: Type.Integer({ minimum: 0, maximum: 100 }),
        compression: Type.Integer({ minimum: 0, maximum: 100 }),
        conflict_visibility: Type.Integer({ minimum: 0, maximum: 100 }),
        recruiter_reviewability: Type.Integer({ minimum: 0, maximum: 100 }),
      },
      { additionalProperties: false },
    ),
    reasons: Type.Array(
      Type.String({ minLength: 1, maxLength: 500 }),
      { maxItems: 20 },
    ),
  },
  { additionalProperties: false },
);

export const KnowledgeSnapshotSchema = Type.Object(
  {
    id: Id,
    account_id: Id,
    person_id: Id,
    relationship_context_id: Type.Union([Id, Type.Null()]),
    source_state_cursor: Type.Integer({ minimum: 0 }),
    compiler: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        version: Type.String({ minLength: 1, maxLength: 120 }),
        policy_version: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
    status: Type.Union([
      Type.Literal("draft"),
      Type.Literal("published"),
      Type.Literal("abstained"),
      Type.Literal("superseded"),
      Type.Literal("deleted"),
    ]),
    blocks: Type.Array(KnowledgeBlockSchema, { maxItems: 200 }),
    quality: CompilationQualitySchema,
    compiled_at: Timestamp,
  },
  { $id: "KnowledgeSnapshot", additionalProperties: false },
);

export const CompileKnowledgeRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    objective: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { $id: "CompileKnowledgeRequest", additionalProperties: false },
);

export const ContextManifestSchema = Type.Object(
  {
    id: Id,
    task_id: Id,
    objective: Type.String({ minLength: 1, maxLength: 1_000 }),
    person_id: Id,
    relationship_context_id: Type.Union([Id, Type.Null()]),
    knowledge_snapshot_id: Id,
    included_block_ids: Type.Array(Id, {
      maxItems: 200,
      uniqueItems: true,
    }),
    evidence_fragment_ids: Type.Array(Id, {
      maxItems: 500,
      uniqueItems: true,
    }),
    inclusion_reasons: Type.Array(
      Type.String({ minLength: 1, maxLength: 500 }),
      { maxItems: 200 },
    ),
    authorization_scope: Type.String({ minLength: 1, maxLength: 1_000 }),
    policy_version: Type.String({ minLength: 1, maxLength: 120 }),
    created_at: Timestamp,
  },
  { $id: "ContextManifest", additionalProperties: false },
);

export const ChatResponseBlockSchema = Type.Object(
  {
    calendar_draft: Type.Optional(CalendarDraftSchema),
    id: Id,
    kind: Type.Union(
      CHAT_RESPONSE_BLOCK_KINDS.map((kind) => Type.Literal(kind)),
    ),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    body: Type.String({ minLength: 1, maxLength: 8_000 }),
    status: Type.Union([
      Type.Literal("informational"),
      Type.Literal("proposed"),
      Type.Literal("needs_review"),
      Type.Literal("confirmed"),
      Type.Literal("failed"),
    ]),
    citation_dependency_ids: Type.Array(Id, {
      maxItems: 100,
      uniqueItems: true,
    }),
    requires_user_decision: Type.Boolean(),
    public_source_refs: Type.Optional(
      Type.Array(
        Type.Object(
          {
            result_id: Type.String({ pattern: "^[a-f0-9]{64}$" }),
            provider_id: Type.Literal("tikhub"),
            platform: Type.Union([
              Type.Literal("douyin"),
              Type.Literal("tiktok"),
              Type.Literal("weibo"),
              Type.Literal("threads"),
            ]),
            profile_url: Type.String({ minLength: 1, maxLength: 2_000 }),
            display_name: Type.String({ minLength: 1, maxLength: 500 }),
            handle: Type.Union([
              Type.String({ minLength: 1, maxLength: 500 }),
              Type.Null(),
            ]),
            biography: Type.Union([
              Type.String({ minLength: 1, maxLength: 2_000 }),
              Type.Null(),
            ]),
            avatar_url: Type.Union([
              Type.String({ minLength: 1, maxLength: 2_000 }),
              Type.Null(),
            ]),
            avatar_display_policy: Type.Optional(
              Type.Union([
                Type.Literal("source_link_only"),
                Type.Literal("display_and_store"),
              ]),
            ),
            avatar_rights_basis: Type.Optional(
              Type.Union([
                Type.Literal("provider_display_license"),
                Type.Literal("profile_owner_consent"),
              ]),
            ),
            verified: Type.Union([Type.Boolean(), Type.Null()]),
            match_basis: Type.String({ minLength: 1, maxLength: 1_000 }),
            content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
            retrieved_at: Timestamp,
          },
          { additionalProperties: false },
        ),
        { maxItems: 10, uniqueItems: true },
      ),
    ),
    /**
     * Stage reference to a durable user-owned MCP human request. The card
     * reloads the canonical request; this reference carries no authority and
     * is never a snapshot of its data.
     */
    mcp_interaction: Type.Optional(
      Type.Object(
        {
          request_id: Id,
          call_id: Id,
          kind: Type.Union(
            ["approval", "choice", "form", "secret", "oauth"].map((kind) =>
              Type.Literal(kind),
            ),
          ),
          state: Type.String({ minLength: 1, maxLength: 24 }),
        },
        { additionalProperties: false },
      ),
    ),
    target_ref: Type.Optional(
      Type.Object(
        {
          type: Type.Literal("pursuit_action"),
          pursuit_id: Id,
          action_id: Id,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ChatMediaAssetSchema = Type.Object(
  {
    id: Id,
    file_name: Type.String({ minLength: 1, maxLength: 240 }),
    media_type: Type.Union([
      Type.Literal("image/jpeg"),
      Type.Literal("image/png"),
      Type.Literal("image/webp"),
      Type.Literal("image/gif"),
      Type.Literal("image/heic"),
      Type.Literal("image/heif"),
    ]),
    byte_size: Type.Integer({ minimum: 1, maximum: 8_388_608 }),
    width: Type.Union([Type.Integer({ minimum: 1, maximum: 20_000 }), Type.Null()]),
    height: Type.Union([Type.Integer({ minimum: 1, maximum: 20_000 }), Type.Null()]),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("ready"),
      Type.Literal("failed"),
      Type.Literal("deleted"),
    ]),
    created_at: Timestamp,
  },
  { $id: "ChatMediaAsset", additionalProperties: false },
);

export const CreateChatMediaRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    person_id: Id,
    relationship_context_id: Id,
    file_name: Type.String({ minLength: 1, maxLength: 240 }),
    media_type: ChatMediaAssetSchema.properties.media_type,
    byte_size: Type.Integer({ minimum: 1, maximum: 8_388_608 }),
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 20_000 })),
    height: Type.Optional(Type.Integer({ minimum: 1, maximum: 20_000 })),
  },
  { $id: "CreateChatMediaRequest", additionalProperties: false },
);

export const ChatMediaDeleteResponseSchema = Type.Object(
  {
    id: Id,
    status: Type.Literal("deleted"),
  },
  { $id: "ChatMediaDeleteResponse", additionalProperties: false },
);

export const RunArtifactSchema = Type.Object({
  id: Id, name: Type.String({minLength:1,maxLength:84}),
  media_type: Type.Union([Type.Literal("application/json"),Type.Literal("text/plain"),Type.Literal("text/csv")]),
  byte_size: Type.Integer({minimum:0,maximum:64000}),
  content_hash: Type.String({pattern:"^[a-f0-9]{64}$"}), expires_at: Timestamp,
},{additionalProperties:false});

/** Optional review reference. Never the sole agent event; old clients ignore it. */
export const MemoryProposalReferenceSchema = Type.Object(
  {
    proposal_id: Id,
    revision: Type.Integer({ minimum: 1 }),
  },
  { $id: "MemoryProposalReference", additionalProperties: false },
);

export const ChatTaskResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    task_id: Id,
    context_manifest_id: Id,
    knowledge_snapshot_id: Id,
    disposition: Type.Union([
      Type.Literal("answer"),
      Type.Literal("clarify"),
      Type.Literal("propose_action"),
      Type.Literal("no_action"),
      Type.Literal("block"),
    ]),
    blocks: Type.Array(ChatResponseBlockSchema, {
      minItems: 1,
      maxItems: 20,
    }),
    artifacts: Type.Optional(Type.Array(RunArtifactSchema,{maxItems:3})),
    media: Type.Optional(Type.Array(ChatMediaAssetSchema, { maxItems: 10 })),
    memory_proposal: Type.Optional(MemoryProposalReferenceSchema),
    telemetry: Type.Optional(TelemetryContextSchema),
    session_title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    created_at: Timestamp,
  },
  { $id: "ChatTaskResponse", additionalProperties: false },
);

export const ChatCitationSchema = Type.Object(
  {
    id: Id,
    dependency_type: Type.Literal("evidence_fragment"),
    person_id: Type.Union([Id, Type.Null()]),
    relationship_context_id: Type.Union([Id, Type.Null()]),
    inclusion_reason: Type.String({ minLength: 1, maxLength: 500 }),
    authorization_scope: Type.String({ minLength: 1, maxLength: 500 }),
    availability: Type.Union([
      Type.Literal("available"),
      Type.Literal("superseded"),
      Type.Literal("unauthorized"),
      Type.Literal("deleted"),
    ]),
    unavailable_reason: Type.Union([
      Type.String({ minLength: 1, maxLength: 500 }),
      Type.Null(),
    ]),
    resource_id: Id,
    source_name: Type.String({ minLength: 1, maxLength: 240 }),
    observed_at: Timestamp,
    source_timezone: Type.Union([
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.Null(),
    ]),
    capture_version: Type.Integer({ minimum: 1 }),
    fragment_kind: Type.Union(
      EVIDENCE_FRAGMENT_KINDS.map((kind) => Type.Literal(kind)),
    ),
    sequence: Type.Integer({ minimum: 0 }),
    exact_excerpt: Type.Union([
      Type.String({ minLength: 1, maxLength: 40_000 }),
      Type.Null(),
    ]),
    locator: Type.Union([EvidenceLocatorSchema, Type.Null()]),
    attribution: EvidenceAttributionSchema,
    review_status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("reviewed"),
      Type.Literal("rejected"),
    ]),
    parser: EvidenceParserSchema,
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    fragment_created_at: Timestamp,
    last_review_id: Type.Union([Id, Type.Null()]),
    last_reviewed_at: Type.Union([Timestamp, Type.Null()]),
    last_reviewed_by: Type.Union([
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const ChatTaskReadbackSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    account_id: Id,
    task_id: Id,
    context_manifest_id: Id,
    knowledge_snapshot_id: Id,
    person_id: Id,
    relationship_context_id: Id,
    manifest_status: Type.Union([
      Type.Literal("active"),
      Type.Literal("superseded"),
      Type.Literal("expired"),
      Type.Literal("deleted"),
    ]),
    snapshot_status: Type.Union([
      Type.Literal("draft"),
      Type.Literal("published"),
      Type.Literal("abstained"),
      Type.Literal("superseded"),
      Type.Literal("deleted"),
    ]),
    authorization_scope: Type.String({ minLength: 1, maxLength: 1_000 }),
    citations: Type.Array(ChatCitationSchema, {
      maxItems: 500,
      uniqueItems: true,
    }),
    lab_feature_receipt: Type.Optional(LabFeatureAdoptionReceiptSchema),
    media: Type.Optional(Type.Array(ChatMediaAssetSchema, { maxItems: 10 })),
    created_at: Timestamp,
  },
  { $id: "ChatTaskReadback", additionalProperties: false },
);

export const ChatTaskRequestSchema = Type.Object(
  {
    time_zone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    idempotency_key: IdempotencyKey,
    previous_task_id: Type.Optional(Id),
    session_id: Type.Optional(Id),
    message_id: Type.Optional(Id),
    objective: Type.String({ minLength: 1, maxLength: 1_000 }),
    person_id: Id,
    relationship_context_id: Id,
    media_ids: Type.Optional(
      Type.Array(Id, { maxItems: 10, uniqueItems: true }),
    ),
    telemetry: Type.Optional(TelemetryContextSchema),
  },
  { $id: "ChatTaskRequest", additionalProperties: false },
);

export const UnscopedChatTaskRequestSchema = Type.Object(
  {
    time_zone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    idempotency_key: IdempotencyKey,
    session_id: Type.Optional(Id),
    message_id: Type.Optional(Id),
    objective: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { $id: "UnscopedChatTaskRequest", additionalProperties: false },
);

export const WorkspaceConversationAgentEventSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("resolved_contact_context"),
      person_id: Id,
      person_display_label: Type.String({ minLength: 1, maxLength: 200 }),
      relationship_context_id: Id,
      relationship_context_display_label: Type.String({
        minLength: 1,
        maxLength: 200,
      }),
      tool_summary: Type.String({ minLength: 1, maxLength: 240 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("contact_candidates"),
      candidates: Type.Array(
        Type.Object(
          {
            person_id: Id,
            person_display_label: Type.String({ minLength: 1, maxLength: 200 }),
            relationship_context_id: Id,
            relationship_context_display_label: Type.String({
              minLength: 1,
              maxLength: 200,
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 6 },
      ),
      possible_duplicate: Type.Boolean(),
      tool_summary: Type.String({ minLength: 1, maxLength: 240 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("contact_change_proposal"),
      proposal_kind: Type.Union([
        Type.Literal("create"),
        Type.Literal("update"),
      ]),
      candidate_fingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
      display_name: Type.String({ minLength: 1, maxLength: 200 }),
      relationship_context: Type.String({ maxLength: 200 }),
      identity_clue: Type.Union([
        Type.Object(
          {
            type: Type.Union([
              Type.Literal("email"),
              Type.Literal("phone"),
              Type.Literal("linkedin_url"),
              Type.Literal("public_profile_url"),
            ]),
            value: Type.String({ minLength: 1, maxLength: 500 }),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      source_excerpts: Type.Array(
        Type.String({ minLength: 1, maxLength: 1_000 }),
        { minItems: 1, maxItems: 5 },
      ),
      source_message_id: Type.Optional(Id),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
      target_person_id: Type.Union([Id, Type.Null()]),
      target_relationship_context_id: Type.Union([Id, Type.Null()]),
      base_revision: Type.Union([
        Type.Integer({ minimum: 1 }),
        Type.Null(),
      ]),
      requires_user_confirmation: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
]);

export const UnscopedChatTaskResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    task_id: Id,
    disposition: Type.Union([
      Type.Literal("answer"),
      Type.Literal("clarify"),
    ]),
    blocks: Type.Array(ChatResponseBlockSchema, {
      minItems: 1,
      maxItems: 1,
    }),
    agent_event: Type.Optional(
      Type.Union([WorkspaceConversationAgentEventSchema, Type.Null()]),
    ),
    memory_proposal: Type.Optional(MemoryProposalReferenceSchema),
    external_effects: Type.Tuple([]),
    session_title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    created_at: Timestamp,
  },
  { $id: "UnscopedChatTaskResponse", additionalProperties: false },
);

const PersonResearchImageMediaTypeSchema = Type.Union([
  Type.Literal("image/jpeg"),
  Type.Literal("image/png"),
  Type.Literal("image/webp"),
]);

export const PersonResearchTaskRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    objective: Type.String({ minLength: 1, maxLength: 1_000 }),
    image: Type.Object(
      {
        media_type: PersonResearchImageMediaTypeSchema,
        byte_size: Type.Integer({ minimum: 1, maximum: 8_388_608 }),
        content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        data_base64: Type.String({
          minLength: 4,
          maxLength: 11_184_812,
          pattern:
            "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
        }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "PersonResearchTaskRequest", additionalProperties: false },
);

export const PersonResearchTaskResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    task_id: Id,
    disposition: Type.Union([
      Type.Literal("answer"),
      Type.Literal("no_action"),
      Type.Literal("unavailable"),
    ]),
    blocks: Type.Array(ChatResponseBlockSchema, {
      minItems: 1,
      maxItems: 1,
    }),
    source_image: Type.Object(
      {
        media_type: PersonResearchImageMediaTypeSchema,
        byte_size: Type.Integer({ minimum: 1, maximum: 8_388_608 }),
        content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        persisted: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    external_effects: Type.Tuple([]),
    created_at: Timestamp,
  },
  { $id: "PersonResearchTaskResponse", additionalProperties: false },
);

export const PersonDirectoryContextSchema = Type.Object(
  {
    id: Id,
    display_label: Type.String({ minLength: 1, maxLength: 200 }),
    last_activity_at: Timestamp,
  },
  { additionalProperties: false },
);

export const PersonDirectoryIdentityMatchSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("name"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("confirmed_handle"),
      handle_type: Type.Union(
        IDENTITY_HANDLE_TYPES.map((type) => Type.Literal(type)),
      ),
      display_hint: Type.String({ minLength: 1, maxLength: 200 }),
      source_resource_id: Type.Union([Id, Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("expired_handle"),
      handle_type: Type.Union(
        IDENTITY_HANDLE_TYPES.map((type) => Type.Literal(type)),
      ),
      display_hint: Type.String({ minLength: 1, maxLength: 200 }),
      source_resource_id: Type.Union([Id, Type.Null()]),
      expired_at: Timestamp,
    },
    { additionalProperties: false },
  ),
]);

export const PersonDirectoryProfileSchema = Type.Object(
  {
    headline: Type.String({ minLength: 1, maxLength: 240 }),
    summary: Type.String({ minLength: 1, maxLength: 4_000 }),
    provenance_kind: Type.Union([
      Type.Literal("user_authored"),
      Type.Literal("reviewed_public_source"),
    ]),
    authored_by_user_id: Id,
    source_profile_url: Type.Optional(
      Type.String({ format: "uri", maxLength: 2_000 }),
    ),
    source_platform: Type.Optional(
      Type.String({ minLength: 1, maxLength: 80 }),
    ),
    revision: Type.Integer({ minimum: 1 }),
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);

export const PersonDirectoryAvatarSchema = Type.Object(
  {
    url: Type.String({ format: "uri", maxLength: 2_000 }),
    source_profile_url: Type.String({ format: "uri", maxLength: 2_000 }),
    source_platform: Type.String({ minLength: 1, maxLength: 80 }),
    retrieved_at: Timestamp,
    confirmed_at: Timestamp,
  },
  { additionalProperties: false },
);

export const PersonDirectoryItemSchema = Type.Object(
  {
    id: Id,
    display_label: Type.String({ minLength: 1, maxLength: 200 }),
    context_count: Type.Integer({ minimum: 0 }),
    capture_count: Type.Integer({ minimum: 0 }),
    confirmed_identity_count: Type.Integer({ minimum: 0 }),
    last_activity_at: Timestamp,
    profile: Type.Union([PersonDirectoryProfileSchema, Type.Null()]),
    avatar: Type.Union([PersonDirectoryAvatarSchema, Type.Null()]),
    contexts: Type.Array(PersonDirectoryContextSchema, {
      maxItems: 20,
    }),
    identity_matches: Type.Array(PersonDirectoryIdentityMatchSchema, {
      maxItems: 5,
    }),
  },
  { additionalProperties: false },
);

export const PersonDirectoryResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    people: Type.Array(PersonDirectoryItemSchema, {
      maxItems: 20,
    }),
  },
  { $id: "PersonDirectoryResponse", additionalProperties: false },
);

export const RelationshipContactPointSchema = Type.Object(
  {
    id: Id,
    type: Type.Union(
      IDENTITY_HANDLE_TYPES.map((type) => Type.Literal(type)),
    ),
    display_hint: Type.String({ minLength: 1, maxLength: 200 }),
    source_resource_id: Type.Union([Id, Type.Null()]),
    source_display_name: Type.Union([
      Type.String({ minLength: 1, maxLength: 240 }),
      Type.Null(),
    ]),
    valid_from: Timestamp,
    valid_until: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);

export const RelationshipScopeSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    person: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
        profile: Type.Optional(
          Type.Union([PersonDirectoryProfileSchema, Type.Null()]),
        ),
        contact_points: Type.Optional(
          Type.Array(RelationshipContactPointSchema, { maxItems: 20 }),
        ),
      },
      { additionalProperties: false },
    ),
    relationship_context: Type.Object(
      {
        id: Id,
        display_label: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "RelationshipScope", additionalProperties: false },
);

export const RelationshipAgentOperationSchema = Type.Object(
  {
    id: Id,
    sequence: Type.Integer({ minimum: 1 }),
    kind: Type.Union([
      Type.Literal("source_captured"),
      Type.Literal("identity_review"),
      Type.Literal("identity_correction"),
      Type.Literal("identity_merge"),
      Type.Literal("source_authorization"),
      Type.Literal("wiki_compilation"),
      Type.Literal("chat_brief"),
      Type.Literal("source_deletion"),
    ]),
    status: Type.Union([
      Type.Literal("staged"),
      Type.Literal("completed"),
      Type.Literal("superseded"),
      Type.Literal("retracted"),
      Type.Literal("abstained"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    detail: Type.String({ minLength: 1, maxLength: 500 }),
    occurred_at: Timestamp,
    actor_kind: Type.Union([
      Type.Literal("recruiter"),
      Type.Literal("system"),
    ]),
    person_id: Id,
    relationship_context_id: Id,
    references: Type.Object(
      {
        capture_id: Type.Union([Id, Type.Null()]),
        source_resource_id: Type.Union([Id, Type.Null()]),
        identity_case_id: Type.Union([Id, Type.Null()]),
        knowledge_snapshot_id: Type.Union([Id, Type.Null()]),
        person_merge_operation_id: Type.Union([Id, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    provenance: Type.Object(
      {
        event_type: Type.String({ minLength: 1, maxLength: 120 }),
        entity_type: Type.String({ minLength: 1, maxLength: 120 }),
        entity_id: Id,
      },
      { additionalProperties: false },
    ),
  },
  { $id: "RelationshipAgentOperation", additionalProperties: false },
);

export const RelationshipExternalEffectFollowUpSchema = Type.Object(
  {
    action_id: Id,
    capture_id: Id,
    action_status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("executing"),
      Type.Literal("unknown"),
    ]),
    action_type: Type.String({ minLength: 1, maxLength: 120 }),
    target: Type.Union([
      Type.String({ minLength: 1, maxLength: 1_000 }),
      Type.Null(),
    ]),
    reason: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_000 }),
      Type.Null(),
    ]),
    destination_key: Type.Union([
      Type.String({ minLength: 1, maxLength: 1_000 }),
      Type.Null(),
    ]),
    authorization: Type.Object(
      {
        state: Type.Union([
          Type.Literal("revoked"),
          Type.Literal("expired"),
        ]),
        decision_id: Type.Union([Id, Type.Null()]),
        changed_at: Timestamp,
      },
      { additionalProperties: false },
    ),
    attempt: Type.Union([
      Type.Object(
        {
          id: Id,
          status: Type.Union([
            Type.Literal("running"),
            Type.Literal("verified"),
            Type.Literal("failed"),
            Type.Literal("unknown"),
          ]),
          started_at: Timestamp,
          finished_at: Type.Union([Timestamp, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    observation: Type.Union([
      Type.Object(
        {
          id: Id,
          match_status: Type.Union([
            Type.Literal("matched"),
            Type.Literal("mismatched"),
            Type.Literal("unavailable"),
          ]),
          observed_at: Timestamp,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    outcome: Type.Union([
      Type.Object(
        {
          id: Id,
          status: Type.Union([
            Type.Literal("verified"),
            Type.Literal("failed"),
            Type.Literal("unknown"),
          ]),
          summary: Type.String({ minLength: 1, maxLength: 2_000 }),
          created_at: Timestamp,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    requires_recruiter_decision: Type.Literal(true),
  },
  {
    $id: "RelationshipExternalEffectFollowUp",
    additionalProperties: false,
  },
);

export const RelationshipAgentHistorySchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    person_id: Id,
    relationship_context_id: Id,
    operations: Type.Array(RelationshipAgentOperationSchema, {
      maxItems: 50,
    }),
    external_effect_follow_ups: Type.Array(
      RelationshipExternalEffectFollowUpSchema,
      { maxItems: 50 },
    ),
    next_cursor: Type.Integer({ minimum: 0 }),
  },
  { $id: "RelationshipAgentHistory", additionalProperties: false },
);

export type RelationshipContextIntent = Static<
  typeof RelationshipContextIntentSchema
>;
export type IdentityHandleHint = Static<typeof IdentityHandleHintSchema>;
export type PersonScopeIntent = Static<typeof PersonScopeIntentSchema>;
export type SourceResourceInput = Static<typeof SourceResourceInputSchema>;
export type MultichannelCaptureIntent = Static<
  typeof MultichannelCaptureIntentSchema
>;
export type EvidenceLocatorInput = Static<
  typeof EvidenceLocatorInputSchema
>;
export type EvidenceLocator = Static<typeof EvidenceLocatorSchema>;
export type EvidenceFragmentInput = Static<
  typeof EvidenceFragmentInputSchema
>;
export type EvidenceFragment = Static<typeof EvidenceFragmentSchema>;
export type ResourceCaptureRequest = Static<
  typeof ResourceCaptureRequestSchema
>;
export type ResourceCaptureResponse = Static<
  typeof ResourceCaptureResponseSchema
>;
export type IdentityResolutionCandidate = Static<
  typeof IdentityResolutionCandidateSchema
>;
export type IdentityResolutionCase = Static<
  typeof IdentityResolutionCaseSchema
>;
export type IdentityResolutionDecisionRequest = Static<
  typeof IdentityResolutionDecisionRequestSchema
>;
export type IdentityResolutionDecisionResponse = Static<
  typeof IdentityResolutionDecisionResponseSchema
>;
export type CaptureIdentityCorrectionRequest = Static<
  typeof CaptureIdentityCorrectionRequestSchema
>;
export type CaptureIdentityCorrectionResponse = Static<
  typeof CaptureIdentityCorrectionResponseSchema
>;
export type PersonMergeReviewItem = Static<
  typeof PersonMergeReviewItemSchema
>;
export type PersonMergeBlocker = Static<typeof PersonMergeBlockerSchema>;
export type PersonMergePreview = Static<typeof PersonMergePreviewSchema>;
export type PersonMergeRequest = Static<typeof PersonMergeRequestSchema>;
export type PersonMergeResponse = Static<typeof PersonMergeResponseSchema>;
export type PersonMergeReversalRequest = Static<
  typeof PersonMergeReversalRequestSchema
>;
export type PersonMergeReversalPreview = Static<
  typeof PersonMergeReversalPreviewSchema
>;
export type SourceAuthorizationDecisionRequest = Static<
  typeof SourceAuthorizationDecisionRequestSchema
>;
export type SourceAuthorizationDecisionResponse = Static<
  typeof SourceAuthorizationDecisionResponseSchema
>;
export type RelationshipResourceListItem = Static<
  typeof RelationshipResourceListItemSchema
>;
export type RelationshipResourceListResponse = Static<
  typeof RelationshipResourceListResponseSchema
>;
export type RelationshipResourceDetail = Static<
  typeof RelationshipResourceDetailSchema
>;
export type ResourceClaimProposal = Static<
  typeof ResourceClaimProposalSchema
>;
export type EvidenceFragmentReviewRequest = Static<
  typeof EvidenceFragmentReviewRequestSchema
>;
export type EvidenceFragmentReviewResponse = Static<
  typeof EvidenceFragmentReviewResponseSchema
>;
export type PublicResearchRequest = Static<
  typeof PublicResearchRequestSchema
>;
export type PublicResearchPage = Static<typeof PublicResearchPageSchema>;
export type PublicResearchResponse = Static<
  typeof PublicResearchResponseSchema
>;
export type KnowledgeDependency = Static<typeof KnowledgeDependencySchema>;
export type KnowledgeBlock = Static<typeof KnowledgeBlockSchema>;
export type CompilationQuality = Static<typeof CompilationQualitySchema>;
export type KnowledgeSnapshot = Static<typeof KnowledgeSnapshotSchema>;
export type CompileKnowledgeRequest = Static<
  typeof CompileKnowledgeRequestSchema
>;
export type ContextManifest = Static<typeof ContextManifestSchema>;
export type ChatResponseBlock = Static<typeof ChatResponseBlockSchema>;
export type ChatTaskResponse = Static<typeof ChatTaskResponseSchema>;
export type ChatCitation = Static<typeof ChatCitationSchema>;
export type ChatTaskReadback = Static<typeof ChatTaskReadbackSchema>;
export type ChatTaskRequest = Static<typeof ChatTaskRequestSchema>;
export type UnscopedChatTaskRequest = Static<
  typeof UnscopedChatTaskRequestSchema
>;
export type WorkspaceConversationAgentEvent = Static<
  typeof WorkspaceConversationAgentEventSchema
>;
export type UnscopedChatTaskResponse = Static<
  typeof UnscopedChatTaskResponseSchema
>;
export type PersonResearchTaskRequest = Static<
  typeof PersonResearchTaskRequestSchema
>;
export type PersonResearchTaskResponse = Static<
  typeof PersonResearchTaskResponseSchema
>;
export type ChatMediaAsset = Static<typeof ChatMediaAssetSchema>;
export type CreateChatMediaRequest = Static<typeof CreateChatMediaRequestSchema>;
export type ChatMediaDeleteResponse = Static<typeof ChatMediaDeleteResponseSchema>;
export type PersonDirectoryContext = Static<
  typeof PersonDirectoryContextSchema
>;
export type PersonDirectoryIdentityMatch = Static<
  typeof PersonDirectoryIdentityMatchSchema
>;
export type PersonDirectoryItem = Static<typeof PersonDirectoryItemSchema>;
export type PersonDirectoryResponse = Static<
  typeof PersonDirectoryResponseSchema
>;
export type RelationshipScope = Static<typeof RelationshipScopeSchema>;
export type RelationshipAgentOperation = Static<
  typeof RelationshipAgentOperationSchema
>;
export type RelationshipExternalEffectFollowUp = Static<
  typeof RelationshipExternalEffectFollowUpSchema
>;
export type RelationshipAgentHistory = Static<
  typeof RelationshipAgentHistorySchema
>;
