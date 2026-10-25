import { Type, type Static } from "@sinclair/typebox";

import {
  ASSERTION_FIELDS,
  CONTRACT_VERSION,
  DISPOSITIONS,
  INPUT_CHANNELS,
  SIMULATED_ADAPTER,
  SIMULATED_CAPABILITY,
  SIMULATED_REVERSAL_CAPABILITY,
  SOURCE_RESOURCE_KINDS,
  SOURCE_RETENTION_MODES,
  SOURCE_RETENTION_RECEIPT_MODES,
  SOURCE_RETENTION_RECEIPT_SCOPES,
  SOURCE_RETENTION_POLICY_VERSION,
  SOURCE_SCOPES,
} from "./constants.js";

const Id = Type.String({ format: "uuid" });
const Timestamp = Type.String({ format: "date-time" });
const IdempotencyKey = Type.String({ minLength: 1, maxLength: 128 });
const NullableString = Type.Union([
  Type.String({ minLength: 1, maxLength: 500 }),
  Type.Null(),
]);

export const ErrorResponseSchema = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      request_id: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  },
  { $id: "ErrorResponse", additionalProperties: false },
);

export const SimulatedLoginRequestSchema = Type.Object(
  {
    account_slug: Type.String({ minLength: 1, maxLength: 80 }),
    user_email: Type.String({ format: "email", maxLength: 320 }),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { $id: "SimulatedLoginRequest", additionalProperties: false },
);

export const PasswordLoginRequestSchema = Type.Object(
  {
    identifier: Type.String({ minLength: 1, maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 128 }),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { $id: "PasswordLoginRequest", additionalProperties: false },
);

export const PasswordRegistrationRequestSchema = Type.Object(
  {
    username: Type.String({
      minLength: 3,
      maxLength: 40,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    }),
    email: Type.String({ format: "email", maxLength: 320 }),
    display_name: Type.String({ minLength: 1, maxLength: 100 }),
    password: Type.String({ minLength: 8, maxLength: 128 }),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { $id: "PasswordRegistrationRequest", additionalProperties: false },
);

export const AppleLoginChallengeRequestSchema = Type.Object(
  {
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { $id: "AppleLoginChallengeRequest", additionalProperties: false },
);

export const AppleLoginChallengeResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    challenge_id: Id,
    nonce: Type.String({ minLength: 32, maxLength: 128 }),
    expires_at: Timestamp,
  },
  { $id: "AppleLoginChallengeResponse", additionalProperties: false },
);

export const AppleLoginRequestSchema = Type.Object(
  {
    challenge_id: Id,
    identity_token: Type.String({ minLength: 100, maxLength: 20_000 }),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
    given_name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    family_name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  },
  { $id: "AppleLoginRequest", additionalProperties: false },
);

export const SessionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    session_id: Type.Optional(Id),
    access_token: Type.String({ minLength: 32 }),
    expires_at: Timestamp,
    account: Type.Object({
      id: Id,
      slug: Type.String(),
      name: Type.String(),
    }),
    user: Type.Object({
      id: Id,
      email: Type.String(),
      display_name: Type.String(),
      kind: Type.Union([
        Type.Literal("simulated_human"),
        Type.Literal("apple_human"),
        Type.Literal("google_human"),
        Type.Literal("password_human"),
        Type.Literal("lab_human"),
      ]),
      role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
      username: Type.Union([Type.String(), Type.Null()]),
    }),
  },
  { $id: "SessionResponse", additionalProperties: false },
);

export const CurrentSessionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    session_id: Type.Optional(Id),
    expires_at: Timestamp,
    account: Type.Object({
      id: Id,
      slug: Type.String(),
      name: Type.String(),
    }),
    user: Type.Object({
      id: Id,
      email: Type.String(),
      display_name: Type.String(),
      kind: Type.Union([
        Type.Literal("simulated_human"),
        Type.Literal("apple_human"),
        Type.Literal("google_human"),
        Type.Literal("password_human"),
        Type.Literal("lab_human"),
      ]),
      role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
      username: Type.Union([Type.String(), Type.Null()]),
    }),
  },
  { $id: "CurrentSessionResponse", additionalProperties: false },
);

export const LogoutResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    revoked_session_id: Id,
    revoked_at: Timestamp,
  },
  { $id: "LogoutResponse", additionalProperties: false },
);

