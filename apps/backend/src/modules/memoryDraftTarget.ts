import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { assertAccountActive } from "./accountIdentity.js";
import { assertSessionForChat } from "./agentSessionSources.js";
import {
  assertConversationQueueContextCurrent,
  assertConversationQueueOwnedClaim,
} from "./conversationQueueState.js";
import type { McpStagingAuthority } from "./mcpInteractions.js";
import type { MemoryProposalCandidate } from "@talent-signal/contracts";

/** Host-only staging scope. It is never a HumanIdentityBinding or recall grant. */
export interface MemoryDraftTargetAdmission {
  personID: string;
  displayLabel: string;
  messageID: string;
  sessionID: string;
}

export function memoryDraftProposalViolation(target: MemoryDraftTargetAdmission, input: {
  personID: string | null;
  contextID: string | null;
  contactDecision: "existing" | "new" | "none";
  items: readonly Pick<MemoryProposalCandidate, "scope" | "subject_id" | "relationship_context_id" | "dependence_kind" | "source_locator">[];
}): "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH" | "MEMORY_DRAFT_TARGET_SOURCE_MISMATCH" | null {
  if (input.personID !== target.personID || input.contextID !== null || input.contactDecision !== "existing"
    || input.items.length === 0 || input.items.some(item => item.scope !== "person"
      || (item.subject_id != null && item.subject_id !== target.personID)
      || item.relationship_context_id != null
      || (item.dependence_kind !== undefined && item.dependence_kind !== "contact"))) {
    return "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH";
  }
  if (input.items.some(item => item.source_locator.kind !== "message"
    || item.source_locator.session_id !== target.sessionID || item.source_locator.message_id !== target.messageID)) {
    return "MEMORY_DRAFT_TARGET_SOURCE_MISMATCH";
  }
  return null;
}

export async function assertActiveMemoryDraftTarget(
  client: DatabaseClient,
  auth: AuthContext,
  personID: string,
): Promise<string> {
  const row = (await client.query<{ display_label: string }>(
    "SELECT display_label FROM subjects WHERE account_id=$1 AND id=$2 AND status='active' FOR SHARE",
    [auth.accountId, personID],
  )).rows[0];
  if (!row) throw new ApiError(409, "MEMORY_DRAFT_TARGET_UNAVAILABLE",
    "The selected person is no longer available in this account. Choose a current person and send a new message.");
  return row.display_label;
}

/** Reconstruct the scope from the durable queue under its current Run fence. */
export async function authorizeMemoryDraftTarget(
  client: DatabaseClient,
  auth: AuthContext,
  input: {
    personID: string;
    messageID: string;
    sessionID: string | null;
    runID: string | null;
    sourceText: string;
    hostAuthority?: McpStagingAuthority;
  },
): Promise<MemoryDraftTargetAdmission> {
  const authority = input.hostAuthority;
  if (!authority || !input.sessionID || !input.sourceText.trim()
    || authority.messageId !== input.messageID || authority.sessionId !== input.sessionID
    || authority.fence.accountId !== auth.accountId || authority.fence.sessionId !== input.sessionID
    || authority.fence.runId !== input.runID) {
    throw new ApiError(409, "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED", "A Memory draft target requires its original live message admission.");
  }
  // Preserve the account-before-queue lock order used by governed staging.
  await assertAccountActive(client, auth.accountId);
  await assertConversationQueueOwnedClaim(client, authority.fence);
  await assertSessionForChat(client, auth, input.sessionID, true);
  await assertConversationQueueContextCurrent(client, auth, input.sessionID);
  const revoked = (await client.query<{ revoked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM memory_source_revocations WHERE account_id=$1
       AND ((source_kind='session' AND source_id=$2) OR (source_kind='artifact' AND source_id=$3)))
     OR EXISTS (SELECT 1 FROM agent_session_retracted_tasks WHERE account_id=$1 AND task_id=$4) AS revoked`,
    [auth.accountId, input.sessionID, `${input.sessionID}:message:${input.messageID}`, input.runID],
  )).rows[0]?.revoked;
  if (revoked) throw new ApiError(409, "MEMORY_SOURCE_REVOKED", "The current message source was withdrawn; it cannot support a Memory draft.");
  const row = (await client.query<{
    memory_draft_target_person_id: string | null; message_id: string; objective: string | null;
    created_by_user_id: string; host_result: unknown; images_hash: string | null;
  }>(
    `SELECT memory_draft_target_person_id,message_id,objective,created_by_user_id,host_result,images_hash
     FROM conversation_queue_entries WHERE account_id=$1 AND id=$2`,
    [auth.accountId, authority.fence.entryId],
  )).rows[0];
  if (!row || row.created_by_user_id !== auth.userId || row.message_id !== input.messageID
    || row.memory_draft_target_person_id !== input.personID || row.objective !== input.sourceText
    || row.host_result != null || row.images_hash != null) {
    throw new ApiError(409, "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED", "The Memory draft target does not match the admitted message.");
  }
  return { personID: input.personID, messageID: input.messageID, sessionID: input.sessionID,
    displayLabel: await assertActiveMemoryDraftTarget(client, auth, input.personID) };
}
