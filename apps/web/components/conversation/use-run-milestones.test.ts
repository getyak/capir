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
let paints: Array<{ runId: string | null; stages: string[] }> = [];
function Probe({ runId, stage }: { runId: string | null; stage: string | null }) {
  const milestones = useRunMilestones(runId, stage);
  useLayoutEffect(() => { observed = milestones; paints.push({ runId, stages: milestones.map(item => item.stage) }); });
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
  paints = [];
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

it("continues publishing stage observations after the 12-entry cap", async () => {
  for (let index = 0; index < 15; index++) await render("run-long", index % 2 ? "answer" : "contact_read");
  expect(observed).toHaveLength(12);
  expect(observed.at(-1)?.stage).toBe("contact_read");
});

it("never paints the previous run observations while a new run has no stage", async () => {
  await render("run-A", "contact_read");
  paints = [];
  await render("run-B", null);
  expect(paints.filter(paint => paint.runId === "run-B").every(paint => paint.stages.length === 0)).toBe(true);
  await render("run-B", "answer");
  expect(observed.map(item => item.stage)).toEqual(["answer"]);
  paints = [];
  await render("retry-run-C", null);
  expect(paints.every(paint => paint.stages.length === 0)).toBe(true);
});
