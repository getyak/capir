// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type LocaleTag } from "@talent-signal/contracts";
import { timeFixtureActivity, timeFixtureSchedule } from "@/lib/test/time-fixtures";
import { translate } from "@/lib/i18n";
import { formatDay } from "@/lib/time-workspace";
const mock = vi.hoisted(() => ({ query: "day=2026-09-21&tz=UTC", request: vi.fn(), read: vi.fn(), router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mock.query), useRouter: () => mock.router }));
vi.mock("@/lib/time-workspace-client", async (original) => ({ ...await original<typeof import("@/lib/time-workspace-client")>(), timeRequest: mock.request, readTimeSchedule: mock.read }));
import { TimeWorkspace } from "./time-workspace";
import { TimeActivityRow, TimeMonth, TimeWeek } from "./time-workspace-views";
import { TimeScheduleEditor } from "./time-schedule-editor";
import { TimeMeetingInspector } from "./time-meeting-inspector";
import { LocaleProvider } from "./locale-provider";
let root: Root, host: HTMLDivElement;
const noop = () => undefined;
const person = { ...timeFixtureActivity, kind: "person_created" as const, title: "原始中文名字", summary: "新建人物", ends_at: null };
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.query = "day=2026-09-21&tz=UTC"; window.history.replaceState(null, "", `/workspace/meetings?${mock.query}`);
  mock.request.mockResolvedValue({ contract_version: CONTRACT_VERSION, scope: { from: "2026-09-21", to: "2026-09-22", time_zone: "UTC" }, activities: [person], next_cursor: null, complete: true, coverage_note: "原始覆盖说明", snapshot_at: "2026-09-21T00:00:00Z" });
  mock.read.mockResolvedValue(timeFixtureSchedule);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });
