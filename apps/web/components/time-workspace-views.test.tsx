// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CONTRACT_VERSION, type TimeActivity } from "@talent-signal/contracts";

import { LocaleProvider } from "./locale-provider";
import { TimeActivityIcon, TimeActivityRow, TimeTimeline } from "./time-workspace-views";

const observation: TimeActivity = {
  id: "public_source_update:b1000000-0000-4000-8000-000000000001",
  kind: "public_source_update",
  source_id: "b1000000-0000-4000-8000-000000000001",
  source_revision: 1,
  title: "Research snapshot · profile.example",
  summary: "定时公开来源读取产生新的拟议依据，等待你审阅。",
  occurred_at: "2026-10-18T00:00:00.000Z",
  recorded_at: "2026-10-18T00:01:00.000Z",
  ends_at: null,
  local_day: "2026-10-18",
  time_zone: "UTC",
  all_day: false,
  person_id: "b1000000-0000-4000-8000-000000000002",
  person_label: "Synthetic Person",
  relationship_context_id: null,
  context_label: null,
  session_id: null,
  status: "needs_review",
  authority: "unconfirmed",
  external_effect: "none",
};

const personCreated: TimeActivity = {
  ...observation,
  id: "person_created:b2000000-0000-4000-8000-000000000011",
  kind: "person_created",
  source_id: "b2000000-0000-4000-8000-000000000011",
  title: "苏晴",
  summary: "新建人物",
  person_label: "苏晴",
  status: "recorded",
};
const systemFallback: TimeActivity = {
  ...observation,
  id: "person_created:b2000000-0000-4000-8000-000000000012",
  kind: "person_created",
  source_id: "b2000000-0000-4000-8000-000000000012",
  title: "苏晴",
  summary: "",
  person_label: null,
  all_day: true,
  status: "needs_review",
};

let root: Root;
let host: HTMLDivElement;

