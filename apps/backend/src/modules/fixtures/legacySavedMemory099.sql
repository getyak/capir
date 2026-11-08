-- Durable source/version lineage for accepted Saved Memory used by the Agent.
--
-- A workspace Agent answer that was derived from `search_saved_memory` keeps a
-- host-owned dependency record (identity + version only, never raw source
-- content) for every accepted statement it read. Withdrawing, deleting or
-- revising a statement or its source then retracts the completed derived
-- Session answers and queued replay bodies through the existing
-- agent_session retraction/redaction machinery, and every later read or replay
-- revalidates the recorded versions before content can escape again.
--
-- Natural raw-source TTL is deliberately absent from this fence, exactly like
-- the Memory discovery fence: explicit deletion, revocation, revision or
-- identity/context loss withdraws derived text; ordinary retention expiry does
-- not.

CREATE TABLE agent_task_memory_dependencies (
  account_id uuid NOT NULL REFERENCES accounts(id),
  task_id text NOT NULL,
  memory_item_id uuid NOT NULL,
  memory_item_version integer NOT NULL CHECK (memory_item_version > 0),
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, task_id, memory_item_id)
);
CREATE INDEX agent_task_memory_dependency_item_idx
  ON agent_task_memory_dependencies(account_id, memory_item_id);
CREATE INDEX agent_task_memory_dependency_owner_idx
  ON agent_task_memory_dependencies(account_id, owner_user_id);

-- One home for "this exact accepted statement is still readable at this exact
-- version". Mirrors the Saved Memory discovery fence (076/078/079 semantics):
-- active item, active person/context, at least one retained evidence row, and
-- every evidence row still available under explicit deletion/revocation rules.
CREATE FUNCTION saved_memory_item_current(
  account uuid, owner uuid, item uuid, expected_version integer
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM memory_items m
    WHERE m.account_id = account AND m.id = item AND m.owner_user_id = owner
      AND m.version = expected_version AND m.status = 'active'
      AND (m.subject_id IS NULL OR EXISTS (SELECT 1 FROM subjects s
        WHERE s.account_id = m.account_id AND s.id = m.subject_id AND s.status = 'active'))
      AND (m.relationship_context_id IS NULL OR EXISTS (SELECT 1 FROM assignments a
        WHERE a.account_id = m.account_id AND a.id = m.relationship_context_id AND a.status = 'active'))
      AND EXISTS (SELECT 1 FROM memory_item_evidence active_evidence
        WHERE active_evidence.account_id = m.account_id
          AND active_evidence.memory_item_id = m.id AND active_evidence.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM memory_item_evidence e
        WHERE e.account_id = m.account_id AND e.memory_item_id = m.id AND NOT (
          e.status = 'active'
          AND (e.capture_id IS NULL OR EXISTS (SELECT 1 FROM captures c
            WHERE c.account_id = e.account_id AND c.id = e.capture_id
              AND c.status = 'active' AND c.deleted_at IS NULL))
          AND (e.source_resource_id IS NULL OR EXISTS (SELECT 1 FROM source_resources r
            WHERE r.account_id = e.account_id AND r.id = e.source_resource_id
              AND r.processing_state <> 'deleted' AND r.deleted_at IS NULL))
          AND (e.capture_id IS NULL OR NOT EXISTS (SELECT 1 FROM source_retention_receipts rr
            WHERE rr.account_id = e.account_id AND rr.capture_id = e.capture_id
              AND (rr.authorization_state = 'revoked' OR rr.source_access_state = 'deleted')))
          AND NOT EXISTS (SELECT 1 FROM memory_source_revocations revoked
            WHERE revoked.account_id = e.account_id
              AND (revoked.source_version IS NULL OR revoked.source_version = e.source_capture_version)
              AND ((revoked.source_kind = 'session' AND e.source_session_id IS NOT NULL
                AND e.source_session_id::text = revoked.source_id)
                OR (revoked.source_kind = 'capture' AND e.capture_id IS NOT NULL
                  AND e.capture_id::text = revoked.source_id)
                OR (revoked.source_kind = 'artifact' AND e.source_artifact_id IS NOT NULL
                  AND e.source_artifact_id = revoked.source_id)))
        ))
  )
$$;

-- A task with no recorded dependency (legacy answer or a run that never read
-- saved Memory) stays available; a recorded dependency must still be current.
CREATE FUNCTION agent_task_memory_dependencies_available(account uuid, task text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM agent_task_memory_dependencies d
    WHERE d.account_id = account AND d.task_id = canonical_agent_session_id(task)
      AND NOT saved_memory_item_current(d.account_id, d.owner_user_id, d.memory_item_id, d.memory_item_version)
  )
$$;

