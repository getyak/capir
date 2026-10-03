import type { TimeActivity, TimeActivityKind, TimeScope } from "@talent-signal/contracts";

import { ApiError } from "../lib/apiError.js";
import { digestValue } from "../lib/hash.js";

/**
 * Shared GET-24 time-workspace scope validation, cursor binding, and read-model
 * mapping. A query cursor is account/owner/scope bound and fails closed on an
 * unknown or mismatched value.
 */

export const MAX_ACTIVITY_PAGE = 100;
export const MAX_SNAPSHOT_ITEMS = 5_000;
export const MAX_SCOPE_DAYS = 93;
export const SNAPSHOT_TTL_MINUTES = 5;
export const TIME_SESSION_RETENTION_DAYS = 30;

export const TIME_COVERAGE_NOTE =
  "会话活动仅覆盖保留期内的会话（最多 30 天）。设备日历与其他应用不会被导入；此处显示的日程均在 capri 内创建。";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MICROSECONDS_PATTERN = /^(?:0|[1-9]\d{0,18})$/u;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function isValidCalendarDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 100 || /\s/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function invalidScope(code: string, message: string): never {
  throw new ApiError(400, code, message);
}

/** Validates and canonicalizes an already-structured scope object. */
export function assertTimeScope(scope: TimeScope): TimeScope {
  if (!isValidCalendarDay(scope.from) || !isValidCalendarDay(scope.to)) {
    invalidScope(
      "TIME_SCOPE_INVALID",
      "The time scope must use real YYYY-MM-DD calendar dates.",
    );
  }
  const fromMs = Date.parse(`${scope.from}T00:00:00.000Z`);
  const toMs = Date.parse(`${scope.to}T00:00:00.000Z`);
  const spanDays = Math.round((toMs - fromMs) / 86_400_000);
  if (spanDays < 1 || spanDays > MAX_SCOPE_DAYS) {
    invalidScope(
      "TIME_SCOPE_INVALID",
      `The time scope must span between 1 and ${MAX_SCOPE_DAYS} calendar days.`,
    );
  }
  if (!isValidTimeZone(scope.time_zone)) {
    invalidScope(
      "TIME_SCOPE_INVALID",
      "The time scope must use a valid IANA time zone.",
    );
  }
  return {
    from: scope.from,
    to: scope.to,
    time_zone: scope.time_zone,
    ...(scope.person_id ? { person_id: scope.person_id } : {}),
    ...(scope.kind ? { kind: scope.kind } : {}),
  };
}

export interface TimeScopeQuery {
  from: string;
  to: string;
  time_zone: string;
  person_id?: string | undefined;
  kind?: TimeActivityKind | undefined;
}

/** Validates raw querystring values into a canonical scope. */
export function assertQueryTimeScope(query: TimeScopeQuery): TimeScope {
  return assertTimeScope({
    from: query.from,
    to: query.to,
    time_zone: query.time_zone,
    ...(query.person_id ? { person_id: query.person_id } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
  });
}

export function timeScopeFingerprint(scope: TimeScope): string {
  return digestValue({
    from: scope.from,
    to: scope.to,
    time_zone: scope.time_zone,
    person_id: scope.person_id ?? null,
    kind: scope.kind ?? null,
  });
}

export interface TimeActivityCursor {
  v: 1;
  scope_fingerprint: string;
  snapshot_id: string;
  before_us: string | null;
  before_activity_id: string | null;
}

export function encodeTimeActivityCursor(cursor: TimeActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function invalidCursor(): never {
  throw new ApiError(
    400,
    "TIME_ACTIVITY_CURSOR_INVALID",
    "The activity snapshot cursor is invalid.",
  );
}

export function decodeTimeActivityCursor(value: string): TimeActivityCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<TimeActivityCursor>;
    if (
      parsed.v !== 1 ||
      typeof parsed.scope_fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(parsed.scope_fingerprint) ||
      !UUID_PATTERN.test(parsed.snapshot_id ?? "") ||
      (parsed.before_us === null) !== (parsed.before_activity_id === null) ||
      (parsed.before_us !== null &&
        (typeof parsed.before_us !== "string" ||
          !MICROSECONDS_PATTERN.test(parsed.before_us) ||
          BigInt(parsed.before_us) > POSTGRES_BIGINT_MAX)) ||
      (parsed.before_activity_id !== null &&
        (typeof parsed.before_activity_id !== "string" ||
          parsed.before_activity_id.length === 0 ||
          parsed.before_activity_id.length > 150))
    ) {
      invalidCursor();
    }
    return parsed as TimeActivityCursor;
  } catch {
    invalidCursor();
  }
}

export interface TimeActivityContentRow {
  activity_id: string;
  kind: TimeActivityKind;
  source_id: string;
  source_revision: number;
  title: string;
  summary: string;
  occurred_at: Date;
  recorded_at: Date;
  ends_at: Date | null;
  local_day: string;
  person_id: string | null;
  person_label: string | null;
  relationship_context_id: string | null;
  context_label: string | null;
  session_id: string | null;
  status: TimeActivity["status"];
  authority: TimeActivity["authority"];
  all_day: boolean;
}

const CONTENT_COLUMNS = `activity_id, kind, source_id, source_revision, title,
  summary, occurred_at, recorded_at, ends_at, local_day::text AS local_day,
  person_id, person_label, relationship_context_id, context_label, session_id,
  status, authority, all_day`;

export function timeActivityContentQuery(): string {
  return `SELECT ${CONTENT_COLUMNS}
    FROM time_activity_content($1,$2,$3::date,$4::date,$5,$6::uuid,$7::text,$8::uuid[])`;
}

export function timeActivityFromContentRow(
  row: TimeActivityContentRow,
  scope: TimeScope,
): TimeActivity {
  return {
    id: row.activity_id,
    kind: row.kind,
    source_id: row.source_id,
    source_revision: Number(row.source_revision),
    title: row.title.slice(0, 500),
    summary: row.summary.slice(0, 1000),
    occurred_at: row.occurred_at.toISOString(),
    recorded_at: row.recorded_at.toISOString(),
    ends_at: row.ends_at ? row.ends_at.toISOString() : null,
    local_day: row.local_day.slice(0, 10),
    time_zone: scope.time_zone,
    all_day: row.all_day,
    person_id: row.person_id,
    person_label: row.person_label?.slice(0, 200) ?? null,
    relationship_context_id: row.relationship_context_id,
    context_label: row.context_label?.slice(0, 300) ?? null,
    session_id: row.session_id,
    status: row.status,
    authority: row.authority,
    external_effect: "none",
  };
}

/** A content fingerprint used to reject a model result whose sources changed. */
export function timeActivityFingerprint(activities: readonly TimeActivity[]): string {
  return digestValue(
    activities,
  );
}