async function renderView(element: ReactElement, locale?: "en" | "zh-CN") {
  await act(async () => {
    root.render(locale ? <LocaleProvider locale={locale}>{element}</LocaleProvider> : element);
  });
}
function rowView(activity: TimeActivity, selected = false, onSelect: (a: TimeActivity) => void = () => undefined, zone = "UTC") {
  return createElement(TimeActivityRow, { activity, zone, selected, onSelect });
}
function timelineView(activities: TimeActivity[], zone: string, selected = "") {
  return createElement(TimeTimeline, { activities, zone, selected, onSelect: () => undefined });
}
function subtitle(): string {
  return host.querySelector("strong")!.parentElement!.querySelector("span")!.textContent!;
}
function statusText(): string {
  return host.querySelector("[data-status]")!.textContent!;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("renders a genuinely committed public source observation as unconfirmed reviewable activity", async () => {
  expect(CONTRACT_VERSION).toBeTruthy();
  await act(async () => {
    root.render(
      createElement(TimeActivityRow, {
        activity: observation,
        zone: "UTC",
        selected: false,
        onSelect: () => undefined,
      }),
    );
  });
  expect(host.textContent).toContain("Research snapshot · profile.example");
  expect(host.textContent).toContain("待核对");
  expect(host.querySelector("svg")).toBeTruthy();
});

it("drops the person label prefix when it only repeats the row title", async () => {
  await renderView(rowView(personCreated));
  expect(host.textContent).toContain("苏晴");
  expect(subtitle()).toBe("新建人物");
  await renderView(rowView({ ...personCreated, person_label: " 苏晴 " }));
  expect(subtitle()).toBe("新建人物");
});

it("keeps a distinct person label and the source summary verbatim", async () => {
  await renderView(rowView(observation), "en");
  expect(subtitle()).toBe("Synthetic Person · 定时公开来源读取产生新的拟议依据，等待你审阅。");
});

it("translates system fallback kind, status and all-day labels under en", async () => {
  await renderView(rowView(systemFallback), "en");
  expect(host.textContent).toContain("All day");
  expect(subtitle()).toBe("Contact");
  expect(statusText()).toBe("Awaiting check");
  expect(host.textContent).not.toContain("全天");
  expect(host.textContent).not.toContain("待核对");
});

it("keeps zh-CN system fallback labels identical to the source catalog", async () => {
  await renderView(rowView(systemFallback), "zh-CN");
  expect(host.textContent).toContain("全天");
  expect(subtitle()).toBe("联系人");
  expect(statusText()).toBe("待核对");
});

it("renders every status label through the active locale", async () => {
  const labels: [TimeActivity["status"], string, string][] = [
    ["recorded", "已记录", "Recorded"],
    ["needs_review", "待核对", "Awaiting check"],
    ["planned", "内部安排", "Internal plan"],
    ["completed", "已记录结果", "Outcome recorded"],
    ["cancelled", "已取消", "Cancelled"],
  ];
  for (const [status, zh, en] of labels) {
    await renderView(rowView({ ...systemFallback, status }), "zh-CN");
    expect(statusText()).toBe(zh);
    await renderView(rowView({ ...systemFallback, status }), "en");
    expect(statusText()).toBe(en);
  }
});

it("localizes timeline day headings and record counts without moving the stored day", async () => {
  const day = "2026-10-18";
  const activities: TimeActivity[] = [
    { ...systemFallback, id: "person_created:b2000000-0000-4000-8000-000000000013", source_id: "b2000000-0000-4000-8000-000000000013", local_day: day },
    { ...personCreated, id: "person_created:b2000000-0000-4000-8000-000000000014", source_id: "b2000000-0000-4000-8000-000000000014", local_day: day },
  ];
  await renderView(timelineView(activities, "UTC"), "en");
  const section = host.querySelector("section")!;
  expect(section.getAttribute("aria-label")).toBe("Sunday, October 18");
  expect(host.querySelector("h2")!.textContent).toBe("Sunday, October 18");
  expect(host.textContent).toContain("2 records");
  expect(host.textContent).not.toContain("10月18日");
  await renderView(timelineView(activities, "UTC"), "zh-CN");
  expect(host.querySelector("h2")!.textContent).toBe("10月18日星期日");
  expect(host.textContent).toContain("2 条记录");
});

it("keeps the zone date-boundary marker tied to the stored local day", async () => {
  const crossing: TimeActivity = {
    ...observation,
    id: "public_source_update:b2000000-0000-4000-8000-000000000015",
    source_id: "b2000000-0000-4000-8000-000000000015",
    occurred_at: "2026-10-18T16:00:00.000Z",
    recorded_at: "2026-10-18T16:01:00.000Z",
    local_day: "2026-10-18",
  };
  await renderView(timelineView([crossing], "Asia/Tokyo"), "en");
  expect(host.querySelector("h2")!.textContent).toBe("Sunday, October 18");
  expect(host.textContent).toContain("10/19");
});

it("uses a singular record count for a one-record timeline", async () => {
  await renderView(timelineView([personCreated], "UTC"), "en");
  expect(host.textContent).toContain("1 record");
  expect(host.textContent).not.toContain("1 records");
  await renderView(timelineView([personCreated], "UTC"), "zh-CN");
  expect(host.textContent).toContain("1 条记录");
});

it("keeps row selection semantics and the onSelect callback in every locale", async () => {
  const seen: TimeActivity[] = [];
  await renderView(rowView(personCreated, true, (activity) => { seen.push(activity); }), "en");
  const button = host.querySelector("button")!;
  expect(button.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button.click());
  expect(seen).toEqual([personCreated]);
  await renderView(rowView({ ...personCreated, person_label: null }), "zh-CN");
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
});

it("keeps the additive calendar kind on its own icon path", async () => {
  await act(async () => {
    root.render(createElement(TimeActivityIcon, { kind: "public_source_update" }));
  });
  expect(host.querySelector("svg")).toBeTruthy();
  await act(async () => {
    root.render(createElement(TimeActivityIcon, { kind: "schedule" }));
  });
  expect(host.querySelector("svg")).toBeTruthy();
});
