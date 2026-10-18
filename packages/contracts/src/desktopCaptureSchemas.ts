import { Type, type Static } from "@sinclair/typebox";
import { ConversationImageManifestSchema, ConversationQueueEntryStatusSchema } from "./conversationQueueSchemas.js";
import { CONTRACT_VERSION } from "./constants.js";

/** Discloses the processor set that may receive an intentional Mac capture. */
export const DesktopCapturePolicySchema = Type.Object({
  policy_version: Type.String({ minLength: 1, maxLength: 64 }),
  available: Type.Boolean(),
  processor_labels: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 5 }),
  workspace_label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  source_retention_days: Type.Integer({ minimum: 1, maximum: 365 }),
}, { additionalProperties: false });
export type DesktopCapturePolicy = Static<typeof DesktopCapturePolicySchema>;

/** Scope is for local recovery partitioning, not a grant to submit data. */
export const DesktopCaptureContextSchema = Type.Object({
  protocol_version: Type.Literal(1),
  owner_scope: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  workspace_account_id: Type.String({ minLength: 1, maxLength: 160 }),
  login_binding: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  expires_at: Type.String({ format: "date-time" }),
  processing: DesktopCapturePolicySchema,
}, { additionalProperties: false });
export type DesktopCaptureContext = Static<typeof DesktopCaptureContextSchema>;

/** Bounded readback for one screenshot message; it never includes image bytes or answer text. */
export const DesktopCaptureReceiptSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  session_id: Type.String({ format: "uuid" }),
  message_id: Type.String({ format: "uuid" }),
  queue_entry_id: Type.String({ format: "uuid" }),
  status: ConversationQueueEntryStatusSchema,
  image_manifest: Type.Array(ConversationImageManifestSchema, { maxItems: 1 }),
  observed_at: Type.String({ format: "date-time" }),
  result_recorded: Type.Boolean(),
}, { additionalProperties: false });
export type DesktopCaptureReceipt = Static<typeof DesktopCaptureReceiptSchema>;

/** Unconfirmed literal words, not contact identities or relationship facts. */
export const CaptureTextClueSchema = Type.Object({
  kind: Type.Union([Type.Literal("person"), Type.Literal("company")]),
  text: Type.String({ minLength: 1, maxLength: 80 }),
  source_excerpt: Type.String({ minLength: 1, maxLength: 240 }),
}, { additionalProperties: false });

/** Host-only same-run inspection projection, persisted outside Session JSON. */
export const CaptureImageObservationSchema = Type.Object({
  artifact_id: Type.String({ minLength: 1, maxLength: 300 }),
  content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  model: Type.String({ minLength: 1, maxLength: 200 }),
  inspection_request_id: Type.String({ minLength: 1, maxLength: 200 }),
  conversation_kind: Type.Union([Type.Literal("direct"), Type.Literal("group"), Type.Literal("unknown")]),
  pending: Type.Literal(true),
  clues: Type.Array(CaptureTextClueSchema, { maxItems: 6 }),
  source_warning: Type.Optional(Type.Literal("ai_generated_or_fictional")),
}, { additionalProperties: false });
export type CaptureImageObservation = Static<typeof CaptureImageObservationSchema>;

/** Exact current-source readback; old metadata-only receipts stay unchanged. */
export const DesktopCaptureResultSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  session_id: Type.String({ format: "uuid" }),
  message_id: Type.String({ format: "uuid" }),
  queue_entry_id: Type.String({ format: "uuid" }),
  result_version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  source: ConversationImageManifestSchema,
  observation: Type.Union([CaptureImageObservationSchema, Type.Null()]),
  observed_at: Type.String({ format: "date-time" }),
}, { additionalProperties: false });
export type DesktopCaptureResult = Static<typeof DesktopCaptureResultSchema>;
