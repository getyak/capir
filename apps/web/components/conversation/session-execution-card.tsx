"use client";

import { useEffect, useState } from "react";

import {
  conversationElapsedLabel,
  conversationElapsedMs,
  conversationExecutionPhaseLabel,
  conversationStageLabel,
  type ConversationExecutionMilestone,
  type ConversationExecutionPhase,
} from "@/lib/conversation-execution";
import { ConversationResponse } from "../conversation-response";
import styles from "./queued-conversation.module.css";

function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * In-place collapsible execution card.
 *
 * It reports only observed run state and elapsed observed time. There is no
 * progress percentage because total work is unknown, and a stage list is a
 * record of observed stages, never a claim that earlier phases succeeded.
 * Terminal phases keep their elapsed time pinned to the terminal timestamp.
 */
export function SessionExecutionCard({
  phase,
  stage,
  startedAt,
  endedAt,
  milestones,
  failureCode,
  defaultOpen = false,
}: {
  phase: ConversationExecutionPhase;
  stage: string | null;
  startedAt: string;
  endedAt?: string | null;
  milestones: readonly ConversationExecutionMilestone[];
  failureCode?: string | null;
  defaultOpen?: boolean;
}) {
  const live = !endedAt && (phase === "queued" || phase === "running" || phase === "stopping");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    // Reduced motion keeps the clock: elapsed time is text, not animation.
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const elapsedMs = conversationElapsedMs({ startedAt, nowMs, endedAt });
  const stageLabel = conversationStageLabel(stage);
  return (
    <details className={styles.execution} data-phase={phase} data-run-stage={stage ?? undefined} open={defaultOpen}>
      <summary className={styles.executionSummary}>
        <span className={styles.executionState}>{conversationExecutionPhaseLabel(phase)}</span>
        {stageLabel && live ? <span className={styles.executionStage}>{stageLabel}</span> : null}
        <span className={styles.executionElapsed} data-elapsed-ms={elapsedMs}>用时 {conversationElapsedLabel(elapsedMs)}</span>
      </summary>
      <div className={styles.executionDetail}>
        {failureCode ? <p className={styles.executionFailure}>失败代码：{failureCode}</p> : null}
        {milestones.length > 0 ? (
          <ol className={styles.executionMilestones}>
            {milestones.map((milestone) => (
              <li key={`${milestone.stage}:${milestone.observedAt}`}>
                <span>{milestone.label}</span>
                <time dateTime={milestone.observedAt}>{clock(milestone.observedAt)}</time>
              </li>
            ))}
          </ol>
        ) : null}
        <p className={styles.executionTimes}>
          开始 {clock(startedAt) || "未记录"}
          {endedAt ? ` · 结束 ${clock(endedAt) || "未记录"}` : live ? " · 仍在进行" : ""}
        </p>
      </div>
    </details>
  );
}

/**
 * Milestone-only dialogue updates for the live run.
 *
 * The lines are the run's real visible output so far, always presented as
 * ephemeral updates that are replaced by the persisted semantic result after
 * terminal readback. With no visible output yet the observed stage stands in;
 * silence is valid and never filled with invented content.
 */
export function SessionRunUpdate({ updates, stage, status }: { updates: readonly string[]; stage: string | null; status: string }) {
  if (!updates.length) {
    return <div className={styles.waiting}><span className={styles.pulse} aria-hidden="true"/>{conversationStageLabel(stage) ?? (status || "正在处理")}</div>;
  }
  return <>{updates.map((line, index) => (
    <div className={styles.milestone} data-run-update key={`${index}:${line.slice(0, 24)}`}>
      {/* Markdown keeps code, lists and tables intact while output forms. */}
      <ConversationResponse>{line}</ConversationResponse>
      {index === updates.length - 1 ? <span className={styles.cursor} aria-hidden="true"/> : null}
    </div>
  ))}</>;
}

/** Centered per-send timestamp above each user send. */
export function SessionSendTime({ at }: { at: unknown }) {
  const value = typeof at === "string" ? new Date(at) : at instanceof Date ? at : null;
  if (!value || Number.isNaN(value.getTime())) return null;
  const now = new Date();
  const time = value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const label = value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth() && value.getDate() === now.getDate()
    ? `今天 ${time}`
    : `${value.getMonth() + 1}月${value.getDate()}日 ${time}`;
  return <div className={styles.sendTime}>{label}</div>;
}
