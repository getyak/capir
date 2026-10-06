"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { MessagePrimitive } from "@assistant-ui/react";
import type {
  ConversationImageManifest,
  ConversationQueueEntry,
  ConversationQueuePreview,
  MemoryProposalItem,
} from "@talent-signal/contracts";
import {
  conversationExecutionPhase,
  conversationMilestoneUpdates,
  conversationTurnInterrupted,
  type ConversationExecutionMilestone,
  type ConversationExecutionPhase,
} from "@/lib/conversation-execution";
import type { SessionDetail } from "../session-workbench/session-detail-state";
import { sessionTurnBlocks } from "../session-workbench/session-presentation";
import { SessionExecutionCard, SessionRunUpdate } from "./session-execution-card";
import { ConversationProvenance, ConversationResponse } from "../conversation-response";
import { MemoryReviewCard } from "../memory-review/memory-review-card";
import { sessionBlockTitle } from "../session-workbench/session-presentation";
import { ConversationImageStrip } from "./conversation-images";
import { SessionCalendarDraftCard } from "./session-calendar-draft-card";
import { McpRequestCard } from "../mcp/mcp-request-card";
import { sessionHumanMessages } from "@/lib/session-human-messages";
export { sessionHumanMessages } from "@/lib/session-human-messages";
import styles from "./queued-conversation.module.css";

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

const EXECUTION_PHASES = new Set<ConversationExecutionPhase>([
  "queued", "running", "stopping", "waiting-review", "review-unknown", "completed", "failed", "interrupted",
]);

type ExecutionReceipt = {
  started_at: string | null;
  completed_at: string | null;
  tools: Array<{ name: string; completed_at: string }>;
};

function canonicalExecution(response: unknown): ExecutionReceipt | null {
  const data = dataRecord(dataRecord(response)?.execution);
  if (!data || !Array.isArray(data.tools)) return null;
  const tools = data.tools.flatMap(value => {
    const item = dataRecord(value);
    return item && typeof item.name === "string" && typeof item.completed_at === "string"
      ? [{ name: item.name, completed_at: item.completed_at }] : [];
  });
  return { started_at: typeof data.started_at === "string" ? data.started_at : null,
    completed_at: typeof data.completed_at === "string" ? data.completed_at : null, tools };
}

function executionData(data: Record<string, unknown>) {
  const phase = typeof data.phase === "string" && EXECUTION_PHASES.has(data.phase as ConversationExecutionPhase)
    ? data.phase as ConversationExecutionPhase : null;
  if (!phase) return null;
  return {
    phase,
    stage: typeof data.stage === "string" ? data.stage : null,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : "",
    endedAt: typeof data.endedAt === "string" ? data.endedAt : null,
    draft: typeof data.draft === "string" ? data.draft : undefined,
    failureCode: typeof data.failureCode === "string" ? data.failureCode : null,
    milestones: Array.isArray(data.milestones) ? data.milestones as ConversationExecutionMilestone[] : [],
    completedTools: Array.isArray(data.completedTools) ? data.completedTools as ExecutionReceipt["tools"] : [],
    timingBasis: data.timingBasis === "receipt" ? "receipt" as const : "run" as const,
  };
}

/**
 * Message projection for the conversation transcript.
 *
 * Canonical turns and the live queue entry are the only sources. An in-flight
 * run projects ephemeral milestone updates plus its collapsible execution
 * record; the final semantic response blocks appear only after persisted
 * history readback, so a preview can never become a result. Readback turns
 * keep one collapsed execution record above the standalone result — state and
 * elapsed observed time only — while pending memory or calendar decisions
 * stay distinct blocks after it.
 */
