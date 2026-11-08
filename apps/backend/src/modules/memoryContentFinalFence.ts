/** Closed Review-domain observation. No route/caller supplies SQL or a grant.
 * Accepted/Operation are deliberately not implemented by this Review slice. */
import type { MemoryReviewResponse } from "@talent-signal/contracts";
import type { PoolClient } from "pg";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_AT_TICK_SQL } from "./memoryProposalSourceEligibility.js";
// Only function declarations are imported across this owning pair; neither
// module invokes the other while initializing. No caller-provided projection.
import { hashReviewCredential, readMemoryReviewOnClient } from "./memoryReviewRead.js";
import { assertMemoryContentPreparationTransaction } from "./memoryContentReadEnvelope.js";

export function memoryContentChanged(): never {
  throw new ApiError(409, "MEMORY_CONTENT_CHANGED", "Memory content or its authority changed. Start a fresh read.");
}
export interface PreparedMemoryReviewContent {
  readonly body: MemoryReviewResponse;
  readonly encodedBody: string;
  readonly finalFence: unknown;
}
interface ReviewObservation {
  content_stamp: string;
  deadline: string;
  item_sources: Array<{ id: string; eligible: boolean }>;
}
interface BoundReview {
  client: PoolClient;
  accountId: string;
  userId: string;
  scopeID: string;
  credentialHash: string;
  stamp: string;
  originalDeadline: string;
}
const prepared = new WeakMap<object, Readonly<BoundReview>>();
const sixDigits = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

// Exact live Pursuit association, with pending receipt TTL at this same tick.
// This is additive; the original legacy owner/query/lock behavior is unchanged.
const pursuitCurrent = `(r.pursuit_id IS NULL OR EXISTS (
 SELECT 1 FROM pursuit_roles role
 JOIN pursuits pursuit ON pursuit.account_id=role.account_id AND pursuit.id=role.pursuit_id AND pursuit.status<>'cancelled'
 JOIN subjects subject ON subject.account_id=role.account_id AND subject.id=role.person_id AND subject.status='active'
 JOIN pursuit_role_evidence pe ON pe.account_id=role.account_id AND pe.role_id=role.id
 JOIN evidence_fragments fragment ON fragment.account_id=pe.account_id AND fragment.id=pe.evidence_fragment_id
   AND fragment.status='active' AND fragment.review_status='reviewed' AND fragment.attribution_status='confirmed' AND fragment.text_content IS NOT NULL
 JOIN source_resources resource ON resource.account_id=fragment.account_id AND resource.id=fragment.resource_id AND resource.processing_state<>'deleted'
 JOIN captures capture ON capture.account_id=fragment.account_id AND capture.id=fragment.capture_id
   AND capture.status='active' AND capture.identity_status='bound' AND capture.subject_id=role.person_id
 JOIN source_retention_receipts receipt ON receipt.account_id=capture.account_id AND receipt.capture_id=capture.id
   AND receipt.source_access_state='available' AND receipt.authorization_state='authorized'
   AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at>tick.checked_at)
   AND (receipt.retention_until IS NULL OR receipt.retention_until>tick.checked_at)
 LEFT JOIN assignments assignment ON assignment.account_id=capture.account_id AND assignment.id=capture.assignment_id
   AND assignment.status='active' AND assignment.subject_id=role.person_id
 WHERE role.account_id=$1 AND role.id=r.pursuit_role_id AND role.pursuit_id=r.pursuit_id
   AND role.person_id=r.person_id AND role.status IN ('active','quiet') AND role.confidence='confirmed'
   AND fragment.id=r.pursuit_role_evidence_fragment_id
   AND (r.pursuit_capture_version IS NULL OR capture.version=r.pursuit_capture_version)
   AND (r.pursuit_capture_id IS NULL OR capture.id=r.pursuit_capture_id)
   AND (r.relationship_context_id IS NULL OR capture.assignment_id=r.relationship_context_id)
   AND (capture.assignment_id IS NULL OR assignment.id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM memory_source_revocations revoked WHERE revoked.account_id=capture.account_id
     AND revoked.source_kind='capture' AND revoked.source_id=capture.id::text
     AND (revoked.source_version IS NULL OR revoked.source_version=COALESCE(r.pursuit_capture_version,capture.version)))
))`;

