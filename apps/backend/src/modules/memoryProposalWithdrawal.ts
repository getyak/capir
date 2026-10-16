import type { DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import type { AuthContext } from "./auth.js";
import { loadProposal, loadProposalItems } from "./memoryReviewStore.js";
import type { McpStagingAuthority } from "./mcpInteractions.js";
import {
  assertProposalWithdrawalRun,
  assertProposalWithdrawalSource,
  withProposalWithdrawalTransaction,
} from "./proposalWithdrawalAuthority.js";

export interface MemoryProposalWithdrawalRequest {
  proposalID: string;
  expectedRevision: number;
  sourceMessageID: string;
  authority: McpStagingAuthority;
}

export interface MemoryProposalWithdrawalResult {
  proposalID: string;
  revision: number;
  status: "withdrawn" | "already_closed" | "already_committed";
  /** The pending review was closed while previously saved Memory was retained. */
  hadCommittedItems?: true;
}

/** Host-only reversal of an uncommitted proposal after a same-Run human
 * no-save instruction. It closes review authority, never deletes source/audit
 * evidence or undoes an accepted Memory/contact. Not a model tool or API. */
export function withdrawMemoryProposalForRun(
  database: DatabaseClient,
  auth: AuthContext,
  request: MemoryProposalWithdrawalRequest,
): Promise<MemoryProposalWithdrawalResult> {
  return withProposalWithdrawalTransaction(database, async client => {
    await assertProposalWithdrawalRun(client, auth, request.authority);
    await assertProposalWithdrawalSource(client, auth, request.authority, request.sourceMessageID);
    const proposal = await loadProposal(client, auth.accountId, request.proposalID, true);
    if (!proposal || proposal.created_by_user_id !== auth.userId || proposal.surface !== "chat"
      || proposal.proposer_kind !== "agent" || proposal.proposer_name !== "workspace-conversation"
      || proposal.session_id !== request.authority.sessionId || proposal.source_message_id !== request.sourceMessageID
      || proposal.source_task_id !== request.authority.fence.runId) {
      throw new ApiError(409, "MEMORY_WITHDRAWAL_SCOPE_MISMATCH", "This run cannot withdraw the requested Memory proposal.");
    }
    const result = { proposalID: proposal.id, revision: proposal.revision };
    if (proposal.status === "committed") return { ...result, status: "already_committed" };
    if (proposal.status === "dismissed" || proposal.status === "expired") return { ...result, status: "already_closed" };
    if (proposal.revision !== request.expectedRevision || proposal.status !== "open") {
      // A concurrent human commit/rebase is never silently overwritten. In
      // particular a partially committed review needs a fresh human decision.
      throw new ApiError(409, "MEMORY_WITHDRAWAL_CHANGED", "The Memory proposal changed after this run staged it.");
    }
    // A self-only human save may deliberately leave the contact decision open
    // without advancing the proposal revision. Its committed items are still
    // authoritative; proposal.status alone cannot prove nothing was saved.
    const items = await loadProposalItems(client, auth.accountId, proposal.id);
    const hadCommittedItems = items.some(item => item.status === "committed");
    if (hadCommittedItems && items.some(item => item.status === "pending")) {
      throw new ApiError(409, "MEMORY_WITHDRAWAL_CHANGED", "Part of this proposal was already saved by a human.");
    }
    // Even with no pending items, an open proposal can still authorize its
    // contact-only decision. Close that permission too, preserving every saved
    // item/commit rather than mistaking them for a closed review.
    const skipped = await client.query<{ id: string }>(
      `UPDATE memory_proposal_items SET status='skipped'
       WHERE account_id=$1 AND proposal_id=$2 AND status='pending' RETURNING id`,
      [auth.accountId, proposal.id],
    );
    await client.query(
      `UPDATE memory_proposals SET status='dismissed', revision=revision+1, updated_at=now()
       WHERE account_id=$1 AND id=$2 AND revision=$3`,
      [auth.accountId, proposal.id, request.expectedRevision],
    );
    await appendAudit(client, { accountId: auth.accountId, actorUserId: auth.userId },
      "memory.proposal_withdrawn", "memory_proposal", proposal.id, {
        proposal_revision: request.expectedRevision, source_task_id: request.authority.fence.runId,
        source_message_id: request.sourceMessageID, session_id: request.authority.sessionId,
        skipped_item_ids: skipped.rows.map(item => item.id), had_committed_items: hadCommittedItems, external_effect_count: 0,
      });
    return { proposalID: proposal.id, revision: proposal.revision + 1, status: "withdrawn",
      ...(hadCommittedItems ? { hadCommittedItems: true as const } : {}) };
  });
}
