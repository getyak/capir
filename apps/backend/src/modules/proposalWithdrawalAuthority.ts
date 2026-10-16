import type { PoolClient } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { assertAccountActive } from "./accountIdentity.js";
import { assertSessionForChat } from "./agentSessionSources.js";
import type { AuthContext } from "./auth.js";
import { assertConversationQueueOwnedClaim } from "./conversationQueueState.js";
import type { McpStagingAuthority } from "./mcpInteractions.js";

/** PoolClient callers already own the transaction; never acquire another Pool
 * connection or commit their surrounding work. */
export function withProposalWithdrawalTransaction<T>(
  database: DatabaseClient,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return "release" in database ? operation(database) : inTransaction(database, operation);
}

/** Host-only authority for withdrawing this live Run's own pending proposals.
 * A generated statement, source image or arbitrary task UUID grants nothing. */
export async function assertProposalWithdrawalRun(
  client: PoolClient,
  auth: AuthContext,
  authority: McpStagingAuthority,
): Promise<void> {
  if (authority.fence.accountId !== auth.accountId || authority.fence.sessionId !== authority.sessionId) {
    throw new ApiError(409, "PROPOSAL_WITHDRAWAL_SCOPE_MISMATCH", "The run does not own this proposal scope.");
  }
  // Match the account-before-queue lock order used by Run refresh and MCP
  // staging; retirement and concurrent approval cannot cross this boundary.
  await assertAccountActive(client, auth.accountId);
  const user = await client.query<{ status: string }>(
    "SELECT status FROM users WHERE account_id=$1 AND id=$2 FOR SHARE", [auth.accountId, auth.userId],
  );
  if (user.rows[0]?.status !== "active") {
    throw new ApiError(403, "PROPOSAL_WITHDRAWAL_SCOPE_MISMATCH", "The acting member is no longer active.");
  }
  await assertConversationQueueOwnedClaim(client, authority.fence);
  await assertSessionForChat(client, auth, authority.sessionId, true);
  const entry = await client.query(
    `SELECT 1 FROM conversation_queue_entries
     WHERE account_id=$1 AND id=$2 AND session_id=$3 AND run_id=$4
       AND created_by_user_id=$5 AND message_id=$6
       AND content_state='retained' AND objective IS NOT NULL AND expires_at>now()`,
    [auth.accountId, authority.fence.entryId, authority.sessionId, authority.fence.runId, auth.userId, authority.messageId],
  );
  if (!entry.rowCount) {
    throw new ApiError(409, "PROPOSAL_WITHDRAWAL_SCOPE_MISMATCH", "The run no longer owns its originating user message.");
  }
}

/** A source is this Run's root or an actually dispatched steering member, never
 * an earlier Session message or an undelivered future task. */
export async function assertProposalWithdrawalSource(
  client: PoolClient,
  auth: AuthContext,
  authority: McpStagingAuthority,
  sourceMessageID: string,
): Promise<void> {
  if (sourceMessageID === authority.messageId) return;
  const source = await client.query(
    `SELECT 1 FROM conversation_queue_entries
     WHERE account_id=$1 AND session_id=$2 AND created_by_user_id=$3 AND message_id=$4
       AND steer_group_entry_id=$5 AND steer_state IN ('dispatching','delivered')
       AND content_state='retained' AND objective IS NOT NULL AND expires_at>now()
     FOR SHARE`,
    [auth.accountId, authority.sessionId, auth.userId, sourceMessageID, authority.fence.entryId],
  );
  if (!source.rowCount) {
    throw new ApiError(409, "PROPOSAL_WITHDRAWAL_SCOPE_MISMATCH", "The proposal source was not consumed by this run.");
  }
}
