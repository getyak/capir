-- Additive C03 durable retention. Migration identity114 remains immutable.
-- The canonical migration transaction owns COMMIT; no worker/tool is enabled.
SET LOCAL lock_timeout = '100ms';
LOCK TABLE agent_task_memory_lineage IN SHARE ROW EXCLUSIVE MODE NOWAIT;

-- This unreleased115 revision distinguishes new governed completions from old
-- unbound tasks even if a lineage row is missing. A true marker is never an
-- independence grant and cannot be cleared by cleanup or a caller retry.
ALTER TABLE idempotency_records ADD COLUMN saved_memory_lineage_required boolean NOT NULL DEFAULT false;
CREATE FUNCTION guard_saved_memory_canonical_marker_115()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
 IF OLD.saved_memory_lineage_required AND NOT NEW.saved_memory_lineage_required THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='saved_memory_canonical_marker_115',
     MESSAGE='SAVED_MEMORY_CANONICAL_MARKER_IMMUTABLE';
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER saved_memory_canonical_marker_115
 BEFORE UPDATE OF saved_memory_lineage_required ON idempotency_records
 FOR EACH ROW EXECUTE FUNCTION guard_saved_memory_canonical_marker_115();

-- Match only the two known114 constraints by their complete normalized
-- definitions. Unknown schema drift aborts rather than dropping another guard.
DO $migration$
DECLARE names text[];
BEGIN
 SELECT array_agg(conname ORDER BY conname) INTO names FROM pg_constraint
 WHERE conrelid='agent_task_memory_lineage'::regclass AND contype='c'
   AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()"]','','g') IN (
     'CHECKformat_version=1',
     'CHECKisfiniteexpires_atANDisfiniterecorded_atANDexpires_at>recorded_at');
 IF cardinality(names) IS DISTINCT FROM 2 THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SAVED_MEMORY_115_V1_CONSTRAINT_MISMATCH';
 END IF;
 EXECUTE format('ALTER TABLE agent_task_memory_lineage DROP CONSTRAINT %I',names[1]);
 EXECUTE format('ALTER TABLE agent_task_memory_lineage DROP CONSTRAINT %I',names[2]);
END;
$migration$;
ALTER TABLE agent_task_memory_lineage ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE agent_task_memory_lineage
 ADD COLUMN retention_kind text NOT NULL DEFAULT 'legacy_finite',
 ADD COLUMN completion_idempotency_id uuid,
 ADD COLUMN source_origin_session_id uuid,
 ADD CONSTRAINT saved_memory_typed_retention_115 CHECK (
   isfinite(recorded_at) AND (
     (format_version=1 AND retention_kind='legacy_finite'
       AND completion_idempotency_id IS NULL AND source_origin_session_id IS NULL
       AND expires_at IS NOT NULL AND isfinite(expires_at) AND expires_at>recorded_at)
     OR (format_version=2 AND completion_idempotency_id IS NOT NULL AND (
       (retention_kind='session_bound' AND source_origin_session_id IS NOT NULL
         AND expires_at IS NOT NULL AND isfinite(expires_at) AND expires_at>recorded_at)
       OR (retention_kind='canonical_no_session' AND source_origin_session_id IS NULL AND expires_at IS NULL)
     ))
   )
 );
-- No completion/source FK: canonical cleanup may remove/retract a result.
-- A missing completion then denies delivery; it never means an empty read-set.

