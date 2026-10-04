import { Type, type Static } from "@sinclair/typebox";

import { CONTRACT_VERSION } from "./constants.js";
import { McpAuthModeSchema } from "./mcpInteractionSchemas.js";

/**
 * MCP Extensions contracts.
 *
 * Two directions share one page:
 * - inbound: capri connects to an external MCP server as a client.
 * - outbound: capri publishes a scoped, read-only MCP server.
 *
 * Credentials are never part of a read contract. A connection only exposes
 * whether a credential is configured; a client grant only reveals a one-time
 * token at creation time.
 */

const Id = Type.String({ format: "uuid" });
const Timestamp = Type.String({ format: "date-time" });
const Revision = Type.Integer({ minimum: 1 });
const IdempotencyKey = Type.String({ minLength: 8, maxLength: 128 });

export const MCP_CONNECTION_STATUSES = [
  "disconnected",
  "verified",
  "failed",
  "unauthorized",
] as const;

export const MCP_CONNECTION_ERROR_CODES = [
  "MCP_ENDPOINT_REJECTED",
  "MCP_DNS_UNAVAILABLE",
  "MCP_REDIRECT_REFUSED",
  "MCP_TIMEOUT",
  "MCP_RESPONSE_TOO_LARGE",
  "MCP_RESPONSE_INVALID",
  "MCP_HANDSHAKE_FAILED",
  "MCP_PROTOCOL_UNSUPPORTED",
  "MCP_REQUIRES_AUTH",
  "MCP_UNAUTHORIZED",
  "MCP_CREDENTIAL_UNAVAILABLE",
  "MCP_TOO_MANY_TOOLS",
] as const;

export const MCP_CONNECTION_ERROR_CODE_SET = new Set<string>(
  MCP_CONNECTION_ERROR_CODES,
);

export const MCP_GRANT_SCOPES = [
  "workspace_metadata_read",
  "people_directory_read",
] as const;

export const MCP_GRANT_STATUSES = ["active", "revoked", "expired"] as const;

export const McpConnectionStatusSchema = Type.Union(
  MCP_CONNECTION_STATUSES.map((status) => Type.Literal(status)),
);

export const McpConnectionErrorCodeSchema = Type.Union([
  ...MCP_CONNECTION_ERROR_CODES.map((code) => Type.Literal(code)),
  Type.Null(),
]);

export const McpDiscoveredToolSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.String({ maxLength: 2_000 }),
    read_only: Type.Boolean(),
    /**
     * The original discovered input schema, retained as bounded inert JSON
     * text. It drives exact-argument validation and accessible forms; it is
     * never remote instructions and never grants authority.
     */
    input_schema: Type.Union([
      Type.String({ minLength: 1, maxLength: 20_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const McpConnectionSchema = Type.Object(
  {
    id: Id,
    friendly_name: Type.String({ minLength: 1, maxLength: 80 }),
    server_url: Type.String({ minLength: 1, maxLength: 2_048 }),
    credential_configured: Type.Boolean(),
    auth_mode: McpAuthModeSchema,
    /** True when a Nango-mediated OAuth connection is bound. */
    oauth_connected: Type.Boolean(),
    status: McpConnectionStatusSchema,
    last_checked_at: Type.Union([Timestamp, Type.Null()]),
    last_error_code: McpConnectionErrorCodeSchema,
    last_error_message: Type.Union([
      Type.String({ minLength: 1, maxLength: 240 }),
      Type.Null(),
    ]),
    tools: Type.Array(McpDiscoveredToolSchema, { maxItems: 100 }),
    tools_count: Type.Integer({ minimum: 0, maximum: 100 }),
    revision: Revision,
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);

export const McpConnectionListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    connections: Type.Array(McpConnectionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export const McpConnectionCreateRequestSchema = Type.Object(
  {
    bearer_secret: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 4_096 }), Type.Null()]),
    ),
    friendly_name: Type.String({ minLength: 1, maxLength: 80 }),
    idempotency_key: IdempotencyKey,
    server_url: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
);

export const McpConnectionUpdateRequestSchema = Type.Object(
  {
    bearer_secret: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 4_096 }), Type.Null()]),
    ),
    expected_revision: Revision,
    friendly_name: Type.String({ minLength: 1, maxLength: 80 }),
    idempotency_key: IdempotencyKey,
    server_url: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
);

