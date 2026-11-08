import type { PoolClient } from "pg";
import { appendAudit } from "../lib/audit.js";
import type { AuthContext } from "./auth.js";
import type { ChatResponseBlock } from "@talent-signal/contracts";
import { recordSessionChatSources, type AgentSessionChatSource } from "./agentSessionSources.js";
import { recordMeetingDraftsForTask } from "./meetingDrafts.js";

/** Real source owners shared by atomic and durable publication. No synthesized
 * execution/Agent result is needed to retain a truthful answer-only reply. */
export async function recordUnscopedChatCompletionSources(client: PoolClient, auth: AuthContext, input: {
  sessionID: string | undefined; taskID: string; blocks: ChatResponseBlock[]; messageID: string | undefined;
  conversationSources: AgentSessionChatSource[]; previousTaskIDs: string[];
}): Promise<void> {
  await recordSessionChatSources(client,auth,input.sessionID,input.taskID,input.conversationSources,input.previousTaskIDs);
  if (input.sessionID) await recordMeetingDraftsForTask(client,auth,{
    blocks: input.blocks,...(input.messageID ? { messageID: input.messageID } : {}),sessionID: input.sessionID,taskID: input.taskID,
  });
}

/** Shared audit owner for the existing atomic path and durable answer-only
 * finalizer. No provider execution object or full prompt text is required. */
export async function appendUnscopedChatCompletionAudit(client: PoolClient, auth: AuthContext, input: {
  taskID: string;
  sessionID: string | null;
  messageID: string | null;
  conversationMessageIDs: readonly string[];
  disposition: "answer" | "clarify";
  remoteStatus: "agent_completed" | "completed" | "disabled" | "fallback";
  providerID: string | null;
  model: string | null;
  providerRequestID: string | null;
  eventKind: string | null;
  prompt: unknown;
}): Promise<void> {
  await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId },
    "unscoped_chat_task.completed", "unscoped_chat_task", input.taskID, {
      context_scope: "agent_bounded_contact_lookup",
      conversation_session_id: input.sessionID,
      conversation_message_ids: input.conversationMessageIDs,
      current_message_id: input.messageID,
      evidence_count: 0,
      external_effect_count: 0,
      disposition: input.disposition,
      remote_chat_status: input.remoteStatus,
      remote_chat_provider_id: input.providerID,
      remote_chat_model: input.model,
      remote_chat_provider_request_id: input.providerRequestID,
      contact_agent_event_kind: input.eventKind,
      prompt: input.prompt,
    });
}
