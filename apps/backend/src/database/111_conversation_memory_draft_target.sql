-- An explicit target belongs to one pending message, never to the Session or
-- private recall. Keep the UUID through retry, then scrub it with that source.
ALTER TABLE conversation_queue_entries
  ADD COLUMN memory_draft_target_person_id uuid,
  ADD COLUMN memory_draft_target_claim_revision integer NOT NULL DEFAULT 0
    CHECK (memory_draft_target_claim_revision >= 0),
  ADD CONSTRAINT conversation_memory_draft_target_text CHECK (
    memory_draft_target_person_id IS NULL OR
    (content_state = 'retained' AND objective IS NOT NULL AND length(btrim(objective)) > 0
      AND host_result IS NULL AND images_hash IS NULL AND steer_group_entry_id IS NULL)
  );

-- Older workers select queued rows without knowing this admission. Require a
-- monotonic, host-internal claim revision before granting either a new Run or
-- stale-lease recovery. Returning no row keeps legacy UPDATE ... RETURNING
-- callers before provider execution instead of degrading to ordinary chat.
CREATE FUNCTION conversation_memory_draft_target_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Legacy source erasure must remain possible after rollback, even though
  -- that code does not know the new target column.
  IF NEW.content_state = 'scrubbed' OR NEW.objective IS NULL THEN
    NEW.memory_draft_target_person_id := NULL;
  END IF;
  IF NEW.memory_draft_target_person_id IS DISTINCT FROM OLD.memory_draft_target_person_id
    AND NOT (NEW.memory_draft_target_person_id IS NULL
      AND (NEW.content_state = 'scrubbed' OR NEW.objective IS NULL)) THEN
    RAISE EXCEPTION 'A message Memory draft target cannot be replaced';
  END IF;
  IF OLD.memory_draft_target_person_id IS NOT NULL AND NEW.status = 'running'
    AND (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.run_id IS DISTINCT FROM NEW.run_id
      OR OLD.lease_owner IS DISTINCT FROM NEW.lease_owner
      OR OLD.lease_generation IS DISTINCT FROM NEW.lease_generation)
    AND NEW.memory_draft_target_claim_revision <> OLD.memory_draft_target_claim_revision + 1 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_memory_draft_target_fence
  BEFORE UPDATE ON conversation_queue_entries
  FOR EACH ROW EXECUTE FUNCTION conversation_memory_draft_target_fence();

-- A historical display marker must disappear with the source it described.
-- Preserve the existing proposal/draft retention behavior while extending the
-- canonical redactor, so all existing revocation and expiry callers agree.
CREATE OR REPLACE FUNCTION redact_agent_session_payload(account uuid, body jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=body; turn jsonb; turns jsonb:='[]'::jsonb; proposal_unavailable boolean:=false;
BEGIN
  IF body IS NULL THEN RETURN NULL; END IF;
  FOR turn IN SELECT value FROM jsonb_array_elements(body->'turns') LOOP
    IF NOT agent_session_turn_source_available(account,turn,body) THEN
      turn:=turn-'memoryDraftTarget';
      turn:=jsonb_set(turn,'{response}',(turn->'response')-'savedBlocks'-'unboundConversationBlocks'-'unboundPersonResearchBlocks'-'media');
      IF body->'contactProposal' IS NOT NULL AND
        (body->'contactProposal'->>'sourceMessageID' IS NULL
          OR lower(body->'contactProposal'->>'sourceMessageID')=lower(turn->>'id')) THEN
        proposal_unavailable:=true;
      END IF;
    END IF;
    turns:=turns||jsonb_build_array(turn);
  END LOOP;
  result:=jsonb_set(result,'{turns}',turns);
  IF proposal_unavailable THEN result:=result-'contactProposal'; END IF;
  IF result->'contactProposal' IS NOT NULL AND
    (COALESCE(NULLIF(result->'contactProposal'->>'expiresAt','')::timestamptz,
      (result->'contactProposal'->>'updatedAt')::timestamptz + interval '7 days') <= statement_timestamp()) THEN
    result:=result-'contactProposal';
  END IF;
  IF result->>'composerDraft' IS NOT NULL AND COALESCE(
    NULLIF(result->>'composerDraftUpdatedAt','')::timestamptz,
    (result->>'updatedAt')::timestamptz) + interval '7 days' <= statement_timestamp() THEN
    result:=result-'composerDraft'-'composerDraftUpdatedAt';
  END IF;
  RETURN result;
END;
$$;
