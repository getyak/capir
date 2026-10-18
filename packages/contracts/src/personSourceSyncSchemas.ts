import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";

const obj = { additionalProperties: false } as const;
const id = Type.String({ format: "uuid" });
const stamp = Type.String({ format: "date-time" });
const nullableID = Type.Union([id, Type.Null()]);
const nullableText = (maxLength: number) =>
  Type.Union([Type.String({ maxLength }), Type.Null()]);

/** A real 86400-second UTC interval; the zone is display only. */
export const PERSON_SOURCE_SYNC_INTERVAL_SECONDS = 86_400;
/** Total automatic attempts per cycle including the first. */
export const PERSON_SOURCE_SYNC_ATTEMPT_LIMIT = 3;

export const PersonSourceSyncConfirmationSchema = Type.Literal(
  "periodic_public_source_re_read",
);
export type PersonSourceSyncConfirmation = Static<
  typeof PersonSourceSyncConfirmationSchema
>;

export const PersonSourceSyncStatusSchema = Type.Union([
  Type.Literal("active"), Type.Literal("paused"),
  Type.Literal("revoked"), Type.Literal("deleted"),
]);
export type PersonSourceSyncStatus = Static<typeof PersonSourceSyncStatusSchema>;

/** Derived live: expiry is honest and never silently revived. */
export const PersonSourceSyncEffectiveStateSchema = Type.Union([
  Type.Literal("active"), Type.Literal("paused"), Type.Literal("expired"),
  Type.Literal("revoked"), Type.Literal("deleted"),
]);
export type PersonSourceSyncEffectiveState = Static<
  typeof PersonSourceSyncEffectiveStateSchema
>;

export const PersonSourceSyncRunStatusSchema = Type.Union([
  Type.Literal("pending"), Type.Literal("running"),
  Type.Literal("completed"), Type.Literal("partial"),
  Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("unknown"),
]);
export type PersonSourceSyncRunStatus = Static<
  typeof PersonSourceSyncRunStatusSchema
>;

/** Fixed content-free diagnostics; raw exception or page text never persists. */
export const PersonSourceSyncWarningCodeSchema = Type.Union([
  Type.Literal("PUBLIC_RESEARCH_FETCH_FAILED"),
  Type.Literal("PUBLIC_RESEARCH_CAPTURE_FAILED"),
  Type.Literal("PUBLIC_RESEARCH_UNAVAILABLE"),
  Type.Literal("PUBLIC_RESEARCH_RETRY_FAILED"),
  Type.Literal("PERSON_SOURCE_SYNC_UNCHANGED"),
  Type.Literal("PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED"),
  Type.Literal("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED"),
  Type.Literal("PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION"),
  Type.Literal("PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED"),
]);
export type PersonSourceSyncWarningCode = Static<
  typeof PersonSourceSyncWarningCodeSchema
>;

export const PersonSourceSyncStopReasonSchema = Type.Union([
  Type.Literal("PERSON_SOURCE_SYNC_GRANT_PAUSED"),
  Type.Literal("PERSON_SOURCE_SYNC_GRANT_REVOKED"),
  Type.Literal("PERSON_SOURCE_SYNC_GRANT_EXPIRED"),
  Type.Literal("PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE"),
  Type.Literal("PERSON_SOURCE_SYNC_ACCOUNT_RETIRED"),
  Type.Literal("PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE"),
  Type.Literal("PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED"),
  Type.Literal("PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED"),
  Type.Literal("PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED"),
  Type.Literal("PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED"),
  Type.Literal("PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION"),
  Type.Literal("PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED"),
  Type.Literal("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED"),
  Type.Literal("PERSON_SOURCE_SYNC_LEASE_LOST"),
]);
export type PersonSourceSyncStopReason = Static<
  typeof PersonSourceSyncStopReasonSchema
>;

/** Immutable owner grant plus honest derived state and next run. */
export const PersonSourceSyncRecordSchema = Type.Object({
  id,
  revision: Type.Integer({ minimum: 1 }),
  last_operation_id: id,
  created_at: stamp,
  updated_at: stamp,
  status: PersonSourceSyncStatusSchema,
  effective_state: PersonSourceSyncEffectiveStateSchema,
  content_available: Type.Boolean(),
  person_id: nullableID,
  person_label: nullableText(200),
  relationship_context_id: nullableID,
  seed_resource_id: nullableID,
  source_url: nullableText(2_000),
  allowed_domain: nullableText(253),
  purpose: nullableText(500),
  time_zone: nullableText(100),
  interval_seconds: Type.Literal(PERSON_SOURCE_SYNC_INTERVAL_SECONDS),
  expires_at: Type.Union([stamp, Type.Null()]),
  next_due_at: Type.Union([stamp, Type.Null()]),
  authority: Type.Literal("user_authored"),
  external_effect: Type.Literal("none"),
}, obj);
export type PersonSourceSyncRecord = Static<typeof PersonSourceSyncRecordSchema>;

