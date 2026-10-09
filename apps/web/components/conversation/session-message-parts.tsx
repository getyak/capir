"use client";

import type {
  ConversationQueueEntry,
  ConversationImageManifest,
  ConversationQueuePreview,
} from "@talent-signal/contracts";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { sessionTurnBlocks } from "../session-workbench/session-presentation";

export type SessionDataPart = {
  type: "data";
  name: string;
  data: Record<string, unknown>;
};
export type SessionTextPart = { type: "text"; text: string };
export type SessionProjectedMessage = {
  id: string;
  role: "user" | "assistant";
  content: Array<SessionDataPart | SessionTextPart>;
  createdAt: Date;
};

export function sessionMessages(input: {
  turns: SessionDetail["turns"];
  active: ConversationQueueEntry | null;
  preview: ConversationQueuePreview | null;
  pending?: ReadonlyArray<{ id: string; objective: string; images?: readonly ConversationImageManifest[]; createdAt: string; previewText?: string }>;
}): SessionProjectedMessage[] {
  const messages: SessionProjectedMessage[] = [];
  for (const turn of input.turns) {
    const userContent: SessionProjectedMessage["content"] = [];
    if (turn.objective) userContent.push({ type: "text", text: turn.objective });
    if (turn.images?.length) userContent.push({
      type: "data", name: "talent-signal.user-images",
      data: { messageId: turn.id, images: turn.images, local: false },
    });
    messages.push({ id: `${turn.id}:user`, role: "user", content: userContent, createdAt: new Date(turn.createdAt) });
    const content: SessionProjectedMessage["content"] = sessionTurnBlocks(turn.response).map((block) => ({
      type: "data", name: "talent-signal.answer-block", data: { block, messageId: turn.id },
    }));
    if (turn.response.memoryProposal) content.push({
      type: "data", name: "talent-signal.memory",
      data: {
        version: 1,
        messageId: turn.id,
        proposalId: turn.response.memoryProposal.proposal_id,
        revision: turn.response.memoryProposal.revision,
        fallback: "记忆建议可在这段对话中处理。",
      },
    });
    if (turn.response.meetingDraft) content.push({
      type: "data", name: "talent-signal.calendar",
      data: {
        version: 1,
        messageId: turn.id,
        draftId: turn.response.meetingDraft.id,
        title: turn.response.meetingDraft.title,
        fallback: "日历草稿可在这段对话中处理。",
      },
    });
    messages.push({ id: `${turn.id}:assistant`, role: "assistant", content, createdAt: new Date(turn.response.createdAt) });
  }
  const active = input.active;
  if (active && !input.turns.some((turn) => turn.id === active.message_id)) {
    const userContent: SessionProjectedMessage["content"] = [];
    if (active.objective) userContent.push({ type: "text", text: active.objective });
    if (active.images?.length) userContent.push({
      type: "data", name: "talent-signal.user-images",
      data: { messageId: active.message_id, images: active.images, local: false },
    });
    messages.push({ id: `${active.message_id}:user`, role: "user", content: userContent, createdAt: new Date(active.created_at) });
    const preview = input.preview?.run_id === active.run_id ? input.preview : null;
    messages.push({
      id: `${active.message_id}:assistant`, role: "assistant",
      content: [{ type: "data", name: "talent-signal.progress", data: {
        messageId: active.message_id, text: preview?.text ?? "", stage: preview?.stage ?? active.stage ?? "preparing",
      } }],
      createdAt: new Date(active.updated_at),
    });
  }
  for (const pending of input.pending ?? []) {
    if (input.turns.some(turn => turn.id === pending.id) || active?.message_id === pending.id) continue;
    const content: SessionProjectedMessage["content"] = [];
    if (pending.objective) content.push({ type: "text", text: pending.objective });
    if (pending.images?.length) content.push({ type: "data", name: "talent-signal.user-images", data: { messageId: pending.id, images: pending.images } });
    messages.push({ id: `${pending.id}:user`, role: "user", content, createdAt: new Date(pending.createdAt) });
    messages.push({ id: `${pending.id}:assistant`, role: "assistant", content: [{ type: "data", name: "talent-signal.progress", data: { messageId: pending.id, text: pending.previewText ?? "" } }], createdAt: new Date(pending.createdAt) });
  }
  // Keep each request and its answer together; order requests by their source
  // time so a retained readback cannot jump below a newer active request.
  const groups: SessionProjectedMessage[][] = [];
  for (let index = 0; index < messages.length; index += 2) groups.push(messages.slice(index, index + 2));
  groups.sort((left, right) => left[0]!.createdAt.getTime() - right[0]!.createdAt.getTime());
  return groups.flat();
}

