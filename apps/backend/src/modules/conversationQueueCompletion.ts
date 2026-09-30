import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type AgentSessionPayload,
  type ChatResponseBlock,
  type ConversationImageManifest,
  type UnscopedChatTaskResponse,
} from "@talent-signal/contracts";
import type { Pool } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { digestValue } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import { assertSessionChatSourcesAvailable, type AgentSessionChatSource } from "./agentSessionSources.js";
import { getAgentSession, mutateAgentSession } from "./agentSessions.js";
import {
  assertConversationQueueContextCurrent,
  assertConversationQueueLiveClaim,
  assertConversationQueueOwnedClaim,
  readConversationQueueSteeringMembers,
  type ConversationQueueRunFence,
  type ConversationQueueSteeringMember,
} from "./conversationQueueState.js";
import { readConversationMessageImageManifests } from "./conversationMessageImages.js";
import {
  recordUnscopedChatCompletionEvidence,
  type UnscopedChatExecution,
} from "./unscopedChat.js";

export interface ConversationQueueAuditMetadata {
  providerID: string | null;
  model: string | null;
  providerRequestID: string | null;
  prompt: unknown;
  contactAgentEventKind: string | null;
}

/**
 * Authentic execution readback for the folded card: canonical run bounds and
 * genuine tool-completion receipts. Name and time only; never arguments,
 * results, provider text or other private data.
 */
export interface ConversationQueueExecutionRecord {
  started_at: string | null;
  completed_at: string | null;
  tools: Array<{ name: string; completed_at: string }>;
}

/** One human message folded into the run's single canonical turn. */
export interface ConversationQueueSteeredMessage {
  id: string;
  objective: string;
  images?: ConversationImageManifest[];
  createdAt: string;
}

/** Serializable execution truth needed to replay Session persistence once. */
export interface ConversationQueueExecutionResult {
  body: UnscopedChatTaskResponse;
  conversationMessageIDs: string[];
  previousTaskIDs: string[];
  conversationSources: AgentSessionChatSource[];
  remoteStatus: UnscopedChatExecution["remoteStatus"];
  audit: ConversationQueueAuditMetadata;
  /** Ordered metadata-only attachment manifest; never raw bytes. */
  images: ConversationImageManifest[];
  /** Canonical run start/end and real tool completions, when available. */
  execution?: ConversationQueueExecutionRecord;
}

function executionFromResult(
  result: ConversationQueueExecutionResult,
): UnscopedChatExecution {
  return {
    body: result.body,
    conversationMessageIDs: result.conversationMessageIDs,
    previousTaskIDs: result.previousTaskIDs,
    conversationSources: result.conversationSources,
    remoteStatus: result.remoteStatus,
    providerResult: null,
    agentProviderResult: result.audit.providerID && result.audit.model
      ? {
          providerID: result.audit.providerID,
          model: result.audit.model,
          providerRequestID: result.audit.providerRequestID,
          inputTokens: 0,
          outputTokens: 0,
          ...(result.audit.prompt ? { prompt: result.audit.prompt as never } : {}),
        }
      : null,
  };
}

function displayBlocks(blocks: ChatResponseBlock[]) {
  return blocks.slice(0, 32).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    status: entry.status,
    citation_dependency_ids: [] as string[],
    requires_user_decision: false as const,
    allows_static_share: false,
    target_ref: null,
  }));
}

type QueueTurn = {
  id: string;
  objective: string;
  images?: ConversationImageManifest[];
  /** Delivered steering messages folded before this turn's one response. */
  steeredMessages?: ConversationQueueSteeredMessage[];
  createdAt: string;
  response: {
    contractVersion: string;
    taskID: string;
    contextManifestID: string;
    knowledgeSnapshotID: string;
    disposition: string;
    createdAt: string;
    unboundConversationBlocks: ReturnType<typeof displayBlocks>;
    memoryProposal?: { proposal_id: string; revision: number };
    meetingDraft?: {id:string;title:string};
    execution?: ConversationQueueExecutionRecord;
  };
};