export const SourceRetentionRequestSchema = Type.Object(
  {
    requested_mode: Type.Union(
      SOURCE_RETENTION_MODES.map((mode) => Type.Literal(mode)),
    ),
    source_scope: Type.Union(
      SOURCE_SCOPES.map((scope) => Type.Literal(scope)),
    ),
    requested_retention_until: Type.Optional(Timestamp),
  },
  { additionalProperties: false },
);

export const CaptureSourceInputSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("fixture"),
      Type.Literal("transcript"),
      Type.Literal("screenshot_metadata"),
    ]),
    channel: Type.Optional(
      Type.Union(INPUT_CHANNELS.map((channel) => Type.Literal(channel))),
    ),
    captured_at: Timestamp,
    source_timezone: NullableString,
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
    source_locator: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500 }),
    ),
    authorization_expires_at: Type.Optional(Timestamp),
    retention: SourceRetentionRequestSchema,
  },
  { additionalProperties: false },
);

export const SourceRetentionSummarySchema = Type.Object(
  {
    policy_version: Type.Literal(SOURCE_RETENTION_POLICY_VERSION),
    requested_mode: Type.Union(
      SOURCE_RETENTION_RECEIPT_MODES.map((mode) => Type.Literal(mode)),
    ),
    effective_mode: Type.Union(
      SOURCE_RETENTION_RECEIPT_MODES.map((mode) => Type.Literal(mode)),
    ),
    source_scope: Type.Union(
      SOURCE_RETENTION_RECEIPT_SCOPES.map((scope) => Type.Literal(scope)),
    ),
    source_access_state: Type.Union([
      Type.Literal("available"),
      Type.Literal("purged"),
      Type.Literal("deleted"),
    ]),
    source_access_reason: Type.Union([
      Type.Literal("awaiting_review_completion"),
      Type.Literal("retained_until_deadline"),
      Type.Literal("review_completed"),
      Type.Literal("retention_deadline_elapsed"),
      Type.Literal("manual_deletion"),
      Type.Literal("legacy_unverified"),
    ]),
    requested_retention_until: Type.Union([Timestamp, Type.Null()]),
    retention_until: Type.Union([Timestamp, Type.Null()]),
    review_completed_at: Type.Union([Timestamp, Type.Null()]),
    source_purged_at: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);

export const CaptureSourceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("fixture"),
      Type.Literal("transcript"),
      Type.Literal("screenshot_metadata"),
      ...SOURCE_RESOURCE_KINDS.map((kind) => Type.Literal(kind)),
    ]),
    channel: Type.Optional(
      Type.Union(INPUT_CHANNELS.map((channel) => Type.Literal(channel))),
    ),
    captured_at: Timestamp,
    source_timezone: NullableString,
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
    source_locator: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500 }),
    ),
    retention: SourceRetentionSummarySchema,
  },
  { additionalProperties: false },
);

