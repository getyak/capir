// @vitest-environment happy-dom
//
// GET-128 milestone observation: only real stage transitions append, the
// record resets with the run identity, and silence stays silent.
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationExecutionMilestone } from "@/lib/conversation-execution";
import { useRunMilestones } from "./use-run-milestones";

let observed: readonly ConversationExecutionMilestone[] = [];
function Probe({ runId, stage }: { runId: string | null; stage: string | null }) {
  const milestones = useRunMilestones(runId, stage);
  useLayoutEffect(() => { observed = milestones; });
  return null;
}
let root: Root;
let mount: HTMLDivElement;
async function render(runId: string | null, stage: string | null) {
  await act(async () => { root.render(createElement(Probe, { runId, stage })); });
  await act(async () => { await Promise.resolve(); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  observed = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

it("records observed stage transitions once and resets with the run identity", async () => {
  const runA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const runB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await render(runA, "contact_lookup");
  expect(observed.map((milestone) => milestone.stage)).toEqual(["contact_lookup"]);
  await render(runA, "contact_lookup");
  expect(observed).toHaveLength(1);
  await render(runA, "answer");
  expect(observed.map((milestone) => milestone.stage)).toEqual(["contact_lookup", "answer"]);
  await render(runB, "preparing");
  expect(observed.map((milestone) => milestone.stage)).toEqual(["preparing"]);
  await render(null, null);
  expect(observed).toEqual([]);
});

it("adds no milestone when no stage is observed", async () => {
  await render("cccccccc-cccc-4ccc-8ccc-cccccccccccc", null);
  expect(observed).toEqual([]);
});