CREATE OR REPLACE FUNCTION saved_memory_item_readable(a uuid,u uuid,item uuid,owned boolean)
RETURNS boolean LANGUAGE sql STABLE AS $function$
 SELECT EXISTS (
  SELECT 1 FROM memory_items m JOIN accounts account ON account.id=m.account_id
  JOIN users reader ON reader.account_id=account.id AND reader.id=u
  WHERE m.account_id=a AND m.id=item AND account.retired_at IS NULL AND reader.status='active'
    AND m.status='active' AND (NOT owned OR m.owner_user_id=u)
    AND (m.content_protocol='legacy-v1' OR (m.content_protocol='literal-v2'
      AND memory_literal_accepted_113(m.content_manifest,m.content_manifest_digest,m.display_text,m.original_display_text)
      AND m.content_manifest->'reviewed_evidence'=(SELECT jsonb_agg(jsonb_build_object(
        'evidence_id',e.id::text,'content_protocol',e.content_protocol,'content_version',e.content_version,
        'content_manifest_digest',e.content_manifest_digest) ORDER BY e.id)
        FROM memory_item_evidence e WHERE e.account_id=a AND e.memory_item_id=m.id AND e.status='active')))
    AND ((m.scope='self' AND m.owner_user_id=u AND m.relationship_context_id IS NULL
      AND (m.subject_id IS NULL OR EXISTS (SELECT 1 FROM subjects owner_subject
        WHERE owner_subject.account_id=a AND owner_subject.id=m.subject_id AND owner_subject.status='active'
          AND owner_subject.external_ref='workspace-owner:'||m.owner_user_id::text)))
      OR (m.scope='person' AND m.subject_id IS NOT NULL AND m.relationship_context_id IS NULL)
      OR (m.scope='relationship' AND m.owner_user_id=u AND m.subject_id IS NOT NULL AND m.relationship_context_id IS NOT NULL))
    AND (m.subject_id IS NULL OR EXISTS (SELECT 1 FROM subjects s
      WHERE s.account_id=a AND s.id=m.subject_id AND s.status='active'))
    AND (m.relationship_context_id IS NULL OR EXISTS (SELECT 1 FROM assignments c
      WHERE c.account_id=a AND c.id=m.relationship_context_id AND c.subject_id=m.subject_id AND c.status='active'))
    AND EXISTS (SELECT 1 FROM memory_item_evidence active WHERE active.account_id=a AND active.memory_item_id=m.id AND active.status='active')
    AND NOT EXISTS (SELECT 1 FROM memory_item_evidence e WHERE e.account_id=a AND e.memory_item_id=m.id AND NOT (
      e.status='active'
      AND (e.content_protocol='legacy-v1' OR (e.content_protocol='literal-v2'
        AND memory_literal_evidence_113(e.content_manifest,e.content_manifest_digest,e.excerpt,e.content_hash,
          e.locator,e.source_session_id,e.source_message_id)))
      AND (e.capture_id IS NULL OR EXISTS (SELECT 1 FROM captures c WHERE c.account_id=e.account_id AND c.id=e.capture_id AND c.status='active' AND c.deleted_at IS NULL))
      AND (e.source_resource_id IS NULL OR EXISTS (SELECT 1 FROM source_resources r WHERE r.account_id=e.account_id AND r.id=e.source_resource_id AND r.processing_state<>'deleted' AND r.deleted_at IS NULL))
      AND (e.capture_id IS NULL OR NOT EXISTS (SELECT 1 FROM source_retention_receipts rr WHERE rr.account_id=e.account_id AND rr.capture_id=e.capture_id AND (rr.authorization_state='revoked' OR rr.source_access_state='deleted')))
      AND NOT EXISTS (SELECT 1 FROM memory_source_revocations r WHERE r.account_id=e.account_id
        AND (r.source_version IS NULL OR r.source_version=e.source_capture_version)
        AND ((r.source_kind='session' AND e.source_session_id IS NOT NULL AND e.source_session_id::text=r.source_id)
          OR (r.source_kind='capture' AND e.capture_id IS NOT NULL AND e.capture_id::text=r.source_id)
          OR (r.source_kind='artifact' AND e.source_artifact_id IS NOT NULL AND e.source_artifact_id=r.source_id)))
    ))
 )
$function$;