const BoundIdentitySchema = Type.Object(
  {
    status: Type.Literal("bound"),
    external_ref: Type.String({ minLength: 1, maxLength: 200 }),
    display_label: Type.String({ minLength: 1, maxLength: 200 }),
    assignment_ref: Type.String({ minLength: 1, maxLength: 200 }),
    assignment_label: Type.String({ minLength: 1, maxLength: 200 }),
    binding_basis: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

const BoundExistingIdentitySchema = Type.Object(
  {
    status: Type.Literal("bound_existing"),
    subject_id: Id,
    assignment_id: Type.Optional(Id),
    assignment_ref: Type.String({ minLength: 1, maxLength: 200 }),
    assignment_label: Type.String({ minLength: 1, maxLength: 200 }),
    binding_basis: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

const AmbiguousIdentitySchema = Type.Object(
  {
    status: Type.Literal("ambiguous"),
    options: Type.Array(
      Type.Object(
        {
          external_ref: Type.String({ minLength: 1, maxLength: 200 }),
          display_label: Type.String({ minLength: 1, maxLength: 200 }),
          assignment_label: Type.String({ minLength: 1, maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 20 },
    ),
    reason: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

const UnboundIdentitySchema = Type.Object(
  {
    status: Type.Literal("unbound"),
    reason: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

export const CaptureIdentitySchema = Type.Union([
  BoundIdentitySchema,
  BoundExistingIdentitySchema,
  AmbiguousIdentitySchema,
  UnboundIdentitySchema,
]);

export const EvidenceMessageInputSchema = Type.Object(
  {
    source_message_id: Type.String({ minLength: 1, maxLength: 128 }),
    sequence: Type.Integer({ minimum: 0 }),
    speaker: Type.Union([
      Type.Literal("candidate"),
      Type.Literal("recruiter"),
      Type.Literal("hiring_manager"),
      Type.Literal("unknown"),
    ]),
    text: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
);

export const CreateCaptureRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    fixture_case_id: Type.Optional(
      Type.String({ minLength: 1, maxLength: 80 }),
    ),
    source: CaptureSourceInputSchema,
    identity: CaptureIdentitySchema,
    messages: Type.Array(EvidenceMessageInputSchema, {
      minItems: 1,
      maxItems: 500,
    }),
  },
  { $id: "CreateCaptureRequest", additionalProperties: false },
);

export const EvidenceMessageSchema = Type.Object(
  {
    id: Id,
    source_message_id: Type.String(),
    sequence: Type.Integer(),
    speaker: Type.String(),
    text: Type.Union([Type.String(), Type.Null()]),
    content_hash: Type.String(),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("purged"),
      Type.Literal("deleted"),
    ]),
  },
  { additionalProperties: false },
);

export const CaptureResponseSchema = Type.Object(
  {
    id: Id,
    account_id: Id,
    fixture_case_id: Type.Union([Type.String(), Type.Null()]),
    status: Type.Union([Type.Literal("active"), Type.Literal("deleted")]),
    version: Type.Integer({ minimum: 1 }),
    identity_status: Type.Union([
      Type.Literal("bound"),
      Type.Literal("ambiguous"),
      Type.Literal("unbound"),
    ]),
    subject_id: Type.Union([Id, Type.Null()]),
    assignment_id: Type.Union([Id, Type.Null()]),
    source: CaptureSourceSchema,
    messages: Type.Array(EvidenceMessageSchema),
    created_at: Timestamp,
  },
  { $id: "CaptureResponse", additionalProperties: false },
);

export const ProposedAssertionInputSchema = Type.Object(
  {
    field: Type.Union(ASSERTION_FIELDS.map((field) => Type.Literal(field))),
    status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("ambiguous"),
      Type.Literal("superseded"),
    ]),
    value: Type.String({ minLength: 1, maxLength: 2000 }),
    evidence_message_id: Type.String({ minLength: 1, maxLength: 128 }),
    evidence_quote: Type.String({ minLength: 1, maxLength: 2000 }),
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
    supersedes_state_id: Type.Optional(Id),
  },
  { additionalProperties: false },
);

export const SimulatedEffectPreviewSchema = Type.Object(
  {
    simulated: Type.Literal(true),
    capability: Type.Literal(SIMULATED_CAPABILITY),
    adapter: Type.Literal(SIMULATED_ADAPTER),
    target: Type.Object(
      {
        destination_key: Type.String({ minLength: 1, maxLength: 200 }),
        label: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    change: Type.Object(
      {
        kind: Type.Literal("create_attention"),
        title: Type.String({ minLength: 1, maxLength: 240 }),
      },
      { additionalProperties: false },
    ),
    expected_destination_version: Type.Integer({ minimum: 0 }),
    simulation_behavior: Type.Union([
      Type.Literal("success"),
      Type.Literal("failure"),
      Type.Literal("timeout_before_write"),
      Type.Literal("timeout_after_write"),
    ]),
  },
  { $id: "SimulatedEffectPreview", additionalProperties: false },
);

export const ActionProposalInputSchema = Type.Object(
  {
    type: Type.Literal("prepare_question"),
    owner: Type.Literal("recruiter"),
    target: Type.String({ minLength: 1, maxLength: 500 }),
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    due: Type.String({ minLength: 1, maxLength: 240 }),
    evidence_message_ids: Type.Array(
      Type.String({ minLength: 1, maxLength: 128 }),
      { minItems: 1, uniqueItems: true },
    ),
    effect_preview: SimulatedEffectPreviewSchema,
  },
  { additionalProperties: false },
);

export const SubmitAnalysisProposalRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    producer: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("model"),
          Type.Literal("fixture_compiler"),
          Type.Literal("human_draft"),
        ]),
        name: Type.String({ minLength: 1, maxLength: 120 }),
        version: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
    disposition: Type.Union(
      DISPOSITIONS.map((disposition) => Type.Literal(disposition)),
    ),
    assertions: Type.Array(ProposedAssertionInputSchema, { maxItems: 50 }),
    action: Type.Union([ActionProposalInputSchema, Type.Null()]),
  },
  { $id: "SubmitAnalysisProposalRequest", additionalProperties: false },
);

export const AssertionProposalSchema = Type.Object(
  {
    id: Id,
    field: Type.String(),
    status: Type.String(),
    review_status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("confirmed"),
      Type.Literal("dismissed"),
      Type.Literal("unresolved"),
      Type.Literal("deleted"),
    ]),
    value: Type.Union([Type.String(), Type.Null()]),
    evidence_id: Id,
    evidence_quote: Type.Union([Type.String(), Type.Null()]),
    subject_kind: Type.String(),
    temporal_relation: Type.String(),
    supersedes_state_id: Type.Union([Id, Type.Null()]),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const ActionProposalSchema = Type.Object(
  {
    id: Id,
    type: Type.Literal("prepare_question"),
    status: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    target: Type.String(),
    reason: Type.String(),
    due: Type.String(),
    evidence_ids: Type.Array(Id),
    required_assertion_ids: Type.Array(Id),
    exact_preview: SimulatedEffectPreviewSchema,
    exact_preview_digest: Type.String(),
    simulated: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const AnalysisProposalResponseSchema = Type.Object(
  {
    id: Id,
    capture_id: Id,
    disposition: Type.Union(
      DISPOSITIONS.map((disposition) => Type.Literal(disposition)),
    ),
    producer: Type.Object({
      kind: Type.String(),
      name: Type.String(),
      version: Type.String(),
    }),
    assertions: Type.Array(AssertionProposalSchema),
    action: Type.Union([ActionProposalSchema, Type.Null()]),
    created_at: Timestamp,
  },
  { $id: "AnalysisProposalResponse", additionalProperties: false },
);

export const AssertionDecisionRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    expected_review_token: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
    expected_assertion_version: Type.Integer({ minimum: 1 }),
    decision: Type.Union([
      Type.Literal("confirm"),
      Type.Literal("dismiss"),
      Type.Literal("leave_unresolved"),
    ]),
    corrected_value: Type.Optional(
      Type.String({ minLength: 1, maxLength: 2000 }),
    ),
  },
  { $id: "AssertionDecisionRequest", additionalProperties: false },
);

export const AssertionDecisionResponseSchema = Type.Object(
  {
    decision_id: Id,
    assertion_id: Id,
    decision: Type.String(),
    decided_by_user_id: Id,
    confirmed_state_id: Type.Union([Id, Type.Null()]),
    decided_at: Timestamp,
  },
  { $id: "AssertionDecisionResponse", additionalProperties: false },
);

export const ReviseActionRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    expected_action_version: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    exact_preview: SimulatedEffectPreviewSchema,
  },
  { $id: "ReviseActionRequest", additionalProperties: false },
);

export const ApproveActionRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    expected_action_version: Type.Integer({ minimum: 1 }),
    exact_preview: SimulatedEffectPreviewSchema,
    expires_at: Type.Optional(Timestamp),
  },
  { $id: "ApproveActionRequest", additionalProperties: false },
);