function queueTurn(
  messageId: string,
  objective: string,
  acceptedAt: string,
  response: { taskID: string; disposition: string; blocks: ChatResponseBlock[]; createdAt: string; memoryProposal?: { proposal_id: string; revision: number } },
  images: readonly ConversationImageManifest[] = [],
  fold: {
    steered?: readonly ConversationQueueSteeredMessage[];
    execution?: ConversationQueueExecutionRecord;
  } = {},
): QueueTurn {
  return {
    id: messageId,
    objective,
    ...(images.length > 0 ? { images: [...images] } : {}),
    ...(fold.steered && fold.steered.length > 0 ? { steeredMessages: [...fold.steered] } : {}),
    createdAt: acceptedAt,
    response: {
      contractVersion: CONTRACT_VERSION,
      taskID: response.taskID,
      contextManifestID: "",
      knowledgeSnapshotID: "",
      disposition: response.disposition,
      createdAt: response.createdAt,
      unboundConversationBlocks: displayBlocks(response.blocks),
      ...(response.blocks.find(block=>block.calendar_draft)?.calendar_draft
        ? {meetingDraft:{id:response.blocks.find(block=>block.calendar_draft)!.calendar_draft!.id,title:response.blocks.find(block=>block.calendar_draft)!.calendar_draft!.title}} : {}),
      ...(response.memoryProposal ? { memoryProposal: response.memoryProposal } : {}),
      ...(fold.execution ? { execution: fold.execution } : {}),
    },
  };
}

/**
 * The steering fold truth: exactly the messages the model actually received,
 * with their grouped images, plus the messages whose image batch could not
 * join this run and re-queue as the next task.
 */
async function readConversationQueueSteeringFold(
  pool: Pool,
  fence: ConversationQueueRunFence,
): Promise<{ delivered: ConversationQueueSteeredMessage[]; unsupportedCount: number }> {
  const [deliveredMembers, unsupportedMembers] = await Promise.all([
    readConversationQueueSteeringMembers(pool, fence, { state: "delivered" }),
    readConversationQueueSteeringMembers(pool, fence, { state: "unsupported" }),
  ]);
  const manifests = await readConversationMessageImageManifests(
    pool,
    fence.accountId,
    deliveredMembers.map((member) => member.entryId),
  );
  return {
    delivered: deliveredMembers.map((member) => {
      const images = manifests.get(member.entryId) ?? [];
      return {
        id: member.messageId,
        objective: member.objective,
        ...(images.length > 0 ? { images } : {}),
        createdAt: member.acceptedAt,
      };
    }),
    unsupportedCount: unsupportedMembers.length,
  };
}

/** Host-authored, explicit: never a model answer and never silent loss. */
function unsupportedSteeringNote(unsupportedCount: number, chinese: boolean): ChatResponseBlock {
  return {
    id: randomUUID(),
    kind: "answer",
    title: chinese ? "补充消息将单独处理" : "Supplement queued separately",
    body: unsupportedCount > 0
      ? chinese
        ? "部分补充因图片或数量边界未能并入本次任务；消息与附件完整保留，将在后续任务中处理。"
        : "Some supplements exceeded this task’s image or message boundary. Each original message and attachment is preserved for a later task."
      : "",
    status: "informational",
    citation_dependency_ids: [],
    requires_user_decision: false,
  };
}

/**
 * Write the durable source/audit lineage for a completed run exactly once.
 *
 * The `lineage_recorded_at` gate and the governed evidence write share one
 * transaction, so a replay can never duplicate audit rows or proposal rows.
 */
export async function recordConversationQueueLineage(
  pool: Pool,
  auth: AuthContext,
  input: {
    fence: ConversationQueueRunFence;
    request: Parameters<typeof recordUnscopedChatCompletionEvidence>[2];
    result: ConversationQueueExecutionResult;
  },
): Promise<void> {
  await inTransaction(pool, async (client) => {
    const claimed = await client.query(
      `UPDATE conversation_queue_entries
       SET lineage_recorded_at=now(), revision=revision+1, updated_at=now()
       WHERE account_id=$1 AND id=$2 AND run_id=$3 AND lease_owner=$4 AND lease_generation=$5
         AND status='running' AND lease_expires_at>now() AND cancel_requested=false
         AND lineage_recorded_at IS NULL
       RETURNING id`,
      [
        input.fence.accountId,
        input.fence.entryId,
        input.fence.runId,
        input.fence.leaseOwner,
        input.fence.leaseGeneration,
      ],
    );
    if (claimed.rowCount === 1) {
      await recordUnscopedChatCompletionEvidence(
        client,
        auth,
        input.request,
        executionFromResult(input.result),
      );
    }
  });
}

