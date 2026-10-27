import type { LocaleTag, TimeActivity, TimeActivityKind, TimeScope } from "@talent-signal/contracts";
import { translate } from "./i18n";
import { validMeetingDay } from "./meeting-calendar";

export type TimeView = "timeline" | "week" | "month";
export type TimeRange = "day" | "week" | "month" | "past7" | "next30" | "custom";
export type TimePerson = { id: string; label: string; context: string; contextId: string | null };
export const TIME_KINDS: Record<TimeActivityKind, string> = {
  person_created: "联系人", session_activity: "对话", meeting_draft: "会议草稿", schedule: "安排", public_source_update: "公开来源",
};
export const TIME_STATUSES: Record<TimeActivity["status"], string> = {
  recorded: "已记录", needs_review: "待核对", planned: "内部安排", completed: "已记录结果", cancelled: "已取消",
};
/** Exact database-owned summaries from 074/099; authored summaries stay intact. */
export function timeActivitySummary(activity: TimeActivity, locale: LocaleTag): string {
  if (activity.kind === "person_created" && activity.summary === "新建人物") return translate(locale, "新建人物");
  if (activity.kind === "meeting_draft" && activity.summary === "未经确认的日程草稿") return translate(locale, "未经确认的日程草稿");
  if (activity.kind === "public_source_update" && activity.summary === "定时公开来源读取产生新的拟议依据，等待你审阅。") return translate(locale, "定时公开来源读取产生新的拟议依据，等待你审阅。");
  const count = activity.kind === "session_activity" ? /^(\d+) 条当日会话记录$/u.exec(activity.summary) : null;
  return count ? translate(locale, "{count} 条当日会话记录", { count: count[1]! }) : activity.summary;
}
const TIME_COVERAGE_NOTE = "会话活动仅覆盖保留期内的会话（最多 30 天）。设备日历与其他应用不会被导入；此处显示的日程均在 capri 内创建。";
/** Exact system templates from timeWorkspaceShared and timeReview, never model prose. */
export function timeCoverageNote(note: string, locale: LocaleTag): string {
  if (note === TIME_COVERAGE_NOTE) return translate(locale, TIME_COVERAGE_NOTE);
  if (note.endsWith(TIME_COVERAGE_NOTE)) {
    const prefix = note.slice(0, -TIME_COVERAGE_NOTE.length);
    const match = /^本次仅回顾该范围内前 (\d+) 条活动；受记录数量或上下文长度限制，范围不完整。$/u.exec(prefix);
    if (match) return `${translate(locale, "本次仅回顾该范围内前 {count} 条活动；受记录数量或上下文长度限制，范围不完整。", { count: match[1]! })}${locale === "zh-CN" || locale === "zh-TW" || locale === "ja" ? "" : " "}${translate(locale, TIME_COVERAGE_NOTE)}`;
  }
  return note;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value.length <= 100; }
  catch { return false; }
}
export function dateInZone(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map((part) => parts.find((p) => p.type === part)!.value).join("-");
}
/** Calendar arithmetic, deliberately independent of timezone and DST. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function weekStart(day: string): string {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function adjacentMonth(day: string, delta: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}
export function rangeBounds(day: string, range: Exclude<TimeRange, "custom">): { from: string; to: string } {
  if (range === "past7") return { from: addDays(day, -6), to: addDays(day, 1) };
  if (range === "next30") return { from: day, to: addDays(day, 30) };
  if (range === "week") { const from = weekStart(day); return { from, to: addDays(from, 7) }; }
  if (range === "month") return { from: `${day.slice(0, 7)}-01`, to: adjacentMonth(day, 1) };
  return { from: day, to: addDays(day, 1) };
}
export function monthDays(day: string): string[] {
  const start = weekStart(`${day.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", weekday: "long" }, locale: LocaleTag = "zh-CN") {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
export function formatTime(value: string, zone: string, locale: LocaleTag = "zh-CN") {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
export function parseTimeLocation(query: URLSearchParams, defaultZone: string, today: Date = new Date()) {
  const zone = query.get("tz") ?? defaultZone;
  const timeZone = validTimeZone(zone) ? zone : defaultZone;
  const day = validMeetingDay(query.get("day") ?? undefined) ?? dateInZone(today, timeZone);
  const view: TimeView = query.get("view") === "week" ? "week" : query.get("view") === "month" ? "month" : "timeline";
  const requestedRange = query.get("range");
  const range: TimeRange = view !== "timeline" ? view : ["day", "week", "month", "past7", "next30", "custom"].includes(requestedRange ?? "")
    ? requestedRange as TimeRange : view === "timeline" ? "day" : view;
  let bounds = rangeBounds(day, range === "custom" ? "day" : range);
  if (range === "custom") {
    const from = validMeetingDay(query.get("from") ?? undefined), to = validMeetingDay(query.get("to") ?? undefined);
    if (from && to && to > from && (Date.parse(to) - Date.parse(from)) <= 93 * 86400000) bounds = { from, to };
  }
  const personId = UUID.test(query.get("person") ?? "") ? query.get("person")! : "";
  const rawKind = query.get("kind") ?? "";
  const kind: TimeActivityKind | "" = Object.hasOwn(TIME_KINDS, rawKind) ? rawKind as TimeActivityKind : "";
  const scope: TimeScope = { ...bounds, time_zone: timeZone, ...(personId ? { person_id: personId } : {}), ...(kind ? { kind } : {}) };
  return { day, view, range, timeZone, personId, kind, scope,
    selected: (query.get("item") ?? "").slice(0, 150),
    draft: UUID.test(query.get("draft") ?? "") ? query.get("draft")! : null };
}
export function timeHref(query: URLSearchParams, patch: Record<string, string | null>): string {
  const result = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") result.delete(key); else result.set(key, value);
  }
  return `/workspace/meetings${result.size ? `?${result}` : ""}`;
}
export function activityHref(activity: TimeActivity): string | null {
  if (activity.kind === "session_activity") return `/workspace/sessions/${encodeURIComponent(activity.source_id)}`;
  if (activity.kind === "meeting_draft") return `/workspace/meetings?draft=${encodeURIComponent(activity.source_id)}`;
  if (activity.person_id && activity.relationship_context_id) return `/workspace?surface=desk&person=${encodeURIComponent(activity.person_id)}&context=${encodeURIComponent(activity.relationship_context_id)}`;
  // A label search cannot preserve identity when names collide.
  // Unassigned people remain inspectable here until a current context exists.
  return null;
}
export function mergeTimePages(existing: TimeActivity[], next: TimeActivity[]): TimeActivity[] {
  const records = new Map(existing.map((item) => [item.id, item]));
  for (const item of next) records.set(item.id, item);
  return [...records.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
}
/** Event layout clips to a visible day; point activities never occupy time. */
export function scheduleSegments(activities: TimeActivity[], day: string, zone: string) {
  const dayEnd = addDays(day, 1);
  const minuteOfDay = (timestamp: string) => {
    const [hour, minute] = formatTime(timestamp, zone).split(":").map(Number);
    return hour! * 60 + minute!;
  };
  const segments = activities.filter((a) => a.ends_at && !a.all_day && a.status !== "cancelled" &&
    dateInZone(a.occurred_at, zone) <= day && dateInZone(a.ends_at!, zone) >= day)
    .map((activity) => {
      const start = dateInZone(activity.occurred_at, zone) < day ? 0 : minuteOfDay(activity.occurred_at);
      const end = dateInZone(activity.ends_at!, zone) >= dayEnd ? 1440 : minuteOfDay(activity.ends_at!);
      return { activity, start, end, lane: 0, lanes: 1 };
    }).filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  // Overlapping groups share column count, so short overlapping meetings cannot hide each other.
  let group: typeof segments = [], end = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    const displayEnd = (segment: typeof segments[number]) => Math.max(segment.end, segment.start + 24);
    for (const segment of group) {
      let lane = laneEnds.findIndex((until) => until <= segment.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = displayEnd(segment); segment.lane = lane;
    }
    for (const segment of group) segment.lanes = laneEnds.length;
    group = [];
  };
  for (const segment of segments) {
    if (segment.start >= end) flush();
    group.push(segment); end = Math.max(group.length === 1 ? -1 : end, segment.end, segment.start + 24);
  }
  flush();
  return segments;
}
