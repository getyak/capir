import { describe, expect, it } from "vitest";
import type { MeetingDraftRecord } from "@talent-signal/contracts";

import {
  adjacentMeetingMonth,
  defaultMeetingDay,
  meetingToday,
  meetingTodayHref,
  meetingCalendarDayLabel,
  meetingCalendarDays,
  meetingDraftCalendarValue,
  meetingDraftExpiryLabel,
  meetingDraftLocalDay,
  mergeMeetingDraftScopeSnapshots,
  validMeetingDay,
  validMeetingMonth,
} from "./meeting-calendar";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const draft: MeetingDraftRecord = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "needs_review",
  external_effect: "none",
  revision: 1,
  source_task_id: "20000000-0000-4000-8000-000000000002",
  origin_session_id: "30000000-0000-4000-8000-000000000003",
  created_at: "2026-09-16T00:00:00.000Z",
  updated_at: "2026-09-16T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  content_available: true,
  title: "与陈夏会谈",
  starts_at: "2026-09-16T01:30:00.000Z",
  ends_at: "2026-09-16T02:00:00.000Z",
  time_zone: "Asia/Shanghai",
  source_excerpt: "我们周三上午九点半聊。",
  reference_time: "2026-09-15T00:00:00.000Z",
  redacted_at: null,
  dismissed_at: null,
};

const redactedDraft: MeetingDraftRecord = {
  ...draft,
  status: "redacted",
  content_available: false,
  title: null,
  starts_at: null,
  ends_at: null,
  time_zone: null,
  source_excerpt: null,
  reference_time: null,
  redacted_at: "2026-09-16T00:01:00.000Z",
};

