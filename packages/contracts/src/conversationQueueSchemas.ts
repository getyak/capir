import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";

/**
 * Durable conversation queue contract.
 *
 * Admission is separate from model execution: the client receives a 202
 * receipt once a queue row is committed, then observes the run through a
 * snapshot/stream. Queue data inherits Session ownership and deadline.
 */
const obj = { additionalProperties: false } as const;
const id = Type.String({ format: "uuid" });
const stamp = Type.String({ format: "date-time" });
const bounded = (maxLength: number) => Type.String({ minLength: 1, maxLength });

export const ConversationQueueEntryStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("interrupted"),
]);

export type ConversationQueueEntryStatus = Static<
  typeof ConversationQueueEntryStatusSchema
>;

/**
 * Ordered inline conversation image manifest.
 *
 * Array position is the immutable order. `attachment_id` is stable across a
 * client timeout retry, and `content_hash` pins the exact bytes so a changed
 * byte sequence can never reuse the same receipt identity. No raw bytes appear
 * here; bytes live only in the dedicated image store and the authenticated
 * readback path.
 */
export const ConversationImageManifestSchema = Type.Object(
  {
    attachment_id: id,
    file_name: Type.String({ minLength: 1, maxLength: 200 }),
    media_type: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
    ]),
    byte_size: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  obj,
);

export type ConversationImageManifest = Static<
  typeof ConversationImageManifestSchema
>;

/** One admitted image as sent by the client; base64 is transport only. */
export const ConversationImageUploadSchema = Type.Object(
  {
    attachment_id: id,
    file_name: Type.String({ minLength: 1, maxLength: 200 }),
    media_type: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
    ]),
    byte_size: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    data_base64: Type.String({ minLength: 1, maxLength: 13_400_000 }),
  },
  obj,
);

export type ConversationImageUpload = Static<
  typeof ConversationImageUploadSchema
>;

export const ConversationQueueEntrySchema = Type.Object(
  {
    queue_entry_id: id,
    message_id: id,
    sequence: Type.Integer({ minimum: 1 }),
    status: ConversationQueueEntryStatusSchema,
    // Empty only for an images-only message; the client renders a placeholder.
    objective: Type.String({ maxLength: 1_000 }),
    images: Type.Optional(
      Type.Array(ConversationImageManifestSchema, { maxItems: 10 }),
    ),
    created_at: stamp,
    updated_at: stamp,
    started_at: Type.Optional(Type.Union([stamp, Type.Null()])),
    revision: Type.Integer({ minimum: 1 }),
    run_id: Type.Union([id, Type.Null()]),
    stage: Type.Union([bounded(40), Type.Null()]),
    cancel_requested: Type.Boolean(),
    failure_code: Type.Union([bounded(80), Type.Null()]),
    // GET-128 steering metadata for projection only: this message steers the
    // run identified here instead of waiting as a separate future task.
    // Absent means the message is ordinary queued or active work.
    steers_run_id: Type.Optional(id),
    accepts_steering: Type.Optional(Type.Boolean()),
    steer_state: Type.Optional(Type.Union([Type.Literal("awaiting"), Type.Literal("dispatching"), Type.Literal("delivered"), Type.Literal("unsupported")])),
    // True once this message was actually delivered into that run; the run's
    // one standalone final answer folds exactly the delivered messages.
    steer_delivered: Type.Optional(Type.Boolean()),
  },
  obj,
);

export type ConversationQueueEntry = Static<
  typeof ConversationQueueEntrySchema
>;

export const ConversationQueuePreviewSchema = Type.Object(
  {
    run_id: id,
    message_id: id,
    text: Type.String({ maxLength: 12_000 }),
    completed_tools: Type.Optional(Type.Array(Type.Object({ name: bounded(80), completed_at: stamp }, obj), { maxItems: 16 })),
    stage: Type.Union([bounded(40), Type.Null()]),
    revision: Type.Integer({ minimum: 1 }),
  },
  obj,
);

export type ConversationQueuePreview = Static<
  typeof ConversationQueuePreviewSchema
>;

export const ConversationQueueSnapshotSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    session_id: id,
    revision: Type.Integer({ minimum: 0 }),
    paused: Type.Boolean(),
    active: Type.Union([ConversationQueueEntrySchema, Type.Null()]),
    queued: Type.Array(ConversationQueueEntrySchema, { maxItems: 50 }),
    preview: Type.Union([ConversationQueuePreviewSchema, Type.Null()]),
  },
  obj,
);

export type ConversationQueueSnapshot = Static<
  typeof ConversationQueueSnapshotSchema
>;

export const ConversationQueueAdmitRequestSchema = Type.Object(
  {
    idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
    session_id: id,
    message_id: id,
    // Empty is only admissible together with at least one image.
    objective: Type.String({ maxLength: 1_000 }),
    time_zone: Type.Optional(bounded(100)),
    images: Type.Optional(
      Type.Array(ConversationImageUploadSchema, { maxItems: 10 }),
    ),
  },
  obj,
);

export type ConversationQueueAdmitRequest = Static<
  typeof ConversationQueueAdmitRequestSchema
>;

export const ConversationQueueAdmitResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    session_id: id,
    message_id: id,
    queue_entry_id: id,
    run_id: Type.Union([id, Type.Null()]),
    status: ConversationQueueEntryStatusSchema,
    sequence: Type.Integer({ minimum: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    snapshot_revision: Type.Integer({ minimum: 0 }),
    accepted_at: stamp,
    // Present when this message steers the currently running task instead of
    // queueing as a separate future task. Backward compatible: older clients
    // ignore it and still render the message as accepted work.
    steers_run_id: Type.Optional(id),
    accepts_steering: Type.Optional(Type.Boolean()),
    steer_state: Type.Optional(Type.Union([Type.Literal("awaiting"), Type.Literal("dispatching"), Type.Literal("delivered"), Type.Literal("unsupported")])),
  },
  obj,
);

export type ConversationQueueAdmitResponse = Static<
  typeof ConversationQueueAdmitResponseSchema
>;

export const ConversationQueueMutationRequestSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("edit"),
      queue_entry_id: id,
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
      objective: Type.String({ minLength: 1, maxLength: 1_000 }),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("withdraw"),
      queue_entry_id: id,
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("retry"),
      queue_entry_id: id,
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("continue"),
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("stop"),
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
      run_id: id,
    },
    obj,
  ),
  Type.Object(
    {
      kind: Type.Literal("prioritize"),
      queue_entry_id: id,
      expected_revision: Type.Integer({ minimum: 0 }),
      idempotency_key: Type.String({ minLength: 1, maxLength: 128 }),
    },
    obj,
  ),
], { $id: "ConversationQueueMutationRequest" });

export type ConversationQueueMutationRequest = Static<
  typeof ConversationQueueMutationRequestSchema
>;

export const ConversationQueueAppliedSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("edit"),
      Type.Literal("withdraw"),
      Type.Literal("retry"),
      Type.Literal("continue"),
      Type.Literal("stop"),
      Type.Literal("prioritize"),
    ]),
    queue_entry_id: Type.Union([id, Type.Null()]),
    run_id: Type.Union([id, Type.Null()]),
    status: Type.Union([ConversationQueueEntryStatusSchema, Type.Null()]),
  },
  obj,
);

export type ConversationQueueApplied = Static<
  typeof ConversationQueueAppliedSchema
>;

export const ConversationQueueMutationResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    snapshot: ConversationQueueSnapshotSchema,
    applied: ConversationQueueAppliedSchema,
  },
  obj,
);

export type ConversationQueueMutationResponse = Static<
  typeof ConversationQueueMutationResponseSchema
>;
