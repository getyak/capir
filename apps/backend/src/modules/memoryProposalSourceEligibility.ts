/** Read-only prequalification for the p=proposal/i=visible pending item aliases.
 * Owning authority remains verifyPendingSourceAuthority; every selected row is
 * checked by that original verifier again. Do not use accepted-Memory evidence
 * retention here: pending proposals still require their original live source.
 *
 * Mapping: memorySourceVerification.ts captureById/receipt/resource/fragment,
 * media + sessionPendingAvailable, proposalSourceAvailable, tombstoneBlocks;
 * memoryReviewStore.ts resolveSessionSourceAuthority + sourceRevisionHash.
 * The normal pool's 10s statement/12s query limits remain unchanged.
 */

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const safeTurns = `CASE WHEN jsonb_typeof(s.payload->'turns') = 'array'
  THEN s.payload->'turns' ELSE '[]'::jsonb END`;
const safeSteering = `CASE WHEN jsonb_typeof(t.value->'steeredMessages') = 'array'
  THEN t.value->'steeredMessages' ELSE '[]'::jsonb END`;
const safeStoredManifest = `CASE WHEN jsonb_typeof(p.source_image_manifest) = 'array'
  THEN p.source_image_manifest ELSE '[]'::jsonb END`;

// JSON scalar serialization is deliberate. jsonb::text changes key ordering
// and spaces and therefore cannot reproduce JavaScript JSON.stringify hashes.
const imageManifestJSON = `COALESCE((
  SELECT '[' || string_agg('{"index":' || (image.ordinality - 1)::text
    || ',"attachmentId":' || to_json(image.value->>'attachment_id')::text
    || ',"contentHash":' || to_json(image.value->>'content_hash')::text || '}',
    ',' ORDER BY image.ordinality) || ']'
  FROM jsonb_array_elements(expected.images) WITH ORDINALITY image(value, ordinality)
), '[]')`;
const currentTextHash = `CASE WHEN chosen.message IS NULL THEN NULL ELSE
  encode(sha256(convert_to(chosen.message->>'objective', 'UTF8')), 'hex') END`;
const sourceFingerprintJSON = `'{"session":' || to_json(p.session_id::text)::text
  || ',"message":' || COALESCE(to_json(chosen.message->>'id')::text, 'null')
  || ',"messageTextHash":' || COALESCE(to_json(${currentTextHash})::text, 'null')
  || ',"imageManifest":' || ${imageManifestJSON}
  || ',"capture":[null,null,null]}'`;

// Closed owner choice only: no caller-supplied clock/SQL expression. The false
// branch preserves the legacy GET448 predicate's exact resolved bytes.
function sessionSourceMatches(atTick: boolean): string {
  return `EXISTS (
  SELECT 1 FROM agent_sessions s
  LEFT JOIN LATERAL (
    SELECT messages.message FROM (
      SELECT t.value AS message, t.ordinality AS turn_order, 0::bigint AS message_order
      FROM jsonb_array_elements(${safeTurns}) WITH ORDINALITY t(value, ordinality)
      UNION ALL
      SELECT steered.value, t.ordinality, steered.ordinality
      FROM jsonb_array_elements(${safeTurns}) WITH ORDINALITY t(value, ordinality)
      CROSS JOIN LATERAL jsonb_array_elements(${safeSteering})
        WITH ORDINALITY steered(value, ordinality)
    ) messages
    WHERE p.source_message_id IS NULL OR messages.message->>'id' = p.source_message_id::text
    ORDER BY
      CASE WHEN p.source_message_id IS NULL THEN -messages.turn_order ELSE messages.turn_order END,
      CASE WHEN p.source_message_id IS NULL THEN -messages.message_order ELSE messages.message_order END
    LIMIT 1
  ) chosen ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(chosen.message->'images') = 'array'
      THEN chosen.message->'images' ELSE '[]'::jsonb END AS images
  ) expected
  WHERE s.account_id = p.account_id AND s.id = p.session_id
    AND s.created_by_user_id = $2
    AND s.deleted_at IS NULL AND s.expires_at > ${atTick ? "tick.checked_at" : "clock_timestamp()"} AND s.payload IS NOT NULL
    AND jsonb_typeof(s.payload->'turns') = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${safeTurns}) t(value)
      WHERE jsonb_typeof(t.value) <> 'object'
        OR (t.value->'steeredMessages' IS NOT NULL AND t.value->'steeredMessages' <> 'null'::jsonb
          AND jsonb_typeof(t.value->'steeredMessages') <> 'array')
    )
    AND (p.source_message_id IS NULL OR chosen.message IS NOT NULL)
    AND (chosen.message IS NULL OR (
      jsonb_typeof(chosen.message->'id') = 'string'
      AND jsonb_typeof(chosen.message->'objective') = 'string'
      AND (chosen.message->'images' IS NULL OR chosen.message->'images' = 'null'::jsonb
        OR jsonb_typeof(chosen.message->'images') = 'array')
    ))
    AND p.source_message_text_hash IS NOT DISTINCT FROM ${currentTextHash}
    AND (SELECT count(*) FROM conversation_message_images stored
      WHERE stored.account_id = p.account_id AND stored.session_id = p.session_id
        AND stored.message_id::text = chosen.message->>'id' AND stored.expires_at > ${atTick ? "tick.checked_at" : "now()"})
      = jsonb_array_length(expected.images)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(expected.images) WITH ORDINALITY image(value, ordinality)
      WHERE jsonb_typeof(image.value->'attachment_id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(image.value->'content_hash') IS DISTINCT FROM 'string'
        OR NOT EXISTS (
          SELECT 1 FROM conversation_message_images stored
          WHERE stored.account_id = p.account_id AND stored.session_id = p.session_id
            AND stored.message_id::text = chosen.message->>'id'
            AND stored.image_index = image.ordinality - 1 AND stored.expires_at > ${atTick ? "tick.checked_at" : "now()"}
            AND stored.attachment_id::text = image.value->>'attachment_id'
            AND stored.content_hash = image.value->>'content_hash'
        )
    )
    AND (p.source_image_manifest IS NULL OR p.source_image_manifest = 'null'::jsonb
      OR jsonb_typeof(p.source_image_manifest) = 'array')
    AND jsonb_array_length(${safeStoredManifest})
      = jsonb_array_length(expected.images)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${safeStoredManifest})
        WITH ORDINALITY stored(value, ordinality)
      WHERE stored.value->'index' IS DISTINCT FROM to_jsonb(stored.ordinality - 1)
        OR stored.value->'attachmentId' IS DISTINCT FROM expected.images->(stored.ordinality - 1)::int->'attachment_id'
        OR stored.value->'contentHash' IS DISTINCT FROM expected.images->(stored.ordinality - 1)::int->'content_hash'
    )
    AND p.source_revision_hash = encode(sha256(convert_to(${sourceFingerprintJSON}, 'UTF8')), 'hex')
    AND COALESCE(chosen.message->>'id', p.source_message_id::text)
      IS NOT DISTINCT FROM i.source_message_id::text
    AND NOT EXISTS (
      SELECT 1 FROM memory_source_revocations revoked
      WHERE revoked.account_id = p.account_id AND revoked.source_version IS NULL
        AND ((revoked.source_kind = 'session' AND revoked.source_id = p.session_id::text)
          OR (revoked.source_kind = 'artifact' AND (
            revoked.source_id = p.session_id::text || ':message:' || COALESCE(chosen.message->>'id', '')
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(expected.images) WITH ORDINALITY image(value, ordinality)
              WHERE revoked.source_id = 'conversation-image-' || (chosen.message->>'id') || '-'
                || (image.ordinality - 1)::text || '-' || (image.value->>'attachment_id')
            )
          )))
    )
)`;
}

