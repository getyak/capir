import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFRESH_INTERVAL_MS, REFRESH_INTERVALS_MS,
  contentEnvelope, contentStateText, conversationImageRoute, conversationSourceImages,
  formatRunDuration, formatSpanDuration, mergeRunPage, normalizeRefreshInterval, pollTick,
  regressionCaptureKey, regressionCaptureSupport, resumeFetchDue, runReviewExport,
  statusLabel, statusPhase, traceRows, traceStats,
} from "./product-run-monitor-state";
import type { ProductRunDetail } from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    attachment_id: ATTACHMENT,
    file_name: "photo.png",
    media_type: "image/png",
    byte_size: 1024,
    content_hash: HASH,
    ...overrides,
  };
}

function envelope(value: unknown, overrides: Record<string, unknown> = {}) {
  return { status: "complete", original_bytes: 10, retained_bytes: 10, sha256: HASH, value, ...overrides };
}

function span(overrides: Record<string, unknown> = {}): ProductRunDetail["spans"][number] {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    parent_id: null,
    name: "relationship.answer",
    kind: "llm",
    status: "completed",
    started_at: "2026-10-07T00:00:00.000Z",
    finished_at: "2026-10-07T00:00:01.000Z",
    input: envelope({ prompt: "hi" }),
    output: envelope({ summary: "hello" }),
    metadata: {},
    error: null,
    ...overrides,
  };
}

describe("status and duration truth", () => {
  it("keeps exact labels for every known status and shows unknown statuses verbatim", () => {
    for (const [status, label] of Object.entries({
      completed: "已完成", running: "运行中", failed: "失败", fallback: "已降级",
      interrupted: "已中断", waiting_for_user: "待确认", partial: "部分完成", cancelled: "已停止",
    })) expect(statusLabel(status)).toBe(label);
    expect(statusLabel("weird_state")).toBe("weird_state");
    for (const status of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(statusLabel(status)).toBe(status);
    }
  });

  it("distinguishes every terminal phase and never folds unknown into completed", () => {
    expect(statusPhase("running")).toBe("running");
    expect(statusPhase("completed")).toBe("completed");
    expect(statusPhase("failed")).toBe("failed");
    expect(statusPhase("cancelled")).toBe("cancelled");
    expect(statusPhase("interrupted")).toBe("interrupted");
    expect(statusPhase("waiting_for_user")).toBe("waiting");
    expect(statusPhase("partial")).toBe("partial");
    expect(statusPhase("fallback")).toBe("fallback");
    expect(statusPhase("weird_state")).toBe("unknown");
  });

  it("reads a run duration as unknown on terminal statuses and in progress only while running", () => {
    expect(formatRunDuration(12340, "completed")).toBe("12.34 s");
    expect(formatRunDuration(null, "running")).toBe("进行中");
    expect(formatRunDuration(null, "failed")).toBe("耗时未知");
    expect(formatRunDuration(undefined, "cancelled")).toBe("耗时未知");
    expect(formatRunDuration(null, "weird_state")).toBe("耗时未知");
    expect(formatRunDuration(-5, "completed")).toBe("0.00 s");
  });

  it("reads malformed span timestamps as unknown while terminal and in progress only while running", () => {
    expect(formatSpanDuration(span())).toBe("1000 ms");
    expect(formatSpanDuration(span({ started_at: "not-a-date", status: "failed" }))).toBe("耗时未知");
    expect(formatSpanDuration(span({ finished_at: "not-a-date", status: "failed" }))).toBe("耗时未知");
    expect(formatSpanDuration(span({ finished_at: "2026-10-06T00:00:00.000Z", status: "failed" }))).toBe("耗时未知");
    expect(formatSpanDuration(span({ started_at: "not-a-date", status: "running" }))).toBe("进行中");
    expect(formatSpanDuration(span({ finished_at: "", status: "weird_state" }))).toBe("耗时未知");
  });
});

