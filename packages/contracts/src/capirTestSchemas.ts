import { Type, type Static } from "@sinclair/typebox";

import { SessionResponseSchema } from "./schemas.js";

/**
 * Operator-owned test-account provisioning (`capir test create`, Task 1).
 *
 * The backend receives the chosen or CLI-generated password once, stores only
 * its salted scrypt credential, and never echoes it. Run projections therefore
 * carry no password, bearer token or handoff secret.
 */

const ID = Type.String({ format: "uuid" });
const Time = Type.String({ format: "date-time" });
const Origin = Type.String({ minLength: 1, maxLength: 240 });
const Digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
/** 32 random bytes, base64url without padding (one-use handoff secrets). */
const Secret = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$", minLength: 43, maxLength: 43 });

export const CAPIR_TEST_SCHEMA_VERSION = "capir-test.v1" as const;

export const CapirTestPresetSchema = Type.Object(
  {
    id: Type.Union([Type.Literal("daily"), Type.Literal("empty")]),
    version: Type.String({ minLength: 1, maxLength: 32 }),
    digest: Digest,
  },
  { additionalProperties: false },
);

export const CapirTestCreateRequestSchema = Type.Object(
  {
    request_id: ID,
    // Omitted handles are generated uniquely per run. Email-shaped handles are
    // accepted only inside the reserved lab.invalid namespace.
    username: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    password: Type.String({ minLength: 8, maxLength: 128 }),
    preset: Type.Union([Type.Literal("daily"), Type.Literal("empty")]),
    duration_hours: Type.Union([Type.Literal(1), Type.Literal(4), Type.Literal(24)]),
    web_origin: Origin,
  },
  { additionalProperties: false },
);

export const CapirTestRunStateSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("expired"),
  Type.Literal("revoked"),
  Type.Literal("deleting"),
  Type.Literal("deleted"),
]);

export const CapirTestCleanupErrorSchema = Type.Union([
  Type.Literal("schema_changed"),
  Type.Literal("media_scope_changed"),
  Type.Literal("media_unsettled"),
  Type.Literal("media_cleanup_failed"),
  Type.Literal("data_cleanup_failed"),
  Type.Null(),
]);

export const CapirTestRunSchema = Type.Object(
  {
    id: ID,
    request_id: ID,
    account_id: ID,
    user_id: ID,
    username: Type.String(),
    email: Type.String(),
    preset: Type.Union([Type.Literal("daily"), Type.Literal("empty")]),
    preset_version: Type.String(),
    preset_digest: Digest,
    counts: Type.Object(
      {
        contacts: Type.Integer({ minimum: 0 }),
        observations: Type.Integer({ minimum: 0 }),
        tasks: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    state: CapirTestRunStateSchema,
    expires_at: Time,
    cleanup_error: CapirTestCleanupErrorSchema,
    login_url: Type.String(),
  },
  { additionalProperties: false },
);

export const CapirTestRunResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_TEST_SCHEMA_VERSION),
    run: CapirTestRunSchema,
  },
  { additionalProperties: false },
);

export const CapirTestStopRequestSchema = Type.Object(
  { request_id: ID },
  { additionalProperties: false },
);

export const CapirTestHandoffRequestSchema = Type.Object(
  { request_id: ID },
  { additionalProperties: false },
);

export const CapirTestHandoffResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_TEST_SCHEMA_VERSION),
    handoff_id: ID,
    // Disclosed exactly once to the authenticated provisioning caller; it is
    // never placed in a URL, log or public readback.
    handoff_secret: Secret,
    expires_at: Time,
    entry_path: Type.String(),
    run_id: ID,
  },
  { additionalProperties: false },
);

export const CapirTestHandoffExchangeRequestSchema = Type.Object(
  { handoff_secret: Secret, web_origin: Origin },
  { additionalProperties: false },
);

export const CapirTestHandoffExchangeResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_TEST_SCHEMA_VERSION),
    session: SessionResponseSchema,
    entry_path: Type.String(),
    run_id: ID,
  },
  { additionalProperties: false },
);

export const CapirTestCapabilitiesResponseSchema = Type.Object(
  {
    schema_version: Type.Literal(CAPIR_TEST_SCHEMA_VERSION),
    enabled: Type.Boolean(),
    presets: Type.Array(CapirTestPresetSchema),
    duration_hours: Type.Array(Type.Union([Type.Literal(1), Type.Literal(4), Type.Literal(24)])),
    max_active_runs: Type.Integer({ minimum: 0 }),
    web_handoff_available: Type.Boolean(),
    supported: Type.Array(Type.String()),
    unsupported: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type CapirTestPreset = Static<typeof CapirTestPresetSchema>;
export type CapirTestCreateRequest = Static<typeof CapirTestCreateRequestSchema>;
export type CapirTestRun = Static<typeof CapirTestRunSchema>;
export type CapirTestRunResponse = Static<typeof CapirTestRunResponseSchema>;
export type CapirTestStopRequest = Static<typeof CapirTestStopRequestSchema>;
export type CapirTestHandoffRequest = Static<typeof CapirTestHandoffRequestSchema>;
export type CapirTestHandoffResponse = Static<typeof CapirTestHandoffResponseSchema>;
export type CapirTestHandoffExchangeRequest = Static<typeof CapirTestHandoffExchangeRequestSchema>;
export type CapirTestHandoffExchangeResponse = Static<typeof CapirTestHandoffExchangeResponseSchema>;
export type CapirTestCapabilitiesResponse = Static<typeof CapirTestCapabilitiesResponseSchema>;