export function sessionMessages(input: {
  turns: SessionDetail["turns"];
  active: ConversationQueueEntry | null;
  preview: ConversationQueuePreview | null;
  milestones?: readonly ConversationExecutionMilestone[];
  milestonesByMessage?: Readonly<Record<string, readonly ConversationExecutionMilestone[]>>;
  queued?: readonly ConversationQueueEntry[];
}): SessionProjectedMessage[] {
  const messages: SessionProjectedMessage[] = [];
  const committed = new Set(input.turns.flatMap(turn => sessionHumanMessages(turn).map(message => message.id)));
  for (const turn of input.turns) {
    for (const human of sessionHumanMessages(turn)) {
    const userContent: SessionProjectedMessage["content"] = [];
    if (human.objective) userContent.push({ type: "text", text: human.objective });
    if (human.images?.length) userContent.push({
      type: "data", name: "talent-signal.user-images",
      data: { messageId: human.id, images: human.images, local: false },
    });
    messages.push({ id: `${human.id}:user`, role: "user", content: userContent, createdAt: new Date(human.createdAt) });
    }
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
    if (turn.response.hostResult) content.push({
      type: "data", name: "talent-signal.mcp-human-result",
      data: {
        version: 1,
        messageId: turn.id,
        result: turn.response.hostResult,
      },
    });
    if (turn.response.mcpInteraction) content.push({
      type: "data", name: "talent-signal.mcp-interaction",
      data: {
        version: 1,
        messageId: turn.id,
        requestId: turn.response.mcpInteraction.request_id,
        callId: turn.response.mcpInteraction.call_id,
        kind: turn.response.mcpInteraction.kind,
        state: turn.response.mcpInteraction.state,
      },
    });
    const awaiting = false; // Current decision state is read by the governed cards.
    const interrupted = conversationTurnInterrupted(turn.response, turn.id);
    const execution = canonicalExecution(turn.response);
    // The folded execution record sits above the result and never wraps it:
    // the final result is standalone and pending memory or calendar decisions
    // stay distinct blocks. Completed turns keep the record collapsed so the
    // state stays explicit without taking over the history.
    content.unshift({
      type: "data", name: "talent-signal.execution",
      data: {
        phase: conversationExecutionPhase({ entry: null, readbackComplete: true, awaitingDecision: awaiting, interrupted }),
        stage: null,
        startedAt: execution?.started_at ?? turn.createdAt,
        endedAt: execution?.completed_at ?? turn.response.createdAt,
        timingBasis: execution?.started_at ? "run" : "receipt",
        completedTools: execution?.tools ?? [],
        failureCode: null,
        milestones: input.milestonesByMessage?.[turn.id] ?? [],
        decisionKeys: [turn.response.memoryProposal ? `memory:${turn.response.memoryProposal.proposal_id}` : null, turn.response.meetingDraft ? `calendar:${turn.response.meetingDraft.id}` : null].filter(Boolean),
      },
    });
    messages.push({ id: `${turn.id}:assistant`, role: "assistant", content, createdAt: new Date(turn.response.createdAt) });
  }
  const active = input.active;
  if (active && !committed.has(active.message_id)) {
    const userContent: SessionProjectedMessage["content"] = [];
    if (active.objective) userContent.push({ type: "text", text: active.objective });
    if (active.images?.length) userContent.push({
      type: "data", name: "talent-signal.user-images",
      data: { messageId: active.message_id, images: active.images, local: false },
    });
    if (!active.host_result) messages.push({ id: `${active.message_id}:user`, role: "user", content: userContent, createdAt: new Date(active.created_at) });
    const preview = input.preview?.run_id === active.run_id ? input.preview : null;
    messages.push({
      id: `${active.message_id}:assistant`, role: "assistant",
      content: [
        ...(active.host_result ? [{ type: "data" as const, name: "talent-signal.mcp-human-result", data: { version: 1, messageId: active.message_id, result: active.host_result } }] : []),
        // In-flight state is a status record, never a fabricated reply.
        { type: "data", name: "talent-signal.execution", data: {
          phase: conversationExecutionPhase({ entry: active, readbackComplete: false, awaitingDecision: false }),
          stage: preview?.stage ?? active.stage ?? null,
          startedAt: active.started_at ?? active.created_at,
          timingBasis: active.started_at ? "run" : "receipt",
          endedAt: null,
          failureCode: active.failure_code,
          milestones: input.milestones ?? [],
          completedTools: preview?.completed_tools ?? [],
          draft: preview?.text ?? "",
        } },
      ],
      createdAt: new Date(active.updated_at),
    });
  }
  for (const entry of input.queued ?? []) {
    if (committed.has(entry.message_id) || entry.message_id === active?.message_id) continue;
    const content: SessionProjectedMessage["content"] = [];
    if (entry.objective) content.push({ type: "text", text: entry.objective });
    if (entry.images?.length) content.push({ type: "data", name: "talent-signal.user-images", data: { messageId: entry.message_id, images: entry.images, local: false } });
    if (!entry.host_result) messages.push({ id: `${entry.message_id}:user`, role: "user", content, createdAt: new Date(entry.created_at) });
    if (active?.run_id && entry.steers_run_id === active.run_id && entry.steer_state !== "unsupported") continue;
    messages.push({ id: `${entry.message_id}:assistant`, role: "assistant", content: [
      ...(entry.host_result ? [{ type: "data" as const, name: "talent-signal.mcp-human-result", data: { version: 1, messageId: entry.message_id, result: entry.host_result } }] : []),
      { type: "data", name: "talent-signal.execution", data: {
      phase: conversationExecutionPhase({ entry, readbackComplete: false, awaitingDecision: false }),
      stage: entry.stage, startedAt: entry.started_at ?? entry.created_at,
      timingBasis: entry.started_at ? "run" : "receipt",
      endedAt: entry.status === "queued" || entry.status === "running" ? null : entry.updated_at,
      failureCode: entry.failure_code, milestones: input.milestonesByMessage?.[entry.message_id] ?? [],
    } }], createdAt: new Date(entry.updated_at) });
  }
  return messages;
}

