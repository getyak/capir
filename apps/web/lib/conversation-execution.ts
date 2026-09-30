/**
 * Pure projection for the in-place conversation execution surface.
 *
 * The durable conversation queue (snapshot + SSE) and canonical Session history
 * are the only authorities. This module turns those observed states into
 * presentation models; it never infers a tool success, never totals unknown
 * work into a percentage, and never lets an ephemeral preview become
 * persisted or authoritative content.
 *
 * Boundaries:
 * - Stage labels describe real observed stage events only. A stage is an
 *   observation of the current run phase, not a claim that earlier phases
 *   succeeded.
 * - Elapsed time comes from observed timestamps (admission/acceptance and
 *   terminal readback). It never extrapolates a completion estimate.
 * - Presentation pacing coalesces forming text into 500–1000ms updates while
 *   terminal states and errors commit immediately.
 */

import type { ConversationQueueEntry } from "@talent-signal/contracts";

/** Labels for the stage events the runner can actually emit. */
export const CONVERSATION_STAGE_LABELS: Readonly<Record<string, string>> = {
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

/**
 * A stage label for one observed stage string. Unknown or absent stages return
 * null so the surface can stay silent instead of inventing a meaning.
 */
export function conversationStageLabel(stage: string | null | undefined): string | null {
  if (typeof stage !== "string") return null;
  return CONVERSATION_STAGE_LABELS[stage] ?? null;
}

export type ConversationExecutionPhase =
  | "queued"
  | "running"
  | "stopping"
  | "waiting-review"
  | "completed"
  | "failed"
  | "interrupted";

export const CONVERSATION_PHASE_LABELS: Readonly<Record<ConversationExecutionPhase, string>> = {
  queued: "已排队，等待处理",
  running: "执行中",
  stopping: "正在停止",
  "waiting-review": "执行完成，待你确认",
  completed: "执行完成",
  failed: "执行未完成",
  interrupted: "执行已中断",
};

export function conversationExecutionPhaseLabel(phase: ConversationExecutionPhase): string {
  return CONVERSATION_PHASE_LABELS[phase];
}

/**
 * Project the real run phase from the observed queue entry and history
 * readback. `null` means no execution is attached to this message.
 *
 * A completed run is only ever claimed after canonical history readback
 * (`readbackComplete`); the entry alone never proves completion. A completed
 * run with an unresolved memory or calendar decision is `waiting-review`, so a
 * pending decision can never read as a finished execution.
 */
export function conversationExecutionPhase(input: {
  entry?: ConversationQueueEntry | null;
  readbackComplete: boolean;
  awaitingDecision: boolean;
  /** A stopped run whose partial output was persisted under its cancelled identity. */
  interrupted?: boolean;
}): ConversationExecutionPhase | null {
  const entry = input.entry ?? null;
  if (entry) {
    switch (entry.status) {
      case "queued":
        return "queued";
      case "running":
        return entry.cancel_requested ? "stopping" : "running";
      case "completed":
        return input.awaitingDecision ? "waiting-review" : "completed";
      case "failed":
        return "failed";
      case "cancelled":
      case "interrupted":
        return "interrupted";
      default:
        return null;
    }
  }
  if (!input.readbackComplete) return null;
  if (input.interrupted) return "interrupted";
  return input.awaitingDecision ? "waiting-review" : "completed";
}

/**
 * The durable producer marks a stopped run's persisted partial with this task
 * identity (`persistConversationQueueCancellation`). It is the only accepted
 * evidence that a readback turn is an interrupted execution.
 */
export function conversationInterruptedRunTaskID(messageId: string): string {
  return `cancelled-${messageId}`;
}

export function conversationTurnInterrupted(
  response: unknown,
  messageId: string,
): boolean {
  if (!response || typeof response !== "object") return false;
  const taskID = (response as { taskID?: unknown }).taskID;
  return typeof taskID === "string"
    && taskID.toLowerCase() === conversationInterruptedRunTaskID(messageId).toLowerCase();
}

export type ConversationExecutionMilestone = {
  /** Real observed stage identifier; unknown stages keep their raw value. */
  stage: string;
  label: string;
  /** Observed timestamp (ISO) when this stage was first seen. */
  observedAt: string;
};

export const CONVERSATION_MILESTONE_LIMIT = 12;

/**
 * Append one milestone only when a real stage transition is observed. Repeat
 * frames of the same stage add nothing, and a missing stage never produces a
 * milestone, so no milestone list can imply an unobserved success.
 */
export function conversationObservedMilestone(
  previous: readonly ConversationExecutionMilestone[],
  stage: string | null | undefined,
  observedAt: string,
): ConversationExecutionMilestone[] {
  if (typeof stage !== "string" || stage.length === 0) return [...previous];
  const last = previous.at(-1);
  if (last?.stage === stage) return [...previous];
  const next = [...previous, { stage, label: conversationStageLabel(stage) ?? stage, observedAt }];
  return next.slice(-CONVERSATION_MILESTONE_LIMIT);
}

/**
 * Elapsed time between observed timestamps. `nowMs` is used only while the run
 * is still open; a terminal `endedAt` pins the value so a reopened transcript
 * keeps the truthful duration instead of a growing one.
 */
export function conversationElapsedMs(input: {
  startedAt: string;
  nowMs: number;
  endedAt?: string | null;
}): number {
  const started = Date.parse(input.startedAt);
  if (!Number.isFinite(started)) return 0;
  const ended = input.endedAt ? Date.parse(input.endedAt) : input.nowMs;
  return Math.max(0, (Number.isFinite(ended) ? ended : input.nowMs) - started);
}

/** Human-readable elapsed label; only whole observed time is shown. */
export function conversationElapsedLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
  if (minutes > 0) return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  return `${seconds} 秒`;
}