export const PersonSourceSyncResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  sync: PersonSourceSyncRecordSchema,
}, obj);
export type PersonSourceSyncResponse = Static<
  typeof PersonSourceSyncResponseSchema
>;

/** Bounded owner-scoped list keyed by exact person/context, never all-account. */
export const PersonSourceSyncListResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  syncs: Type.Array(PersonSourceSyncRecordSchema, { maxItems: 10 }),
}, obj);
export type PersonSourceSyncListResponse = Static<
  typeof PersonSourceSyncListResponseSchema
>;

/** One due cycle: honest observed outcome, never a fabricated success. */
export const PersonSourceSyncRunRecordSchema = Type.Object({
  id,
  grant_id: id,
  cycle_due_at: stamp,
  created_at: stamp,
  started_at: Type.Union([stamp, Type.Null()]),
  completed_at: Type.Union([stamp, Type.Null()]),
  status: PersonSourceSyncRunStatusSchema,
  settled: Type.Boolean(),
  attempt_count: Type.Integer({ minimum: 0, maximum: PERSON_SOURCE_SYNC_ATTEMPT_LIMIT }),
  attempt_limit: Type.Literal(PERSON_SOURCE_SYNC_ATTEMPT_LIMIT),
  deadline_at: stamp,
  task_id: nullableID,
  new_observations: Type.Integer({ minimum: 0, maximum: 1 }),
  content_available: Type.Boolean(),
  source_url: nullableText(2_000),
  observed_canonical_url: nullableText(2_000),
  warning_codes: Type.Array(PersonSourceSyncWarningCodeSchema, { maxItems: 20 }),
  stop_reason: Type.Union([PersonSourceSyncStopReasonSchema, Type.Null()]),
  authority: Type.Literal("unconfirmed"),
  external_effect: Type.Literal("none"),
}, obj);
export type PersonSourceSyncRunRecord = Static<
  typeof PersonSourceSyncRunRecordSchema
>;

export const PersonSourceSyncRunsResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  grant_id: id,
  runs: Type.Array(PersonSourceSyncRunRecordSchema, { maxItems: 20 }),
  complete: Type.Boolean(),
}, obj);
export type PersonSourceSyncRunsResponse = Static<
  typeof PersonSourceSyncRunsResponseSchema
>;

/**
 * The deliberate periodic confirmation, structurally distinct from the
 * one-shot research approval. The exact public URL, bound person/context,
 * honest 24h UTC interval, IANA display zone and required expiry are echoed
 * so the owner confirms exactly what will be re-read.
 */
export const PersonSourceSyncMutationRequestSchema = Type.Object({
  expected_revision: Type.Integer({ minimum: 0 }),
  idempotency_key: id,
  person_id: id,
  relationship_context_id: id,
  seed_resource_id: id,
  source_url: Type.String({ minLength: 1, maxLength: 2_000 }),
  time_zone: Type.String({ minLength: 1, maxLength: 100 }),
  interval_seconds: Type.Literal(PERSON_SOURCE_SYNC_INTERVAL_SECONDS),
  expires_at: stamp,
  status: Type.Union([Type.Literal("active"), Type.Literal("paused")]),
  confirmation: PersonSourceSyncConfirmationSchema,
}, obj);
export type PersonSourceSyncMutationRequest = Static<
  typeof PersonSourceSyncMutationRequestSchema
>;

export const PersonSourceSyncDeleteRequestSchema = Type.Object({
  expected_revision: Type.Integer({ minimum: 1 }),
  idempotency_key: id,
}, obj);
export type PersonSourceSyncDeleteRequest = Static<
  typeof PersonSourceSyncDeleteRequestSchema
>;

/** Exact person/context filters; an all-account list is never served. */
export const PersonSourceSyncListQuerySchema = Type.Object({
  person_id: id,
  relationship_context_id: id,
  seed_resource_id: Type.Optional(id),
}, obj);
export type PersonSourceSyncListQuery = Static<
  typeof PersonSourceSyncListQuerySchema
>;