export const ApprovalResponseSchema = Type.Object(
  {
    id: Id,
    action_id: Id,
    action_version: Type.Integer({ minimum: 1 }),
    exact_preview_digest: Type.String(),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("revoked"),
      Type.Literal("stale"),
      Type.Literal("consumed"),
    ]),
    approved_by_user_id: Id,
    granted_at: Timestamp,
    expires_at: Timestamp,
  },
  { $id: "ApprovalResponse", additionalProperties: false },
);

export const RevokeApprovalRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "RevokeApprovalRequest", additionalProperties: false },
);

export const ExecuteActionRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    approval_id: Id,
    expected_action_version: Type.Integer({ minimum: 1 }),
  },
  { $id: "ExecuteActionRequest", additionalProperties: false },
);

export const ReconcileEffectRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
  },
  { $id: "ReconcileEffectRequest", additionalProperties: false },
);

export const EffectReversalPreviewSchema = Type.Object(
  {
    original_attempt_id: Id,
    simulated: Type.Literal(true),
    capability: Type.Literal(SIMULATED_REVERSAL_CAPABILITY),
    adapter: Type.Literal(SIMULATED_ADAPTER),
    target: Type.Object(
      {
        destination_key: Type.String({ minLength: 1, maxLength: 200 }),
        label: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    current_effect: Type.Object(
      {
        kind: Type.Literal("create_attention"),
        title: Type.String({ minLength: 1, maxLength: 240 }),
      },
      { additionalProperties: false },
    ),
    reversal: Type.Object(
      {
        kind: Type.Literal("remove_attention"),
        title: Type.String({ minLength: 1, maxLength: 240 }),
      },
      { additionalProperties: false },
    ),
    expected_destination_version: Type.Integer({ minimum: 1 }),
    preview_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    blockers: Type.Array(
      Type.Object(
        {
          code: Type.Union([
            Type.Literal("effect_not_verified"),
            Type.Literal("prior_state_not_reversible"),
            Type.Literal("destination_changed"),
            Type.Literal("reversal_already_verified"),
          ]),
          message: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
    ),
    reversal_available: Type.Boolean(),
  },
  { $id: "EffectReversalPreview", additionalProperties: false },
);

export const ApproveEffectReversalRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    expected_destination_version: Type.Integer({ minimum: 1 }),
    expected_preview_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { $id: "ApproveEffectReversalRequest", additionalProperties: false },
);

export const EffectReversalApprovalResponseSchema = Type.Object(
  {
    id: Id,
    original_attempt_id: Id,
    exact_preview: EffectReversalPreviewSchema,
    exact_preview_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("revoked"),
      Type.Literal("stale"),
      Type.Literal("consumed"),
    ]),
    reason: Type.String(),
    approved_by_user_id: Id,
    granted_at: Timestamp,
    expires_at: Timestamp,
  },
  { $id: "EffectReversalApprovalResponse", additionalProperties: false },
);

export const ExecuteEffectReversalRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    approval_id: Id,
  },
  { $id: "ExecuteEffectReversalRequest", additionalProperties: false },
);

