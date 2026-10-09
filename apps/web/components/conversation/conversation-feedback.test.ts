// Truthful feedback derivation: every phase is distinct, every text derives
// from observed state, and nothing is acknowledged, animated or completed
// without evidence. No fabricated percentage or elapsed prediction.
import { describe, expect, it } from "vitest";
import type { ConversationQueueEntry } from "@talent-signal/contracts";
import { conversationWorkStatus, queueFailureText, runStageText } from "./conversation-feedback";

const base = {
  error: undefined,
  settled: false,
  entry: null,
  entrySlot: null,
  paused: false,
  connection: "live" as const,
  stage: null,
  outcome: null,
  readbackStalled: false,
  hasImages: false,
};

function runningEntry(overrides: Partial<ConversationQueueEntry> = {}): ConversationQueueEntry {
  return {
    queue_entry_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    message_id: "44444444-4444-4444-8444-444444444444",
    sequence: 1,
    status: "running",
    objective: "原位消息",
    images: [],
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    revision: 2,
    run_id: "66666666-6666-4666-8666-666666666666",
    stage: "answer",
    cancel_requested: false,
    failure_code: null,
    ...overrides,
  };
}

describe("conversation work feedback", () => {
  it("keeps every delivery, queue, run, connection and readback state distinct", () => {
    const states = {
      pending: conversationWorkStatus({ ...base, delivery: "pending" }),
      sending: conversationWorkStatus({ ...base, delivery: "sending" }),
      waiting: conversationWorkStatus({ ...base, delivery: "accepted" }),
      running: conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry(), entrySlot: "active" }),
      stopping: conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ cancel_requested: true }), entrySlot: "active" }),
      queued: conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "queued", run_id: null, stage: null }), entrySlot: "queued" }),
      paused: conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "queued", run_id: null, stage: null }), entrySlot: "queued", paused: true }),
      reconnecting: conversationWorkStatus({ ...base, delivery: "accepted", connection: "reconnecting" }),
      failed: conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "failed", run_id: null, stage: null, failure_code: "MODEL_RUN_FAILED" }), entrySlot: "queued" }),
      stopped: conversationWorkStatus({ ...base, delivery: "accepted", outcome: "stopped" }),
      readback: conversationWorkStatus({ ...base, delivery: "accepted", outcome: "completed" }),
      settled: conversationWorkStatus({ ...base, delivery: "accepted", settled: true }),
    };
    expect(states.pending.text).toBe("等待送达");
    expect(states.sending.text).toBe("正在送达…");
    expect(states.waiting.text).toBe("等待回复状态");
    expect(states.running.text).toBe("正在回复");
    expect(states.stopping.text).toBe("正在停止…");
    expect(states.queued.text).toBe("排队等待处理");
    expect(states.paused.text).toContain("已暂停");
    expect(states.reconnecting.text).toBe("连接恢复中，消息已保留");
    expect(states.failed.text).toBe("上次未完成，请重试或移除");
    expect(states.stopped.text).toBe("已停止");
    expect(states.readback.text).toContain("正在读取回复");
    expect(states.settled.text).toBe("");
    const texts = Object.values(states).map((state) => state.text);
    expect(new Set(texts).size).toBe(texts.length);
    // Phases are stable machine-readable identities too.
    expect(new Set(Object.values(states).map((state) => state.phase)).size).toBe(Object.keys(states).length);
  });

  it("never shows an unconfirmed delivery as confirmed processing", () => {
    const unknown = conversationWorkStatus({ ...base, delivery: "unknown", entry: runningEntry(), entrySlot: "active" });
    expect(unknown.phase).toBe("unknown");
    expect(unknown.text).toContain("尚未确认");
    expect(unknown.recover).toBe("check");
    for (const text of ["正在回复", "正在处理", "等待回复状态", "已送达"]) expect(unknown.text).not.toContain(text);
    const rejected = conversationWorkStatus({ ...base, delivery: "rejected", error: "队列已满" });
    expect(rejected.phase).toBe("rejected");
    expect(rejected.text).toBe("队列已满");
    expect(rejected.recover).toBe("check");
  });

  it("claims no acknowledgement or completed effect while waiting for reply status", () => {
    const waiting = conversationWorkStatus({ ...base, delivery: "accepted" });
    for (const claim of ["已送达", "已接收", "正在处理", "正在回复", "完成", "%"]) expect(waiting.text).not.toContain(claim);
  });

  it("animates only live progression and never stopped, paused or failed turns", () => {
    const live = [
      conversationWorkStatus({ ...base, delivery: "pending" }),
      conversationWorkStatus({ ...base, delivery: "sending" }),
      conversationWorkStatus({ ...base, delivery: "accepted" }),
      conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry(), entrySlot: "active" }),
      conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "queued", run_id: null, stage: null }), entrySlot: "queued" }),
    ];
    for (const state of live) expect(state.animate).toBe(true);
    const still = [
      conversationWorkStatus({ ...base, delivery: "unknown" }),
      conversationWorkStatus({ ...base, delivery: "rejected" }),
      conversationWorkStatus({ ...base, delivery: "accepted", outcome: "stopped" }),
      conversationWorkStatus({ ...base, delivery: "accepted", outcome: "completed" }),
      conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "failed", run_id: null, stage: null }), entrySlot: "queued" }),
      conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ status: "queued", run_id: null, stage: null }), entrySlot: "queued", paused: true }),
      conversationWorkStatus({ ...base, delivery: "accepted", connection: "reconnecting" }),
    ];
    for (const state of still) expect(state.animate).toBe(false);
  });

  it("never fabricates a percentage or elapsed prediction", () => {
    const states = [
      conversationWorkStatus({ ...base, delivery: "pending" }),
      conversationWorkStatus({ ...base, delivery: "sending" }),
      conversationWorkStatus({ ...base, delivery: "accepted" }),
      conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry(), entrySlot: "active" }),
      conversationWorkStatus({ ...base, delivery: "accepted", outcome: "completed" }),
      conversationWorkStatus({ ...base, delivery: "accepted", outcome: "completed", readbackStalled: true }),
    ];
    for (const state of states) expect(state.text).not.toMatch(/\d+\s*(%|秒|s\b|分钟)/u);
  });

  it("keeps a stalled readback recoverable through a passive refresh", () => {
    const stalled = conversationWorkStatus({ ...base, delivery: "accepted", outcome: "completed", readbackStalled: true });
    expect(stalled.phase).toBe("readback");
    expect(stalled.text).toContain("可刷新查看");
    expect(stalled.recover).toBe("refresh");
  });

  it("uses the observed run stage and keeps bounded failure copy", () => {
    expect(conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ stage: "persisting" }), entrySlot: "active" }).text).toBe("正在保存回复");
    expect(conversationWorkStatus({ ...base, delivery: "accepted", entry: runningEntry({ stage: "unknown-stage" }), entrySlot: "active" }).text).toBe("正在处理");
    expect(queueFailureText("MODEL_RUN_TIMEOUT", true)).toContain("图片分析超时");
    expect(queueFailureText("MODEL_RUN_TIMEOUT", false)).toContain("消息已保留");
    expect(queueFailureText(null, false)).toBe("上次未完成，请重试或移除");
    expect(runStageText.answer).toBe("正在回复");
  });
});
