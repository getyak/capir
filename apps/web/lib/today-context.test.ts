import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type TimeActivity, type TimeActivityListResponse } from "@talent-signal/contracts";
import { formatTodayArrangement, projectTodaySchedules, projectTodayUnread, todayScope } from "./today-context";

const now = new Date("2026-10-18T02:00:00Z");
const scope = { from: "2026-10-18", to: "2026-10-25", time_zone: "Asia/Shanghai", kind: "schedule" as const };
const sourceId = "00000000-0000-4000-8000-000000000001";
describe("arrangement interval labels", () => {
  it("names both local dates for an overnight arrangement", () => {
    expect(formatTodayArrangement(arrangement({ occurred_at: "2026-10-18T15:00:00Z", ends_at: "2026-10-18T17:00:00Z" })))
      .toBe("2026年10月18日 · 23:00 – 2026年10月19日 · 01:00");
  });
  it("shows a multi-day all-day span without counting its exclusive end date", () => {
    expect(formatTodayArrangement(arrangement({ occurred_at: "2026-10-17T16:00:00Z", ends_at: "2026-10-20T16:00:00Z", all_day: true })))
      .toBe("2026年10月18日 – 2026年10月20日 · 全天");
    expect(formatTodayArrangement(arrangement({ occurred_at: "2026-10-17T16:00:00Z", ends_at: "2026-10-18T16:00:00Z", all_day: true })))
      .toBe("2026年10月18日 · 全天");
  });
});
function arrangement(patch: Partial<TimeActivity> = {}): TimeActivity {
  return { id: `schedule:${sourceId}`, kind: "schedule", source_id: sourceId, source_revision: 2,
    title: "已确认的内部安排", summary: "用户填写", occurred_at: "2026-10-18T03:00:00Z",
    recorded_at: "2026-10-17T03:00:00Z", ends_at: "2026-10-18T04:00:00Z",
    local_day: "2026-10-18", time_zone: "Asia/Shanghai", all_day: false,
    person_id: null, person_label: null, relationship_context_id: null, context_label: null,
    session_id: null, status: "planned", authority: "user_authored", external_effect: "none", ...patch };
}
function page(activities: TimeActivity[] = [], patch: Partial<TimeActivityListResponse> = {}): TimeActivityListResponse {
  return { contract_version: CONTRACT_VERSION, scope, activities, complete: true, next_cursor: null,
    snapshot_at: now.toISOString(), coverage_note: "当前范围", ...patch };
}
const session = { session_id: sourceId, revision: 2, state: "active", title: "待继续核对的线索",
  updated_at: "2026-10-18T01:30:00Z", expires_at: "2026-10-19T00:00:00Z", turn_count: 2, is_unread: true };
const directory = (sessions: unknown[] = [session], patch: Record<string, unknown> = {}) =>
  ({ sessions, session_version: "current", complete: true, next_cursor: null, ...patch });

describe("Today local-date scope", () => {
  it("uses the user's date and seven calendar dates rather than UTC or seven 24-hour durations", () => {
    expect(todayScope(new Date("2026-03-08T07:30:00Z"), "America/Los_Angeles")).toEqual({
      from: "2026-03-07", to: "2026-03-14", time_zone: "America/Los_Angeles", kind: "schedule" });
    expect(todayScope(new Date("2026-10-17T16:01:00Z"), "Asia/Shanghai")).toEqual(scope);
  });
  it("rejects an invalid clock or zone instead of inventing today's date", () => {
    expect(() => todayScope(new Date(NaN), "UTC")).toThrow();
    expect(() => todayScope(now, "invalid/zone")).toThrow();
  });
});