it.each(["en", "ja", "ko", "zh-TW"] as LocaleTag[])("localizes the day, filters and review chrome in %s while preserving authored Chinese", async locale => {
  await act(async () => root.render(<LocaleProvider locale={locale}><TimeWorkspace people={[]} peopleError={null} binding="locale" legacyDraft={null} /></LocaleProvider>));
  expect(host.textContent).toContain(formatDay("2026-09-21", undefined, locale));
  expect(host.textContent).toContain(translate(locale, "新建人物"));
  expect(host.textContent).toContain("原始中文名字");
  expect(host.textContent).toContain(translate(locale, "回顾当前范围"));
  const filter = [...host.querySelectorAll("button")].find(b => b.textContent === translate(locale, "筛选"));
  expect(filter).toBeTruthy(); await act(async () => filter!.click());
  expect(host.querySelector('option[value="person_created"]')?.textContent).toBe(translate(locale, "联系人"));
  expect(host.textContent).toContain(translate(locale, "{count} 条记录", { count: 1 }));
});
it("only localizes the exact system-owned person summary, preserving arbitrary Chinese payloads and timestamps", async () => {
  for (const activity of [person, { ...person, summary: "新建人物：我自己写的" }, { ...person, kind: "session_activity" as const }]) {
    await act(async () => root.render(<LocaleProvider locale="en"><TimeActivityRow activity={activity} zone="Asia/Shanghai" onSelect={noop} /></LocaleProvider>));
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe(activity.occurred_at);
    expect(host.textContent).toContain(activity.kind === "person_created" && activity.summary === "新建人物" ? "Person created" : activity.summary);
    expect(host.textContent).toContain("原始中文名字");
  }
});
it.each(["en", "ja"] as LocaleTag[])("localizes week/month chrome in %s and preserves an all-day exclusive end", async locale => {
  const allDay = { ...timeFixtureActivity, all_day: true, title: "整天的原文", occurred_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z", local_day: "2026-09-21" };
  await act(async () => root.render(<LocaleProvider locale={locale}><TimeMonth activities={[allDay]} day="2026-09-21" zone="UTC" onDay={noop} onSelect={noop} /></LocaleProvider>));
  expect(host.querySelector(`[aria-label="${translate(locale, "月历")}"]`)).toBeTruthy();
  expect([...host.querySelectorAll("strong")].filter(e => e.textContent === "整天的原文")).toHaveLength(1);
  expect(host.textContent).toContain(translate(locale, "没有安排"));
  await act(async () => root.render(<LocaleProvider locale={locale}><TimeWeek activities={[allDay]} day="2026-09-21" zone="UTC" selected="" onDay={noop} onSelect={noop} /></LocaleProvider>));
  expect(host.querySelector(`[aria-label="${translate(locale, "周日程")}"]`)).toBeTruthy();
  expect(host.textContent).toContain(translate(locale, "记录 / 全天"));
});
it("localizes editor labels and unknown-write recovery without changing the source zone, instants or authored fields", async () => {
  const record = { ...timeFixtureSchedule, title: "保留我写的标题", note: "保留我写的备注" };
  mock.read.mockResolvedValue(record); mock.request.mockRejectedValue(new TypeError("network lost"));
  await act(async () => root.render(<LocaleProvider locale="en"><TimeScheduleEditor record={record} day="2026-09-21" zone="UTC" personId="" people={[]} binding="locale" onSaved={noop} onClose={noop} onDirtyChange={noop} /></LocaleProvider>));
  expect(host.querySelector('section[aria-label="Edit schedule"]')).toBeTruthy();
  expect([...host.querySelectorAll("label")].map(label => label.firstChild?.textContent)).toEqual(expect.arrayContaining(["Start time", "End time"]));
  expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe(record.title);
  expect(host.querySelector("textarea")?.value).toBe(record.note);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const body = JSON.parse(mock.request.mock.calls[0]![2].body);
  expect(body).toMatchObject({ title: record.title, note: record.note, starts_at: record.starts_at, ends_at: record.ends_at, time_zone: record.time_zone });
  expect(host.textContent).toContain(translate("en", "连接中断，操作可能已完成。请核实结果后再修改。"));
  expect(host.textContent).not.toContain("连接中断");
});
it("localizes meeting-inspector fallback errors without translating supplied errors", async () => {
  mock.request.mockRejectedValueOnce(null);
  await act(async () => root.render(<LocaleProvider locale="en"><TimeMeetingInspector id="x" revision={1} binding="locale" returnHref="/" refreshKey={0} /></LocaleProvider>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(translate("en", "读取失败。"));
  mock.request.mockRejectedValueOnce(new Error("原始服务错误"));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("原始服务错误");
});
const systemCoverage = "会话活动仅覆盖保留期内的会话（最多 30 天）。设备日历与其他应用不会被导入；此处显示的日程均在 capri 内创建。";
it("localizes only exact system coverage notes, preserving unknown footers", async () => {
  const feed = await mock.request();
  for (const note of [systemCoverage, `本次仅回顾该范围内前 12 条活动；受记录数量或上下文长度限制，范围不完整。${systemCoverage}`, `${systemCoverage} 我补充的内容`]) {
    mock.request.mockResolvedValue({ ...feed, coverage_note: note });
    await act(async () => root.render(<LocaleProvider locale="en"><TimeWorkspace key={note} people={[]} peopleError={null} binding="locale" legacyDraft={null} /></LocaleProvider>));
    expect(host.textContent).toContain(note.endsWith("我补充的内容") ? note : "Session activity only covers retained conversations (up to 30 days).");
    if (note.startsWith("本次")) expect(host.textContent).toContain("Only the first 12 activities");
  }
});
it("keeps Chinese review questions, generated output and sources verbatim while localizing stale review status", async () => {
  const feed = await mock.request();
  mock.request.mockImplementation(async (url: string) => url.includes("/review") ? {
    contract_version: CONTRACT_VERSION, scope: feed.scope, generated_at: "2026-09-21T01:05:00Z", title: "模型原始标题", body: "模型原始正文", sources: [person], complete: true, coverage_note: systemCoverage, authority: "unconfirmed", external_effect: "none",
  } : feed);
  await act(async () => root.render(<LocaleProvider locale="en"><TimeWorkspace people={[]} peopleError={null} binding="locale" legacyDraft={null} /></LocaleProvider>));
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "原始中文问题");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = [...host.querySelectorAll("button")].find(b => b.textContent === translate("en", "回顾当前范围"))!;
  await act(async () => submit.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(mock.request.mock.calls.map(c => c[0])).toContain("/api/time/review");
  expect(host.textContent).toContain("模型原始标题"); expect(host.textContent).toContain("模型原始正文"); expect(host.textContent).toContain("原始中文问题");
  const request = mock.request.mock.calls.find(c => String(c[0]).includes("/review"))!;
  expect(JSON.parse(request[2].body).objective).toBe("原始中文问题");
  mock.request.mockRejectedValue(new Error("原始服务错误"));
  await act(async () => submit.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain(translate("en", "旧整理 · 未核实"));
  expect(host.textContent).toContain("模型原始正文");
  expect(host.textContent).not.toContain("这段整理基于较早的读取生成");
});
it("retains the all-day exclusive end-date label and input values", async () => {
  const record = { ...timeFixtureSchedule, all_day: true, starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z", time_zone: "UTC" };
  await act(async () => root.render(<LocaleProvider locale="en"><TimeScheduleEditor record={record} day="2026-09-21" zone="UTC" personId="" people={[]} binding="locale" onSaved={noop} onClose={noop} onDirtyChange={noop} /></LocaleProvider>));
  const dates = [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  expect(dates.map(input => input.value)).toEqual(["2026-09-21", "2026-09-22"]);
  expect(dates[1]?.closest("label")?.textContent).toBe(translate("en", "结束日期（不包含此日）"));
});
