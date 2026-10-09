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
import { siteConfig } from "@/lib/site";
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
  draft,
  completedTools = [],
  timingBasis = "run",
}: {
  phase: ConversationExecutionPhase;
  stage: string | null;
  startedAt: string;
  endedAt?: string | null;
  milestones: readonly ConversationExecutionMilestone[];
  failureCode?: string | null;
  defaultOpen?: boolean;
  draft?: string;
  completedTools?: readonly { name: string; completed_at: string }[];
  timingBasis?: "run" | "receipt";
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
    <details className={styles.execution} data-phase={phase} data-run-stage={stage ?? undefined} data-live={live ? "true" : undefined} open={defaultOpen}>
      <summary className={styles.executionSummary} title={live ? stageLabel ?? undefined : undefined}>
        {live ? <span className={styles.workingName}>{siteConfig.name}</span> : null}
        <span className={styles.executionState} role={live ? "status" : undefined}>{phase === "running" && live ? "正在处理" : conversationExecutionPhaseLabel(phase)}</span>
        {completedTools.length > 0 ? <span className={styles.executionStage}>已记录 {completedTools.length} 次工具完成</span> : null}
        <span className={styles.executionElapsed} data-elapsed-ms={elapsedMs}>{phase === "queued" ? "已等待" : timingBasis === "receipt" ? "记录跨度" : "用时"} {conversationElapsedLabel(elapsedMs)}</span>
      </summary>
      <div className={styles.executionDetail}>
        {stageLabel && live ? <p>{stageLabel}</p> : null}
        {failureCode ? <p className={styles.executionFailure}>失败代码：{failureCode}</p> : null}
        {completedTools.length > 0 ? <ol className={styles.executionMilestones} aria-label="工具完成记录">
          {completedTools.map((tool, index) => <li key={`${index}:${tool.completed_at}`}>
            <span>{tool.name}</span><time dateTime={tool.completed_at}>{clock(tool.completed_at)}</time>
          </li>)}
        </ol> : null}
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
        {draft && <div className={styles.executionDraft} aria-label="回复草稿，尚未完成"><ConversationResponse>{draft}</ConversationResponse></div>}
        <p className={styles.executionTimes}>
          {timingBasis === "receipt" ? "消息接收" : "开始"} {clock(startedAt) || "未记录"}
          {endedAt ? ` · ${timingBasis === "receipt" ? "结果记录" : "结束"} ${clock(endedAt) || "未记录"}` : live ? " · 仍在进行" : ""}
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
export function SessionRunUpdate({ updates }: { updates: readonly string[]; stage: string | null; status: string }) {
  if (!updates.length) return null;
  return <>{updates.map((line, index) => (
    <div className={styles.milestone} data-run-update key={`${index}:${line.slice(0, 24)}`}>
      {/* Host dialogue updates contain one complete semantic unit. */}
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
    : `${value.getFullYear() === now.getFullYear() ? "" : `${value.getFullYear()}年`}${value.getMonth() + 1}月${value.getDate()}日 ${time}`;
  return <time className={styles.sendTime} dateTime={value.toISOString()} title={value.toLocaleString("zh-CN")}>{label}</time>;
}
