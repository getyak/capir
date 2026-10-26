"use client";

import { CaretDown } from "@phosphor-icons/react";
import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode, type RefCallback } from "react";
import type { ConversationQueueEntry } from "@talent-signal/contracts";
import { conversationStageLabel } from "@/lib/conversation-execution";
import { sessionHumanMessages } from "@/lib/session-human-messages";
import { useLocale, useT } from "../locale-provider";
import { conversationWorkStatus, type ConversationWorkStatus } from "./conversation-feedback";
import type { useConversation } from "./use-conversation";
import styles from "./session-task-capsule.module.css";

type Observation = ReturnType<typeof useConversation>["taskObservation"];
type Task = { stage: string | null; messageId: string; entry: ConversationQueueEntry | null; work: ConversationWorkStatus; key: string };

/** A projection of existing queue/outbox/history, with no success authority. */
function observedTask(observation: Observation, connection: "connecting" | "live" | "reconnecting"): Task | null {
  const snapshot = observation.snapshot?.session_id === observation.sessionId ? observation.snapshot : null;
  const settled = new Set((observation.detail?.turns ?? []).flatMap(sessionHumanMessages).map(message => message.id));
  const entries = [snapshot?.active, ...Object.values(observation.handoffEntries), ...(snapshot?.queued ?? [])].filter((entry): entry is ConversationQueueEntry => Boolean(entry));
  const messages = observation.messages.filter(message => !settled.has(message.id));
  const selected = entries.find(entry => !settled.has(entry.message_id));
  const message = selected ? messages.find(message => message.id === selected.message_id) : messages.at(-1);
  if (!selected && !message) return null;
  const messageId = selected?.message_id ?? message!.id;
  const slot = selected === snapshot?.active ? "active" : snapshot?.queued.some(entry => entry === selected) ? "queued" : null;
  // Completed queue metadata is still a readback, never an answer. Cancellation
  // remains stopped until the actual persisted partial owns its presentation.
  const outcome = selected?.status === "cancelled" ? "stopped" : selected?.status === "completed" ? "completed" : observation.runOutcome[messageId] ?? null;
  const stage = selected?.run_id === observation.preview?.run_id ? observation.preview?.stage ?? selected?.stage ?? null : selected?.stage ?? null;
  const work = conversationWorkStatus({ delivery: message?.delivery ?? "accepted", settled: false,
    entry: selected ?? null, entrySlot: selected?.status === "completed" || selected?.status === "cancelled" ? null : slot,
    paused: snapshot?.paused ?? false, connection, stage, outcome,
    readbackStalled: observation.readbackStalled.includes(messageId), hasImages: Boolean(message?.images?.length || selected?.images?.length) });
  return { stage, messageId, entry: selected ?? null, work, key: JSON.stringify([messageId, selected?.run_id, selected?.revision, work.phase]) };
}

const phaseKey: Record<ConversationWorkStatus["phase"], string> = {
  settled: "", unknown: "unknown", rejected: "unknown", pending: "sending", sending: "sending",
  waiting: "waiting", queued: "queued", paused: "paused", running: "running", stopping: "stopping",
  stopped: "stopped", readback: "readback", reconnecting: "reconnecting", failed: "failed",
};

type Props = {
  observation: Observation;
  connection: "connecting" | "live" | "reconnecting";
  mutating: boolean;
  onStop: (runId: string) => void;
  onContinue: () => void;
  onRetry: (queueEntryId: string) => void;
  recoveryActions: (messageId: string) => ReactNode;
};
type TaskContext = Props & {
  task: Task | null;
  label: string;
  recordId: string;
  bindRecord: RefCallback<HTMLDivElement>;
  bindTrigger: RefCallback<HTMLButtonElement>;
  inspect: () => void;
  owned: (action: () => void) => void;
};
const TaskContext = createContext<TaskContext | null>(null);

