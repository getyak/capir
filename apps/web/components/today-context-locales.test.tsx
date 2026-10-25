// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
import { TodayContext } from "./today-context";
const instant = new Date("2026-10-25T02:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
const arrangement = { id: `schedule:${id}`, kind: "schedule", source_id: id, source_revision: 1, title: "全天", summary: "用户记录的说明", occurred_at: "2026-10-24T16:00:00Z", recorded_at: "2026-10-23T00:00:00Z", ends_at: "2026-10-25T16:00:00Z", local_day: "2026-10-25", time_zone: "Asia/Shanghai", all_day: true, person_id: null, person_label: null, relationship_context_id: null, context_label: null, session_id: null, status: "planned", authority: "user_authored", external_effect: "none" };
let root: Root; let host: HTMLDivElement; const request = vi.fn();
function response(url: string, activities: unknown[] = [arrangement], unread = true) {
  if (url.startsWith("/api/time/activities")) { const q = new URL(url, "http://localhost").searchParams; return Response.json({ contract_version: CONTRACT_VERSION, scope: { from: q.get("from"), to: q.get("to"), time_zone: q.get("time_zone"), kind: "schedule" }, activities, complete: true, next_cursor: null, snapshot_at: instant.toISOString(), coverage_note: "来源覆盖原文", session_version: "current" }); }
  return Response.json({ session_version: "current", complete: true, next_cursor: null, sessions: unread ? [{ session_id: id, title: "用户中文原文", is_unread: true, state: "active", updated_at: instant.toISOString(), expires_at: "2030-01-01T00:00:00Z", revision: 1, turn_count: 1 }] : [] });
}
async function mount(locale: LocaleTag) { await act(async () => { root.render(<LocaleProvider locale={locale}><TodayContext binding="current" /></LocaleProvider>); for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(instant); vi.stubGlobal("fetch", request); request.mockReset().mockImplementation(async (url: string) => response(url)); host = document.createElement("div"); host.dataset.workspaceScope = "test-scope"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  ["en", "Upcoming arrangements", "Continue a conversation", "All day"],
  ["zh-CN", "接下来的安排", "继续一段对话", "全天"],
  ["zh-TW", "接下來的安排", "繼續一段對話", "全天"],
  ["ja", "今後の予定", "会話を続ける", "終日"],
  ["ko", "예정된 일정", "대화 이어가기", "종일"],
] as const)("localizes loaded Today consumption in %s without translating records or changing source paths", async (locale, heading, unread, allDay) => {
  await mount(locale);
  for (const text of [heading, unread, allDay, "用户中文原文"]) expect(host.textContent).toContain(text);
  expect(host.querySelector('a[href^="/workspace/meetings?"]')?.textContent).toBe("全天");
  expect(host.querySelector(`a[href="/workspace/sessions/${id}"]`)).not.toBeNull();
  if (locale === "en") { expect(host.textContent).toContain("October 25"); expect(host.textContent).toContain("Unread · interpretations in the conversation still need review"); expect(host.textContent).not.toContain("10月25日"); }
});
it("keeps the source snapshot and read count when display language changes", async () => {
  await mount("zh-CN"); const count = request.mock.calls.length; await mount("en");
  expect(request).toHaveBeenCalledTimes(count); expect(host.textContent).toContain("Upcoming arrangements"); expect(host.textContent).toContain("用户中文原文");
});
it("localizes complete empty ranges without claiming failed reads are empty", async () => {
  request.mockImplementation(async (url: string) => response(url, [], false)); await mount("en");
  expect(host.textContent).toContain("No upcoming arrangements in the next seven days."); expect(host.textContent).toContain("No unread conversations right now.");
});