export const EffectReversalResultResponseSchema = Type.Object(
  {
    reversal_attempt_id: Id,
    original_attempt_id: Id,
    attempt_status: Type.Union([
      Type.Literal("verified"),
      Type.Literal("failed"),
      Type.Literal("unknown"),
    ]),
    simulated: Type.Literal(true),
    reused: Type.Boolean(),
    observation: Type.Union([
      Type.Object(
        {
          id: Id,
          destination_key: Type.String(),
          destination_version: Type.Union([
            Type.Integer({ minimum: 1 }),
            Type.Null(),
          ]),
          match_status: Type.Union([
            Type.Literal("matched_absent"),
            Type.Literal("still_present"),
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
          summary: Type.String(),
          created_at: Timestamp,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { $id: "EffectReversalResultResponse", additionalProperties: false },
);

export const EffectReversalSnapshotSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("available"),
      Type.Literal("approved"),
      Type.Literal("stale"),
      Type.Literal("failed"),
      Type.Literal("unknown"),
      Type.Literal("verified"),
    ]),
    latest_approval: Type.Union([
      EffectReversalApprovalResponseSchema,
      Type.Null(),
    ]),
    latest_attempt: Type.Union([
      EffectReversalResultResponseSchema,
      Type.Null(),
    ]),
  },
  { $id: "EffectReversalSnapshot", additionalProperties: false },
);

export const EffectResultResponseSchema = Type.Object(
  {
    attempt_id: Id,
    action_id: Id,
    attempt_status: Type.Union([
      Type.Literal("verified"),
      Type.Literal("failed"),
      Type.Literal("unknown"),
    ]),
    action_status: Type.String(),
    simulated: Type.Literal(true),
    reused: Type.Boolean(),
    observation: Type.Union([
      Type.Object({
        id: Id,
        destination_key: Type.String(),
        destination_version: Type.Integer(),
        match_status: Type.Union([
          Type.Literal("matched"),
          Type.Literal("mismatched"),
          Type.Literal("unavailable"),
        ]),
        observed_at: Timestamp,
      }),
      Type.Null(),
    ]),
    outcome: Type.Union([
      Type.Object({
        id: Id,
        status: Type.Union([
          Type.Literal("verified"),
          Type.Literal("failed"),
          Type.Literal("unknown"),
        ]),
        summary: Type.String(),
        created_at: Timestamp,
      }),
      Type.Null(),
    ]),
    reversal: Type.Optional(
      Type.Union([EffectReversalSnapshotSchema, Type.Null()]),
    ),
  },
  { $id: "EffectResultResponse", additionalProperties: false },
);

export const SyncResponseSchema = Type.Object(
  {
    after: Type.Integer({ minimum: 0 }),
    next_cursor: Type.Integer({ minimum: 0 }),
    events: Type.Array(
      Type.Object({
        sequence: Type.Integer({ minimum: 1 }),
        event_type: Type.String(),
        entity_type: Type.String(),
        entity_id: Id,
        occurred_at: Timestamp,
        metadata: Type.Record(Type.String(), Type.Unknown()),
      }),
    ),
  },
  { $id: "SyncResponse", additionalProperties: false },
);

export const DeleteCaptureRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "DeleteCaptureRequest", additionalProperties: false },
);

export const DeleteCaptureResponseSchema = Type.Object(
  {
    deletion_id: Id,
    capture_id: Id,
    status: Type.Literal("deleted"),
    derivatives_deleted: Type.Integer({ minimum: 0 }),
    access_revoked_at: Timestamp,
  },
  { $id: "DeleteCaptureResponse", additionalProperties: false },
);

export const TemporalStateResponseSchema = Type.Object(
  {
    assignment_id: Id,
    states: Type.Array(
      Type.Object({
        id: Id,
        subject_id: Id,
        assignment_id: Id,
        field: Type.String(),
        value: Type.Union([Type.String(), Type.Null()]),
        status: Type.Union([
          Type.Literal("active"),
          Type.Literal("superseded"),
          Type.Literal("contested"),
          Type.Literal("expired"),
          Type.Literal("deleted"),
        ]),
        source_assertion_id: Id,
        confirmed_by_decision_id: Id,
        supersedes_state_id: Type.Union([Id, Type.Null()]),
        valid_from: Timestamp,
        valid_until: Type.Union([Timestamp, Type.Null()]),
      }),
    ),
  },
  { $id: "TemporalStateResponse", additionalProperties: false },
);

export const WorkspaceReviewResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    data_classification: Type.Union([
      Type.Literal("synthetic_fixture_only"),
      Type.Literal("sensitive_candidate_evidence"),
    ]),
    account_id: Id,
    account_slug: Type.String(),
    subject: Type.Object(
      {
        id: Id,
        display_label: Type.String(),
      },
      { additionalProperties: false },
    ),
    assignment: Type.Object(
      {
        id: Id,
        display_label: Type.String(),
      },
      { additionalProperties: false },
    ),
    source_authorization: Type.Object(
      {
        state: Type.Union([
          Type.Literal("authorized"),
          Type.Literal("revoked"),
          Type.Literal("expired"),
        ]),
        expires_at: Type.Union([Timestamp, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    capture: CaptureResponseSchema,
    analysis: AnalysisProposalResponseSchema,
    confirmed_state: Type.Object(
      {
        id: Id,
        version: Type.Integer({ minimum: 0 }),
        assertions: Type.Array(
          Type.Object(
            {
              id: Id,
              field: Type.String(),
              value: Type.String(),
              status: Type.Literal("confirmed"),
              state_status: Type.Union([
                Type.Literal("active"),
                Type.Literal("superseded"),
                Type.Literal("contested"),
                Type.Literal("expired"),
              ]),
              evidence_message_id: Type.String(),
              evidence_id: Id,
              evidence_quote: Type.Union([Type.String(), Type.Null()]),
              source_assertion_id: Id,
              confirmed_by_decision_id: Id,
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    latest_approval: Type.Union([ApprovalResponseSchema, Type.Null()]),
    latest_effect: Type.Union([EffectResultResponseSchema, Type.Null()]),
    audit_cursor: Type.Integer({ minimum: 0 }),
  },
  { $id: "WorkspaceReviewResponse", additionalProperties: false },
);

export const DeletionLineageResponseSchema = Type.Object(
  {
    deletion_id: Id,
    capture_id: Id,
    access_revoked_at: Timestamp,
    completed_at: Type.Union([Timestamp, Type.Null()]),
    lineage: Type.Array(
      Type.Object({
        entity_type: Type.String(),
        entity_id: Id,
        disposition: Type.Union([
          Type.Literal("content_removed"),
          Type.Literal("access_revoked"),
          Type.Literal("audit_reference_retained"),
        ]),
        deleted_at: Timestamp,
      }),
    ),
  },
  { $id: "DeletionLineageResponse", additionalProperties: false },
);

export const SourceRetentionReceiptSchema = Type.Object(
  {
    receipt_id: Id,
    capture_id: Id,
    account_id: Id,
    policy_version: Type.Literal(SOURCE_RETENTION_POLICY_VERSION),
    requested_policy: Type.Object(
      {
        mode: Type.Union(
          SOURCE_RETENTION_RECEIPT_MODES.map((mode) =>
            Type.Literal(mode),
          ),
        ),
        source_scope: Type.Union(
          SOURCE_RETENTION_RECEIPT_SCOPES.map((scope) =>
            Type.Literal(scope),
          ),
        ),
        retention_until: Type.Union([Timestamp, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    effective_policy: Type.Object(
      {
        mode: Type.Union(
          SOURCE_RETENTION_RECEIPT_MODES.map((mode) =>
            Type.Literal(mode),
          ),
        ),
        source_scope: Type.Union(
          SOURCE_RETENTION_RECEIPT_SCOPES.map((scope) =>
            Type.Literal(scope),
          ),
        ),
        retention_until: Type.Union([Timestamp, Type.Null()]),
        review_completion_event: Type.Union([
          Type.Literal("analysis_proposal_committed"),
          Type.Literal("resource_intake_committed"),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    source_access: Type.Object(
      {
        state: Type.Union([
          Type.Literal("available"),
          Type.Literal("purged"),
          Type.Literal("deleted"),
        ]),
        reason: Type.Union([
          Type.Literal("awaiting_review_completion"),
          Type.Literal("retained_until_deadline"),
          Type.Literal("review_completed"),
          Type.Literal("retention_deadline_elapsed"),
          Type.Literal("manual_deletion"),
          Type.Literal("legacy_unverified"),
        ]),
      },
      { additionalProperties: false },
    ),
    source_authorization: Type.Object(
      {
        state: Type.Union([
          Type.Literal("authorized"),
          Type.Literal("revoked"),
          Type.Literal("expired"),
        ]),
        reason: Type.Union([
          Type.Literal("capture_authorized"),
          Type.Literal("recruiter_revoked"),
          Type.Literal("recruiter_restored"),
          Type.Literal("authorization_expired"),
        ]),
        changed_at: Timestamp,
        expires_at: Type.Union([Timestamp, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    lifecycle: Type.Object(
      {
        submitted_at: Timestamp,
        review_completed_at: Type.Union([Timestamp, Type.Null()]),
        retention_until: Type.Union([Timestamp, Type.Null()]),
        source_purged_at: Type.Union([Timestamp, Type.Null()]),
        deleted_at: Type.Union([Timestamp, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    deletion_id: Type.Union([Id, Type.Null()]),
    lineage: Type.Array(
      Type.Object(
        {
          event_id: Id,
          event_type: Type.Union([
            Type.Literal("source_submitted"),
            Type.Literal("review_completed"),
            Type.Literal("source_purged"),
            Type.Literal("source_deleted"),
          ]),
          reason: Type.Union([
            Type.Literal("capture_submitted"),
            Type.Literal("analysis_proposal_committed"),
            Type.Literal("resource_intake_committed"),
            Type.Literal("review_completed"),
            Type.Literal("retention_deadline_elapsed"),
            Type.Literal("manual_deletion"),
            Type.Literal("legacy_unverified"),
          ]),
          occurred_at: Timestamp,
        },
        { additionalProperties: false },
      ),
    ),
    derivative_lineage: Type.Array(
      Type.Object(
        {
          entity_type: Type.String({ minLength: 1 }),
          entity_id: Id,
          disposition: Type.Union([
            Type.Literal("content_purged"),
            Type.Literal("access_revoked"),
            Type.Literal("audit_reference_retained"),
            Type.Literal("confirmed_state_retained"),
          ]),
          recorded_at: Timestamp,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: "SourceRetentionReceipt", additionalProperties: false },
);

export const RevokeCapabilityRequestSchema = Type.Object(
  {
    idempotency_key: IdempotencyKey,
    capability: Type.Literal(SIMULATED_CAPABILITY),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "RevokeCapabilityRequest", additionalProperties: false },
);

export type SimulatedLoginRequest = Static<
  typeof SimulatedLoginRequestSchema
>;
export type PasswordLoginRequest = Static<typeof PasswordLoginRequestSchema>;
export type PasswordRegistrationRequest = Static<
  typeof PasswordRegistrationRequestSchema
>;
export type SessionResponse = Static<typeof SessionResponseSchema>;
export type AppleLoginChallengeRequest = Static<
  typeof AppleLoginChallengeRequestSchema
>;
export type AppleLoginChallengeResponse = Static<
  typeof AppleLoginChallengeResponseSchema
>;
export type AppleLoginRequest = Static<typeof AppleLoginRequestSchema>;
export type CurrentSessionResponse = Static<
  typeof CurrentSessionResponseSchema
>;
export type LogoutResponse = Static<typeof LogoutResponseSchema>;
export type SourceRetentionRequest = Static<
  typeof SourceRetentionRequestSchema
>;
export type CaptureSourceInput = Static<typeof CaptureSourceInputSchema>;
export type CreateCaptureRequest = Static<typeof CreateCaptureRequestSchema>;
export type CaptureResponse = Static<typeof CaptureResponseSchema>;
export type SubmitAnalysisProposalRequest = Static<
  typeof SubmitAnalysisProposalRequestSchema
>;
export type AnalysisProposalResponse = Static<
  typeof AnalysisProposalResponseSchema
>;
export type AssertionDecisionRequest = Static<
  typeof AssertionDecisionRequestSchema
>;
export type AssertionDecisionResponse = Static<
  typeof AssertionDecisionResponseSchema
>;
export type ActionProposal = Static<typeof ActionProposalSchema>;
export type SimulatedEffectPreview = Static<
  typeof SimulatedEffectPreviewSchema
>;
export type ReviseActionRequest = Static<typeof ReviseActionRequestSchema>;
export type ApproveActionRequest = Static<typeof ApproveActionRequestSchema>;
export type ApprovalResponse = Static<typeof ApprovalResponseSchema>;
export type RevokeApprovalRequest = Static<
  typeof RevokeApprovalRequestSchema
>;
export type ExecuteActionRequest = Static<typeof ExecuteActionRequestSchema>;
export type ReconcileEffectRequest = Static<
  typeof ReconcileEffectRequestSchema
>;
export type EffectReversalPreview = Static<
  typeof EffectReversalPreviewSchema
>;
export type ApproveEffectReversalRequest = Static<
  typeof ApproveEffectReversalRequestSchema
>;
export type EffectReversalApprovalResponse = Static<
  typeof EffectReversalApprovalResponseSchema
>;
export type ExecuteEffectReversalRequest = Static<
  typeof ExecuteEffectReversalRequestSchema
>;
export type EffectReversalResultResponse = Static<
  typeof EffectReversalResultResponseSchema
>;
export type EffectReversalSnapshot = Static<
  typeof EffectReversalSnapshotSchema
>;
export type EffectResultResponse = Static<typeof EffectResultResponseSchema>;
export type SyncResponse = Static<typeof SyncResponseSchema>;
export type DeleteCaptureRequest = Static<typeof DeleteCaptureRequestSchema>;
export type DeleteCaptureResponse = Static<typeof DeleteCaptureResponseSchema>;
export type TemporalStateResponse = Static<typeof TemporalStateResponseSchema>;
export type WorkspaceReviewResponse = Static<
  typeof WorkspaceReviewResponseSchema
>;
export type DeletionLineageResponse = Static<
  typeof DeletionLineageResponseSchema
>;
export type SourceRetentionReceipt = Static<
  typeof SourceRetentionReceiptSchema
>;
export type RevokeCapabilityRequest = Static<
  typeof RevokeCapabilityRequestSchema
>;