import { MessagePrimitive } from "@assistant-ui/react";
import type { MemoryProposalItem } from "@talent-signal/contracts";
import { useEffect, useRef, useState } from "react";
import { ConversationProvenance, ConversationResponse } from "../conversation-response";
import type { AnswerSeamRegistry } from "./answer-seam";
import { ConversationWorkRow } from "./conversation-feedback-row";
import { runStageText, type ConversationWorkStatus } from "./conversation-feedback";
import { MemoryReviewCard } from "../memory-review/memory-review-card";
import { sessionBlockTitle } from "../session-workbench/session-presentation";
import { ConversationImageStrip } from "./conversation-images";
import { SessionCalendarDraftCard } from "./session-calendar-draft-card";
import styles from "./queued-conversation.module.css";

type RenderContext = {
  attention?: AnswerSeamRegistry;
  binding: string;
  meetingBinding: string;
  entryCapability: string | null;
  scope: string;
  sessionId: string;
  workByMessageId: Record<string, ConversationWorkStatus>;
  /** Outbox messages whose local attachment bytes are still owned here. */
  localImageMessageIds: ReadonlySet<string>;
  recoveryActions?: (messageId: string) => import("react").ReactNode;
  sourceImagesByMessageId: Record<string, readonly ConversationImageManifest[]>;
  sourceTextByMessageId: Record<string, string>;
  onCardComment?: (item: MemoryProposalItem) => void;
};

/**
 * An assistant message that carries only the in-flight work marker renders as
 * one compact work row; it never grows a second identity heading above it.
 */
