import { Type, type Static } from "@sinclair/typebox";
import { CONTRACT_VERSION } from "./constants.js";

const obj = { additionalProperties: false } as const;
const id = Type.String({ format: "uuid" });
const stamp = Type.String({ format: "date-time" });
const day = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const nullableID = Type.Union([id, Type.Null()]);
const nullableText = (maxLength: number) => Type.Union([Type.String({ maxLength }), Type.Null()]);

export const TimeActivityKindSchema = Type.Union([
  Type.Literal("person_created"), Type.Literal("session_activity"),
  Type.Literal("meeting_draft"), Type.Literal("schedule"),
  Type.Literal("public_source_update"),
]);
export type TimeActivityKind = Static<typeof TimeActivityKindSchema>;

/** Local calendar dates, with an exclusive upper bound, in an explicit zone. */
export const TimeScopeSchema = Type.Object({
  from: day, to: day,
  time_zone: Type.String({ minLength: 1, maxLength: 100 }),
  person_id: Type.Optional(id),
  kind: Type.Optional(TimeActivityKindSchema),
}, obj);
export type TimeScope = Static<typeof TimeScopeSchema>;

/** Index metadata only. Session activity never establishes person facts. */
export const TimeActivitySchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 150 }),
  kind: TimeActivityKindSchema,
  source_id: id,
  source_revision: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  summary: Type.String({ maxLength: 1000 }),
  occurred_at: stamp,
  recorded_at: stamp,
  ends_at: Type.Union([stamp, Type.Null()]),
  local_day: day,
  time_zone: Type.String({ minLength: 1, maxLength: 100 }),
  all_day: Type.Boolean(),
  person_id: nullableID,
  person_label: nullableText(200),
  relationship_context_id: nullableID,
  context_label: nullableText(300),
  session_id: nullableID,
  status: Type.Union([
    Type.Literal("recorded"), Type.Literal("needs_review"),
    Type.Literal("planned"), Type.Literal("completed"), Type.Literal("cancelled"),
  ]),
  authority: Type.Union([
    Type.Literal("system_record"), Type.Literal("unconfirmed"), Type.Literal("user_authored"),
  ]),
  external_effect: Type.Literal("none"),
}, obj);
export type TimeActivity = Static<typeof TimeActivitySchema>;

export const TimeActivityListResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  scope: TimeScopeSchema,
  activities: Type.Array(TimeActivitySchema, { maxItems: 100 }),
  complete: Type.Boolean(),
  next_cursor: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  snapshot_at: stamp,
  coverage_note: Type.String({ maxLength: 500 }),
}, obj);
export type TimeActivityListResponse = Static<typeof TimeActivityListResponseSchema>;

export const TimeScheduleKindSchema = Type.Union([Type.Literal("meeting"), Type.Literal("reminder")]);
export const TimeScheduleStatusSchema = Type.Union([
  Type.Literal("planned"), Type.Literal("completed"),
  Type.Literal("cancelled"), Type.Literal("deleted"),
]);
export const TimeScheduleMutationRequestSchema = Type.Object({
  expected_revision: Type.Integer({ minimum: 0 }),
  idempotency_key: id,
  title: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
  note: Type.String({ maxLength: 2000 }),
  kind: TimeScheduleKindSchema,
  person_id: nullableID,
  starts_at: stamp, ends_at: stamp,
  time_zone: Type.String({ minLength: 1, maxLength: 100 }),
  all_day: Type.Boolean(),
  status: Type.Union([Type.Literal("planned"), Type.Literal("completed"), Type.Literal("cancelled")]),
  reminder_minutes: Type.Union([Type.Literal(0), Type.Literal(5), Type.Literal(15), Type.Literal(30), Type.Literal(60), Type.Null()]),
}, obj);
export type TimeScheduleMutationRequest = Static<typeof TimeScheduleMutationRequestSchema>;

export const TimeScheduleDeleteRequestSchema = Type.Object({
  expected_revision: Type.Integer({ minimum: 1 }), idempotency_key: id,
}, obj);
export type TimeScheduleDeleteRequest = Static<typeof TimeScheduleDeleteRequestSchema>;

/** Deleted records retain an identity-only receipt and cannot be exported. */
export const TimeScheduleRecordSchema = Type.Object({
  id, revision: Type.Integer({ minimum: 1 }), last_operation_id: id,
  created_at: stamp, updated_at: stamp,
  status: TimeScheduleStatusSchema,
  content_available: Type.Boolean(),
  title: nullableText(200), note: nullableText(2000),
  kind: Type.Union([TimeScheduleKindSchema, Type.Null()]),
  person_id: nullableID, person_label: nullableText(200),
  starts_at: Type.Union([stamp, Type.Null()]),
  ends_at: Type.Union([stamp, Type.Null()]),
  time_zone: nullableText(100),
  all_day: Type.Boolean(),
  reminder_minutes: Type.Union([Type.Integer({ minimum: 0, maximum: 60 }), Type.Null()]),
  authority: Type.Literal("user_authored"), external_effect: Type.Literal("none"),
}, obj);
export type TimeScheduleRecord = Static<typeof TimeScheduleRecordSchema>;
export const TimeScheduleResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION), schedule: TimeScheduleRecordSchema,
}, obj);
export type TimeScheduleResponse = Static<typeof TimeScheduleResponseSchema>;

export const TimeReviewRequestSchema = Type.Object({
  scope: TimeScopeSchema,
  objective: Type.String({ minLength: 1, maxLength: 1000, pattern: "\\S" }),
}, obj);
export type TimeReviewRequest = Static<typeof TimeReviewRequestSchema>;
/** Ephemeral review: no canonical fact, Memory mutation or external effect. */
export const TimeReviewResponseSchema = Type.Object({
  contract_version: Type.Literal(CONTRACT_VERSION),
  scope: TimeScopeSchema, generated_at: stamp,
  title: Type.String({ maxLength: 240 }), body: Type.String({ maxLength: 16000 }),
  sources: Type.Array(TimeActivitySchema, { maxItems: 100 }),
  complete: Type.Boolean(), coverage_note: Type.String({ maxLength: 500 }),
  authority: Type.Literal("unconfirmed"), external_effect: Type.Literal("none"),
}, obj);
export type TimeReviewResponse = Static<typeof TimeReviewResponseSchema>;
