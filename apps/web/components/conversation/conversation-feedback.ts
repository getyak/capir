import type { ConversationImageManifest, ConversationQueueEntry, ConversationQueueSnapshot } from "@talent-signal/contracts";
import type { Delivery } from "@/lib/conversation-local";

/**
 * Truthful feedback derivation for one conversation message.
 *
 * Every status text below is derived from an actually observed state: the
 * local delivery phase, the server queue row, the observed run stage, the
 * observed completion/stop outcome of the last run, or the connection. The
 * result never fabricates an acknowledgement, a tool action, a completed
 * effect, or a predicted percentage/elapsed time. Pending and sending stay
 * distinct from accepted-waiting, active, reconnecting, paused, failure,
 * stopped, readback and the persisted final answer.
 */

/** Observed run stage labels. No stage claims an effect beyond its name. */
export const runStageText: Record<string, string> = {
  queued: "等待开始",
  preparing: "正在准备回复",
  thinking: "正在处理",
  contact_lookup: "正在查找相关人物",
  contact_read: "正在阅读相关记录",
  calendar_draft: "正在整理日程草稿",
  answer: "正在回复",
  responding: "正在回复",
  persisting: "正在保存回复",
  running: "正在处理",
};

export function queueFailureText(code: string | null, hasImages: boolean): string {
  if (code === "MODEL_RUN_TIMEOUT") return hasImages
    ? "图片分析超时，原图已保留。可重试；反复失败时请移除并重新发送较小的图片。"
    : "本次处理超时，消息已保留。可重试。";
  return "上次未完成，请重试或移除";
}

export type ConversationWorkPhase =
  | "settled"
  | "unknown"
  | "rejected"
  | "pending"
  | "sending"
  | "waiting"
  | "queued"
  | "paused"
  | "running"
  | "stopping"
  | "stopped"
  | "readback"
  | "reconnecting"
  | "failed";

export type ConversationWorkStatus = {
  phase: ConversationWorkPhase;
  /** Readable current status; empty only when canonical history owns the message. */
  text: string;
  /** Restrained pulse; never on stopped, paused, failed or unconfirmed turns. */
  animate: boolean;
  /** Explicit recoverable affordance: same-ID check/retry or a passive refresh. */
  recover: "check" | "refresh" | null;
};

export function conversationWorkStatus(input: {
  delivery: Delivery;
  error?: string;
  /** Canonical history already carries this message identity. */
  settled: boolean;
  /** The server queue row (active or queued) for this exact message id. */
  entry: ConversationQueueEntry | null;
  entrySlot: "active" | "queued" | null;
  paused: boolean;
  connection: "connecting" | "live" | "reconnecting";
  /** Observed preview stage for the active run, falling back to the entry stage. */
  stage: string | null;
  /** Observed outcome of the last run that left the active slot. */
  outcome: "completed" | "stopped" | null;
  readbackStalled: boolean;
  hasImages: boolean;
}): ConversationWorkStatus {
  const base = { animate: false, recover: null } as const;
  let status: ConversationWorkStatus;
  if (input.settled) {
    status = { ...base, phase: "settled", text: "" };
  } else if (input.delivery === "unknown") {
    // A receipt we cannot confirm is never shown as confirmed processing; it
    // keeps its explicit same-ID check and retry.
    status = { ...base, phase: "unknown", text: input.error || "送达结果尚未确认，请核对后重试。", recover: "check" };
  } else if (input.delivery === "rejected") {
    status = { ...base, phase: "rejected", text: input.error || "送达结果尚未确认，请核对后重试。", recover: "check" };
  } else if (input.delivery === "pending") {
    status = { ...base, phase: "pending", text: "等待送达", animate: true };
  } else if (input.delivery === "sending") {
    status = { ...base, phase: "sending", text: "正在送达…", animate: true };
  } else if (input.entry && (input.entry.status === "failed" || input.entry.status === "interrupted")) {
    status = { ...base, phase: "failed", text: queueFailureText(input.entry.failure_code, input.hasImages || Boolean(input.entry.images?.length)) };
  } else if (input.entrySlot === "active" && input.entry) {
    status = input.entry.cancel_requested
      ? { ...base, phase: "stopping", text: "正在停止…", animate: true }
      : { ...base, phase: "running", text: runStageText[input.stage ?? input.entry.stage ?? ""] ?? "正在处理", animate: true };
  } else if (input.entrySlot === "queued") {
    status = input.paused
      ? { ...base, phase: "paused", text: "已暂停，继续后按此顺序处理" }
      : { ...base, phase: "queued", text: "排队等待处理", animate: true };
  } else if (input.outcome === "stopped") {
    // The stop was observed; a stopped turn never animates.
    status = { ...base, phase: "stopped", text: "已停止", recover: "refresh" };
  } else if (input.outcome === "completed") {
    // The run left the active slot without a failure or stop: its canonical
    // turn is persisted server-side and the readback is still pending.
    status = input.readbackStalled
      ? { ...base, phase: "readback", text: "回复读取尚未完成，可刷新查看", recover: "refresh" }
      : { ...base, phase: "readback", text: "正在读取回复…" };
  } else {
    // Accepted, but no status flow has been observed yet: waiting for reply
    // status. Never claim the run is active.
    status = { ...base, phase: "waiting", text: "等待回复状态", animate: true };
  }
  // While the status feed cannot deliver state, the connection is the actual
  // current status for every phase that depends on it.
  const feedPhases: ConversationWorkPhase[] = ["waiting", "queued", "running", "stopping"];
  if (input.connection === "reconnecting" && feedPhases.includes(status.phase)) {
    return { ...status, phase: "reconnecting", text: "连接恢复中，消息已保留", animate: false };
  }
  return status;
}

/** Exact ordered source handoff; matching counts alone cannot retire bytes. */
export function sameConversationImages(left: readonly ConversationImageManifest[] = [], right: readonly ConversationImageManifest[] = []): boolean {
  return left.length === right.length && left.every((image, index) => {
    const other = right[index];
    return other && image.attachment_id === other.attachment_id && image.content_hash === other.content_hash && image.byte_size === other.byte_size && image.media_type === other.media_type && image.file_name === other.file_name;
  });
}

export function unresolvedConversationCount(messages: readonly { id: string }[], snapshot: ConversationQueueSnapshot | null): number {
  return new Set([...messages.map(message => message.id), ...(snapshot?.queued ?? []).map(entry => entry.message_id), ...(snapshot?.active ? [snapshot.active.message_id] : [])]).size;
}
