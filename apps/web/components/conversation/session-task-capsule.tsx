"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationQueueEntry } from "@talent-signal/contracts";
import { conversationElapsedLabel, conversationElapsedMs, conversationStageLabel } from "@/lib/conversation-execution";
import { sessionHumanMessages } from "@/lib/session-human-messages";
import { useLocale, useT } from "../locale-provider";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
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

export function SessionTaskCapsule({ observation, connection, mutating, onStop, onContinue, onRetry, recoveryActions }: {
  observation: Observation;
  connection: "connecting" | "live" | "reconnecting";
  mutating: boolean;
  onStop: (runId: string) => void;
  onContinue: () => void;
  onRetry: (queueEntryId: string) => void;
  recoveryActions: (messageId: string) => ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const task = observedTask(observation, connection);
  const taskKey = task?.key ?? null;
  const phase = task?.work.phase;
  const [disclosure, setDisclosure] = useState<{ owner: symbol; open: boolean }>({ owner: observation.owner, open: false });
  const open = disclosure.owner === observation.owner && disclosure.open && Boolean(task);
  const current = useRef<{ owner: symbol; key: string } | null>(null);
  useLayoutEffect(() => {
    current.current = taskKey ? { owner: observation.owner, key: taskKey } : null;
    return () => { current.current = null; };
  }, [observation.owner, taskKey]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !phase || !["running", "stopping", "queued", "paused"].includes(phase)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, phase]);
  if (!task || !phase) return null;
  const owned = (action: () => void) => {
    if (current.current?.owner === observation.owner && current.current.key === task.key) action();
  };
  const label = phase === "running" ? conversationStageLabel(task.stage, locale) ?? t("conversation.task.running") : t(`conversation.task.${phaseKey[phase]}`);
  const startedAt = task.entry?.started_at ?? task.entry?.created_at;
  const elapsed = startedAt ? conversationElapsedMs({ startedAt, nowMs: now,
    endedAt: ["running", "stopping", "queued", "paused"].includes(phase) ? null : task.entry?.updated_at }) : null;
  return <div className={styles.capsule} data-session-task-capsule data-phase={phase}>
    <Popover open={open} onOpenChange={value => { if (value) setNow(Date.now()); setDisclosure({ owner: observation.owner, open: value }); }}>
      <PopoverTrigger asChild><button type="button" className={styles.trigger} aria-label={t("conversation.task.details", { status: label })}>
        <span className={styles.dot} aria-hidden="true"/><span className={styles.label} role="status" aria-live="polite">{label}</span><CaretDown size={12} aria-hidden="true"/>
      </button></PopoverTrigger>
      <PopoverContent align="end" className={styles.panel} aria-label={t("conversation.task.record")} onCloseAutoFocus={event => { if (current.current?.owner !== observation.owner) event.preventDefault(); }}>
        <p className={styles.state}>{label}</p>
        <p>{t(task.work.text)}</p>
        {elapsed !== null && <p>{t("conversation.task.elapsed")} {conversationElapsedLabel(elapsed, locale)}</p>}
        <p>{t("conversation.task.boundary")}</p>
        <div className={styles.actions}>
          {phase === "running" && task.entry?.run_id && <button type="button" disabled={mutating} onClick={() => owned(() => onStop(task.entry!.run_id!))}>{t("conversation.stop.label")}</button>}
          {phase === "paused" && !observation.snapshot?.active && observation.snapshot?.queued.every(entry => entry.status === "queued") && <button type="button" disabled={mutating} onClick={() => owned(onContinue)}>{t("conversation.queue.continue")}</button>}
          {phase === "failed" && task.entry && <button type="button" disabled={mutating} onClick={() => owned(() => onRetry(task.entry!.queue_entry_id))}>{t("conversation.queue.retry")}</button>}
          {/* Existing controls retain their same-ID checks, loading feedback and
              explicit readback semantics. This disclosure grants no consent. */}
          {task.work.recover ? recoveryActions(task.messageId) : null}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
