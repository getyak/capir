/**
 * Pure monitor policy for the product run monitor.
 *
 * Framework-free truth helpers shared by the monitor surface and its tests:
 * exact status labels, honest duration states, separate failed-tool semantics,
 * compact span lineage, captured-content size states, conversation source-image
 * identity validation, regression capture version binding, run-page merging and
 * the polling schedule decision. Nothing here fetches, schedules or executes a
 * provider or job; polling reads are ordinary authenticated GETs owned by the
 * component wiring.
 */
import type { ProductRunDetail, ProductRunSummary } from "@talent-signal/contracts";

type Span = ProductRunDetail["spans"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OUTPUT_HASH = /^[a-f0-9]{64}$/iu;
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** The admitted conversation batch contract: at most 10 images and 30 MB total. */
const CONVERSATION_IMAGE_MAX = 10;
const CONVERSATION_IMAGE_TOTAL_BYTES = 30_000_000;

/* ------------------------------------------------------------------ */
/* Status and duration semantics                                       */
/* ------------------------------------------------------------------ */

export const RUN_STATUS_LABELS: Record<string, string> = {
  completed: "已完成",
  running: "运行中",
  failed: "失败",
  fallback: "已降级",
  interrupted: "已中断",
  waiting_for_user: "待确认",
  partial: "部分完成",
  cancelled: "已停止",
};

export type StatusPhase =
  | "running" | "completed" | "failed" | "cancelled"
  | "interrupted" | "waiting" | "partial" | "fallback" | "unknown";

/** Terminal indicator class. Unknown statuses stay unknown; never folded into completed. */
export function statusPhase(status: string): StatusPhase {
  switch (status) {
    case "running": return "running";
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "interrupted": return "interrupted";
    case "waiting_for_user": return "waiting";
    case "partial": return "partial";
    case "fallback": return "fallback";
    default: return "unknown";
  }
}

/** Exact label for a known status; an unknown status is shown verbatim. */
export function statusLabel(status: string): string {
  return Object.hasOwn(RUN_STATUS_LABELS, status) ? RUN_STATUS_LABELS[status] : status;
}

/** Only an actually running run may read "in progress". */
export function isRunning(status: string): boolean {
  return status === "running";
}

/**
 * Run duration: a recorded duration formats normally; a missing duration reads
 * "in progress" only while the run is actually running, and "unknown" on every
 * terminal or unknown status instead of pretending it is still executing.
 */
export function formatRunDuration(durationMs: number | null | undefined, status: string): string {
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    return `${(Math.max(0, durationMs) / 1000).toFixed(2)} s`;
  }
  return isRunning(status) ? "进行中" : "耗时未知";
}

/**
 * Span duration: malformed or inverted timestamps read "unknown" on terminal
 * spans and "in progress" only while the span is actually running.
 */
export function formatSpanDuration(span: { started_at: string; finished_at: string; status: string }): string {
  const started = Date.parse(span.started_at);
  const finished = Date.parse(span.finished_at);
  if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
    return `${finished - started} ms`;
  }
  return isRunning(span.status) ? "进行中" : "耗时未知";
}

/* ------------------------------------------------------------------ */
/* Trace summary semantics                                             */
/* ------------------------------------------------------------------ */

export type TraceStats = {
  /** Total recorded spans; its own semantic, never a success claim. */
  spanCount: number;
  /** Failed tool spans, shown separately from the final run status. */
  failedToolCount: number;
  /** All failed spans regardless of kind. */
  failedSpanCount: number;
};

/** Failed tools are counted on their own; a completed run never implies all tools succeeded. */
export function traceStats(spans: readonly { kind: string; status: string }[]): TraceStats {
  let failedToolCount = 0;
  let failedSpanCount = 0;
  for (const span of spans) {
    if (span.status !== "failed") continue;
    failedSpanCount += 1;
    if (span.kind === "tool") failedToolCount += 1;
  }
  return { spanCount: spans.length, failedToolCount, failedSpanCount };
}

export type TraceRow<T> = {
  span: T;
  /** Compact indent depth from the parent chain (cycle-safe). */
  depth: number;
  /** Explicit parent name; lineage is named, not implied as sequence. */
  parentName: string | null;
};

/** Recorded order is preserved; hierarchy is indentation plus explicit parent names. */
export function traceRows(spans: readonly Span[]): TraceRow<Span>[] {
  const byID = new Map(spans.map((span) => [span.id, span]));
  return spans.map((span) => {
    let depth = 0;
    const seen = new Set<string>([span.id]);
    let parent = span.parent_id ? byID.get(span.parent_id) ?? null : null;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      depth += 1;
      parent = parent.parent_id ? byID.get(parent.parent_id) ?? null : null;
    }
    return { span, depth, parentName: span.parent_id ? byID.get(span.parent_id)?.name ?? null : null };
  });
}

/* ------------------------------------------------------------------ */
/* Captured-content size states                                        */
/* ------------------------------------------------------------------ */

export type ContentEnvelope = {
  status: string;
  originalBytes: number;
  retainedBytes: number;
  hasValue: boolean;
  value: unknown;
};

