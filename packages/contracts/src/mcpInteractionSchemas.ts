import { Type, type Static } from "@sinclair/typebox";

import { CONTRACT_VERSION } from "./constants.js";

/**
 * Durable user-owned MCP human-interaction contracts.
 *
 * One request envelope covers every human participation kind: exact tool-call
 * approval, choice, typed form, transient secret, and Nango-mediated OAuth.
 * The envelope is authoritative state; renderers own no authority. A pending
 * card always reloads this canonical record instead of replaying a snapshot.
 *
 * A plaintext secret exists only in the input transaction and the outgoing
 * request. The connection stores an encrypted server-side credential so later
 * authorized calls can authenticate; that ciphertext is never returned,
 * echoed, logged, or written into message/history/idempotency/audit/telemetry
 * snapshots, and no plaintext appears in any read contract.
 */

const Id = Type.String({ format: "uuid" });
const Timestamp = Type.String({ format: "date-time" });
const Revision = Type.Integer({ minimum: 1 });
const IdempotencyKey = Type.String({ minLength: 8, maxLength: 128 });

export const MCP_INTERACTION_KINDS = [
  "approval",
  "choice",
  "form",
  "secret",
  "oauth",
] as const;

export const MCP_INTERACTION_STATES = [
  "waiting",
  "pending",
  "submitting",
  "submitted",
  "expired",
  "rejected",
  "failed",
  "unknown",
] as const;

export const MCP_CALL_OUTCOMES = [
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "outcome_unknown",
] as const;

export const MCP_AUTH_MODES = ["anonymous", "bearer", "oauth"] as const;

export const MCP_INTERACTION_ERROR_CODES = [
  "MCP_INTERACTION_NOT_FOUND",
  "MCP_INTERACTION_CHANGED",
  "MCP_INTERACTION_EXPIRED",
  "MCP_INTERACTION_NOT_PENDING",
  "MCP_INTERACTION_SCOPE_MISMATCH",
  "MCP_INTERACTION_INPUT_INVALID",
  "MCP_INTERACTION_SCHEMA_UNSUPPORTED",
  "MCP_CALL_TARGET_NOT_FOUND",
  "MCP_CALL_CONNECTION_NOT_VERIFIED",
  "MCP_CALL_STALE_APPROVAL",
  "MCP_CALL_ALREADY_CLAIMED",
  "MCP_CALL_ARGUMENTS_INVALID",
  "MCP_CALL_SECRET_ARGUMENTS",
  "MCP_CALL_TIMEOUT_AFTER_SEND",
  "MCP_OAUTH_UNAVAILABLE",
  "MCP_OAUTH_REQUEST_NOT_FOUND",
  "MCP_SECRET_UNAVAILABLE",
  "MCP_BROKER_CLEANUP_PENDING",
  "MCP_BROKER_CLEANUP_FAILED",
] as const;

export const MCP_INTERACTION_ERROR_CODE_SET = new Set<string>(
  MCP_INTERACTION_ERROR_CODES,
);

export const McpInteractionKindSchema = Type.Union(
  MCP_INTERACTION_KINDS.map((kind) => Type.Literal(kind)),
);

export const McpInteractionStateSchema = Type.Union(
  MCP_INTERACTION_STATES.map((state) => Type.Literal(state)),
);

export const McpCallOutcomeSchema = Type.Union(
  MCP_CALL_OUTCOMES.map((outcome) => Type.Literal(outcome)),
);

export const McpAuthModeSchema = Type.Union(
  MCP_AUTH_MODES.map((mode) => Type.Literal(mode)),
);

export const McpInteractionErrorCodeSchema = Type.Union([
  ...MCP_INTERACTION_ERROR_CODES.map((code) => Type.Literal(code)),
  Type.Null(),
]);

/**
 * Exact call target. The origin is derived from the stored connection and is
 * never accepted from a renderer.
 */
export const McpInteractionTargetSchema = Type.Object(
  {
    connection_id: Type.Union([Id, Type.Null()]),
    connection_label: Type.String({ minLength: 1, maxLength: 120 }),
    server_origin: Type.String({ minLength: 1, maxLength: 240 }),
    tool_name: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Null(),
    ]),
    auth_mode: Type.Union([McpAuthModeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const McpInteractionChoiceOptionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 120 }),
    label: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
  },
  { additionalProperties: false },
);