/**
 * Persist canonical Session history for a completed run.
 *
 * Ordering: current source validity -> live claim -> lineage/audit -> live
 * claim -> canonical Session turn. The turn is only visible after lineage is
 * durable, and every step is fenced and idempotent. If persistence fails the
 * stored result is preserved for a replay that never re-invokes the model.
 */
export async function persistConversationQueueCompletion(
  pool: Pool,
  auth: AuthContext,
  input: {
    fence: ConversationQueueRunFence;
    sessionId: string;
    messageId: string;
    objective: string;
    acceptedAt: string;
    images: ConversationImageManifest[];
    result: ConversationQueueExecutionResult;
  },
): Promise<void> {
  await assertConversationQueueOwnedClaim(pool, input.fence);
  await assertConversationQueueContextCurrent(pool, auth, input.sessionId);
  await recordConversationQueueLineage(pool, auth, {
    fence: input.fence,
    request: {
      idempotency_key: `conversation-queue:${input.fence.entryId}`,
      session_id: input.sessionId,
      message_id: input.messageId,
      objective: input.objective,
    },
    result: input.result,
  });
  await assertSessionChatSourcesAvailable(pool, auth, input.result.body.task_id);
  await assertConversationQueueLiveClaim(pool, input.fence);
  const { body } = input.result;
  // The fold is read under the live fence: exactly the messages this run
  // actually delivered, never the ones still waiting or unsupported.
  const fold = await readConversationQueueSteeringFold(pool, input.fence);
  const chinese = /\p{Script=Han}/u.test(input.objective);
  const blocks = fold.unsupportedCount > 0
    ? [...body.blocks, unsupportedSteeringNote(fold.unsupportedCount, chinese)]
    : body.blocks;
  await saveConversationQueueTurn(
    pool,
    auth,
    {
      fence: input.fence,
      sessionId: input.sessionId,
      messageId: input.messageId,
      allowCancelRequested: false,
    },
    queueTurn(input.messageId, input.objective, input.acceptedAt, {
      taskID: body.task_id,
      disposition: body.disposition,
      blocks,
      createdAt: body.created_at,
      ...(body.memory_proposal
        ? { memoryProposal: { proposal_id: body.memory_proposal.proposal_id, revision: body.memory_proposal.revision } }
        : {}),
    }, input.images, {
      steered: fold.delivered,
      ...(input.result.execution ? { execution: input.result.execution } : {}),
    }),
    { title: body.session_title ?? null, updatedAt: body.created_at },
  );
}

/**
 * Persist the admitted message and the partial text a stopped run already
 * produced, marked incomplete.
 *
 * Only reached when an explicit user stop is durably committed on a live owned
 * claim with current source validity — including a stop that raced failure or
 * shutdown finalization before the queue row could be scrubbed. Revocation,
 * expiry, and stale leases never pass the owned-claim and context checks below,
 * so now-unauthorized text is never stored; a caller that cannot persist here
 * must retain the fenced row instead of scrubbing it or claiming the message
 * saved.
 */