describe("trace summary semantics", () => {
  it("counts failed tools separately from totals and other failures", () => {
    const spans = [
      span({ kind: "tool", status: "failed" }),
      span({ kind: "tool", status: "failed" }),
      span({ kind: "context", status: "failed" }),
      span({ kind: "llm", status: "completed" }),
    ];
    expect(traceStats(spans)).toEqual({ spanCount: 4, failedToolCount: 2, failedSpanCount: 3 });
    // A completed run's status is separate: counts never infer overall success.
    expect(traceStats([])).toEqual({ spanCount: 0, failedToolCount: 0, failedSpanCount: 0 });
  });

  it("renders lineage as compact indentation with explicit parent names", () => {
    const root = span({ id: "44444444-4444-4444-8444-444444444441", name: "relationship.answer" });
    const child = span({ id: "44444444-4444-4444-8444-444444444442", name: "memory_review", parent_id: root.id });
    const grandChild = span({ id: "44444444-4444-4444-8444-444444444443", name: "lookup", parent_id: child.id });
    const orphan = span({ id: "44444444-4444-4444-8444-444444444444", name: "queue", parent_id: "99999999-9999-4999-8999-999999999999" });
    const rows = traceRows([root, child, grandChild, orphan]);
    expect(rows.map(row => [row.span.name, row.depth, row.parentName])).toEqual([
      ["relationship.answer", 0, null],
      ["memory_review", 1, "relationship.answer"],
      ["lookup", 2, "memory_review"],
      ["queue", 0, null],
    ]);
    // Recorded order stays authoritative; nothing is reordered into fake sequence.
    expect(rows.map(row => row.span.id)).toEqual([root.id, child.id, grandChild.id, orphan.id]);
  });

  it("stays finite on a parent cycle", () => {
    const a = span({ id: "44444444-4444-4444-8444-444444444441", parent_id: "44444444-4444-4444-8444-444444444442" });
    const b = span({ id: "44444444-4444-4444-8444-444444444442", parent_id: "44444444-4444-4444-8444-444444444441" });
    const rows = traceRows([a, b]);
    expect(rows.map(row => row.depth)).toEqual([1, 1]);
    expect(rows.map(row => row.parentName)).toEqual([b.name, a.name]);
  });
});

describe("captured-content size states", () => {
  it("unwraps the persisted envelope and names redacted/truncated/unavailable explicitly", () => {
    expect(contentEnvelope({ summary: "plain" })).toBeNull();
    const complete = contentEnvelope(envelope({ summary: "hi" }));
    expect(complete?.hasValue).toBe(true);
    expect(contentStateText(complete!)).toContain("完整");
    const redacted = contentEnvelope(envelope({ summary: "hi" }, { status: "redacted" }));
    expect(contentStateText(redacted!)).toContain("已脱敏");
    const truncated = contentEnvelope({ status: "truncated", original_bytes: 5_000_000, retained_bytes: 0, sha256: HASH });
    expect(truncated?.hasValue).toBe(false);
    expect(contentStateText(truncated!)).toContain("已截断");
    expect(contentStateText(truncated!)).toContain("4.8 MB");
    const unavailable = contentEnvelope({ status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null });
    expect(contentStateText(unavailable!)).toBe("未记录");
  });

  it("treats a malformed envelope as a plain payload instead of claiming a content state", () => {
    expect(contentEnvelope({ status: "complete", value: 1 })).toBeNull();
    expect(contentEnvelope(null)).toBeNull();
  });
});