-- Reuse the existing source-availability gate: every final canonical write,
-- queue replay, follow-up history read and payload redaction now also fails
-- closed on a withdrawn or revised saved Memory dependency.
CREATE OR REPLACE FUNCTION agent_session_chat_sources_available(account uuid, task text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT agent_session_chat_task_available(account,task)
    AND agent_task_memory_dependencies_available(account,task)
    AND NOT EXISTS (SELECT 1 FROM agent_session_retracted_tasks r WHERE r.account_id=account AND r.task_id=canonical_agent_session_id(task))
    AND NOT EXISTS (SELECT 1 FROM agent_session_chat_sources d
      LEFT JOIN screenshot_contact_tasks t ON t.account_id=d.account_id AND t.id=d.screenshot_task_id
      WHERE d.account_id=account AND d.task_id=canonical_agent_session_id(task)
      AND (t.id IS NULL OR t.created_by_user_id<>d.actor_user_id
        OR NOT agent_session_screenshot_context_available(account,t.id)
        OR agent_session_screenshot_fingerprint(t)<>d.source_fingerprint))
$$;

-- One account-scoped transaction fence shared by dependency registration,
-- every final queue/Session/idempotency write, and every source invalidation
-- transaction. Writers that admit derived text acquire it before their queue
-- or Session locks and hold it through commit; a source transition acquires it
-- inside its retraction, so a concurrent source writer either invalidates
-- before final admission or retracts the committed result afterward. It is
-- never held across a model call: mid-run registration inside a caller-owned
-- long transaction relies on the fenced completion boundary instead.
CREATE FUNCTION lock_saved_memory_lineage(account uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('talent_signal.saved_memory_lineage:' || account::text, 0))
$$;

-- Retraction of completed derived answers and stored replay bodies. The scrub
-- markers match the existing source-withdrawal shape so a replayed request can
-- never resurrect derived text from an idempotent response or a queue result.
CREATE FUNCTION retract_agent_session_saved_memory(account uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_saved_memory_lineage(account);
  IF NOT EXISTS (SELECT 1 FROM agent_task_memory_dependencies d WHERE d.account_id=account) THEN
    RETURN;
  END IF;
  INSERT INTO agent_session_retracted_tasks(account_id,task_id)
    SELECT DISTINCT d.account_id,d.task_id FROM agent_task_memory_dependencies d
    WHERE d.account_id=account AND NOT agent_task_memory_dependencies_available(account,d.task_id)
    ON CONFLICT DO NOTHING;
  UPDATE idempotency_records i SET response_body=jsonb_build_object('task_id',i.response_body->>'task_id','source_context_unavailable',true)
    WHERE i.account_id=account AND i.operation_scope IN ('create_chat_task','create_unscoped_chat_task')
      AND i.response_body IS NOT NULL AND NOT COALESCE((i.response_body->>'source_context_unavailable')::boolean,false)
      AND EXISTS (SELECT 1 FROM agent_task_memory_dependencies d WHERE d.account_id=account
        AND d.task_id=canonical_agent_session_id(i.response_body->>'task_id'))
      AND NOT agent_task_memory_dependencies_available(account,i.response_body->>'task_id');
  UPDATE conversation_queue_entries q
    SET result=jsonb_build_object('task_id',q.result#>>'{body,task_id}','source_context_unavailable',true),
        revision=q.revision+1, updated_at=now()
    WHERE q.account_id=account AND q.result IS NOT NULL
      AND q.result ? 'body'
      AND NOT COALESCE((q.result->>'source_context_unavailable')::boolean,false)
      AND EXISTS (SELECT 1 FROM agent_task_memory_dependencies d WHERE d.account_id=account
        AND d.task_id=canonical_agent_session_id(q.result#>>'{body,task_id}'))
      AND NOT agent_task_memory_dependencies_available(account,q.result#>>'{body,task_id}');
  UPDATE agent_sessions SET payload=redact_agent_session_payload(account,payload),revision=revision+1,updated_at=now()
    WHERE account_id=account AND deleted_at IS NULL AND payload IS DISTINCT FROM redact_agent_session_payload(account,payload);
END;
$$;

CREATE FUNCTION invalidate_agent_session_saved_memory() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account uuid;
BEGIN
  account := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  PERFORM retract_agent_session_saved_memory(account);
  RETURN NULL;
END;
$$;

-- Explicit withdrawal, deletion, revision, source loss, or person/context loss.
-- Natural TTL columns are deliberately not watched.
CREATE TRIGGER retract_saved_memory_lineage_items
  AFTER UPDATE OF version,status,owner_user_id,subject_id,relationship_context_id,deleted_at OR DELETE ON memory_items
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_evidence
  AFTER UPDATE OF status OR DELETE ON memory_item_evidence
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_revocations
  AFTER INSERT ON memory_source_revocations
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_capture
  AFTER UPDATE OF status,deleted_at,subject_id,assignment_id OR DELETE ON captures
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_resource
  AFTER UPDATE OF processing_state,deleted_at OR DELETE ON source_resources
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_authorization
  AFTER UPDATE OF authorization_state,source_access_state ON source_retention_receipts
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_person
  AFTER UPDATE OF status OR DELETE ON subjects
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();
CREATE TRIGGER retract_saved_memory_lineage_context
  AFTER UPDATE OF status OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_session_saved_memory();

-- Lab test workspaces must classify new account-scoped tables explicitly.
INSERT INTO lab_test_workspace_table_manifest(table_name, scope) VALUES
  ('agent_task_memory_dependencies', 'account');

CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON agent_task_memory_dependencies
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
