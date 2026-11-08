import type { PoolClient } from "pg";
import { appendAudit } from "../lib/audit.js";
import type { AuthContext } from "./auth.js";

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