type RenderContext = {
  binding: string;
  meetingBinding: string;
  entryCapability: string | null;
  scope: string;
  sessionId: string;
  status: string;
  sourceImagesByMessageId: Record<string, readonly ConversationImageManifest[]>;
  sourceTextByMessageId: Record<string, string>;
  onDecisionState?: (key: string, state: DecisionState) => void;
  onCardComment?: (item: MemoryProposalItem) => void;
};

function dataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

type DecisionState = "pending" | "resolved" | "unknown";
const DecisionContext = createContext<{ states: Record<string, DecisionState>; update: (key: string, state: DecisionState) => void }>({ states: {}, update: () => {} });
function SessionExecutionRecord({ data }: { data: Record<string, unknown> }) {
  const decisions = useContext(DecisionContext);
  const execution = executionData(data);
  if (!execution) return <span>这项执行记录暂时无法显示。</span>;
  const keys = Array.isArray(data.decisionKeys) ? data.decisionKeys.filter((key): key is string => typeof key === "string") : [];
  const unknown = keys.some(key => !decisions.states[key] || decisions.states[key] === "unknown");
  const pending = keys.some(key => decisions.states[key] === "pending");
  const phase = execution.phase === "completed" ? (unknown ? "review-unknown" : pending ? "waiting-review" : "completed") : execution.phase;
  return <SessionExecutionCard {...execution} phase={phase}/>;
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
    if (!block.body.trim()) return null; // Silence retains execution, without a fabricated dialogue bubble.
    const title = typeof block.title === "string" ? sessionBlockTitle(block.title) : null;
    return <div><div className={styles.semanticBubble}>{title && <h3>{title}</h3>}<ConversationResponse lead={!title}>{block.body}</ConversationResponse></div>
      <ConversationProvenance sources={Array.isArray(block.public_source_refs) ? block.public_source_refs as never : undefined}/></div>;
  }
  if (name === "talent-signal.memory" && data.version === 1 && typeof data.proposalId === "string"
    && typeof data.revision === "number") {
    return <MemoryReviewCard binding={context.binding} entryCapability={context.entryCapability}
      proposal={{ proposal_id: data.proposalId, revision: data.revision }} purpose="chat" sessionId={context.sessionId}
      sourceImages={typeof data.messageId === "string" ? context.sourceImagesByMessageId[data.messageId] ?? [] : []}
      sourceMessageId={typeof data.messageId === "string" ? data.messageId : null}
      onDecisionState={state => context.onDecisionState?.(`memory:${data.proposalId}`, state)}
      sourceText={typeof data.messageId === "string" ? context.sourceTextByMessageId[data.messageId] ?? "" : ""}
      onCommentItem={context.onCardComment}/>;
  }
  if (name === "talent-signal.calendar" && data.version === 1 && typeof data.draftId === "string") {
    return <SessionCalendarDraftCard draftId={data.draftId} binding={context.meetingBinding} sessionId={context.sessionId} onDecisionState={state => context.onDecisionState?.(`calendar:${data.draftId}`, state)}/>;
  }
  if (name === "talent-signal.mcp-human-result" && data.version === 1) {
    // Host-owned typed human result: rendered with its provenance as a result
    // part, never as a user-authored message.
    const result = dataRecord(data.result);
    if (!result) return <span>这项结果暂时无法显示。</span>;
    return (
      <div className={styles.semanticBubble}>
        <h3>MCP 工具结果</h3>
        <ConversationResponse lead={false}>
          {result.outcome === "submitted" ? "你的确认已记录。" : result.outcome === "rejected" ? "你已拒绝这次请求，Agent 将按此结果继续。" : "这次请求的结果已记录。"}
        </ConversationResponse>
        <details><summary>查看结果来源</summary>
          <p>request_id：{String(result.request_id)}</p>
          <p>call_id：{String(result.call_id)}</p>
          <p>结果：{String(result.outcome)}</p>
        </details>
      </div>
    );
  }
  if (name === "talent-signal.mcp-interaction" && data.version === 1 && typeof data.requestId === "string") {
    // The card reloads the canonical request; the part carries only a stable
    // reference with the last observed lifecycle state.
    return <McpRequestCard
      fallback={typeof data.kind === "string" && typeof data.state === "string"
        ? {
            kind: data.kind as never,
            purpose: typeof data.purpose === "string" ? data.purpose : "",
            state: data.state as never,
          }
        : undefined}
      onDecisionState={state => context.onDecisionState?.(`mcp:${data.requestId}`,
        state === "unknown" ? "unknown" : state === "pending" || state === "waiting" || state === "submitting" ? "pending" : "resolved")}
      requestId={data.requestId}
      sessionVersion={context.binding ?? ""}/>;
  }
  if (name === "talent-signal.execution") {
    return <SessionExecutionRecord data={data}/>;
  }
  if (name === "talent-signal.run-update" || name === "talent-signal.progress") {
    const updates = Array.isArray(data.updates)
      ? data.updates.filter((line): line is string => typeof line === "string")
      : conversationMilestoneUpdates(typeof data.text === "string" ? data.text : "");
    return <SessionRunUpdate updates={updates} stage={typeof data.stage === "string" ? data.stage : null} status={context.status}/>;
  }
  return <span>{typeof data.fallback === "string" ? data.fallback : "这项结果暂时无法显示。"}</span>;
}