export function isWorkOnlyMessage(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((part) => {
    const record = part as { type?: string; name?: string; data?: { text?: unknown } };
    return record.type === "data" && record.name === "talent-signal.progress" && !record.data?.text;
  });
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function renderSessionData(name: string, raw: unknown, context: RenderContext) {
  const data = dataRecord(raw);
  if (!data) return <span>这项内容暂时无法显示。</span>;
  if (name === "talent-signal.user-images" && Array.isArray(data.images) && typeof data.messageId === "string") {
    // While the outbox still owns the message its local attachment bytes are
    // the reliable thumbnail source; canonical history renders server bytes.
    return <ConversationImageStrip binding={context.binding} images={data.images as ConversationImageManifest[]}
      local={context.localImageMessageIds.has(data.messageId)} messageId={data.messageId} scope={context.scope} sessionId={context.sessionId}/>;
  }
  if (name === "talent-signal.answer-block") {
    const block = dataRecord(data.block);
    if (!block || typeof block.body !== "string") return <span>这段回复暂时无法显示。</span>;
    return <AnswerBlockFrame block={{
      id: typeof block.id === "string" ? block.id : "",
      title: typeof block.title === "string" ? block.title : null,
      body: block.body,
      status: typeof block.status === "string" ? block.status : "",
      kind: typeof block.kind === "string" ? block.kind : "",
      requires_user_decision: block.requires_user_decision !== false,
      public_source_refs: Array.isArray(block.public_source_refs) ? block.public_source_refs as never : undefined,
    }} messageId={typeof data.messageId === "string" ? data.messageId : ""} sessionId={context.sessionId} attention={context.attention}/>;
  }
  if (name === "talent-signal.memory" && data.version === 1 && typeof data.proposalId === "string"
    && typeof data.revision === "number") {
    return <MemoryReviewCard binding={context.binding} entryCapability={context.entryCapability}
      proposal={{ proposal_id: data.proposalId, revision: data.revision }} purpose="chat" sessionId={context.sessionId}
      sourceImages={typeof data.messageId === "string" ? context.sourceImagesByMessageId[data.messageId] ?? [] : []}
      sourceMessageId={typeof data.messageId === "string" ? data.messageId : null}
      sourceText={typeof data.messageId === "string" ? context.sourceTextByMessageId[data.messageId] ?? "" : ""}
      onCommentItem={context.onCardComment}/>;
  }
  if (name === "talent-signal.calendar" && data.version === 1 && typeof data.draftId === "string") {
    return <SessionCalendarDraftCard draftId={data.draftId} binding={context.meetingBinding} sessionId={context.sessionId}/>;
  }
  if (name === "talent-signal.progress") {
    const text = typeof data.text === "string" ? data.text : "";
    const messageId = typeof data.messageId === "string" ? data.messageId : "";
    const stage = typeof data.stage === "string" ? data.stage : "";
    const work = context.workByMessageId[messageId] ?? { phase: "running" as const, text: runStageText[stage] ?? "正在处理", animate: true, recover: null };
    return text
      ? <div className={styles.forming}><ConversationResponse>{text}</ConversationResponse>{work.animate && <span className={styles.cursor} aria-hidden="true"/>}<small className={styles.formingStatus} role="status">{work.text}</small>{context.recoveryActions?.(messageId)}</div>
      : <ConversationWorkRow status={work}>{context.recoveryActions?.(messageId)}</ConversationWorkRow>;
  }
  return <span>{typeof data.fallback === "string" ? data.fallback : "这项结果暂时无法显示。"}</span>;
}

const SEAM_VISIBLE_MS = 700;

/**
 * One completed answer block. The full text fold is scoped here (committed
 * answers only — a forming streamed reply never folds), and the brief
 * one-shot vermilion seam plays only for a run this client actually observed
 * finishing. The seam never claims review authority: pending human review
 * stays visible and is never auto-approved.
 */
export function AnswerBlockFrame({
  block,
  messageId,
  sessionId,
  attention,
}: {
  block: {
    id: string;
    title: string | null;
    body: string;
    status: string;
    kind?: string;
    requires_user_decision?: boolean;
    public_source_refs?: ReadonlyArray<{ display_name: string }> | null;
  };
  messageId: string;
  sessionId: string;
  attention?: AnswerSeamRegistry;
}) {
  const [seam, setSeam] = useState<"idle" | "playing" | "done">("idle");
  const eligible = useRef(false);
  useEffect(() => {
    if (attention?.claim(messageId, block.status, block.requires_user_decision) === "seam") eligible.current = true;
    if (!eligible.current) return;
    // Defer external event delivery until commit. Strict Mode may tear down
    // this effect before delivery; eligibility survives that teardown once.
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      eligible.current = false;
      setSeam("playing");
    });
    return () => { current = false; };
  }, [attention, sessionId, messageId, block.id, block.status, block.requires_user_decision]);
  useEffect(() => {
    if (seam !== "playing") return;
    const timer = window.setTimeout(() => setSeam("done"), SEAM_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [seam]);
  const title = typeof block.title === "string" ? sessionBlockTitle(block.title) : null;
  return (
    <div className={styles.answerSeam} data-seam={seam === "playing" ? "new" : undefined}>
      {title && <h3>{title}</h3>}
      <ConversationResponse foldable={block.kind === "answer" && block.requires_user_decision === false} lead={!title}>{block.body}</ConversationResponse>
      <ConversationProvenance sources={block.public_source_refs}/>
    </div>
  );
}

export function SessionUserMessage({ context }: { context: RenderContext }) {
  return <MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.userRow}><div className={styles.userMessage} data-user-message>
      <MessagePrimitive.Parts>{({ part }) => part.type === "text" ? part.text
        : part.type === "data" ? renderSessionData(part.name, part.data, context) : null}</MessagePrimitive.Parts>
    </div></div>
  </MessagePrimitive.Root>;
}

export function SessionAssistantMessage({ context, workOnly = false }: { context: RenderContext; workOnly?: boolean }) {
  return <MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.answer}>
      {!workOnly && <div className={styles.identity}><span className={styles.mark} aria-hidden="true"/>Talent Signal</div>}
      <MessagePrimitive.Parts>{({ part }) => part.type === "text" ? <ConversationResponse>{part.text}</ConversationResponse>
        : part.type === "data" ? renderSessionData(part.name, part.data, context) : null}</MessagePrimitive.Parts>
    </div>
  </MessagePrimitive.Root>;
}
