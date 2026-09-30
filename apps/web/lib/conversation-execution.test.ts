import { describe, expect, it } from "vitest";
import type { ConversationQueueEntry } from "@talent-signal/contracts";
import {
  CONVERSATION_PRESENTATION_INTERVAL_MS,
  conversationAwaitingDecision,
  conversationElapsedLabel,
  conversationElapsedMs,
  conversationExecutionPhase,
  conversationExecutionPhaseLabel,
  conversationMilestoneUpdates,
  conversationObservedMilestone,
  conversationPresentationDelay,
  conversationPresentationInitial,
  conversationPresentationStep,
  conversationRunKeyAction,
  conversationStageLabel,
  conversationTurnInterrupted,
} from "./conversation-execution";

function entry(overrides: Partial<ConversationQueueEntry> = {}): ConversationQueueEntry {
  return {
    queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    message_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sequence: 1,
    status: "running",
    objective: "推进试点范围",
    created_at: "2026-09-30T01:00:00.000Z",
    updated_at: "2026-09-30T01:00:05.000Z",
    revision: 3,
    run_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    stage: "contact_read",
    cancel_requested: false,
    failure_code: null,
    ...overrides,
  };
}

describe("conversation execution phase projection", () => {
  it("maps only observed queue states and keeps stopping distinct from running", () => {
    const pending = { readbackComplete: false, awaitingDecision: false };
    expect(conversationExecutionPhase({ entry: entry({ status: "queued", run_id: null }), ...pending })).toBe("queued");
    expect(conversationExecutionPhase({ entry: entry(), ...pending })).toBe("running");
    expect(conversationExecutionPhase({ entry: entry({ cancel_requested: true }), ...pending })).toBe("stopping");
    expect(conversationExecutionPhase({ entry: entry({ status: "failed", failure_code: "MODEL_RUN_TIMEOUT" }), ...pending })).toBe("failed");
    expect(conversationExecutionPhase({ entry: entry({ status: "interrupted" }), ...pending })).toBe("interrupted");
    expect(conversationExecutionPhase({ entry: entry({ status: "cancelled" }), ...pending })).toBe("interrupted");
    expect(conversationExecutionPhase({ entry: null, ...pending })).toBeNull();
  });

  it("claims completion only after history readback and keeps pending decisions in review", () => {
    // A completed entry without readback must never surface as completed.
    expect(conversationExecutionPhase({ entry: entry({ status: "completed" }), readbackComplete: true, awaitingDecision: false })).toBe("completed");
    expect(conversationExecutionPhase({ entry: entry({ status: "completed" }), readbackComplete: true, awaitingDecision: true })).toBe("waiting-review");
    expect(conversationExecutionPhase({ entry: null, readbackComplete: true, awaitingDecision: true })).toBe("waiting-review");
    expect(conversationExecutionPhase({ entry: null, readbackComplete: true, awaitingDecision: false })).toBe("completed");
  });

  it("reads a pending memory or calendar decision from the readback response", () => {
    expect(conversationAwaitingDecision({ memoryProposal: { proposal_id: "p", revision: 1 } })).toBe(true);
    expect(conversationAwaitingDecision({ meetingDraft: { id: "m", title: "回访" } })).toBe(true);
    expect(conversationAwaitingDecision({ memoryProposal: null, meetingDraft: null })).toBe(false);
    expect(conversationAwaitingDecision(undefined)).toBe(false);
  });

  it("keeps every explicit state named for the surface", () => {
    expect(conversationStageLabel("answer")).toBe("正在回复");
    expect(conversationStageLabel("unknown-stage")).toBeNull();
    expect(conversationStageLabel(null)).toBeNull();
    for (const phase of ["queued", "running", "stopping", "waiting-review", "completed", "failed", "interrupted"] as const) {
      expect(conversationExecutionPhaseLabel(phase).length).toBeGreaterThan(0);
    }
    expect(conversationExecutionPhaseLabel("waiting-review")).toContain("待你确认");
    expect(conversationExecutionPhaseLabel("completed")).toBe("执行完成");
    expect(conversationExecutionPhaseLabel("interrupted")).toContain("中断");
  });
});