export function SessionUserMessage({ context }: { context: RenderContext }) {
  // Sent images stand outside the text bubble: each text part keeps one
  // readable bubble and image parts render directly beneath it, so an
  // image-bearing message never grows a prominent outer text bubble frame.
  // Text-only messages keep the original single bubble. The empty-text
  // synthetic part renders nothing instead of an empty bubble frame.
  return <MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.userRow}><div className={styles.userStack}>
      <MessagePrimitive.Parts>{({ part }) => part.type === "text" && part.text
        ? <div className={styles.userMessage}>{part.text}</div>
        : <></>}</MessagePrimitive.Parts>
      <MessagePrimitive.Parts>{({ part }) => part.type === "data" ? renderSessionData(part.name, part.data, context)
        : part.type === "text" ? <></> : null}</MessagePrimitive.Parts>
    </div></div>
  </MessagePrimitive.Root>;
}

export function SessionAssistantMessage({ context }: { context: RenderContext }) {
  const [states, setStates] = useState<Record<string, DecisionState>>({});
  const update = useCallback((key: string, state: DecisionState) => setStates(current => current[key] === state ? current : { ...current, [key]: state }), []);
  const renderContext = { ...context, onDecisionState: update };
  return <DecisionContext.Provider value={{ states, update }}><MessagePrimitive.Root className={styles.turn} role="article">
    <div className={styles.answer}>
      <div className={styles.identity} role="img" aria-label="capri"><span className={styles.mark} aria-hidden="true"/></div>
      <div className={styles.answerBody}>
        {/* Empty assistant content stays valid: silence needs no placeholder. */}
        <MessagePrimitive.Parts>{({ part }) => part.type === "text" ? <ConversationResponse>{part.text}</ConversationResponse>
          : part.type === "data" ? renderSessionData(part.name, part.data, renderContext) : null}</MessagePrimitive.Parts>
      </div>
    </div>
  </MessagePrimitive.Root></DecisionContext.Provider>;
}
