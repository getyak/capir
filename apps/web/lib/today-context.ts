import { TimeActivityListResponseSchema, type LocaleTag, type TimeActivity, type TimeActivityListResponse, type TimeScope } from "@talent-signal/contracts";
import { recentSessionRows, type RecentSession } from "./workspace-recent-sessions";
import { addDays, dateInZone, formatDay, formatTime, validTimeZone } from "./time-workspace";
import { translate } from "./i18n";
import { matchesTypeBox } from "./typebox-validation";

export type TodayProjection<T> = { item: T | null; coverage: "complete" | "partial" | "unavailable" };
const unavailable = <T>(): TodayProjection<T> => ({ item: null, coverage: "unavailable" });
export function todayScope(now: Date, timeZone: string): TimeScope {
  if (!Number.isFinite(now.getTime()) || !validTimeZone(timeZone)) throw new Error("Invalid local clock");
  const from = dateInZone(now, timeZone);
  return { from, to: addDays(from, 7), time_zone: timeZone, kind: "schedule" };
}

/** All-day end instants are exclusive; overnight labels retain both dates. */
export function formatTodayArrangement(row: TimeActivity, locale: LocaleTag = "zh-CN"): string {
  const zone = row.time_zone;
  const startDay = dateInZone(row.occurred_at, zone);
  const day = (value: string) => formatDay(value, { year: "numeric", month: "long", day: "numeric" }, locale);
  if (row.all_day) {
    const lastDay = dateInZone(new Date(Date.parse(row.ends_at!) - 1), zone);
    return `${day(startDay)}${lastDay === startDay ? "" : ` – ${day(lastDay)}`} · ${translate(locale, "全天")}`;
  }
  const endDay = dateInZone(row.ends_at!, zone);
  return `${day(startDay)} · ${formatTime(row.occurred_at, zone, locale)} – ${endDay === startDay ? "" : `${day(endDay)} · `}${formatTime(row.ends_at!, zone, locale)}`;
}
function sameScope(a: TimeScope, b: TimeScope) {
  return a.from === b.from && a.to === b.to && a.time_zone === b.time_zone && a.person_id === b.person_id && a.kind === b.kind;
}

/** At most three bounded pages; incomplete coverage never means an empty week. */
export function projectTodaySchedules(pages: unknown[], scope: TimeScope, now: Date): TodayProjection<TimeActivity> {
  if (!pages.length || pages.length > 3 || !Number.isFinite(now.getTime()) || !validTimeZone(scope.time_zone)) return unavailable();
  const records = new Map<string, TimeActivity>();
  const cursors = new Set<string>();
  let complete = false;
  for (const input of pages) {
    if (complete || !matchesTypeBox(TimeActivityListResponseSchema, input)) return unavailable();
    const page = input as TimeActivityListResponse;
    if (!sameScope(page.scope, scope) || page.complete !== (page.next_cursor === null)) return unavailable();
    if (page.next_cursor) {
      if (cursors.has(page.next_cursor)) return unavailable();
      cursors.add(page.next_cursor);
    }
    complete = page.complete;
    for (const row of page.activities) {
      if (!validTimeZone(row.time_zone)) return unavailable();
      const previous = records.get(row.source_id);
      if (!previous || previous.source_revision < row.source_revision) records.set(row.source_id, row);
    }
  }
  const item = [...records.values()].filter(row => row.kind === "schedule" && row.authority === "user_authored" &&
    row.status === "planned" && row.ends_at && Date.parse(row.ends_at) > now.getTime() &&
    Date.parse(row.ends_at) > Date.parse(row.occurred_at) && dateInZone(row.occurred_at, scope.time_zone) < scope.to &&
    dateInZone(row.ends_at, scope.time_zone) >= scope.from)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.source_id.localeCompare(b.source_id))[0] ?? null;
  return { item, coverage: complete ? "complete" : "partial" };
}

type SessionMetadata = { session_id: string; updated_at: string; expires_at: string; title: string; state: string; is_unread: boolean; revision: number; turn_count: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function validMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== "object") return false;
  const row = value as SessionMetadata;
  return typeof row.session_id === "string" && uuid.test(row.session_id) && typeof row.title === "string" &&
    typeof row.is_unread === "boolean" && typeof row.state === "string" &&
    typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) &&
    typeof row.expires_at === "string" && Number.isFinite(Date.parse(row.expires_at)) &&
    Number.isInteger(row.revision) && row.revision >= 1 && Number.isInteger(row.turn_count) && row.turn_count >= 0;
}
/** Metadata only: no message body read, mark-read mutation, or global count. */
export function projectTodayUnread(payload: unknown, binding: string, now: Date): TodayProjection<RecentSession> {
  if (!payload || typeof payload !== "object" || !binding || !Number.isFinite(now.getTime())) return unavailable();
  const page = payload as { sessions?: unknown; session_version?: unknown; complete?: unknown; next_cursor?: unknown };
  if (page.session_version !== binding || !Array.isArray(page.sessions) || page.sessions.length > 200 ||
    typeof page.complete !== "boolean" || page.complete !== (page.next_cursor === null) ||
    (!page.complete && (typeof page.next_cursor !== "string" || !page.next_cursor.length)) ||
    !page.sessions.every(validMetadata)) return unavailable();
  const ordered = [...page.sessions].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.session_id.localeCompare(b.session_id));
  const rows = recentSessionRows({ ...page, sessions: ordered }, binding, now.getTime(), 200);
  return { item: rows?.find(row => row.unread) ?? null, coverage: page.complete ? "complete" : "partial" };
}