describe("observed milestones and elapsed time", () => {
  it("shortens forming output into milestone-only dialogue updates", () => {
    expect(conversationMilestoneUpdates("")).toEqual([]);
    expect(conversationMilestoneUpdates("先核对两人的沟通记录。再看下一步。\n然后给出建议。"))
      .toEqual(["先核对两人的沟通记录。", "再看下一步。", "然后给出建议。"]);
    // A long unit is capped with an ellipsis instead of becoming the result.
    const long = conversationMilestoneUpdates(`${"很长的进展".repeat(80)}。`, 20);
    expect(long).toHaveLength(1);
    expect(long[0]!.endsWith("…")).toBe(true);
    expect(long[0]!.length).toBeLessThanOrEqual(21);
    // Only the most recent updates stay on screen.
    expect(conversationMilestoneUpdates("一。二。三。四。五。六。七。", 200, 3)).toEqual(["五。", "六。", "七。"]);
    // Latin decimals are not split mid-number.
    expect(conversationMilestoneUpdates("增长 3.5% 的部分。下一步。"))
      .toEqual(["增长 3.5% 的部分。", "下一步。"]);
  });

  it("identifies a stopped run only from its persisted cancelled identity", () => {
    expect(conversationTurnInterrupted({ taskID: `cancelled-${"44444444-4444-4444-8444-444444444444"}` }, "44444444-4444-4444-8444-444444444444")).toBe(true);
    expect(conversationTurnInterrupted({ taskID: "task-1" }, "44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(conversationTurnInterrupted(null, "44444444-4444-4444-8444-444444444444")).toBe(false);
  });

  it("records a milestone only for a real stage transition", () => {
    const started = conversationObservedMilestone([], "contact_lookup", "2026-09-30T01:00:01.000Z");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ stage: "contact_lookup", label: "正在查找相关人物" });
    expect(conversationObservedMilestone(started, "contact_lookup", "2026-09-30T01:00:02.000Z")).toHaveLength(1);
    const grown = conversationObservedMilestone(started, "answer", "2026-09-30T01:00:03.000Z");
    expect(grown.map((milestone) => milestone.stage)).toEqual(["contact_lookup", "answer"]);
    // No observed stage, no milestone: silence stays valid.
    expect(conversationObservedMilestone(grown, null, "2026-09-30T01:00:04.000Z")).toHaveLength(2);
    expect(conversationObservedMilestone(grown, "", "2026-09-30T01:00:04.000Z")).toHaveLength(2);
    // Unknown stages are kept verbatim instead of being given a meaning.
    expect(conversationObservedMilestone([], "custom_stage", "2026-09-30T01:00:04.000Z")[0]!.label).toBe("custom_stage");
  });

  it("measures elapsed time from observed timestamps and pins it at the terminal moment", () => {
    const startedAt = "2026-09-30T01:00:00.000Z";
    const nowMs = Date.parse("2026-09-30T01:00:12.500Z");
    expect(conversationElapsedMs({ startedAt, nowMs })).toBe(12_500);
    expect(conversationElapsedMs({ startedAt, nowMs, endedAt: "2026-09-30T01:00:08.000Z" })).toBe(8_000);
    // A replayed transcript keeps the truthful duration instead of growing.
    expect(conversationElapsedMs({ startedAt, nowMs: nowMs + 60_000, endedAt: "2026-09-30T01:00:08.000Z" })).toBe(8_000);
    expect(conversationElapsedMs({ startedAt: "not-a-date", nowMs })).toBe(0);
    expect(conversationElapsedLabel(8_000)).toBe("8 秒");
    expect(conversationElapsedLabel(125_000)).toBe("2 分 05 秒");
    expect(conversationElapsedLabel(3_725_000)).toBe("1 小时 02 分");
  });
});