export const McpConnectionActionRequestSchema = Type.Object(
  {
    expected_revision: Revision,
    idempotency_key: IdempotencyKey,
  },
  { additionalProperties: false },
);

export const McpConnectionResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    connection: McpConnectionSchema,
  },
  { additionalProperties: false },
);

export const McpGrantScopeSchema = Type.Union(
  MCP_GRANT_SCOPES.map((scope) => Type.Literal(scope)),
);

export const McpGrantStatusSchema = Type.Union(
  MCP_GRANT_STATUSES.map((status) => Type.Literal(status)),
);

export const McpClientGrantSchema = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1, maxLength: 80 }),
    scopes: Type.Array(McpGrantScopeSchema, {
      minItems: 1,
      maxItems: MCP_GRANT_SCOPES.length,
    }),
    token_hint: Type.String({ minLength: 4, maxLength: 32 }),
    status: McpGrantStatusSchema,
    expires_at: Timestamp,
    revoked_at: Type.Union([Timestamp, Type.Null()]),
    last_used_at: Type.Union([Timestamp, Type.Null()]),
    revision: Revision,
    created_at: Timestamp,
  },
  { additionalProperties: false },
);

export const McpClientGrantListResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    grants: Type.Array(McpClientGrantSchema, { maxItems: 200 }),
  },
  { additionalProperties: false },
);

export const McpClientGrantCreateRequestSchema = Type.Object(
  {
    expires_in_days: Type.Integer({ minimum: 1, maximum: 30 }),
    idempotency_key: IdempotencyKey,
    name: Type.String({ minLength: 1, maxLength: 80 }),
    scopes: Type.Array(McpGrantScopeSchema, {
      minItems: 1,
      maxItems: MCP_GRANT_SCOPES.length,
    }),
  },
  { additionalProperties: false },
);

export const McpClientGrantRevokeRequestSchema = Type.Object(
  {
    expected_revision: Revision,
    idempotency_key: IdempotencyKey,
  },
  { additionalProperties: false },
);

export const McpEndpointDescriptorSchema = Type.Object(
  {
    authorization_scheme: Type.Literal("Bearer"),
    configuration_json: Type.String({ minLength: 1, maxLength: 4_000 }),
    streamable_http_url: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
);

export const McpClientGrantCreateResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    endpoint: McpEndpointDescriptorSchema,
    grant: McpClientGrantSchema,
    // One-time reveal. Never persisted or logged by the client.
    token: Type.String({ minLength: 20, maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const McpClientGrantResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    grant: McpClientGrantSchema,
  },
  { additionalProperties: false },
);

export const McpEndpointsResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    authorization_scheme: Type.Union([Type.Literal("Bearer"), Type.Null()]),
    configured: Type.Boolean(),
    note: Type.String({ minLength: 1, maxLength: 400 }),
    public_origin: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_048 }),
      Type.Null(),
    ]),
    streamable_http_url: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_048 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export type McpConnection = Static<typeof McpConnectionSchema>;
export type McpConnectionCreateRequest = Static<
  typeof McpConnectionCreateRequestSchema
>;
export type McpConnectionUpdateRequest = Static<
  typeof McpConnectionUpdateRequestSchema
>;
export type McpConnectionActionRequest = Static<
  typeof McpConnectionActionRequestSchema
>;
export type McpConnectionListResponse = Static<
  typeof McpConnectionListResponseSchema
>;
export type McpConnectionResponse = Static<typeof McpConnectionResponseSchema>;
export type McpClientGrant = Static<typeof McpClientGrantSchema>;
export type McpClientGrantListResponse = Static<
  typeof McpClientGrantListResponseSchema
>;
export type McpClientGrantCreateRequest = Static<
  typeof McpClientGrantCreateRequestSchema
>;
export type McpClientGrantRevokeRequest = Static<
  typeof McpClientGrantRevokeRequestSchema
>;
export type McpClientGrantCreateResponse = Static<
  typeof McpClientGrantCreateResponseSchema
>;
export type McpClientGrantResponse = Static<
  typeof McpClientGrantResponseSchema
>;
export type McpEndpointsResponse = Static<typeof McpEndpointsResponseSchema>;
export type McpGrantScope = (typeof MCP_GRANT_SCOPES)[number];
export type McpConnectionStatus = (typeof MCP_CONNECTION_STATUSES)[number];
export type McpConnectionErrorCode =
  (typeof MCP_CONNECTION_ERROR_CODES)[number];