// All slots are closed: account1/reader2; scope12/credential13. Preparation
// pads slots3..11; the final envelope uses them for actual login/config facts.
// Hashes are server-local observation stamps, never persisted evidence or a
// client-visible access token. Original source text stays in PostgreSQL.
export const memoryReviewContentDomainCTEs = `review_scope AS MATERIALIZED (
 SELECT r.* FROM memory_review_scopes r CROSS JOIN tick
 WHERE r.account_id=$1 AND r.id=$12::uuid AND r.reader_user_id=$2
   AND r.expires_at>tick.checked_at
   AND (r.purpose='chat' OR EXISTS (SELECT 1 FROM subjects subject
     WHERE subject.account_id=$1 AND subject.id=r.person_id AND subject.status='active'))
   AND (r.purpose<>'relationship' OR EXISTS (SELECT 1 FROM assignments context
     WHERE context.account_id=$1 AND context.id=r.relationship_context_id AND context.subject_id=r.person_id AND context.status='active'))
   AND ${pursuitCurrent}
), review_proposal AS MATERIALIZED (
 SELECT p.* FROM memory_proposals p JOIN review_scope r ON r.proposal_id=p.id
 CROSS JOIN tick WHERE p.account_id=$1 AND p.created_by_user_id=$2 AND p.expires_at>tick.checked_at
), review_credential AS MATERIALIZED (
 SELECT c.* FROM memory_review_credentials c JOIN review_scope r ON r.id=c.review_scope_id CROSS JOIN tick
 WHERE c.account_id=$1 AND c.credential_hash=$13 AND c.revoked_at IS NULL AND c.expires_at>tick.checked_at
), review_items AS MATERIALIZED (
 SELECT i.*, ${MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_AT_TICK_SQL} AS source_is_current
 FROM memory_proposal_items i JOIN review_proposal p ON p.id=i.proposal_id CROSS JOIN tick
 WHERE i.account_id=$1
), review_sessions AS MATERIALIZED (
 SELECT s.* FROM agent_sessions s WHERE s.account_id=$1 AND (s.id IN (SELECT session_id FROM review_proposal)
   OR s.id IN (SELECT source_session_id FROM review_items))
), review_images AS MATERIALIZED (
 SELECT image.* FROM conversation_message_images image
 WHERE image.account_id=$1 AND image.session_id IN (SELECT id FROM review_sessions)
), review_fragments AS MATERIALIZED (
 SELECT f.* FROM evidence_fragments f WHERE f.account_id=$1 AND (f.id IN (SELECT evidence_fragment_id FROM review_items)
   OR f.id IN (SELECT pursuit_role_evidence_fragment_id FROM review_scope))
), review_captures AS MATERIALIZED (
 SELECT c.* FROM captures c WHERE c.account_id=$1 AND (c.id IN (SELECT capture_id FROM review_items)
   OR c.id IN (SELECT pursuit_capture_id FROM review_scope) OR c.id IN (SELECT capture_id FROM review_fragments))
), review_retention AS MATERIALIZED (
 SELECT receipt.* FROM source_retention_receipts receipt WHERE receipt.account_id=$1
   AND receipt.capture_id IN (SELECT id FROM review_captures)
), review_resources AS MATERIALIZED (
 SELECT resource.* FROM source_resources resource WHERE resource.account_id=$1
   AND (resource.id IN (SELECT source_resource_id FROM review_items) OR resource.id IN (SELECT resource_id FROM review_fragments))
), review_media AS MATERIALIZED (
 SELECT media.* FROM chat_media_assets media WHERE media.account_id=$1
   AND media.id::text IN (SELECT source_artifact_id FROM review_items)
), review_draft AS MATERIALIZED (
 SELECT d.*, (d.expires_at IS NULL OR d.expires_at>tick.checked_at) AS live_at_tick
 FROM memory_review_drafts d JOIN review_proposal p ON p.id=d.proposal_id CROSS JOIN tick
 WHERE d.account_id=$1 AND d.reader_user_id=$2
), review_observation AS MATERIALIZED (
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'scope',to_jsonb(r),'proposal',to_jsonb(p),'credential',to_jsonb(c),
   'items',(SELECT COALESCE(jsonb_agg(jsonb_build_array(i.id,encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex')) ORDER BY i.id),'[]'::jsonb) FROM review_items i),
   'draft',(SELECT COALESCE(jsonb_agg(jsonb_build_array(d.id,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')) ORDER BY d.id),'[]'::jsonb) FROM review_draft d),
   'sessions',(SELECT COALESCE(jsonb_agg(jsonb_build_array(s.id,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex')) ORDER BY s.id),'[]'::jsonb) FROM review_sessions s),
   'images',(SELECT COALESCE(jsonb_agg(jsonb_build_array(image.image_index,encode(sha256(convert_to(to_jsonb(image)::text,'UTF8')),'hex')) ORDER BY image.session_id,image.message_id,image.image_index),'[]'::jsonb) FROM review_images image),
   'captures',(SELECT COALESCE(jsonb_agg(jsonb_build_array(capture.id,encode(sha256(convert_to(to_jsonb(capture)::text,'UTF8')),'hex')) ORDER BY capture.id),'[]'::jsonb) FROM review_captures capture),
   'retention',(SELECT COALESCE(jsonb_agg(jsonb_build_array(receipt.capture_id,encode(sha256(convert_to(to_jsonb(receipt)::text,'UTF8')),'hex')) ORDER BY receipt.capture_id),'[]'::jsonb) FROM review_retention receipt),
   'fragments',(SELECT COALESCE(jsonb_agg(jsonb_build_array(fragment.id,encode(sha256(convert_to(to_jsonb(fragment)::text,'UTF8')),'hex')) ORDER BY fragment.id),'[]'::jsonb) FROM review_fragments fragment),
   'resources',(SELECT COALESCE(jsonb_agg(jsonb_build_array(resource.id,encode(sha256(convert_to(to_jsonb(resource)::text,'UTF8')),'hex')) ORDER BY resource.id),'[]'::jsonb) FROM review_resources resource),
   'media',(SELECT COALESCE(jsonb_agg(jsonb_build_array(media.id,encode(sha256(convert_to(to_jsonb(media)::text,'UTF8')),'hex')) ORDER BY media.id),'[]'::jsonb) FROM review_media media)
 )::text,'UTF8')),'hex') AS content_stamp,
 LEAST(r.expires_at,p.expires_at,c.expires_at,
   (SELECT min(value) FROM (
     SELECT s.expires_at AS value FROM review_sessions s CROSS JOIN tick WHERE s.expires_at>tick.checked_at
     UNION ALL SELECT image.expires_at FROM review_images image CROSS JOIN tick WHERE image.expires_at>tick.checked_at
     UNION ALL SELECT receipt.authorization_expires_at FROM review_retention receipt CROSS JOIN tick WHERE receipt.authorization_expires_at>tick.checked_at
     UNION ALL SELECT receipt.retention_until FROM review_retention receipt CROSS JOIN tick WHERE receipt.retention_until>tick.checked_at
     UNION ALL SELECT d.expires_at FROM review_draft d WHERE d.live_at_tick
   ) deadlines)) AS deadline,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'eligible',i.source_is_current) ORDER BY i.id),'[]'::jsonb)
   FROM review_items i) AS item_sources
 FROM review_scope r JOIN review_proposal p ON p.id=r.proposal_id CROSS JOIN review_credential c
)`;
// Both observations are lock-free MVCC reads. The private preparation uses
// one repeatable snapshot for all source/projection inputs; final is fresh.