export async function persistConversationQueueCancellation(
  pool: Pool,
  auth: AuthContext,
  input: {
    fence: ConversationQueueRunFence;
    sessionId: string;
    messageId: string;
    objective: string;
    acceptedAt: string;
    images: ConversationImageManifest[];
    partialText: string;
    stoppedAt: string;
    execution?: ConversationQueueExecutionRecord;
  },
): Promise<void> {
  const partial = input.partialText.trim();
  const owned = await assertConversationQueueOwnedClaim(pool, input.fence, {
    allowCancelRequested: true,
  });
  if (!owned.cancelRequested) {
    // The stop flag vanished: another decision already owns this run.
    throw new ApiError(
      409,
      "CONVERSATION_QUEUE_STOP_SUPERSEDED",
      "This run was already resolved elsewhere.",
    );
  }
  await assertConversationQueueContextCurrent(pool, auth, input.sessionId);
  // A stop preserves completed work: the human messages this run actually
  // received stay in the transcript with their identities and times, followed
  // by the truthful stopped marker — never a fabricated answer.
  const fold = await readConversationQueueSteeringFold(pool, input.fence);
  const block: ChatResponseBlock = {
    id: randomUUID(),
    kind: "answer",
    title: /\p{Script=Han}/u.test(input.objective) ? "已停止" : "Stopped",
    body: partial.slice(0, 12_000) || (/\p{Script=Han}/u.test(input.objective)
      ? "已停止生成，本次尚未形成回复。"
      : "Stopped before a reply was generated."),
    status: "failed",
    citation_dependency_ids: [],
    requires_user_decision: false,
  };
  await saveConversationQueueTurn(
    pool,
    auth,
    {
      fence: input.fence,
      sessionId: input.sessionId,
      messageId: input.messageId,
      allowCancelRequested: true,
    },
    queueTurn(input.messageId, input.objective, input.acceptedAt, {
      taskID: `cancelled-${input.messageId}`,
      disposition: "answer",
      blocks: [block],
      createdAt: input.stoppedAt,
    }, input.images, { steered: fold.delivered, ...(input.execution ? { execution: input.execution } : {}) }),
    { title: null, updatedAt: input.stoppedAt },
  );
}

async function saveConversationQueueTurn(
  pool: Pool,
  auth: AuthContext,
  identity: {
    fence: ConversationQueueRunFence;
    sessionId: string;
    messageId: string;
    allowCancelRequested: boolean;
  },
  turn: QueueTurn,
  metadata: { title: string | null; updatedAt: string },
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertConversationQueueOwnedClaim(pool, identity.fence, {
      allowCancelRequested: identity.allowCancelRequested,
    });
    const session = await getAgentSession(pool, auth, identity.sessionId);
    const payload = session.payload;
    if (session.deleted_at || !payload) {
      throw new ApiError(
        410,
        "AGENT_SESSION_DELETED",
        "This Session was deleted or expired and cannot receive the reply.",
      );
    }
    const existing = payload.turns.find(entry => entry.id.toLowerCase() === identity.messageId.toLowerCase());
    if (existing) {
      if (!existing.response.execution || existing.objective !== turn.objective
        || Date.parse(existing.createdAt) !== Date.parse(turn.createdAt)
        || digestValue(existing.steeredMessages ?? []) !== digestValue(turn.steeredMessages ?? [])
        || (existing.response.taskID !== turn.response.taskID
          && !(identity.allowCancelRequested && existing.response.taskID === identity.fence.runId))) {
        throw new ApiError(409, "CONVERSATION_QUEUE_CANONICAL_TURN_CONFLICT",
          "A matching message ID without the canonical execution cannot consume this queue result.");
      }
      return; // proved canonical persistence; never invoke the model again
    }
    const next: AgentSessionPayload = {
      ...payload,
      isUnread: payload.isUnread ?? false,
      updatedAt: metadata.updatedAt,
      ...(payload.turns.length === 0 && metadata.title ? { title: metadata.title } : {}),
      turns: [...payload.turns, turn],
    };
    try {
      await mutateAgentSession(pool, auth, identity.sessionId, {
        expected_revision: session.revision,
        idempotency_key: identity.messageId,
        payload: next,
      }, false, { fence: identity.fence, messageId: identity.messageId, allowCancelRequested: identity.allowCancelRequested });
      return;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.statusCode === 409 &&
        error.code === "AGENT_SESSION_REVISION_CONFLICT"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError(
    409,
    "CONVERSATION_QUEUE_SESSION_BUSY",
    "The Session kept changing. The completed reply is preserved and will be saved on retry.",
  );
}
