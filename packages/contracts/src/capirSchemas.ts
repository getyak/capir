import { Type, type Static } from "@sinclair/typebox";
import { LabWorkspaceSchema } from "./labWorkspaceSchemas.js";
import { SessionResponseSchema } from "./schemas.js";
const ID = Type.String({ format: "uuid" }),
  Time = Type.String({ format: "date-time" });
const Secret = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const Origin = Type.String({ minLength: 1, maxLength: 240 });
export const CAPIR_SCHEMA_VERSION = "capir.v1" as const;
export const CapirAuthorizationRequestSchema = Type.Object(
  {
    redirect_uri: Type.String({ maxLength: 240 }),
    state: Secret,
    code_challenge: Secret,
    code_challenge_method: Type.Literal("S256"),
    web_origin: Origin,
    backend_origin: Origin,
    consent: Type.Literal(true),
    client_label: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);
export const CapirAuthorizationResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    code: Secret,
    state: Secret,
    redirect_uri: Type.String(),
    expires_at: Time,
  },
  { additionalProperties: false },
);
export const CapirExchangeRequestSchema = Type.Object(
  {
    code: Secret,
    code_verifier: Type.String({ pattern: "^[A-Za-z0-9._~-]{43,128}$" }),
    state: Secret,
    redirect_uri: Type.String({ maxLength: 240 }),
    web_origin: Origin,
    backend_origin: Origin,
  },
  { additionalProperties: false },
);
export const CapirGrantSchema = Type.Object(
  {
    id: ID,
    client_label: Type.String(),
    expires_at: Time,
    scopes: Type.Array(Type.String()),
    refresh_supported: Type.Literal(false),
  },
  { additionalProperties: false },
);
export const CapirExchangeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    access_token: Secret,
    grant: CapirGrantSchema,
  },
  { additionalProperties: false },
);
export const CapirAuthStatusResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    grant: CapirGrantSchema,
  },
  { additionalProperties: false },
);
export const CapirScenarioSchema = Type.Object(
  {
    id: Type.Union([Type.Literal("daily"), Type.Literal("empty")]),
    version: Type.Literal("1"),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export const CapirSandboxRequestSchema = Type.Object(
  {
    id: ID,
    scenario_id: Type.Union([Type.Literal("daily"), Type.Literal("empty")]),
    scenario_version: Type.Literal("1"),
    scenario_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    duration_hours: Type.Union([
      Type.Literal(1),
      Type.Literal(4),
      Type.Literal(24),
    ]),
    member_role: Type.Literal("member"),
    model_policy: Type.Literal("strict_replay"),
  },
  { additionalProperties: false },
);
export const CapirSandboxSchema = Type.Object(
  {
    id: ID,
    state: Type.Union([
      Type.Literal("preparing"),
      Type.Literal("ready"),
      Type.Literal("failed"),
      Type.Literal("expired"),
      Type.Literal("deleting"),
      Type.Literal("cleanup_failed"),
      Type.Literal("deleted"),
    ]),
    generation: Type.Integer({ minimum: 1 }),
    scenario: CapirScenarioSchema,
    member_role: Type.Literal("member"),
    model_policy: Type.Literal("strict_replay"),
    expires_at: Time,
    entry_path: Type.String(),
    failure_code: Type.Union([Type.String(), Type.Null()]),
    workspace: Type.Union([LabWorkspaceSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const CapirSandboxResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    sandbox: CapirSandboxSchema,
  },
  { additionalProperties: false },
);
export const CapirOperationRequestSchema = Type.Object(
  { id: ID },
  { additionalProperties: false },
);
export const CapirHandoffResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    handoff_secret: Secret,
    expires_at: Time,
    entry_path: Type.String(),
  },
  { additionalProperties: false },
);
export const CapirHandoffExchangeRequestSchema = Type.Object(
  { handoff_secret: Secret, web_origin: Origin },
  { additionalProperties: false },
);
export const CapirHandoffExchangeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    session: SessionResponseSchema,
    entry_path: Type.String(),
  },
  { additionalProperties: false },
);
export type CapirAuthorizationRequest = Static<
  typeof CapirAuthorizationRequestSchema
>;
export type CapirExchangeRequest = Static<typeof CapirExchangeRequestSchema>;
export type CapirSandboxRequest = Static<typeof CapirSandboxRequestSchema>;
export type CapirSandbox = Static<typeof CapirSandboxSchema>;
export const CapirCapabilitiesResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_SCHEMA_VERSION),
    enabled: Type.Boolean(),
    max_active_sandboxes: Type.Literal(3),
    web_handoff_available: Type.Boolean(),
    scenarios: Type.Array(CapirScenarioSchema),
    model_policy: Type.Literal("strict_replay"),
    approved_recordings: Type.Array(Type.String(), { maxItems: 0 }),
    supported_tasks: Type.Array(Type.String()),
    unsupported: Type.Array(Type.String()),
    backend_origins: Type.Array(Origin),
    web_origins: Type.Array(Origin),
  },
  { additionalProperties: false },
);
export type CapirCapabilitiesResponse = Static<
  typeof CapirCapabilitiesResponseSchema
>;
export type CapirAuthorizationResponse = Static<
  typeof CapirAuthorizationResponseSchema
>;
export type CapirExchangeResponse = Static<typeof CapirExchangeResponseSchema>;
export type CapirAuthStatusResponse = Static<
  typeof CapirAuthStatusResponseSchema
>;
export type CapirSandboxResponse = Static<typeof CapirSandboxResponseSchema>;
export type CapirHandoffResponse = Static<typeof CapirHandoffResponseSchema>;
export type CapirHandoffExchangeResponse = Static<
  typeof CapirHandoffExchangeResponseSchema
>;
