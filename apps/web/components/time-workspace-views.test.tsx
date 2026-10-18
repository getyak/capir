// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CONTRACT_VERSION, type TimeActivity } from "@talent-signal/contracts";

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

let root: Root;
let host: HTMLDivElement;

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
