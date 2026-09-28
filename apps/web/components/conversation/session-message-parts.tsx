"use client";

import type {
  ConversationQueueEntry,
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
      type: "data", name: "talent-signal.answer-block", data: { block },
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
        text: preview?.text ?? "", stage: preview?.stage ?? active.stage ?? "preparing",
      } }],
      createdAt: new Date(active.updated_at),
    });
  }
  return messages;
}

import { MessagePrimitive } from "@assistant-ui/react";
import type { ConversationImageManifest } from "@talent-signal/contracts";
import { ConversationProvenance, ConversationResponse } from "../conversation-response";
import { MemoryReviewCard } from "../memory-review/memory-review-card";
import { sessionBlockTitle } from "../session-workbench/session-presentation";
import { ConversationImageStrip } from "./conversation-images";
import styles from "./queued-conversation.module.css";

type RenderContext = {
  binding: string;
  entryCapability: string | null;
  scope: string;
  sessionId: string;
  status: string;
};

function dataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function renderSessionData(name: string, raw: unknown, context: RenderContext) {
  const data = dataRecord(raw);
  if (!data) return <span>这项内容暂时无法显示。</span>;
  if (name === "talent-signal.user-images" && Array.isArray(data.images) && typeof data.messageId === "string") {
    return <ConversationImageStrip binding={context.binding} images={data.images as ConversationImageManifest[]}
      local={false} messageId={data.messageId} scope={context.scope} sessionId={context.sessionId}/>;
  }
  if (name === "talent-signal.answer-block") {
    const block = dataRecord(data.block);
    if (!block || typeof block.body !== "string") return <span>这段回复暂时无法显示。</span>;
    const title = typeof block.title === "string" ? sessionBlockTitle(block.title) : null;
    return <div>{title && <h3>{title}</h3>}<ConversationResponse lead={!title}>{block.body}</ConversationResponse>
      <ConversationProvenance sources={Array.isArray(block.public_source_refs) ? block.public_source_refs as never : undefined}/></div>;
  }
  if (name === "talent-signal.memory" && data.version === 1 && typeof data.proposalId === "string"
    && typeof data.revision === "number") {
    return <MemoryReviewCard binding={context.binding} entryCapability={context.entryCapability}
      proposal={{ proposal_id: data.proposalId, revision: data.revision }} purpose="chat" sessionId={context.sessionId}/>;
  }
  if (name === "talent-signal.calendar" && data.version === 1 && typeof data.draftId === "string") {
    return <section aria-label="日历草稿核对入口" className="context-calendar-draft-handoff">
      <strong>{typeof data.title === "string" ? data.title : "日历草稿"}</strong>
      <p>日历草稿已准备好，核对时间后可下载并在日历应用中导入。</p>
      <a href={`/workspace/meetings?draft=${encodeURIComponent(data.draftId)}`}>核对日历草稿 →</a>
    </section>;
  }
  if (name === "talent-signal.progress") {
    const text = typeof data.text === "string" ? data.text : "";
    return text ? <div className={styles.forming}><ConversationResponse>{text}</ConversationResponse><span className={styles.cursor} aria-hidden="true"/></div>
      : <div className={styles.waiting}><span className={styles.pulse} aria-hidden="true"/>{context.status || "正在处理"}</div>;
  }
  return <span>{typeof data.fallback === "string" ? data.fallback : "这项结果暂时无法显示。"}</span>;
}

export function SessionUserMessage({ context }: { context: RenderContext }) {
  return <MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.userRow}><div className={styles.userMessage}>
      <MessagePrimitive.Parts>{({ part }) => part.type === "text" ? part.text
        : part.type === "data" ? renderSessionData(part.name, part.data, context) : null}</MessagePrimitive.Parts>
    </div></div>
  </MessagePrimitive.Root>;
}

export function SessionAssistantMessage({ context }: { context: RenderContext }) {
  return <MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.answer}>
      <div className={styles.identity}><span className={styles.mark} aria-hidden="true"/>Talent Signal</div>
      <MessagePrimitive.Parts>{({ part }) => part.type === "text" ? <ConversationResponse>{part.text}</ConversationResponse>
        : part.type === "data" ? renderSessionData(part.name, part.data, context) : null}</MessagePrimitive.Parts>
    </div>
  </MessagePrimitive.Root>;
}