describe("presentation pacing for forming text", () => {
  it("coalesces progress updates to the interval and paints terminal states immediately", () => {
    let state = conversationPresentationInitial(1_000);
    const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const update = (text: string, nowMs: number, extra: { revision?: number; terminal?: boolean } = {}) => ({
      runId, revision: extra.revision ?? 1, text, stage: "answer", nowMs, ...(extra.terminal ? { terminal: true } : {}),
    });
    const first = conversationPresentationStep(state, update("先核对", 1_000));
    expect(first.commit).toBe(true);
    state = first.state;
    // Rapid fragments inside the window are coalesced, never painted per frame.
    for (const [text, now] of [["先核对两人", 1_120], ["先核对两人的", 1_240], ["先核对两人的记录", 1_380]] as const) {
      const step = conversationPresentationStep(state, update(text, now));
      expect(step.commit).toBe(false);
      state = step.state;
    }
    expect(state.dirty).toBe(true);
    expect(conversationPresentationDelay(state, 1_380)).toBeGreaterThan(0);
    // The trailing value paints at the first frame outside the window.
    const trailing = conversationPresentationStep(state, update("先核对两人的记录。", 1_700));
    expect(trailing.commit).toBe(true);
    expect(trailing.state.text).toBe("先核对两人的记录。");
    expect(trailing.state.dirty).toBe(false);
    state = trailing.state;
    // Terminal states and errors stay prompt and bypass the interval.
    const terminal = conversationPresentationStep(state, update("先核对两人的记录。", 1_750, { terminal: true }));
    expect(terminal.commit).toBe(true);
  });

  it("fences stale, out-of-order and cross-run frames", () => {
    let state = conversationPresentationInitial(1_000);
    const runA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const runB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    state = conversationPresentationStep(state, { runId: runA, revision: 4, text: "newer", stage: "answer", nowMs: 1_000 }).state;
    const stale = conversationPresentationStep(state, { runId: runA, revision: 3, text: "older", stage: "answer", nowMs: 5_000 });
    expect(stale.commit).toBe(false);
    expect(stale.state.text).toBe("newer");
    // A new run starts a fresh identity and paints at once.
    const next = conversationPresentationStep(state, { runId: runB, revision: 1, text: "next run", stage: "preparing", nowMs: 1_100 });
    expect(next.commit).toBe(true);
    expect(next.state.text).toBe("next run");
    expect(next.state.revision).toBe(1);
    // An idle frame with no run never paints anything.
    const idle = conversationPresentationStep(conversationPresentationInitial(0), { runId: null, revision: 0, text: "", stage: null, nowMs: 10 });
    expect(idle.commit).toBe(false);
  });

  it("keeps the pacing interval inside the 500–1000ms presentation budget", () => {
    expect(CONVERSATION_PRESENTATION_INTERVAL_MS).toBeGreaterThanOrEqual(500);
    expect(CONVERSATION_PRESENTATION_INTERVAL_MS).toBeLessThanOrEqual(1_000);
    const state = conversationPresentationInitial(0);
    const painted = conversationPresentationStep(state, { runId: "r", revision: 1, text: "a", stage: null, nowMs: 100 }).state;
    const queued = conversationPresentationStep(painted, { runId: "r", revision: 2, text: "ab", stage: null, nowMs: 150 }).state;
    expect(conversationPresentationDelay(queued, 150)).toBe(CONVERSATION_PRESENTATION_INTERVAL_MS - 50);
  });
});

describe("keyboard ownership", () => {
  it("lets IME composition own Enter and Escape and pauses only for a live run", () => {
    expect(conversationRunKeyAction({ key: "Escape", hasActiveRun: true })).toBe("pause-run");
    expect(conversationRunKeyAction({ key: "Escape", isComposing: true, hasActiveRun: true })).toBe("none");
    expect(conversationRunKeyAction({ key: "Escape", keyCode: 229, hasActiveRun: true })).toBe("none");
    expect(conversationRunKeyAction({ key: "Escape", hasActiveRun: false })).toBe("none");
    expect(conversationRunKeyAction({ key: "Enter", hasActiveRun: true })).toBe("none");
    expect(conversationRunKeyAction({ key: "a", hasActiveRun: true })).toBe("none");
  });
});