/** Header and transcript share one observed task; neither grants authority. */
export function SessionTaskProvider({ children, ...props }: Props & { children: ReactNode }) {
  const { observation, connection } = props;
  const t = useT();
  const locale = useLocale();
  const task = observedTask(observation, connection);
  const taskKey = task?.key ?? null;
  const phase = task?.work.phase;
  const recordId = useId();
  const record = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const current = useRef<{ owner: symbol; key: string } | null>(null);
  useLayoutEffect(() => {
    current.current = taskKey ? { owner: observation.owner, key: taskKey } : null;
    return () => { current.current = null; };
  }, [observation.owner, taskKey]);
  const owned = (action: () => void) => {
    if (task && current.current?.owner === observation.owner && current.current.key === task.key) action();
  };
  const label = !task || !phase ? "" : phase === "running" ? conversationStageLabel(task.stage, locale) ?? t("conversation.task.running") : t(`conversation.task.${phaseKey[phase]}`);
  const inspect = () => owned(() => {
    const details = record.current?.closest("details");
    if (!details) return;
    details.open = true;
    details.querySelector("summary")?.focus({ preventScroll: true });
    details.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  });
  const bindRecord: RefCallback<HTMLDivElement> = node => {
    record.current = node;
    const details = node?.closest("details");
    if (!details) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      owned(() => {
        event.preventDefault(); event.stopPropagation();
        details.open = false;
        trigger.current?.focus({ preventScroll: true });
      });
    };
    details.addEventListener("keydown", onKey);
    return () => {
      details.removeEventListener("keydown", onKey);
      if (record.current === node) record.current = null;
    };
  };
  return <TaskContext.Provider value={{ ...props, task, label, recordId, bindRecord, bindTrigger: node => { trigger.current = node; }, inspect, owned }}>{children}</TaskContext.Provider>;
}

export function SessionTaskCapsule() {
  const context = useContext(TaskContext);
  const t = useT();
  if (!context?.task) return null;
  const { task, label, recordId, bindTrigger, inspect } = context;
  return <div className={styles.capsule} data-session-task-capsule data-phase={task.work.phase}>
      <button ref={bindTrigger} type="button" className={styles.trigger} aria-controls={recordId} aria-label={t("conversation.task.details", { status: label })} onClick={inspect}>
        <span className={styles.dot} aria-hidden="true"/><span className={styles.label} role="status" aria-live="polite">{label}</span><CaretDown size={12} aria-hidden="true"/>
      </button>
  </div>;
}

/** Controls live in the execution disclosure belonging to this exact message. */
export function SessionTaskRecord({ messageId, standalone = false }: { messageId: string; standalone?: boolean }) {
  const context = useContext(TaskContext);
  const t = useT();
  if (!context?.task || context.task.messageId !== messageId) return null;
  const { task, recordId, bindRecord, observation, mutating, onStop, onContinue, onRetry, recoveryActions, owned } = context;
  const phase = task.work.phase;
  const content = <div ref={bindRecord} id={recordId} className={styles.panel} data-session-task-record={messageId}>
        <p>{t(task.work.text)}</p>
        <p>{t("conversation.task.boundary")}</p>
        <div className={styles.actions}>
          {phase === "running" && task.entry?.run_id && <button type="button" disabled={mutating} onClick={() => owned(() => onStop(task.entry!.run_id!))}>{t("conversation.stop.label")}</button>}
          {phase === "paused" && !observation.snapshot?.active && observation.snapshot?.queued.every(entry => entry.status === "queued") && <button type="button" disabled={mutating} onClick={() => owned(onContinue)}>{t("conversation.queue.continue")}</button>}
          {phase === "failed" && task.entry && <button type="button" disabled={mutating} onClick={() => owned(() => onRetry(task.entry!.queue_entry_id))}>{t("conversation.queue.retry")}</button>}
          {/* Existing controls retain their same-ID checks, loading feedback and
              explicit readback semantics. This disclosure grants no consent. */}
          {task.work.recover ? recoveryActions(task.messageId) : null}
        </div>
      </div>;
  return standalone ? <details className={styles.standalone}><summary>{t("conversation.task.record")}</summary>{content}</details> : content;
}
