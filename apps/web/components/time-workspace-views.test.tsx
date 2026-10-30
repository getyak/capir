// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CONTRACT_VERSION, type TimeActivity } from "@talent-signal/contracts";

import { LocaleProvider } from "./locale-provider";
import { TimeActivityIcon, TimeActivityRow } from "./time-workspace-views";

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
  id: "person_created:b2000000-0000-4000-8000-000000000011",
  kind: "person_created",
  source_id: "b2000000-0000-4000-8000-000000000011",
  source_revision: 1,
  title: "Synthetic Person",
  summary: "新建人物",
  occurred_at: "2026-10-18T00:00:00.000Z",
  recorded_at: "2026-10-18T00:00:00.000Z",
  ends_at: null,
  local_day: "2026-10-18",
  time_zone: "UTC",
  all_day: false,
  person_id: "b2000000-0000-4000-8000-000000000011",
  person_label: "Synthetic Person",
  relationship_context_id: null,
  context_label: null,
  session_id: null,
  status: "recorded",
  authority: "system_record",
  external_effect: "none",
};

let root: Root;
let host: HTMLDivElement;

async function renderPersonRow(activity: TimeActivity, onSelect: (activity: TimeActivity) => void = () => undefined) {
  await act(async () => {
    root.render(<LocaleProvider locale="en"><TimeActivityRow activity={activity} zone="UTC" onSelect={onSelect} /></LocaleProvider>);
  });
  return host.querySelector("button")!;
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

it.each([
  { match: "exactly equal", title: "Synthetic Person", personLabel: "Synthetic Person" },
  { match: "equal after trimming", title: "  Synthetic Person  ", personLabel: " Synthetic Person " },
])("omits a person prefix when title and label are $match", async ({ title, personLabel }) => {
  const activity: TimeActivity = { ...personCreated, title, person_label: personLabel };
  const original = { ...activity };
  let selected: TimeActivity | undefined;
  const row = await renderPersonRow(activity, (value) => { selected = value; });
  const heading = row.querySelector("strong");
  expect(heading?.textContent).toBe(title);
  expect(heading?.nextElementSibling?.textContent).toBe("Person created");
  await act(async () => row.click());
  expect(selected).toBe(activity);
  expect(activity).toEqual(original);
});

it("keeps a distinct person prefix alongside the localized system summary", async () => {
  const activity: TimeActivity = { ...personCreated, title: "A distinct activity title" };
  const row = await renderPersonRow(activity);
  const heading = row.querySelector("strong");
  expect(heading?.textContent).toBe(activity.title);
  expect(heading?.nextElementSibling?.textContent).toBe("Synthetic Person · Person created");
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