/** Pending memory or calendar decisions stay distinct from execution state. */
export function conversationAwaitingDecision(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const record = response as { memoryProposal?: unknown; meetingDraft?: unknown };
  return Boolean(record.memoryProposal ?? record.meetingDraft);
}

/**
 * Presentation pacing for forming text.
 *
 * Progress updates are coalesced to at most one commit per interval
 * (500–1000ms range; 600ms default) while a terminal update or a new run
 * commits immediately. Lower or equal revisions and different run identities
 * are fenced here as well, so stale frames can never repaint newer output.
 */
export const CONVERSATION_PRESENTATION_INTERVAL_MS = 600;

export type ConversationPresentationState = {
  runId: string | null;
  revision: number;
  text: string;
  stage: string | null;
  /** Timestamp (ms) of the last committed paint; 0 paints the first update. */
  lastCommitAt: number;
  dirty: boolean;
};

export type ConversationPresentationUpdate = {
  runId: string | null;
  revision: number;
  text: string;
  stage: string | null;
  nowMs: number;
  /** Terminal states and errors bypass the pacing interval. */
  terminal?: boolean;
};

export function conversationPresentationInitial(nowMs = 0): ConversationPresentationState {
  return { runId: null, revision: 0, text: "", stage: null, lastCommitAt: nowMs, dirty: false };
}

export function conversationPresentationStep(
  state: ConversationPresentationState,
  update: ConversationPresentationUpdate,
  intervalMs = CONVERSATION_PRESENTATION_INTERVAL_MS,
): { state: ConversationPresentationState; commit: boolean } {
  // Stale or out-of-order frames are dropped without touching the paint state.
  if (update.runId !== null && state.runId !== null && update.runId === state.runId && update.revision < state.revision) {
    return { state, commit: false };
  }
  // A non-null run identity that differs from the painted one is a new run;
  // its revision sequence starts over. An idle frame is never a fresh run.
  const freshRun = update.runId !== null && update.runId !== state.runId;
  const changed = update.text !== state.text || update.stage !== state.stage;
  if (!freshRun && !changed && !update.terminal) return { state, commit: false };
  const base: ConversationPresentationState = {
    runId: update.runId,
    revision: freshRun ? update.revision : Math.max(state.revision, update.revision),
    text: update.text,
    stage: update.stage,
    lastCommitAt: state.lastCommitAt,
    dirty: state.dirty,
  };
  if (update.terminal || freshRun || state.lastCommitAt === 0 || update.nowMs - state.lastCommitAt >= intervalMs) {
    return { state: { ...base, lastCommitAt: update.nowMs, dirty: false }, commit: true };
  }
  return { state: { ...base, dirty: true }, commit: false };
}

/** Remaining wait before a dirty progress update may paint; 0 when free. */
export function conversationPresentationDelay(
  state: ConversationPresentationState,
  nowMs: number,
  intervalMs = CONVERSATION_PRESENTATION_INTERVAL_MS,
): number {
  if (!state.dirty) return 0;
  return Math.max(0, intervalMs - (nowMs - state.lastCommitAt));
}

export type ConversationKeyAction = "none" | "pause-run";
/**
 * Short-form forming output into milestone-only dialogue updates.
 *
 * Live updates are milestones, not the result: each unit keeps its sentence or
 * line boundary, is capped at `limit`, and only the most recent `maxUpdates`
 * stay on screen. Complete semantic content is only ever shown from the
 * persisted terminal result.
 */
export function conversationMilestoneUpdates(
  text: string,
  limit = 200,
  maxUpdates = 6,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const units = trimmed.split(/\n+/u).flatMap(splitSentences);
  const bounded = units.map((unit) =>
    unit.length <= limit ? unit : `${unit.slice(0, limit).trimEnd()}…`);
  return bounded.slice(-maxUpdates);
}

/** Sentence-shaped units that keep their terminators and never split decimals. */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    const next = line[index + 1];
    const boundary = "。！？".includes(char)
      || ((".!?".includes(char)) && (next === undefined || /\s/u.test(next)));
    if (!boundary) { index += 1; continue; }
    let end = index + 1;
    while (end < line.length && "。！？.!?”\"』」'".includes(line[end]!)) end += 1;
    const unit = line.slice(start, end).trim();
    if (unit) out.push(unit);
    start = end;
    index = end;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Escape pauses the queue while a run is live. IME composition always owns
 * Enter and Escape: a composing or Safari 229 key event is never an action.
 */
export function conversationRunKeyAction(input: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  hasActiveRun: boolean;
}): ConversationKeyAction {
  if (input.isComposing || input.keyCode === 229) return "none";
  if (input.key === "Escape" && input.hasActiveRun) return "pause-run";
  return "none";
}