describe("meeting calendar projection", () => {
  // Live review/persistence, conflict and handoff source invariants. Draft
  // selection identity and state remount behavior are covered by real DOM
  // tests in components/time-meeting-inspector.test.ts.
  it("keeps live review persistence, conflict and handoff behavior in place", () => {
    const actionSource = readFileSync(
      resolve(import.meta.dirname, "../components/meeting-draft-actions.tsx"),
      "utf8",
    );
    expect(actionSource).toContain("从待核对中移除");
    expect(actionSource).toContain("内容仍随来源对话保留至");
    expect(actionSource).toContain("router.replace(returnHref)");
    expect(actionSource).toContain("router.refresh()");
    expect(actionSource).toContain("clearPendingMeetingDraftEdit");
    expect(actionSource).toContain("writePendingMeetingDraftDismiss");
    expect(actionSource).toContain("readPendingMeetingDraftDismiss");
    expect(actionSource).toContain("clearPendingMeetingDraftDismiss");
    const reviewSource = readFileSync(
      resolve(import.meta.dirname, "../components/calendar-draft-review.tsx"),
      "utf8",
    );
    expect(reviewSource).toContain('window.addEventListener("pagehide", flushOnExit)');
    expect(reviewSource).toContain('onBlur={() => void flushCurrent()}');
    expect(reviewSource).toContain("使用服务器版本");
    expect(reviewSource).toContain("重新应用我的编辑");
    expect(reviewSource).toContain("expected_revision: currentRevision.current");
    expect(reviewSource).toContain("writePendingMeetingDraftEdit");
    expect(reviewSource).toContain("readPendingMeetingDraftEdit");
    expect(reviewSource).toContain("onCompositionStart");
    expect(reviewSource).toContain("onCompositionEnd");
    expect(reviewSource).toContain("as InputEvent).isComposing");
    expect(reviewSource).toContain("[isComposing, setIsComposing]");
    expect(reviewSource).toContain("persistence: CalendarDraftPersistence");
    expect(reviewSource).toContain("重试保存");
    expect(reviewSource).toContain("void persist(reviewed)");
    expect(reviewSource).toContain("setTitle(current.title)");
    expect(reviewSource).toContain("setStart(canonicalStart)");
    expect(reviewSource).toContain("setEnd(canonicalEnd)");
    for (const legacySurface of [
      "../components/relationship-workspace/relationship-agent-panel.tsx",
      "../components/relationship-workspace/relationship-agent-start-panel.tsx",
    ]) {
      const legacySource = readFileSync(
        resolve(import.meta.dirname, legacySurface),
        "utf8",
      );
      expect(legacySource).not.toContain("CalendarDraftReview");
    }
    const scopedSource = readFileSync(
      resolve(import.meta.dirname, "../components/relationship-workspace/relationship-agent-panel.tsx"),
      "utf8",
    );
    expect(scopedSource).toContain('persistence="unbound"');
    // The extracted turn thread owns the session-bound handoff that both the
    // scoped desk and the default conversation canvas render.
    const sessionBoundSource = readFileSync(
      resolve(import.meta.dirname, "../components/relationship-workspace/agent-turn-thread.tsx"),
      "utf8",
    );
    expect(sessionBoundSource).toContain("MeetingDraftHandoff");
    expect(sessionBoundSource).toContain('persistence="persisted"');
    const handoffSource = readFileSync(
      resolve(import.meta.dirname, "../components/meeting-draft-handoff.tsx"),
      "utf8",
    );
    expect(handoffSource).toContain("/workspace/meetings?draft=");
    expect(handoffSource).toContain("当前页面不能直接导出");
    expect(handoffSource).toContain("未绑定可恢复的 Session");
    expect(handoffSource).toContain('persistence: "persisted" | "unbound"');
    const adapterSource = readFileSync(
      resolve(import.meta.dirname, "server/meetingDrafts.ts"),
      "utf8",
    );
    expect(adapterSource).toContain('"reviewable", 20');
    expect(adapterSource).toContain('"inactive", 1');
    expect(adapterSource).toContain("inactiveTruncated: inactive.truncated");
  });

  it("validates real dates rather than accepting shape-only values", () => {
    expect(validMeetingMonth("2026-09")).toBe("2026-09");
    expect(validMeetingMonth("2026-13")).toBeNull();
    expect(validMeetingDay("2026-09-16")).toBe("2026-09-16");
    expect(validMeetingDay("2026-02-31")).toBeNull();
  });

  it("groups the instant using the draft IANA timezone", () => {
    expect(meetingDraftLocalDay(draft)).toBe("2026-09-16");
    const days = meetingCalendarDays("2026-09", [draft]);
    expect(days).toHaveLength(42);
    expect(days.find((day) => day.date === "2026-09-16")?.draftCount).toBe(1);
  });

  it("turns only a current reviewable record back into an export draft", () => {
    expect(meetingDraftCalendarValue(draft)).toMatchObject({
      external_effect: "none",
      source_request_id: draft.source_task_id,
      status: "needs_review",
    });
    expect(meetingDraftCalendarValue(redactedDraft)).toBeNull();
  });

  it("lets the later inactive scope revoke a stale reviewable projection", () => {
    const transitioned = {
      ...draft,
      content_available: true as const,
      dismissed_at: "2026-09-16T00:01:00.000Z",
      revision: 2,
      status: "dismissed" as const,
    };
    expect(mergeMeetingDraftScopeSnapshots([draft], [transitioned])).toEqual([
      transitioned,
    ]);
  });

  it("moves across year boundaries deterministically", () => {
    expect(adjacentMeetingMonth("2026-12", 1)).toBe("2027-01");
    expect(adjacentMeetingMonth("2026-01", -1)).toBe("2025-12");
  });

  it("starts on the first active draft rather than an older dismissed date", () => {
    const dismissed: MeetingDraftRecord = {
      ...draft,
      content_available: true,
      dismissed_at: "2026-09-16T00:01:00.000Z",
      status: "dismissed",
    };
    const active = {
      ...draft,
      id: "10000000-0000-4000-8000-000000000004",
      starts_at: "2026-09-18T01:30:00.000Z",
      ends_at: "2026-09-18T02:00:00.000Z",
    };
    expect(defaultMeetingDay([dismissed, active])).toBe("2026-09-18");
    expect(defaultMeetingDay([dismissed])).toBeNull();
  });

  it("gives every calendar cell a complete, unique accessible date name", () => {
    expect(
      meetingCalendarDayLabel({
        date: "2026-09-16",
        draftCount: 2,
        inMonth: true,
      }),
    ).toContain("2026年9月16日星期三，2 份待核对草稿");
    expect(
      meetingCalendarDayLabel({
        date: "2026-08-31",
        draftCount: 0,
        inMonth: false,
      }),
    ).toContain("相邻月份，没有待核对草稿");
  });

  it("formats retention in the draft timezone without server-locale drift", () => {
    expect(
      meetingDraftExpiryLabel({
        ...draft,
        expires_at: "2026-09-16T16:30:00.000Z",
      }),
    ).toBe("2026年9月17日");
    expect(
      meetingDraftExpiryLabel(redactedDraft),
    ).toBe("原来源保留期结束");
  });
});

describe("today navigation", () => {
  it("uses device calendar components instead of slicing UTC", () => {
    const local = new Date(2026, 8, 20, 0, 2);
    expect(meetingToday(local)).toBe("2026-09-20");
    expect(meetingToday(new Date(2027, 0, 1))).toBe("2027-01-01");
  });
  it("navigates to a complete date and rejects impossible dates", () => {
    expect(meetingTodayHref("2026-09-20")).toBe("/workspace/meetings?month=2026-09&day=2026-09-20");
    expect(meetingTodayHref("2026-02-31")).toBe("/workspace/meetings");
  });
});