describe("conversation source images", () => {
  const run = { task_kind: "conversation", content_available: true, session_id: SESSION };

  it("builds the existing message route in immutable array order", () => {
    const second = manifest({ attachment_id: "55555555-5555-4555-8555-555555555555", file_name: "b.png" });
    const source = conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest(), second] }));
    if (source.state !== "ready") throw new Error("expected ready source");
    expect(source.images.map(image => image.index)).toEqual([0, 1]);
    expect(source.images.map(image => image.fileName)).toEqual(["photo.png", "b.png"]);
    expect(source.images[0]!.route).toBe(conversationImageRoute(SESSION, MESSAGE, 0));
    expect(source.images.map(image => image.route)).toEqual([
      `/api/workspace-sessions/${SESSION}/conversation-images/${MESSAGE}/0`,
      `/api/workspace-sessions/${SESSION}/conversation-images/${MESSAGE}/1`,
    ]);
  });

  it("rejects invalid identities and manifests wholesale without any fallback", () => {
    expect(conversationSourceImages(run, envelope({ session_id: "nope", message_id: MESSAGE, images: [manifest()] }))).toEqual({ state: "invalid" });
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest({ content_hash: "zz" })] }))).toEqual({ state: "invalid" });
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest(), { file_name: "x.png" }] }))).toEqual({ state: "invalid" });
    // File names are never identity; a missing manifest stays missing.
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: "photo.png" }))).toEqual({ state: "invalid" });
  });

  it("rejects a captured session that conflicts with or lacks the run's persisted session binding", () => {
    const otherSession = "99999999-9999-4999-8999-999999999999";
    const captured = envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest()] });
    expect(conversationSourceImages({ task_kind: "conversation", content_available: true, session_id: otherSession }, captured)).toEqual({ state: "invalid" });
    expect(conversationSourceImages({ task_kind: "conversation", content_available: true, session_id: null }, captured)).toEqual({ state: "invalid" });
  });

  it("rejects duplicate attachments and batches beyond the conversation contract", () => {
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest(), manifest()] }))).toEqual({ state: "invalid" });
    const eleven = Array.from({ length: 11 }, (_, index) =>
      manifest({ attachment_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: eleven }))).toEqual({ state: "invalid" });
    const overBytes = [
      manifest({ byte_size: 10_000_000 }),
      manifest({ attachment_id: "55555555-5555-4555-8555-555555555555", byte_size: 10_000_000 }),
      manifest({ attachment_id: "66666666-6666-4666-8666-666666666666", byte_size: 10_000_000 }),
      manifest({ attachment_id: "77777777-7777-4777-8777-777777777777", byte_size: 8 }),
    ];
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: overBytes }))).toEqual({ state: "invalid" });
  });

  it("never trusts a stray value in a truncated or unavailable envelope but accepts redacted bodies", () => {
    const body = { session_id: SESSION, message_id: MESSAGE, images: [manifest()] };
    expect(conversationSourceImages(run, { status: "truncated", original_bytes: 5, retained_bytes: 0, sha256: HASH, value: body })).toEqual({ state: "invalid" });
    expect(conversationSourceImages(run, { status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null, value: body })).toEqual({ state: "invalid" });
    expect(conversationSourceImages(run, envelope(body, { status: "redacted" })).state).toBe("ready");
  });

  it("produces no input image when the context is absent or withdrawn", () => {
    expect(conversationSourceImages({ task_kind: "relationship_chat", content_available: true, session_id: SESSION }, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest()] }))).toEqual({ state: "absent" });
    expect(conversationSourceImages({ task_kind: "conversation", content_available: false, session_id: SESSION }, envelope({ session_id: SESSION, message_id: MESSAGE, images: [manifest()] }))).toEqual({ state: "withdrawn" });
    expect(conversationSourceImages(run, null)).toEqual({ state: "absent" });
    expect(conversationSourceImages(run, { status: "truncated", original_bytes: 5, retained_bytes: 0, sha256: HASH })).toEqual({ state: "absent" });
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE }))).toEqual({ state: "absent" });
    expect(conversationSourceImages(run, envelope({ session_id: SESSION, message_id: MESSAGE, images: [] }))).toEqual({ state: "absent" });
  });
});