const CONTENT_STATES = new Set(["complete", "redacted", "truncated", "unavailable"]);

/** Unwrap a persisted `{status,value}` capture envelope; plain payloads return null. */
export function contentEnvelope(value: unknown): ContentEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.status !== "string" || !CONTENT_STATES.has(data.status)) return null;
  if (typeof data.original_bytes !== "number" || typeof data.retained_bytes !== "number") return null;
  if (!("sha256" in data)) return null;
  return {
    status: data.status,
    originalBytes: data.original_bytes,
    retainedBytes: data.retained_bytes,
    hasValue: "value" in data && data.value !== undefined,
    value: data.value,
  };
}

function formatBytes(bytes: number): string {
  const safe = Math.max(0, Math.round(bytes));
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  return `${(safe / 1024 / 1024).toFixed(1)} MB`;
}

/** Redacted / truncated / unavailable read explicitly; never silent about sizes. */
export function contentStateText(envelope: ContentEnvelope): string {
  switch (envelope.status) {
    case "complete": return `完整 · ${formatBytes(envelope.retainedBytes)}`;
    case "redacted": return `已脱敏（凭证已移除） · ${formatBytes(envelope.retainedBytes)}`;
    case "truncated": return `已截断，未保留正文 · 原始 ${formatBytes(envelope.originalBytes)}`;
    case "unavailable": return "未记录";
    default: return envelope.status;
  }
}

/* ------------------------------------------------------------------ */
/* Conversation source images                                          */
/* ------------------------------------------------------------------ */

export type ConversationImageRef = {
  /** Immutable manifest array position; identity is never a file name. */
  index: number;
  attachmentId: string;
  /** Display label only; never used as identity. */
  fileName: string;
  route: string;
};

export type ConversationSourceImages =
  | { state: "absent" }
  | { state: "withdrawn" }
  | { state: "invalid" }
  | { state: "ready"; sessionId: string; messageId: string; images: ConversationImageRef[] };

/** The existing authenticated readback route for one exact message image. */
export function conversationImageRoute(sessionId: string, messageId: string, index: number): string {
  return `/api/workspace-sessions/${encodeURIComponent(sessionId)}/conversation-images/${encodeURIComponent(messageId)}/${index}`;
}

function validManifest(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return typeof manifest.attachment_id === "string" && UUID.test(manifest.attachment_id)
    && typeof manifest.file_name === "string" && manifest.file_name.length >= 1 && manifest.file_name.length <= 200
    && typeof manifest.media_type === "string" && MEDIA_TYPES.has(manifest.media_type)
    && typeof manifest.byte_size === "number" && Number.isInteger(manifest.byte_size)
    && manifest.byte_size >= 1 && manifest.byte_size <= 10_000_000
    && typeof manifest.content_hash === "string" && OUTPUT_HASH.test(manifest.content_hash);
}

/**
 * Conversation originals come only from the persisted `detail.input` envelope:
 * `task_kind === "conversation"`, an available source, the run's own persisted
 * session binding matching the captured identity, a validated message identity
 * and validated image manifests in immutable array order. Nothing falls back to
 * another session/message or to file names, malformed or over-contract batches
 * are rejected wholesale (no partial list, no renumbering), and no image is
 * produced when the context is absent or withdrawn.
 */
export function conversationSourceImages(
  run: Pick<ProductRunSummary, "task_kind" | "content_available" | "session_id">,
  input: unknown,
): ConversationSourceImages {
  if (run.task_kind !== "conversation") return { state: "absent" };
  if (!run.content_available) return { state: "withdrawn" };
  // A missing run session binding can never authorize an image identity.
  if (typeof run.session_id !== "string" || !UUID.test(run.session_id)) return { state: "invalid" };
  const envelope = contentEnvelope(input);
  if (!envelope || !envelope.hasValue) return { state: "absent" };
  // Only the captured states that may legitimately carry a body drive identity;
  // a stray value inside an unavailable/truncated envelope is never trusted.
  if (envelope.status !== "complete" && envelope.status !== "redacted") return { state: "invalid" };
  const value = envelope.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "invalid" };
  const data = value as Record<string, unknown>;
  const images = data.images;
  if (images === undefined) return { state: "absent" };
  if (!Array.isArray(images)) return { state: "invalid" };
  const sessionId = data.session_id;
  const messageId = data.message_id;
  // The captured session must be the run's own persisted session; a missing or
  // conflicting identity never constructs a route.
  if (typeof sessionId !== "string" || !UUID.test(sessionId) || sessionId !== run.session_id
    || typeof messageId !== "string" || !UUID.test(messageId)) return { state: "invalid" };
  if (!images.length) return { state: "absent" };
  if (images.length > CONVERSATION_IMAGE_MAX) return { state: "invalid" };
  const refs: ConversationImageRef[] = [];
  const attachments = new Set<string>();
  let totalBytes = 0;
  for (const [index, item] of images.entries()) {
    // A batch that cannot be validated wholesale is rejected wholesale: the
    // route index is the manifest position, so a partial list would renumber.
    if (!validManifest(item)) return { state: "invalid" };
    const attachmentID = item.attachment_id as string;
    if (attachments.has(attachmentID)) return { state: "invalid" };
    attachments.add(attachmentID);
    totalBytes += item.byte_size as number;
    refs.push({
      index,
      attachmentId: attachmentID,
      fileName: item.file_name as string,
      route: conversationImageRoute(sessionId, messageId, index),
    });
  }
  if (totalBytes > CONVERSATION_IMAGE_TOTAL_BYTES) return { state: "invalid" };
  return { state: "ready", sessionId, messageId, images: refs };
}