/**
 * Public tool-call receipt: what ran, where it ran, and the outcome. The
 * bounded result is redacted remote content, never a credential, and is
 * provenance-bearing public state rather than confirmed relationship
 * evidence.
 */
export const McpToolCallReceiptSchema = Type.Object(
  {
    call_id: Id,
    request_id: Id,
    connection_id: Type.Union([Id, Type.Null()]),
    server_origin: Type.String({ minLength: 1, maxLength: 240 }),
    tool_name: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Null(),
    ]),
    outcome: McpCallOutcomeSchema,
    is_error: Type.Boolean(),
    error_code: Type.Union([
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.Null(),
    ]),
    result_summary: Type.Union([
      Type.String({ minLength: 1, maxLength: 4_000 }),
      Type.Null(),
    ]),
    result_json: Type.Union([
      Type.String({ minLength: 1, maxLength: 24_000 }),
      Type.Null(),
    ]),
    executed_at: Type.Union([Timestamp, Type.Null()]),
    source: Type.Object(
      {
        kind: Type.Literal("mcp_tool_result"),
        connection_id: Type.Union([Id, Type.Null()]),
        server_origin: Type.String({ minLength: 1, maxLength: 240 }),
        tool_name: Type.Union([
          Type.String({ minLength: 1, maxLength: 128 }),
          Type.Null(),
        ]),
        protocol_version: Type.Union([
          Type.String({ minLength: 1, maxLength: 40 }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/**
 * The durable human request envelope. `call_id` is the exact tool-call
 * identity an approval binds to; for connection proposals it is the staged
 * call that adds the connection.
 */
export const McpInteractionRequestSchema = Type.Object(
  {
    id: Id,
    call_id: Id,
    kind: McpInteractionKindSchema,
    state: McpInteractionStateSchema,
    purpose: Type.String({ minLength: 1, maxLength: 1_000 }),
    target: McpInteractionTargetSchema,
    /** Bounded, redacted display of the exact arguments the approval binds. */
    arguments_display: Type.String({ minLength: 1, maxLength: 6_000 }),
    /** Original bounded input schema for validation and accessible forms. */
    argument_schema: Type.Union([
      Type.String({ minLength: 1, maxLength: 20_000 }),
      Type.Null(),
    ]),
    schema_unsupported_reason: Type.Union([
      Type.String({ minLength: 1, maxLength: 240 }),
      Type.Null(),
    ]),
    choices: Type.Array(McpInteractionChoiceOptionSchema, { maxItems: 40 }),
    oauth: Type.Union([
      Type.Object(
        {
          provider: Type.String({ minLength: 1, maxLength: 80 }),
          connect_request_id: Type.String({ minLength: 8, maxLength: 120 }),
          connect_url: Type.Union([
            Type.String({ minLength: 1, maxLength: 2_048 }),
            Type.Null(),
          ]),
          available: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    session_id: Type.Union([Id, Type.Null()]),
    message_id: Type.Union([Id, Type.Null()]),
    revision: Revision,
    expires_at: Timestamp,
    created_at: Timestamp,
    updated_at: Timestamp,
    resolved_at: Type.Union([Timestamp, Type.Null()]),
    receipt: Type.Union([McpToolCallReceiptSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const McpInteractionListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    requests: Type.Array(McpInteractionRequestSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export const McpInteractionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    request: McpInteractionRequestSchema,
  },
  { additionalProperties: false },
);

/**
 * Resolution input. `secret` is accepted once for the transaction that
 * consumes it and is never echoed in a response, receipt, or log.
 */
export const McpInteractionResolveRequestSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("approve"),
      Type.Literal("reject"),
      Type.Literal("submit"),
    ]),
    expected_revision: Revision,
    idempotency_key: IdempotencyKey,
    choice_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    values: Type.Optional(Type.String({ minLength: 2, maxLength: 20_000 })),
    secret: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  },
  { additionalProperties: false },
);

/**
 * Agent/web staging input for an exact tool-call approval. The backend
 * re-validates the arguments against the original discovered schema and the
 * connection revision before anything is shown to the human.
 */
export const McpToolCallProposeRequestSchema = Type.Object(
  {
    connection_id: Id,
    tool_name: Type.String({ minLength: 1, maxLength: 128 }),
    arguments: Type.String({ minLength: 2, maxLength: 20_000 }),
    purpose: Type.String({ minLength: 1, maxLength: 1_000 }),
    session_id: Type.Optional(Id),
    message_id: Type.Optional(Id),
    idempotency_key: IdempotencyKey,
  },
  { additionalProperties: false },
);

/**
 * Staging input for adding a user-owned connection from a conversation or the
 * directory. The form is schema-driven; a bearer secret travels only inside
 * `secret` of the later resolution.
 */
export const McpConnectionProposeRequestSchema = Type.Object(
  {
    friendly_name: Type.String({ minLength: 1, maxLength: 80 }),
    server_url: Type.String({ minLength: 1, maxLength: 2_048 }),
    auth_mode: McpAuthModeSchema,
    purpose: Type.String({ minLength: 1, maxLength: 1_000 }),
    directory_entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    session_id: Type.Optional(Id),
    message_id: Type.Optional(Id),
    idempotency_key: IdempotencyKey,
  },
  { additionalProperties: false },
);

export const McpDirectoryEntrySchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 80 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    verified_domain: Type.String({ minLength: 1, maxLength: 240 }),
    server_url: Type.String({ minLength: 1, maxLength: 2_048 }),
    summary: Type.String({ minLength: 1, maxLength: 400 }),
    auth_mode: McpAuthModeSchema,
    oauth_available: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const McpDirectoryListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    entries: Type.Array(McpDirectoryEntrySchema, { maxItems: 50 }),
  },
  { additionalProperties: false },
);

/** OAuth is optional authorization infrastructure; absent config is explicit. */
export const McpOAuthAvailabilityResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    available: Type.Boolean(),
    base_url: Type.Union([
      Type.String({ minLength: 1, maxLength: 240 }),
      Type.Null(),
    ]),
    note: Type.String({ minLength: 1, maxLength: 400 }),
  },
  { additionalProperties: false },
);

/**
 * Host-only typed human-result provenance for a resolved MCP interaction.
 * It travels with the queued continuation as host data — never as a
 * user-authored message — and preserves the exact request/call identity, the
 * original message, and the human who resolved it.
 */
export const McpHumanResultSchema = Type.Object(
  {
    request_id: Id,
    call_id: Id,
    original_message_id: Type.Union([Id, Type.Null()]),
    actor_user_id: Id,
    kind: McpInteractionKindSchema,
    outcome: Type.String({ minLength: 1, maxLength: 24 }),
    choice_id: Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
    receipt_ref: Type.Union([Id, Type.Null()]),
  },
  { additionalProperties: false },
);

export type McpHumanResult = Static<typeof McpHumanResultSchema>;

export type McpInteractionKind = (typeof MCP_INTERACTION_KINDS)[number];
export type McpInteractionState = (typeof MCP_INTERACTION_STATES)[number];
export type McpCallOutcome = (typeof MCP_CALL_OUTCOMES)[number];
export type McpAuthMode = (typeof MCP_AUTH_MODES)[number];
export type McpInteractionErrorCode =
  (typeof MCP_INTERACTION_ERROR_CODES)[number];
export type McpInteractionTarget = Static<typeof McpInteractionTargetSchema>;
export type McpInteractionChoiceOption = Static<
  typeof McpInteractionChoiceOptionSchema
>;
export type McpToolCallReceipt = Static<typeof McpToolCallReceiptSchema>;
export type McpInteractionRequest = Static<typeof McpInteractionRequestSchema>;
export type McpInteractionListResponse = Static<
  typeof McpInteractionListResponseSchema
>;
export type McpInteractionResponse = Static<
  typeof McpInteractionResponseSchema
>;
export type McpInteractionResolveRequest = Static<
  typeof McpInteractionResolveRequestSchema
>;
export type McpToolCallProposeRequest = Static<
  typeof McpToolCallProposeRequestSchema
>;
export type McpConnectionProposeRequest = Static<
  typeof McpConnectionProposeRequestSchema
>;
export type McpDirectoryEntry = Static<typeof McpDirectoryEntrySchema>;
export type McpDirectoryListResponse = Static<
  typeof McpDirectoryListResponseSchema
>;
export type McpOAuthAvailabilityResponse = Static<
  typeof McpOAuthAvailabilityResponseSchema
>;
