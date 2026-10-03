import { Type, type Static } from "@sinclair/typebox";

import { CONTRACT_VERSION } from "./constants.js";

export const SystemHealthStatusSchema = Type.Union([
  Type.Literal("healthy"),
  Type.Literal("degraded"),
  Type.Literal("unavailable"),
  Type.Literal("unknown"),
]);

export const SystemHealthComponentSchema = Type.Object(
  {
    id: Type.Union([
      Type.Literal("web"),
      Type.Literal("backend"),
      Type.Literal("database"),
      Type.Literal("migrations"),
    ]),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    kind: Type.Union([
      Type.Literal("service"),
      Type.Literal("database"),
      Type.Literal("schema"),
    ]),
    required: Type.Boolean(),
    status: SystemHealthStatusSchema,
    duration_ms: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    detail_code: Type.Union([
      Type.Literal("request_completed"),
      Type.Literal("query_completed"),
      Type.Literal("required_migrations_applied"),
      Type.Literal("required_migrations_missing"),
      Type.Literal("dependency_unreachable"),
      Type.Literal("not_observed"),
    ]),
  },
  { additionalProperties: false },
);

/**
 * Deployment and receipt revisions are Git SHAs, so they are validated as
 * bounded hex rather than accepting arbitrary labels or dotted identifiers.
 */
export const GIT_REVISION_MIN_LENGTH = 7;
export const GIT_REVISION_MAX_LENGTH = 40;
export const GIT_REVISION_PATTERN = "^[0-9a-fA-F]{7,40}$";

export function isGitRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= GIT_REVISION_MIN_LENGTH &&
    value.length <= GIT_REVISION_MAX_LENGTH &&
    new RegExp(GIT_REVISION_PATTERN).test(value)
  );
}

export const SystemHealthResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    schema_version: Type.Literal("system-health.v1"),
    status: Type.Union([
      Type.Literal("healthy"),
      Type.Literal("degraded"),
      Type.Literal("unavailable"),
    ]),
    observed_at: Type.String({ format: "date-time" }),
    // Optional: an older backend simply omits it, and the UI must say unknown
    // rather than invent a release identity.
    backend_revision: Type.Optional(
      Type.String({
        minLength: GIT_REVISION_MIN_LENGTH,
        maxLength: GIT_REVISION_MAX_LENGTH,
        pattern: GIT_REVISION_PATTERN,
      }),
    ),
    components: Type.Array(SystemHealthComponentSchema, {
      minItems: 1,
      maxItems: 4,
    }),
  },
  { additionalProperties: false },
);

export type SystemHealthStatus = Static<typeof SystemHealthStatusSchema>;
export type SystemHealthComponent = Static<typeof SystemHealthComponentSchema>;
export type SystemHealthResponse = Static<typeof SystemHealthResponseSchema>;