describe("Today arrangements preserve canonical authority", () => {
  it("selects the next real arrangement and retains source identity and revision", () => {
    const next = arrangement();
    expect(projectTodaySchedules([page([arrangement({ source_id: "00000000-0000-4000-8000-000000000002", occurred_at: "2026-10-19T03:00:00Z", ends_at: "2026-10-19T04:00:00Z" }), next])], scope, now))
      .toMatchObject({ item: next, coverage: "complete" });
  });
  it.each(["cancelled", "completed", "needs_review"] as const)("excludes %s from planned arrangements", status => {
    expect(projectTodaySchedules([page([arrangement({ status })])], scope, now).item).toBeNull();
  });
  it.each(["unconfirmed", "system_record"] as const)("does not upgrade %s activity into a user arrangement", authority => {
    expect(projectTodaySchedules([page([arrangement({ authority })])], scope, now).item).toBeNull();
  });
  it("retains ongoing and all-day arrangements but excludes elapsed intervals", () => {
    const ongoing = arrangement({ occurred_at: "2026-10-18T01:00:00Z" });
    expect(projectTodaySchedules([page([ongoing])], scope, now).item).toEqual(ongoing);
    const allDay = arrangement({ occurred_at: "2026-10-17T16:00:00Z", ends_at: "2026-10-18T16:00:00Z", all_day: true });
    expect(projectTodaySchedules([page([allDay])], scope, now).item).toEqual(allDay);
    expect(projectTodaySchedules([page([arrangement({ ends_at: now.toISOString(), occurred_at: "2026-10-18T01:00:00Z" })])], scope, now).item).toBeNull();
  });
  it("keeps an incomplete bounded read distinct from a verified empty range", () => {
    expect(projectTodaySchedules([page([], { complete: false, next_cursor: "next" })], scope, now)).toMatchObject({ item: null, coverage: "partial" });
    expect(projectTodaySchedules([page()], scope, now)).toMatchObject({ item: null, coverage: "complete" });
    expect(projectTodaySchedules([], scope, now).coverage).toBe("unavailable");
  });
  it("rejects changed scope, malformed payloads and inconsistent pagination", () => {
    expect(projectTodaySchedules([page([], { scope: { ...scope, time_zone: "UTC" } })], scope, now).coverage).toBe("unavailable");
    expect(projectTodaySchedules([{ ...page(), activities: [{}] }], scope, now).coverage).toBe("unavailable");
    expect(projectTodaySchedules([page([], { complete: true, next_cursor: "next" })], scope, now).coverage).toBe("unavailable");
    expect(projectTodaySchedules([page([], { complete: false, next_cursor: "same" }), page([], { complete: false, next_cursor: "same" })], scope, now).coverage).toBe("unavailable");
    expect(projectTodaySchedules(Array.from({ length: 4 }, () => page()), scope, now).coverage).toBe("unavailable");
  });
  it("uses the newest revision so a later cancellation removes an earlier planned row", () => {
    const first = page([arrangement()], { complete: false, next_cursor: "second" });
    expect(projectTodaySchedules([first, page([arrangement({ source_revision: 3, status: "cancelled" })])], scope, now))
      .toMatchObject({ item: null, coverage: "complete" });
  });
});

describe("Today one unread continuation", () => {
  it("renders only the newest active unread metadata row, retaining scope identity", () => {
    const older = { ...session, session_id: "00000000-0000-4000-8000-000000000002", updated_at: "2026-10-17T00:00:00Z" };
    expect(projectTodayUnread(directory([older, session]), "current", now)).toMatchObject({ item: { id: sourceId, title: session.title, unread: true }, coverage: "complete" });
  });
  it("excludes read, expired and deleted sessions without changing read status", () => {
    const payload = directory([{ ...session, is_unread: false }, { ...session, expires_at: now.toISOString() }, { ...session, state: "deleted" }]);
    const before = structuredClone(payload);
    expect(projectTodayUnread(payload, "current", now)).toMatchObject({ item: null, coverage: "complete" });
    expect(payload).toEqual(before);
  });
  it("never reveals titles after identity changes or malformed metadata", () => {
    expect(projectTodayUnread(directory(), "other", now)).toMatchObject({ item: null, coverage: "unavailable" });
    expect(projectTodayUnread(directory([{ ...session, is_unread: "true" }]), "current", now)).toMatchObject({ item: null, coverage: "unavailable" });
    expect(projectTodayUnread(directory([{ ...session, updated_at: "invalid" }]), "current", now).coverage).toBe("unavailable");
  });
  it("does not turn the first directory page into a global unread count or empty claim", () => {
    expect(projectTodayUnread(directory([], { complete: false, next_cursor: "next" }), "current", now)).toMatchObject({ item: null, coverage: "partial" });
    expect(projectTodayUnread({ sessions: [], session_version: "current" }, "current", now).coverage).toBe("unavailable");
  });
});