function proposalSourceEligibility(atTick: boolean): string {
  return `(
  CASE WHEN i.capture_id IS NOT NULL THEN EXISTS (
    SELECT 1 FROM captures capture
    JOIN source_retention_receipts receipt
      ON receipt.account_id = capture.account_id AND receipt.capture_id = capture.id
    WHERE capture.account_id = p.account_id AND capture.id = i.capture_id
      AND capture.status = 'active' AND capture.version = i.source_capture_version
      AND capture.subject_id IS NOT DISTINCT FROM i.subject_id
      AND capture.assignment_id IS NOT DISTINCT FROM COALESCE(i.relationship_context_id, capture.assignment_id)
      AND receipt.authorization_state = 'authorized' AND receipt.source_access_state = 'available'
      AND (receipt.authorization_expires_at IS NULL OR receipt.authorization_expires_at > ${atTick ? "tick.checked_at" : "clock_timestamp()"})
      AND (receipt.retention_until IS NULL OR receipt.retention_until > ${atTick ? "tick.checked_at" : "clock_timestamp()"})
      AND (i.source_resource_id IS NULL OR EXISTS (
        SELECT 1 FROM source_resources resource
        WHERE resource.account_id = p.account_id AND resource.id = i.source_resource_id
          AND resource.processing_state <> 'deleted' AND resource.deleted_at IS NULL
      ))
      AND (i.evidence_fragment_id IS NULL OR EXISTS (
        SELECT 1 FROM evidence_fragments fragment
        WHERE fragment.account_id = p.account_id AND fragment.id = i.evidence_fragment_id AND fragment.status = 'active'
      ))
  ) ELSE (
    (i.source_artifact_id ~* '${uuidPattern}' AND EXISTS (
      SELECT 1 FROM chat_media_assets media
      WHERE media.account_id = p.account_id AND media.id::text = i.source_artifact_id
        AND media.status = 'ready' AND media.deleted_at IS NULL
    ) AND (i.source_session_id IS NULL OR EXISTS (
      SELECT 1 FROM agent_sessions live
      WHERE live.account_id = p.account_id AND live.id = i.source_session_id
        AND live.created_by_user_id = $2 AND live.deleted_at IS NULL
        AND live.expires_at > ${atTick ? "tick.checked_at" : "now()"} AND live.payload IS NOT NULL
    )))
    OR (i.source_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chat_media_assets media
        WHERE i.source_artifact_id ~* '${uuidPattern}'
          AND media.account_id = p.account_id AND media.id::text = i.source_artifact_id
          AND media.status = 'ready' AND media.deleted_at IS NULL
      )
      AND ((p.session_id IS NULL AND p.source_message_id IS NOT DISTINCT FROM i.source_message_id)
        OR ${sessionSourceMatches(atTick)}))
  ) END
  AND NOT EXISTS (
    SELECT 1 FROM memory_source_revocations revoked
    WHERE revoked.account_id = p.account_id
      AND (revoked.source_version IS NULL OR revoked.source_version = i.source_capture_version)
      AND ((revoked.source_kind = 'session' AND revoked.source_id = i.source_session_id::text)
        OR (revoked.source_kind = 'capture' AND revoked.source_id = i.capture_id::text)
        OR (revoked.source_kind = 'artifact' AND revoked.source_id = i.source_artifact_id))
  )
)`;
}

export const MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_SQL = proposalSourceEligibility(false);
/** New joint Memory reader only. Its owning statement must materialize one
 * tick with clock_timestamp() AS checked_at; this predicate is not authority. */
export const MEMORY_PROPOSAL_SOURCE_ELIGIBILITY_AT_TICK_SQL = proposalSourceEligibility(true);
