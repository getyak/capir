import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";
import { ConversationImageManifestSchema } from "./conversationQueueSchemas.js";
import { McpHumanResultSchema } from "./mcpInteractionSchemas.js";

const obj = { additionalProperties: false } as const;
const id = Type.String({ format: "uuid" });
const stamp = Type.String({ format: "date-time" });
const text = (maxLength: number) => Type.String({ maxLength });
const optional = <T extends TSchema>(schema: T) =>
  Type.Optional(Type.Union([schema, Type.Null()]));
const reference = text(160);
const publicSource = Type.Object(
  {
    result_id: text(160),
    provider_id: text(160),
    platform: text(100),
    profile_url: text(2048),
    display_name: text(200),
    handle: optional(text(200)),
    biography: optional(text(4000)),
    avatar_url: optional(text(2048)),
    avatar_display_policy: optional(text(100)),
    avatar_rights_basis: optional(text(100)),
    verified: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    match_basis: text(2000),
    content_hash: text(128),
    retrieved_at: stamp,
  },
  obj,
);
export const AgentSessionDisplayBlockSchema = Type.Object(
  {
    id: reference,
    kind: text(100),
    title: text(500),
    body: text(12000),
    status: text(80),
    citation_dependency_ids: Type.Array(reference, { maxItems: 0 }),
    requires_user_decision: Type.Literal(false),
    target_ref: Type.Optional(Type.Null()),
    public_source_refs: optional(Type.Array(publicSource, { maxItems: 12 })),
    // New clients persist this decision before executable fields are stripped.
    // Optional only for old stored payloads and old mobile clients; current
    // clients fail closed when a restored block has no classification.
    allows_static_share: Type.Optional(Type.Boolean()),
  },
  obj,
);
const media = Type.Object(
  {
    id,
    file_name: text(200),
    media_type: text(100),
    byte_size: Type.Integer({ minimum: 0, maximum: 10000000 }),
    width: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 20000 }), Type.Null()]),
    ),
    height: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 20000 }), Type.Null()]),
    ),
    status: text(80),
    created_at: stamp,
  },
  obj,
);
const labReceipt = Type.Object(
  {
    override_id: id,
    feature_id: text(160),
    server_value: text(500),
    override_value: text(500),
    effective_value: text(500),
    catalog_revision: text(160),
    definition_revision: text(160),
    backend_revision: optional(text(160)),
    scope: text(100),
    observed_at: stamp,
  },
  obj,
);
const response = Type.Object(
  {
    contractVersion: text(80),
    taskID: reference,
    contextManifestID: reference,
    knowledgeSnapshotID: reference,
    disposition: text(100),
    savedBlocks: optional(
      Type.Array(AgentSessionDisplayBlockSchema, { maxItems: 32 }),
    ),
    unboundPersonResearchBlocks: optional(
      Type.Array(AgentSessionDisplayBlockSchema, { maxItems: 32 }),
    ),
    unboundConversationBlocks: optional(
      Type.Array(AgentSessionDisplayBlockSchema, { maxItems: 32 }),
    ),
    media: optional(Type.Array(media, { maxItems: 10 })),
    createdAt: stamp,
    // GET-128 authentic execution readback for the folded execution card:
    // canonical run start/end when available, plus real tool-completion
    // receipts (name and completion time only; never arguments, results,
    // provider text or other private data). Empty is legal: a run with no
    // completed tool and no prose still has its own truthful receipt.
    execution: Type.Optional(
      Type.Object(
        {
          started_at: optional(stamp),
          completed_at: optional(stamp),
          tools: Type.Array(
            Type.Object({ name: text(80), completed_at: stamp }, obj),
            { maxItems: 16 },
          ),
        },
        obj,
      ),
    ),
    labFeatureReceipt: optional(labReceipt),
    // GET-40 independent review: keep only the proposal id/revision in history
    // so a restored completed turn can re-open the same authorized review
    // without parsing answer text or listing every account proposal.
    memoryProposal: optional(
      Type.Object(
        { proposal_id: id, revision: Type.Integer({ minimum: 1 }) },
        obj,
      ),
    ),
    // Display-only link; review/export always rereads the governed projection.
    meetingDraft: optional(Type.Object({id,title:text(200)},obj)),
    // Durable user-owned MCP human request reference. The card always reloads
    // the canonical request; this is only a stable pointer with its last known
    // lifecycle state, never an executable snapshot.
    mcpInteraction: optional(
      Type.Object(
        {
          request_id: id,
          call_id: id,
          kind: text(24),
          state: text(24),
        },
        obj,
      ),
    ),
    // Host-only typed human result for a resolved MCP interaction. Server
    // issued and immutable on client save; rendered as a result part, never a
    // user-authored turn.
    hostResult: optional(McpHumanResultSchema),
  },
  obj,
);
const fieldEvidence = Type.Array(
  Type.Object(
    {
      field: Type.Union([
        Type.Literal("name"),
        Type.Literal("identityClue"),
        Type.Literal("relationshipContext"),
      ]),
      exactExcerpt: text(4000),
    },
    obj,
  ),
  { maxItems: 12 },
);
const reviewedPublicProfile = Type.Object(
  {
    resultID: reference,
    providerID: reference,
    platform: text(100),
    profileURL: text(2048),
    displayName: text(200),
    handle: optional(text(200)),
    biography: optional(text(4000)),
    avatarURL: optional(text(2048)),
    avatarDisplayPolicy: optional(text(100)),
    avatarRightsBasis: optional(text(100)),
    verified: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    matchBasis: text(2000),
    contentHash: text(128),
    retrievedAt: stamp,
    cardHeadline: text(500),
    includeAvatar: Type.Boolean(),
  },
  obj,
);
const proposal = Type.Object(
  {
    draft: Type.Object(
      {
        name: text(200),
        identityClue: optional(
          Type.Object({ type: text(80), value: text(2048) }, obj),
        ),
        relationshipContext: text(500),
        sourceNote: text(12000),
        interpreter: optional(
          Type.Object({ name: text(160), version: text(80) }, obj),
        ),
        reviewedPublicProfile: optional(reviewedPublicProfile),
        fieldEvidence: optional(fieldEvidence),
      },
      obj,
    ),
    idempotencyKey: text(200),
    capturedAt: optional(stamp),
    updatedAt: stamp,
    sessionID: optional(id),
    sourceMessageID: optional(id),
    sourceText: optional(text(12000)),
    fieldEvidence: optional(fieldEvidence),
    expiresAt: optional(stamp),
    status: Type.Optional(
      Type.Union([
        Type.Literal("proposed"),
        Type.Literal("declined"),
        Type.Literal("completed"),
        Type.Literal("needs_review"),
        Type.Literal("pending"),
        Type.Literal("failed"),
        Type.Literal("outcome_unknown"),
        Type.Literal("expired"),
        Type.Literal("applied"),
        Type.Literal("superseded"),
        Type.Literal("dismissed"),
        Type.Null(),
      ]),
    ),
  },
  obj,
);
export const AgentSessionPayloadSchema = Type.Object(
  {
    id,
    scopeKind: Type.Union([
      Type.Literal("unresolved_intent"),
      Type.Literal("relationship"),
      Type.Literal("identity_review"),
    ]),
    personID: optional(id),
    relationshipContextID: optional(id),
    identityResolutionCaseID: optional(id),
    personDisplayLabel: text(200),
    contextDisplayLabel: text(300),
    title: text(500),
    turns: Type.Array(
      Type.Object(
        {
          id,
          objective: text(12000),
          response,
          images: Type.Optional(
            Type.Array(ConversationImageManifestSchema, { maxItems: 10 }),
          ),
          // GET-128 steering fold: later human messages that were actually
          // delivered into this turn's single run keep their own immutable
          // identity, text, accepted time and images here. The turn's own
          // id/objective/createdAt stay the first accepted message so older
          // clients keep rendering the human side; exactly one combined final
          // answer follows these messages and is never split into fabricated
          // milestones. Messages that never reached the model are not listed
          // here; they keep their own later turns.
          steeredMessages: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  id,
                  objective: text(12000),
                  images: Type.Optional(
                    Type.Array(ConversationImageManifestSchema, {
                      maxItems: 10,
                    }),
                  ),
                  createdAt: stamp,
                },
                obj,
              ),
              { maxItems: 20 },
            ),
          ),
          createdAt: stamp,
          feedback: Type.Optional(
            Type.Union([
              Type.Literal("helpful"),
              Type.Literal("unhelpful"),
              Type.Null(),
            ]),
          ),
          feedbackUpdatedAt: optional(stamp),
        },
        obj,
      ),
      { maxItems: 200 },
    ),
    contactReceipts: optional(
      Type.Array(
        Type.Object(
          {
            id,
            operationKey: text(200),
            outcome: Type.Union([
              Type.Literal("created_person"),
              Type.Literal("matched_existing"),
              Type.Literal("identity_review"),
            ]),
            captureID: id,
            resourceID: id,
            duplicateOfResourceID: optional(id),
            personID: optional(id),
            relationshipContextID: optional(id),
            resolutionCaseID: optional(id),
            personDisplayLabel: text(200),
            contextDisplayLabel: optional(text(300)),
            createdAt: stamp,
          },
          obj,
        ),
        { maxItems: 100 },
      ),
    ),
    composerDraft: optional(text(12000)),
    composerDraftUpdatedAt: optional(stamp),
    pendingScopedAskIdempotencyKey: optional(text(200)),
    pendingScopedAskRequestIdentity: optional(text(500)),
    pendingScreenshotIdempotencyKey: optional(
      Type.String({ minLength: 1, maxLength: 200 }),
    ),
    pendingScreenshotRequestIdentity: optional(
      Type.String({ pattern: "^[0-9a-f]{64}$" }),
    ),
    pendingScreenshotCapturedAt: optional(stamp),
    pendingObjective: optional(text(12000)),
    pendingUnscopedChatIdempotencyKey: optional(text(200)),
    pendingPersonResearchIdempotencyKey: optional(text(200)),
    pendingPersonResearchRequestIdentity: optional(text(500)),
    createdAt: optional(stamp),
    contextWasTrimmed: Type.Optional(Type.Boolean()),
    originKind: Type.Optional(Type.Literal("local")),
    originSessionID: optional(id),
    originTurnID: optional(id),
    screenshotTaskIDs: optional(Type.Array(id, { maxItems: 20 })),
    inheritedScreenshotTaskIDs: optional(Type.Array(id, { maxItems: 20 })),
    contactProposal: optional(proposal),
    updatedAt: stamp,
    isUnread: Type.Boolean(),
  },
  obj,
);
export const AgentSessionMutationRequestSchema = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 0 }),
    idempotency_key: id,
    payload: AgentSessionPayloadSchema,
  },
  obj,
);
export const AgentSessionDeleteRequestSchema = Type.Object(
  { expected_revision: Type.Integer({ minimum: 0 }), idempotency_key: id },
  obj,
);
export const AgentSessionRecordSchema = Type.Object(
  {
    session_id: id,
    revision: Type.Integer({ minimum: 1 }),
    updated_at: stamp,
    expires_at: stamp,
    deleted_at: Type.Union([stamp, Type.Null()]),
    payload: Type.Union([AgentSessionPayloadSchema, Type.Null()]),
    display_authority: Type.Literal("stale_unconfirmed"),
  },
  obj,
);
export const AgentSessionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    session: AgentSessionRecordSchema,
  },
  obj,
);
export const AgentSessionListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    sessions: Type.Array(AgentSessionRecordSchema, { maxItems: 50 }),
    complete: Type.Boolean(),
    next_cursor: Type.Union([text(512), Type.Null()]),
  },
  obj,
);
export type AgentSessionPayload = Static<typeof AgentSessionPayloadSchema>;
export type AgentSessionRecord = Static<typeof AgentSessionRecordSchema>;
export type AgentSessionMutationRequest = Static<
  typeof AgentSessionMutationRequestSchema
>;
export type AgentSessionDeleteRequest = Static<
  typeof AgentSessionDeleteRequestSchema
>;
export type AgentSessionResponse = Static<typeof AgentSessionResponseSchema>;
export type AgentSessionListResponse = Static<
  typeof AgentSessionListResponseSchema
>;