describe("regression capture version binding", () => {
  const answer = span({ name: "relationship.answer", status: "completed" });
  const detail = (hash: string | null, spans = [answer]) => ({ run: { output_hash: hash }, spans });

  it("binds capture to the exact output hash and resets on run or hash change", () => {
    expect(regressionCaptureSupport(detail(HASH))).toEqual({ supported: true, outputHash: HASH, reason: null });
    expect(regressionCaptureKey({ id: "run-1", output_hash: HASH })).not.toBe(regressionCaptureKey({ id: "run-1", output_hash: "b".repeat(64) }));
    expect(regressionCaptureKey({ id: "run-1", output_hash: HASH })).not.toBe(regressionCaptureKey({ id: "run-2", output_hash: HASH }));
  });

  it("disables capture on a blank or malformed output hash", () => {
    expect(regressionCaptureSupport(detail(null)).reason).toBe("missing-output-hash");
    expect(regressionCaptureSupport(detail("")).reason).toBe("missing-output-hash");
    expect(regressionCaptureSupport(detail("not-a-hash")).reason).toBe("missing-output-hash");
  });

  it("keeps image runs and unprovable inputs non-replayable", () => {
    const imageSpan = span({ name: "relationship.answer", status: "completed", input: envelope({ images: [manifest()] }) });
    expect(regressionCaptureSupport(detail(HASH, [imageSpan]))).toEqual({ supported: false, outputHash: HASH, reason: "image-run" });
    const unproven = span({ name: "relationship.answer", status: "completed", input: { status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null } });
    expect(regressionCaptureSupport(detail(HASH, [unproven])).reason).toBe("input-unproven");
    expect(regressionCaptureSupport(detail(HASH, [])).reason).toBe("unsupported-run");
    const failedAnswer = span({ name: "relationship.answer", status: "failed" });
    expect(regressionCaptureSupport(detail(HASH, [failedAnswer])).reason).toBe("unsupported-run");
  });

  it("never treats a malformed captured input as proven image-free", () => {
    const withInput = (value: unknown) => detail(HASH, [span({ name: "relationship.answer", status: "completed", input: envelope(value) })]);
    expect(regressionCaptureSupport(withInput(null)).reason).toBe("input-unproven");
    expect(regressionCaptureSupport(withInput("text")).reason).toBe("input-unproven");
    expect(regressionCaptureSupport(withInput([manifest()])).reason).toBe("input-unproven");
    expect(regressionCaptureSupport(withInput({ images: "photo.png" })).reason).toBe("input-unproven");
    expect(regressionCaptureSupport(withInput({ images: {} })).reason).toBe("input-unproven");
    // The canonical captured request has no null `images`; a null cannot prove
    // the answer was image-free.
    expect(regressionCaptureSupport(withInput({ images: null })).reason).toBe("input-unproven");
    // Older text records omit `images`; the canonical no-image batch is an
    // explicit empty array. Both are proven image-free.
    expect(regressionCaptureSupport(withInput({}))).toEqual({ supported: true, outputHash: HASH, reason: null });
    expect(regressionCaptureSupport(withInput({ images: [] }))).toEqual({ supported: true, outputHash: HASH, reason: null });
  });

  it("requires a complete captured input and output body like the canonical Lab capture policy", () => {
    const truncatedOutput = span({ name: "relationship.answer", status: "completed",
      output: { status: "truncated", original_bytes: 5, retained_bytes: 0, sha256: HASH } });
    expect(regressionCaptureSupport(detail(HASH, [truncatedOutput])).reason).toBe("input-unproven");
    const redactedInput = span({ name: "relationship.answer", status: "completed", input: envelope({ question: "hi" }, { status: "redacted" }) });
    expect(regressionCaptureSupport(detail(HASH, [redactedInput])).reason).toBe("input-unproven");
  });

  it("exports purpose-bound content with the same captured version", () => {
    const run = {
      id: "run-1", task_id: null, session_id: null, platform: "web", task_kind: "conversation",
      objective: "q", status: "completed", created_at: "2026-10-07T00:00:00.000Z", updated_at: "2026-10-07T00:00:01.000Z",
      duration_ms: 1000, attempts: 1, output_hash: HASH,
      feedback: { revision: 0, sentiment: null, reasons: [], comment: "", correction: "", selected_text: "", updated_at: null },
      model: "m", span_count: 1, content_available: true,
    };
    const detail: ProductRunDetail = {
      contract_version: CONTRACT_VERSION, run, input: envelope({}), output: envelope({}),
      spans: [answer], history: [], execution: null, corrections: [],
    };
    const exported = runReviewExport(detail);
    expect(exported.purpose).toBe("product-run-review-and-case-design");
    expect(exported.feedback_role).toContain("not gold labels");
    expect(exported.captured_output_hash).toBe(HASH);
    expect((exported.run as typeof run).output_hash).toBe(exported.captured_output_hash);
  });
});

describe("run pages and polling schedule", () => {
  it("appends with run-ID deduplication and replaces on the latest page", () => {
    const a = { id: "a" }, b = { id: "b" }, a2 = { id: "a" };
    expect(mergeRunPage([a, b], [a2], true).map(run => run.id)).toEqual(["a", "b"]);
    expect(mergeRunPage(null, [a, b], false).map(run => run.id)).toEqual(["a", "b"]);
    expect(mergeRunPage([a, b], [a2], false).map(run => run.id)).toEqual(["a"]);
  });

  it("keeps 5/10/30 second intervals with a 10 second default", () => {
    expect(REFRESH_INTERVALS_MS).toEqual([5_000, 10_000, 30_000]);
    expect(DEFAULT_REFRESH_INTERVAL_MS).toBe(10_000);
    expect(normalizeRefreshInterval(30_000)).toBe(30_000);
    expect(normalizeRefreshInterval(7_000)).toBe(10_000);
  });

  it("polls only the visible tab, only with auto-refresh on, never overlapping or during pause", () => {
    const base = { visible: true, autoRefresh: true, inFlight: false, paused: false };
    expect(pollTick(base)).toBe(true);
    expect(pollTick({ ...base, visible: false })).toBe(false);
    expect(pollTick({ ...base, autoRefresh: false })).toBe(false);
    expect(pollTick({ ...base, inFlight: true })).toBe(false);
    expect(pollTick({ ...base, paused: true })).toBe(false);
  });

  it("bounds visibility-resume to one immediate fetch per interval", () => {
    expect(resumeFetchDue(null, 10_000, 10_000)).toBe(true);
    expect(resumeFetchDue(5_000, 10_000, 10_000)).toBe(false);
    expect(resumeFetchDue(0, 10_000, 10_000)).toBe(true);
  });
});
