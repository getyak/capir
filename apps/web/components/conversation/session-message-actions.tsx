"use client";

import { useAuiState } from "@assistant-ui/react";
import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { sessionBlockTitle } from "../session-workbench/session-presentation";
import styles from "./session-message-actions.module.css";

type CopyMessage = { role: string; content: readonly unknown[] };
type CopyPayload = { text: string; anchorBlockId: string | null };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Extract only the original sent text or persisted, completed answer prose.
 * Governed proposals, image manifests, tools and forming output never enter
 * this payload. Reading the projection does not grant any export authority;
 * the clipboard write still belongs to the explicit button click. */
export function extractSessionMessageCopy(message: CopyMessage): CopyPayload | null {
  if (message.role === "user") {
    const text = message.content.flatMap(value => {
      const part = record(value);
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
    }).join("\n\n");
    return text.trim() ? { text, anchorBlockId: null } : null;
  }
  if (message.role !== "assistant") return null;
  const parts = message.content.map(record);
  const executions = parts.filter(part => part?.type === "data" && part.name === "talent-signal.execution");
  // A final execution receipt is mandatory. Ambiguous or incomplete executions
  // cannot make otherwise plausible answer text look completed.
  if (executions.length !== 1) return null;
  const execution = record(executions[0]?.data);
  if (!execution || !["completed", "waiting-review"].includes(String(execution.phase))
    || typeof execution.endedAt !== "string" || !Number.isFinite(Date.parse(execution.endedAt))) return null;
  const blocks = parts.flatMap(part => {
    if (part?.type !== "data" || part.name !== "talent-signal.answer-block") return [];
    const block = record(record(part.data)?.block);
    if (!block || block.kind !== "answer" || block.status !== "informational"
      || block.requires_user_decision !== false || typeof block.id !== "string" || !block.id
      || typeof block.body !== "string" || !block.body.trim()) return [];
    const title = typeof block.title === "string" ? sessionBlockTitle(block.title) : null;
    return [{ id: block.id, text: title ? `### ${title}\n\n${block.body}` : block.body }];
  });
  return blocks.length ? { text: blocks.map(block => block.text).join("\n\n"), anchorBlockId: blocks.at(-1)!.id } : null;
}

type Feedback = "idle" | "busy" | "copied" | "failed";

export function SessionMessageActions({ afterBlockId }: { afterBlockId?: string }) {
  const message = useAuiState(s => s.message);
  const payload = extractSessionMessageCopy(message);
  const text = payload?.text ?? null;
  const identity = `${message.id}\u0000${message.role}\u0000${text ?? ""}`;
  const current = useRef({ identity, mounted: true, busy: false, request: 0 });
  const [feedback, setFeedback] = useState<{ identity: string; state: Feedback }>({ identity, state: "idle" });
  const state = feedback.identity === identity ? feedback.state : "idle";
  useLayoutEffect(() => {
    current.current = { identity, mounted: true, busy: false, request: current.current.request + 1 };
    return () => { current.current.mounted = false; current.current.request += 1; };
  }, [identity]);
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setFeedback({ identity, state: "idle" }), 1800);
    return () => window.clearTimeout(timer);
  }, [identity, state]);

  if (!payload || (message.role === "assistant" && payload.anchorBlockId !== afterBlockId)) return null;
  const noun = message.role === "user" ? "消息" : "回答";
  async function copy() {
    if (!text || current.current.busy) return;
    current.current.busy = true;
    const request = ++current.current.request;
    setFeedback({ identity, state: "busy" });
    const stillCurrent = () => current.current.mounted && current.current.identity === identity && current.current.request === request;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (stillCurrent()) setFeedback({ identity, state: "copied" });
    } catch {
      if (stillCurrent()) setFeedback({ identity, state: "failed" });
    } finally {
      if (stillCurrent()) current.current.busy = false;
    }
  }
  const label = state === "failed" ? `重试复制${noun}` : `复制${noun}`;
  return <div className={styles.actions} data-message-actions={message.role} data-state={state}>
    <Button className={styles.copy} variant="ghost" size="icon" aria-label={label} title={label}
      aria-busy={state === "busy"} disabled={state === "busy"} onClick={() => void copy()}>
      {state === "copied" ? <Check size={16} weight="regular" aria-hidden="true"/> : <Copy size={16} weight="regular" aria-hidden="true"/>}
    </Button>
    <span className={state === "failed" ? styles.failure : "sr-only"} role={state === "idle" ? undefined : "status"} aria-live="polite" aria-atomic="true">
      {state === "failed" ? "复制失败，请重试" : state === "copied" ? "已复制" : state === "busy" ? "正在复制" : ""}
    </span>
  </div>;
}
