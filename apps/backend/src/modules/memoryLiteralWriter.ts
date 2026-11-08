/** Canonical first producer slice: authored Chat, owner-self adds and explicit
 * inline confirmation. These are private passed-client operations, not HTTP
 * handlers. The caller owns one transaction and its original publication fence. */
import { CONTRACT_VERSION, MEMORY_LITERAL_UUID, memoryLiteralInvalid, memoryLiteralRecord } from "@talent-signal/contracts";
import type { PoolClient } from "pg";
import { ApiError } from "../lib/apiError.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { captureMemoryLiteralStageRequest, captureMemoryLiteralCommitRequest, captureMemoryLiteralWriterData } from "./memoryLiteralWriterCapture.js";
import { prepareLiteralStage, prepareLiteralCommit, prepareLiteralOpen } from "./memoryLiteralWriterProtocol.js";
import { verifyMemoryLiteralProposalRow } from "./memoryLiteralIntegrity.js";
import { stageMemoryProposal, type StagedProposal } from "./memoryReviewStage.js";
import { openMemoryReviewOnClient } from "./memoryReviewRead.js";
import { commitMemoryReviewOnClient } from "./memoryReviewCommit.js";
import { loadProposal, loadProposalItems } from "./memoryReviewStore.js";
import { verifyPendingSourceAuthority } from "./memorySourceVerification.js";

export { captureMemoryLiteralStageRequest, captureMemoryLiteralCommitRequest } from "./memoryLiteralWriterCapture.js";

/** AuthContext comes only from the existing authenticator. Freezing its
 * values is not authentication or a replacement for the final serving fence. */
function actor(value: AuthContext): AuthContext {
  const row = memoryLiteralRecord(captureMemoryLiteralWriterData(value),
    ["accountId", "accountSlug", "userId", "userEmail", "userKind", "sessionId"]);
  if (typeof row.accountId !== "string" || !MEMORY_LITERAL_UUID.test(row.accountId)
    || typeof row.userId !== "string" || !MEMORY_LITERAL_UUID.test(row.userId)
    || typeof row.sessionId !== "string" || typeof row.accountSlug !== "string"
    || typeof row.userEmail !== "string" || typeof row.userKind !== "string") return memoryLiteralInvalid();
  return Object.freeze(row) as unknown as AuthContext;
}

type LiteralStagedProposal = StagedProposal & { contract_version: string; content_protocol: "literal-v2" };
export async function stageMemoryLiteralProposalOnClient(client: PoolClient, auth: AuthContext,
  input: unknown): Promise<LiteralStagedProposal> {
  const request = captureMemoryLiteralStageRequest(input), current = actor(auth);
  const idempotency = await claimIdempotency(client, { accountId: current.accountId, actorUserId: current.userId },
    "stage_memory_proposal", request.idempotency_key, request);
  if (idempotency.replay) {
    const body = idempotency.replay.body as { proposal?: { proposal_id?: string }; content_protocol?: unknown };
    const id = body?.proposal?.proposal_id;
    if (body.content_protocol !== "literal-v2" || typeof id !== "string") return memoryLiteralInvalid();
    const proposal = await loadProposal(client, current.accountId, id, true);
    if (!proposal || proposal.created_by_user_id !== current.userId || proposal.session_id !== request.session_id
      || proposal.source_message_id !== request.source_message_id) return memoryLiteralInvalid();
    const items = await loadProposalItems(client, current.accountId, id);
    const source = await verifyPendingSourceAuthority(client, current, proposal, items, { lock: true });
    if (!source.proposalSourceAvailable || source.unavailableItemIds.size > 0) {
      throw new ApiError(409, "MEMORY_SOURCE_UNAVAILABLE", "The original admitted source is no longer available.");
    }
    for (const item of items) {
      if (item.content_protocol !== "literal-v2") return memoryLiteralInvalid();
      await verifyMemoryLiteralProposalRow({ ...item });
    }
    return { ...idempotency.replay.body as LiteralStagedProposal, replayed: true };
  }
  const prepared = await prepareLiteralStage(client, current, request);
  const staged = await stageMemoryProposal(client, current, prepared.request, prepared.authority, prepared.ticket);
  if (!staged) return memoryLiteralInvalid();
  const body: LiteralStagedProposal = { contract_version: CONTRACT_VERSION, content_protocol: "literal-v2", ...staged };
  await completeIdempotency(client, idempotency, 201, body);
  return body;
}

export async function openMemoryLiteralReviewOnClient(client: PoolClient, auth: AuthContext, proposalID: string, input: unknown) {
  const request = memoryLiteralRecord(captureMemoryLiteralWriterData(input), ["purpose", "session_id"]), current = actor(auth);
  if (typeof proposalID !== "string" || !MEMORY_LITERAL_UUID.test(proposalID) || request.purpose !== "chat"
    || typeof request.session_id !== "string" || !MEMORY_LITERAL_UUID.test(request.session_id)) return memoryLiteralInvalid();
  return openMemoryReviewOnClient(client, current, proposalID, { purpose: "chat", session_id: request.session_id },
    prepareLiteralOpen(client, current, proposalID));
}

export async function commitMemoryLiteralReviewOnClient(client: PoolClient, auth: AuthContext, scopeID: string,
  credential: string | null, input: unknown) {
  const request = captureMemoryLiteralCommitRequest(input), current = actor(auth);
  if (typeof scopeID !== "string" || !MEMORY_LITERAL_UUID.test(scopeID)
    || (credential !== null && typeof credential !== "string")) return memoryLiteralInvalid();
  const prepared = prepareLiteralCommit(client, current, scopeID, request);
  return commitMemoryReviewOnClient(client, current, scopeID, credential, prepared.request, "batch", undefined, prepared.ticket);
}