/* ------------------------------------------------------------------ */
/* Regression capture version binding                                  */
/* ------------------------------------------------------------------ */

export type RegressionCaptureSupport =
  | { supported: true; outputHash: string; reason: null }
  | { supported: false; outputHash: string | null; reason: "missing-output-hash" | "image-run" | "input-unproven" | "unsupported-run" };

/**
 * A regression case binds to one exact output version. A missing or malformed
 * output hash disables capture outright, and replay support mirrors the
 * canonical Lab capture policy: a completed `relationship.answer` span with a
 * complete captured input AND output body whose input object proves it carried
 * no images. An older text record with no `images` key is valid; an explicit
 * empty array is valid; a non-object input or a malformed `images` property is
 * never replay-capable, and image runs stay non-replayable.
 */
export function regressionCaptureSupport(
  detail: { run: Pick<ProductRunSummary, "output_hash">; spans: readonly Span[] },
): RegressionCaptureSupport {
  const hash = typeof detail.run.output_hash === "string" && detail.run.output_hash ? detail.run.output_hash : null;
  if (!hash || !OUTPUT_HASH.test(hash)) return { supported: false, outputHash: hash, reason: "missing-output-hash" };
  const answers = detail.spans.filter((span) => span.name === "relationship.answer" && span.status === "completed");
  if (!answers.length) return { supported: false, outputHash: hash, reason: "unsupported-run" };
  for (const span of answers) {
    const input = contentEnvelope(span.input);
    const output = contentEnvelope(span.output);
    if (!input || input.status !== "complete" || !input.hasValue
      || !output || output.status !== "complete" || !output.hasValue) {
      return { supported: false, outputHash: hash, reason: "input-unproven" };
    }
    const value = input.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { supported: false, outputHash: hash, reason: "input-unproven" };
    }
    const images = (value as Record<string, unknown>).images;
    // Absent `images` is the older text-only record shape; an explicit empty
    // array is the canonical no-image batch. Anything else cannot prove the
    // answer was image-free.
    if (images === undefined) continue;
    if (!Array.isArray(images)) return { supported: false, outputHash: hash, reason: "input-unproven" };
    if (images.length) return { supported: false, outputHash: hash, reason: "image-run" };
  }
  return { supported: true, outputHash: hash, reason: null };
}

/** Capture state resets when either the run ID or the exact output hash changes. */
export function regressionCaptureKey(run: { id: string; output_hash: string | null }): string {
  return `${run.id}:${run.output_hash ?? "unversioned"}`;
}

/** Purpose-bound review export carrying the same captured version it reviews. */
export function runReviewExport(detail: ProductRunDetail): Record<string, unknown> {
  return {
    ...detail,
    schema_version: "product-run-review.v1",
    purpose: "product-run-review-and-case-design",
    feedback_role: "user feedback only; not gold labels",
    captured_run_id: detail.run.id,
    captured_output_hash: detail.run.output_hash,
  };
}

/* ------------------------------------------------------------------ */
/* Run page merging                                                    */
/* ------------------------------------------------------------------ */

/** Appended pages keep first-seen order and deduplicate run IDs. */
export function mergeRunPage<T extends { id: string }>(current: readonly T[] | null, incoming: readonly T[], append: boolean): T[] {
  const merged = append && current ? [...current, ...incoming] : [...incoming];
  const seen = new Set<string>();
  return merged.filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Polling schedule decisions                                          */
/* ------------------------------------------------------------------ */

export const REFRESH_INTERVALS_MS = [5_000, 10_000, 30_000] as const;
export const DEFAULT_REFRESH_INTERVAL_MS = 10_000;

export function normalizeRefreshInterval(value: unknown): number {
  return (REFRESH_INTERVALS_MS as readonly number[]).includes(value as number)
    ? value as number
    : DEFAULT_REFRESH_INTERVAL_MS;
}

export type PollTickState = {
  /** The monitor tab is the visible tab. */
  visible: boolean;
  autoRefresh: boolean;
  /** A fetch for this stream is still in flight; never overlap or queue ticks. */
  inFlight: boolean;
  /** Latest-page polling is paused, e.g. while paging through history. */
  paused?: boolean;
};

export function pollTick(state: PollTickState): boolean {
  return state.visible && state.autoRefresh && !state.inFlight && !state.paused;
}

/**
 * Visibility resume runs one bounded immediate fetch: at most one per interval
 * per stream, never a burst that replays every hidden tick.
 */
export function resumeFetchDue(lastFetchedAt: number | null, now: number, intervalMs: number): boolean {
  return lastFetchedAt === null || now - lastFetchedAt >= intervalMs;
}
