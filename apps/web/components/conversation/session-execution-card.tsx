"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  conversationElapsedLabel,
  conversationElapsedMs,
  conversationExecutionPhaseLabel,
  conversationStageLabel,
  type ConversationExecutionMilestone,
  type ConversationExecutionPhase,
} from "@/lib/conversation-execution";
import { siteConfig } from "@/lib/site";
import { useLocale, useT } from "../locale-provider";
import type { LocaleTag } from "@talent-signal/contracts";
import { ConversationResponse } from "../conversation-response";
import styles from "./queued-conversation.module.css";
import executionStyles from "./session-execution-card.module.css";
import { ProcessingLabel } from "./processing-label";
import { executionToolLabelKey } from "./session-execution-tool-labels";

function clock(iso: string | null | undefined, locale: LocaleTag): string {
  if (!iso) return "";
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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
  statusInHeader = false,
  children,
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
  statusInHeader?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const live = !endedAt && (phase === "queued" || phase === "running" || phase === "stopping");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    // Reduced motion keeps the clock: elapsed time is text, not animation.
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const elapsedMs = conversationElapsedMs({ startedAt, nowMs, endedAt });
  const stageLabel = conversationStageLabel(stage, locale);
  return (
    <>
    {live ? <div className={executionStyles.progress} data-run-progress>
      {draft?.trim() ? <section aria-label={t("回复草稿，尚未完成")}>
        <p className={executionStyles.draftLabel}>{t("回复草稿，尚未完成")}</p>
        <div className={styles.semanticBubble} data-presentation="prose"><ConversationResponse>{draft}</ConversationResponse></div>
        {phase === "running" ? <span className={styles.cursor} aria-hidden="true"/> : null}
      </section> : <p className={executionStyles.stage} role={statusInHeader ? undefined : "status"}>
        {!statusInHeader ? <span className={styles.workingName}>{siteConfig.name}</span> : null}
        <ProcessingLabel animated={phase === "running"}>{phase === "running" ? stageLabel ?? conversationExecutionPhaseLabel(phase, locale) : conversationExecutionPhaseLabel(phase, locale)}</ProcessingLabel>
      </p>}
    </div> : null}
    <details className={`${styles.execution} ${phase === "completed" ? executionStyles.completed : ""}`} data-phase={phase} data-run-stage={stage ?? undefined} data-live={live ? "true" : undefined} open={defaultOpen} onKeyDown={event => {
      if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      // An older inspected record can remain open after a new run takes over.
      // Closing that record must never reach the canvas shortcut for Stop.
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
    }}>
      <summary className={styles.executionSummary} title={live ? stageLabel ?? undefined : undefined}>
        {phase === "completed" || live ? <span>{t("conversation.task.record")}</span> : <span className={styles.executionState}>{conversationExecutionPhaseLabel(phase, locale)}</span>}
      </summary>
      <div className={styles.executionDetail}>
        <p className={styles.executionElapsed} data-elapsed-ms={elapsedMs}>{t(phase === "queued" ? "已等待" : timingBasis === "receipt" ? "记录跨度" : "用时")} {conversationElapsedLabel(elapsedMs, locale)}</p>
        {stageLabel && live ? <p>{stageLabel}</p> : null}
        {failureCode ? <p className={styles.executionFailure}>{t("execution.failureCode", { code: failureCode })}</p> : null}
        {completedTools.length > 0 ? <ol className={styles.executionMilestones} aria-label={t("execution.activity")} data-tool-activity>
          {completedTools.map((tool, index) => <li key={`${index}:${tool.completed_at}`}>
            <span>{t(executionToolLabelKey(tool.name))}</span><time dateTime={tool.completed_at}>{clock(tool.completed_at, locale)}</time>
          </li>)}
        </ol> : null}
        {milestones.length > 0 ? (
          <ol className={styles.executionMilestones}>
            {milestones.map((milestone) => (
              <li key={`${milestone.stage}:${milestone.observedAt}`}>
                <span>{conversationStageLabel(milestone.stage, locale) ?? t("execution.stage.other")}</span>
                <time dateTime={milestone.observedAt}>{clock(milestone.observedAt, locale)}</time>
              </li>
            ))}
          </ol>
        ) : null}
        {!live && draft && <div className={styles.executionDraft} aria-label={t("回复草稿，尚未完成")}><ConversationResponse>{draft}</ConversationResponse></div>}
        <p className={styles.executionTimes}>
          {t(timingBasis === "receipt" ? "消息接收" : "开始")} {clock(startedAt, locale) || t("未记录")}
          {endedAt ? ` · ${t(timingBasis === "receipt" ? "结果记录" : "结束")} ${clock(endedAt, locale) || t("未记录")}` : live ? ` · ${t("仍在进行")}` : ""}
        </p>
        {completedTools.length > 0 || milestones.some(milestone => !conversationStageLabel(milestone.stage, locale)) ? <details className={executionStyles.diagnostics} data-run-diagnostics>
          <summary>{t("execution.diagnostics")}</summary>
          {completedTools.length > 0 ? <>
            <p>{t("execution.tools.count", { count: completedTools.length })}</p>
            <ol className={styles.executionMilestones} aria-label={t("工具完成记录")}>
              {completedTools.map((tool, index) => <li key={`${index}:${tool.completed_at}`}>
                <code>{tool.name}</code><time dateTime={tool.completed_at}>{clock(tool.completed_at, locale)}</time>
              </li>)}
            </ol>
          </> : null}
          {milestones.filter(milestone => !conversationStageLabel(milestone.stage, locale)).map(milestone => <p key={`${milestone.stage}:${milestone.observedAt}`}><code>{milestone.stage}</code> · <time dateTime={milestone.observedAt}>{clock(milestone.observedAt, locale)}</time></p>)}
        </details> : null}
        {children}
      </div>
    </details>
    </>
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

/** Exact localized send time, presented with its owning user message. */
export function SessionSendTime({ at }: { at: unknown }) {
  const locale = useLocale();
  const t = useT();
  const value = typeof at === "string" ? new Date(at) : at instanceof Date ? at : null;
  if (!value || Number.isNaN(value.getTime())) return null;
  const now = new Date();
  const time = clock(value.toISOString(), locale);
  const sameYear = value.getFullYear() === now.getFullYear();
  const today = sameYear && value.getMonth() === now.getMonth() && value.getDate() === now.getDate();
  const date = value.toLocaleDateString(locale, { ...(sameYear ? {} : { year: "numeric" as const }), month: "long", day: "numeric" });
  const label = today ? t("execution.time.today", { time }) : `${date} ${time}`;
  return <time className={styles.sendTime} dateTime={value.toISOString()} title={value.toLocaleString(locale)}>{label}</time>;
}