function freezeJSON<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}

/** The actual passed-client Review reader is fixed here, never a callback
 * supplied by a route/caller. Its real bytes bind to the earlier actual-row
 * snapshot and this exact client. No public function accepts expected body. */
export async function captureMemoryReviewContent(
  client: PoolClient, auth: AuthContext, scopeID: string, renderedCredential: string,
): Promise<PreparedMemoryReviewContent> {
  assertMemoryContentPreparationTransaction(client);
  const accountId = auth.accountId, userId = auth.userId;
  const credentialHash = hashReviewCredential(renderedCredential);
  const values: unknown[] = [accountId, userId, null, null, null, null, null, null, null, null, null, scopeID, credentialHash];
  const row = (await client.query<ReviewObservation>(`WITH unused_authority_slots AS (SELECT $3::uuid,$4::text,$5::text,$6::timestamptz,$7::boolean,$8::text,$9::text,$10::boolean,$11::uuid[]),
    tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
    ${memoryReviewContentDomainCTEs}
    SELECT content_stamp,to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline,item_sources
    FROM review_observation WHERE current_setting('transaction_isolation')='repeatable read'`, values)).rows[0];
  if (!row || !/^[a-f0-9]{64}$/u.test(row.content_stamp) || !sixDigits.test(row.deadline)
    || !Array.isArray(row.item_sources)) return memoryContentChanged();
  const body = await readMemoryReviewOnClient(client, auth, scopeID, renderedCredential);
  const eligible = new Set(row.item_sources.filter(item => item.eligible === true).map(item => item.id));
  if (body.review.review_scope_id !== scopeID || body.review.items.some(item => !eligible.has(item.id)))
    return memoryContentChanged();
  const encodedBody = JSON.stringify(body);
  if (Buffer.byteLength(encodedBody, "utf8") > 1_048_576) {
    throw new ApiError(413, "MEMORY_CONTENT_TOO_LARGE", "The complete Memory response exceeds its encoded byte budget.");
  }
  const copied = freezeJSON(JSON.parse(encodedBody) as MemoryReviewResponse);
  const value = Object.freeze({ body: copied, encodedBody, finalFence: Object.freeze({}) });
  prepared.set(value, Object.freeze({ client, accountId, userId, scopeID, credentialHash,
    stamp: row.content_stamp, originalDeadline: row.deadline }));
  return value;
}

/** No structural shape, copied fence or user-provided identifier can pass this
 * module-local identity check. The encoded body itself was frozen pre-fence. */
export function memoryReviewContentBinding(value: unknown, client: PoolClient, accountId: string, userId: string): Readonly<BoundReview> {
  if (!value || typeof value !== "object") return memoryContentChanged();
  const binding = prepared.get(value);
  if (!binding || binding.client !== client || binding.accountId !== accountId || binding.userId !== userId)
    return memoryContentChanged();
  return binding;
}
