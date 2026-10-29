import { CONTRACT_VERSION, TalentSignalHttpError, resolveFirstReplyTitle, type TalentSignalClient, type AgentSessionResponse } from "@talent-signal/contracts";

export type WorkspaceChatInput = { request_id: string; session_id: string; objective: string; time_zone: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const genericSessionTitles = new Set(["reply", "answer", "hello", "hi", "chat", "conversation", "response", "greeting", "回复", "回答", "你好", "您好", "嗨", "工作台对话", "对话", "聊天", "会话"]);

function boundedSessionTitle(value: string): string {
  let segments: string[];
  try { segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), part => part.segment); }
  catch { segments = Array.from(value); }
  let codePoints = 0;
  const accepted: string[] = [];
  for (const segment of segments) {
    const size = Array.from(segment).length;
    if (accepted.length >= 32 || codePoints + size > 256) break;
    accepted.push(segment); codePoints += size;
  }
  return accepted.join("").trim();
}

/** Local first-paint fallback; the canonical API title replaces it only once. */
export function workspaceSessionTitle(value: string): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  const bounded = boundedSessionTitle(oneLine);
  const comparable = bounded.toLowerCase().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
  if (!bounded || genericSessionTitles.has(comparable)) return /\p{Script=Han}/u.test(value) ? "简单聊两句" : "Quick hello";
  return bounded;
}

/** The browser submits intent; canonical product results supply conversation history. */
export async function askWorkspaceChat(client: TalentSignalClient, input: WorkspaceChatInput) {
  if (!input || !uuid.test(input.request_id) || !uuid.test(input.session_id) ||
      typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 1000 ||
      typeof input.time_zone !== "string" || input.time_zone.length > 100) {
    throw new TalentSignalHttpError(400, "workspace_chat_invalid", "消息格式无效。", null);
  }
  const now = new Date().toISOString();
  let session: AgentSessionResponse;
  try { session = await client.getAgentSession(input.session_id); }
  catch (error) {
    if (!(error instanceof TalentSignalHttpError) || error.status !== 404) throw error;
    session = await client.saveAgentSession(input.session_id, {
      expected_revision: 0, idempotency_key: input.session_id,
      payload: { id: input.session_id, scopeKind: "unresolved_intent", personDisplayLabel: "",
        contextDisplayLabel: "", title: workspaceSessionTitle(input.objective), turns: [], updatedAt: now, isUnread: false },
    });
  }
  const payload = session.session.payload;
  if (!payload || session.session.deleted_at || payload.scopeKind !== "unresolved_intent") {
    throw new TalentSignalHttpError(409, "workspace_session_unavailable", "这段对话已不可用，请重新打开工作台。", null);
  }
  const output = await client.createUnscopedChatTask({
    idempotency_key: `web-chat:${input.request_id}`, session_id: input.session_id,
    message_id: input.request_id, objective: input.objective.trim(), time_zone: input.time_zone,
  });
  if (!payload.turns.some(turn => turn.id === input.request_id)) {
    await client.saveAgentSession(input.session_id, {
      expected_revision: session.session.revision, idempotency_key: input.request_id,
      payload: { ...payload,
        ...(payload.turns.length === 0 && output.session_title ? { title: resolveFirstReplyTitle(payload.title, workspaceSessionTitle(output.session_title), workspaceSessionTitle(input.objective)) } : {}),
        updatedAt: output.created_at, turns: [...payload.turns, {
        id: input.request_id, objective: input.objective.trim(), createdAt: now,
        response: { contractVersion: CONTRACT_VERSION, taskID: output.task_id, contextManifestID: "",
          knowledgeSnapshotID: "", disposition: output.disposition, createdAt: output.created_at,
          // A bounded historical display, never an executable action or evidence authority.
          unboundConversationBlocks: output.blocks.slice(0, 32).map(block => ({
            id: block.id, kind: block.kind, title: block.title, body: block.body,
            status: block.status, citation_dependency_ids: [], requires_user_decision: false as const,
            allows_static_share: false, target_ref: null,
          })),
          ...(output.memory_proposal ? {
            memoryProposal: {
              proposal_id: output.memory_proposal.proposal_id,
              revision: output.memory_proposal.revision,
            },
          } : {}),
        },
      }] },
    });
  }
  return output;
}