-- Semantic self stamps carry null subject; accepted rows can carry the actual
-- active account owner's stable subject. Person/relationship targets keep exact
-- subject/context/owner ACL checks. This helper has no exposure deadline.
CREATE FUNCTION saved_memory_stamps_current(a uuid,u uuid,stamps jsonb,checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $function$
DECLARE stamp jsonb; previous uuid; item uuid;
BEGIN
 IF checked_at IS NULL OR NOT isfinite(checked_at) OR jsonb_typeof(stamps) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(stamps)>256 OR NOT EXISTS (SELECT 1 FROM users reader JOIN accounts account ON account.id=reader.account_id
   WHERE reader.account_id=a AND reader.id=u AND reader.status='active' AND account.retired_at IS NULL) THEN RETURN false; END IF;
 FOR stamp IN SELECT value FROM jsonb_array_elements(stamps) LOOP
   IF saved_memory_stamp_shape(stamp) IS NOT TRUE THEN RETURN false; END IF;
   item:=(stamp->>'item_id')::uuid;
   IF previous IS NOT NULL AND previous>=item THEN RETURN false; END IF;
   previous:=item;
   IF NOT EXISTS (SELECT 1 FROM memory_items m JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
     WHERE m.account_id=a AND m.id=item AND m.version=(stamp->>'item_version')::int
       AND l.epoch=(stamp->>'lineage_epoch')::bigint AND m.owner_user_id=(stamp->>'memory_owner_id')::uuid
       AND m.scope=stamp->>'scope'
       AND ((m.scope='self' AND stamp->'subject_id'='null'::jsonb AND m.relationship_context_id IS NULL
         AND (m.subject_id IS NULL OR EXISTS (SELECT 1 FROM subjects owner_subject
           WHERE owner_subject.account_id=a AND owner_subject.id=m.subject_id AND owner_subject.status='active'
             AND owner_subject.external_ref='workspace-owner:'||m.owner_user_id::text)))
         OR (m.scope IN ('person','relationship') AND m.subject_id IS NOT DISTINCT FROM (stamp->>'subject_id')::uuid))
       AND m.relationship_context_id IS NOT DISTINCT FROM (stamp->>'relationship_context_id')::uuid
       AND saved_memory_item_readable(a,u,m.id,false)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END;
$function$;
CREATE OR REPLACE FUNCTION saved_memory_read_set_current(a uuid,u uuid,stamps jsonb,deadline timestamptz,checked_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $function$
 SELECT checked_at IS NOT NULL AND isfinite(checked_at) AND deadline IS NOT NULL AND isfinite(deadline)
   AND deadline>checked_at AND saved_memory_stamps_current(a,u,stamps,checked_at)
$function$;

-- Real canonical completion, never a queue/provider assertion. Current-reader
-- source/credential/Lab policy still belongs to the final joined owner query.
CREATE FUNCTION saved_memory_completion_current(a uuid,u uuid,task uuid,completion uuid,checked_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $function$
 SELECT checked_at IS NOT NULL AND isfinite(checked_at) AND EXISTS (
   SELECT 1 FROM idempotency_records i WHERE i.id=completion AND i.account_id=a AND i.actor_user_id=u
     AND i.operation_scope IN ('create_chat_task','create_unscoped_chat_task') AND i.status='completed'
     AND i.response_status=201 AND i.completed_at IS NOT NULL AND isfinite(i.completed_at) AND i.completed_at<=checked_at
     AND jsonb_typeof(i.response_body)='object' AND i.response_body->>'task_id'=task::text
     AND (NOT (i.response_body ? 'memory_context_unavailable') OR i.response_body->'memory_context_unavailable'='false'::jsonb)
     AND (NOT (i.response_body ? 'session_context_unavailable') OR i.response_body->'session_context_unavailable'='false'::jsonb)
 )
$function$;

-- Closed ASCII metadata tuple shared with the host codec. Every admitted field
-- is a UUID/enum/integer/decimal epoch/UTC timestamp/null; none can contain a
-- space. Compacting PostgreSQL's JSON separators therefore preserves values.
CREATE FUNCTION saved_memory_durable_digest_115(a uuid,u uuid,task uuid,completion uuid,kind text,origin uuid,deadline_text text,stamps jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
 SELECT encode(sha256(convert_to(replace(jsonb_build_array('saved-memory-durable.v2',a::text,u::text,task::text,completion::text,
   kind,origin::text,deadline_text,COALESCE((SELECT jsonb_agg(jsonb_build_array(
     stamp->>'item_id',(stamp->>'item_version')::int,stamp->>'lineage_epoch',stamp->>'memory_owner_id',
     stamp->>'scope',stamp->>'subject_id',stamp->>'relationship_context_id') ORDER BY ordinal)
     FROM jsonb_array_elements(stamps) WITH ORDINALITY AS entries(stamp,ordinal)),'[]'::jsonb))::text,' ',''),'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION saved_memory_task_current(a uuid,task uuid,reader uuid,checked_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $function$
 SELECT checked_at IS NOT NULL AND isfinite(checked_at) AND COALESCE((SELECT t.withdrawn_at IS NULL
   AND t.reader_actor_id=reader AND t.dependency_count=(SELECT count(*) FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task)
   AND ((t.format_version=1 AND t.retention_kind='legacy_finite' AND t.completion_idempotency_id IS NULL
       AND t.source_origin_session_id IS NULL AND t.expires_at IS NOT NULL AND t.expires_at>checked_at)
     OR (t.format_version=2 AND saved_memory_completion_current(a,reader,task,t.completion_idempotency_id,checked_at)
       AND ((t.retention_kind='session_bound' AND t.source_origin_session_id IS NOT NULL AND t.expires_at IS NOT NULL AND t.expires_at>checked_at)
         OR (t.retention_kind='canonical_no_session' AND t.source_origin_session_id IS NULL AND t.expires_at IS NULL))))
   AND saved_memory_stamps_current(a,reader,COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'item_id',d.memory_item_id::text,'item_version',d.item_version,'lineage_epoch',d.lineage_epoch::text,
     'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,'subject_id',d.subject_id::text,
     'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id)
     FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task),'[]'::jsonb),checked_at)
   FROM agent_task_memory_lineage t WHERE t.account_id=a AND t.task_id=task),false)
$function$;
-- Origin is an immutable registration/provenance binding only. No new live-
-- origin join is added here; existing056 any-live-Session-copy policy is intact.

CREATE OR REPLACE FUNCTION register_saved_memory_lineage(a uuid,u uuid,task uuid,deadline timestamptz,stamps jsonb,digest text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $function$
DECLARE stored agent_task_memory_lineage%ROWTYPE; stamp jsonb;
BEGIN
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' OR saved_memory_read_set_current(a,u,stamps,deadline,clock_timestamp()) IS NOT TRUE THEN RETURN false; END IF;
 INSERT INTO agent_task_memory_lineage(account_id,task_id,reader_actor_id,format_version,dependency_count,proof_digest,expires_at)
   VALUES(a,task,u,1,jsonb_array_length(stamps),digest,deadline) ON CONFLICT DO NOTHING;
 SELECT * INTO stored FROM agent_task_memory_lineage WHERE account_id=a AND task_id=task FOR UPDATE NOWAIT;
 IF stored.format_version IS DISTINCT FROM 1 OR stored.retention_kind IS DISTINCT FROM 'legacy_finite'
   OR stored.completion_idempotency_id IS NOT NULL OR stored.source_origin_session_id IS NOT NULL
   OR stored.reader_actor_id<>u OR stored.expires_at<>deadline OR stored.proof_digest<>digest OR stored.withdrawn_at IS NOT NULL
   OR stored.dependency_count<>jsonb_array_length(stamps) THEN RETURN false; END IF;
 FOR stamp IN SELECT value FROM jsonb_array_elements(stamps) LOOP
   INSERT INTO agent_task_saved_memory_dependencies(account_id,task_id,memory_item_id,item_version,lineage_epoch,memory_owner_id,scope,subject_id,relationship_context_id)
   VALUES(a,task,(stamp->>'item_id')::uuid,(stamp->>'item_version')::int,(stamp->>'lineage_epoch')::bigint,
     (stamp->>'memory_owner_id')::uuid,stamp->>'scope',(stamp->>'subject_id')::uuid,(stamp->>'relationship_context_id')::uuid)
   ON CONFLICT DO NOTHING;
   IF NOT EXISTS (SELECT 1 FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task
     AND d.memory_item_id=(stamp->>'item_id')::uuid AND d.item_version=(stamp->>'item_version')::int
     AND d.lineage_epoch=(stamp->>'lineage_epoch')::bigint AND d.memory_owner_id=(stamp->>'memory_owner_id')::uuid
     AND d.scope=stamp->>'scope' AND d.subject_id IS NOT DISTINCT FROM (stamp->>'subject_id')::uuid
     AND d.relationship_context_id IS NOT DISTINCT FROM (stamp->>'relationship_context_id')::uuid) THEN RETURN false; END IF;
 END LOOP;
 RETURN saved_memory_task_current(a,task,u,clock_timestamp());
END;
$function$;

-- Expected xid8 is observed, never assigned, by the host AFTER the real outer-
-- transaction completion/source writes. xmin is32bit: compare its low32bits,
-- while requiring the full xid8 to remain exactly the current transaction.
-- Completion/source writes inside a subtransaction deliberately refuse. Retry
-- after unknown ACK uses canonical readback, never a new registration attempt.
CREATE FUNCTION register_saved_memory_durable_lineage(a uuid,u uuid,task uuid,completion uuid,
 kind text,origin uuid,deadline_text text,stamps jsonb,digest text,exposure_deadline timestamptz,expected_xid xid8)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $function$
DECLARE stored agent_task_memory_lineage%ROWTYPE; stamp jsonb; checked timestamptz; deadline timestamptz; refusal text; violated_constraint text;
BEGIN
 IF expected_xid IS NULL OR pg_current_xact_id_if_assigned() IS DISTINCT FROM expected_xid
   OR a IS NULL OR u IS NULL OR task IS NULL OR completion IS NULL OR digest IS NULL OR digest !~ '^[a-f0-9]{64}$'
   OR kind IS NULL OR kind NOT IN ('session_bound','canonical_no_session') THEN RETURN false; END IF;
 checked:=clock_timestamp();
 IF saved_memory_read_set_current(a,u,stamps,exposure_deadline,checked) IS NOT TRUE
   OR saved_memory_completion_current(a,u,task,completion,checked) IS NOT TRUE THEN RETURN false; END IF;
 PERFORM id FROM idempotency_records WHERE id=completion AND account_id=a AND actor_user_id=u
   AND xmin::text::numeric=mod(expected_xid::text::numeric,4294967296::numeric) FOR SHARE NOWAIT;
 IF NOT FOUND THEN RETURN false; END IF;
 IF kind='session_bound' THEN
   IF origin IS NULL OR deadline_text IS NULL OR deadline_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false; END IF;
   deadline:=deadline_text::timestamptz;
   IF NOT isfinite(deadline) OR deadline<=checked THEN RETURN false; END IF;
   PERFORM task_id FROM agent_session_chat_tasks WHERE account_id=a AND actor_user_id=u AND task_id=task::text
     AND origin_session_id=origin AND expires_at=deadline
     AND to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=deadline_text
     AND xmin::text::numeric=mod(expected_xid::text::numeric,4294967296::numeric) FOR SHARE NOWAIT;
   IF NOT FOUND THEN RETURN false; END IF;
 ELSE
   IF origin IS NOT NULL OR deadline_text IS NOT NULL OR EXISTS (SELECT 1 FROM agent_session_chat_tasks WHERE account_id=a AND task_id=task::text) THEN RETURN false; END IF;
   deadline:=NULL;
 END IF;
 IF digest IS DISTINCT FROM saved_memory_durable_digest_115(a,u,task,completion,kind,origin,deadline_text,stamps) THEN RETURN false; END IF;
 -- This inner exception block rolls back this function's lineage writes on an
 -- honest late refusal. It does not undo any prior canonical completion, own
 -- COMMIT, classify an unknown ACK or replace the caller's outer transaction.
 BEGIN
   UPDATE idempotency_records SET saved_memory_lineage_required=true
     WHERE id=completion AND account_id=a AND actor_user_id=u;
   IF NOT FOUND THEN
     RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SAVED_MEMORY_DURABLE_REGISTER_REFUSED';
   END IF;
   INSERT INTO agent_task_memory_lineage(account_id,task_id,reader_actor_id,format_version,dependency_count,proof_digest,expires_at,
     retention_kind,completion_idempotency_id,source_origin_session_id)
     VALUES(a,task,u,2,jsonb_array_length(stamps),digest,deadline,kind,completion,origin) ON CONFLICT DO NOTHING;
   SELECT * INTO stored FROM agent_task_memory_lineage WHERE account_id=a AND task_id=task FOR UPDATE NOWAIT;
   IF stored.format_version IS DISTINCT FROM 2 OR stored.retention_kind IS DISTINCT FROM kind
     OR stored.completion_idempotency_id IS DISTINCT FROM completion OR stored.source_origin_session_id IS DISTINCT FROM origin
     OR stored.reader_actor_id IS DISTINCT FROM u OR stored.expires_at IS DISTINCT FROM deadline OR stored.proof_digest IS DISTINCT FROM digest
     OR stored.withdrawn_at IS NOT NULL OR stored.dependency_count IS DISTINCT FROM jsonb_array_length(stamps) THEN
     RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SAVED_MEMORY_DURABLE_REGISTER_REFUSED';
   END IF;
   FOR stamp IN SELECT value FROM jsonb_array_elements(stamps) LOOP
     INSERT INTO agent_task_saved_memory_dependencies(account_id,task_id,memory_item_id,item_version,lineage_epoch,memory_owner_id,scope,subject_id,relationship_context_id)
     VALUES(a,task,(stamp->>'item_id')::uuid,(stamp->>'item_version')::int,(stamp->>'lineage_epoch')::bigint,
       (stamp->>'memory_owner_id')::uuid,stamp->>'scope',(stamp->>'subject_id')::uuid,(stamp->>'relationship_context_id')::uuid)
     ON CONFLICT DO NOTHING;
     IF NOT EXISTS (SELECT 1 FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task
       AND d.memory_item_id=(stamp->>'item_id')::uuid AND d.item_version=(stamp->>'item_version')::int
       AND d.lineage_epoch=(stamp->>'lineage_epoch')::bigint AND d.memory_owner_id=(stamp->>'memory_owner_id')::uuid
       AND d.scope=stamp->>'scope' AND d.subject_id IS NOT DISTINCT FROM (stamp->>'subject_id')::uuid
       AND d.relationship_context_id IS NOT DISTINCT FROM (stamp->>'relationship_context_id')::uuid) THEN
       RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SAVED_MEMORY_DURABLE_REGISTER_REFUSED';
     END IF;
   END LOOP;
   checked:=clock_timestamp();
   IF pg_current_xact_id_if_assigned() IS DISTINCT FROM expected_xid
     OR saved_memory_read_set_current(a,u,stamps,exposure_deadline,checked) IS NOT TRUE
     OR saved_memory_task_current(a,task,u,checked) IS NOT TRUE THEN
     RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SAVED_MEMORY_DURABLE_REGISTER_REFUSED';
   END IF;
   RETURN true;
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
   IF violated_constraint='saved_memory_typed_retention_115' AND kind='session_bound' AND deadline<=clock_timestamp() THEN RETURN false; END IF;
   RAISE;
 WHEN SQLSTATE 'P0001' THEN
   GET STACKED DIAGNOSTICS refusal=MESSAGE_TEXT;
   IF refusal<>'SAVED_MEMORY_DURABLE_REGISTER_REFUSED' THEN RAISE; END IF;
   RETURN false;
 END;
END;
$function$;
