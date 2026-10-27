// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type LocaleTag } from "@talent-signal/contracts";
import { timeFixtureActivity } from "@/lib/test/time-fixtures";
import { formatDay, formatTime } from "@/lib/time-workspace";
import { translate } from "@/lib/i18n";
const mock = vi.hoisted(() => ({ request: vi.fn(), query: "day=2026-09-21&view=week&tz=UTC&person=one" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/meetings", useSearchParams: () => new URLSearchParams(mock.query) }));
vi.mock("@/lib/time-workspace-client", async original => ({ ...await original<typeof import("@/lib/time-workspace-client")>(), timeRequest: mock.request }));
import { WorkspaceSidebarCalendar } from "./workspace-sidebar-calendar";
import { LocaleProvider } from "./locale-provider";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.request.mockReset();
  mock.request.mockImplementation(async (url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    return { contract_version: CONTRACT_VERSION, scope: { from: params.get("from"), to: params.get("to"), time_zone: params.get("time_zone"), kind: "schedule", ...(params.get("person_id") ? { person_id: params.get("person_id") } : {}) }, activities: [{ ...timeFixtureActivity, title: "自写中文安排", person_label: "原始中文人物" }], complete: true, next_cursor: null, snapshot_at: "2026-09-21T00:00:00Z", coverage_note: "原始说明" };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(locale: LocaleTag, binding: string | null = "locale") { await act(async () => root.render(<LocaleProvider locale={locale}><WorkspaceSidebarCalendar binding={binding} /></LocaleProvider>)); }
it.each(["en", "ja", "ko", "zh-TW"] as LocaleTag[])("localizes calendar dates, accessible names and upcoming chrome in %s without changing data or destinations", async locale => {
  const errors = vi.spyOn(console, "error");
  await render(locale);
  expect(host.querySelector("h2")?.textContent).toBe(formatDay("2026-09-01", { year: "numeric", month: "long" }, locale));
  expect(host.textContent).toContain(translate(locale, "近期安排"));
  expect(host.textContent).toContain("自写中文安排"); expect(host.textContent).toContain("原始中文人物");
  const day = host.querySelector('[data-calendar-day="2026-09-21"]')!;
  expect(day.getAttribute("aria-label")).toContain(formatDay("2026-09-21", { year: "numeric", month: "long", day: "numeric", weekday: "long" }, locale));
  expect(day.getAttribute("aria-label")).not.toContain("已选中");
  expect(new URL(day.getAttribute("href")!, "http://localhost").searchParams.get("day")).toBe("2026-09-21");
  const headers = [...host.querySelectorAll("th")];
  expect(headers.map(h => h.textContent)).toEqual(Array.from({ length: 7 }, (_, index) => formatDay(`2026-09-${21 + index}`, { weekday: "narrow" }, locale)));
  expect(headers[0]?.getAttribute("aria-label")).toBe(formatDay("2026-09-21", { weekday: "long" }, locale));
  const schedule = host.querySelector("ol a")!;
  expect(schedule.getAttribute("aria-label")).toContain(formatTime(timeFixtureActivity.occurred_at, "UTC", locale));
  expect(schedule.getAttribute("aria-label")).toBe(translate(locale, "{title}，{day}，{time}{person}，内部安排", { title: "自写中文安排", day: formatDay("2026-09-21", { month: "long", day: "numeric" }, locale), time: formatTime(timeFixtureActivity.occurred_at, "UTC", locale), person: " · 原始中文人物" }));
  expect(host.querySelector('option[value="7"]')?.textContent).toBe(translate(locale, "{count} 天", { count: 7 }));
  expect(errors.mock.calls.filter(call => String(call[0]).includes("same key"))).toHaveLength(0);
  expect(mock.request).toHaveBeenCalledOnce();
});
it("localizes signed-out and unavailable states, and keeps locale switches read-only", async () => {
  await render("en", null);
  expect(host.textContent).toContain("Sign in to view schedules"); expect(mock.request).not.toHaveBeenCalled();
  mock.request.mockRejectedValue(new Error("private backend message"));
  await render("en");
  expect(host.textContent).toContain(translate("en", "安排暂时无法读取。"));
  expect(host.textContent).not.toContain("private backend message");
  await render("ja");
  expect(mock.request).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(translate("ja", "安排暂时无法读取。"));
});
