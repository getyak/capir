-- Canonical migration owner already holds BEGIN. This local bound also covers
-- earlier implicit FK-DDL relation waits; it is not a global NOWAIT guarantee
-- or a session default, and is restored when this transaction ends.
SET LOCAL lock_timeout = '100ms';
-- Keep deterministic write barriers until the same COMMIT that installs both
-- transition triggers. Old API/import writers may still be running at upgrade.
LOCK TABLE memory_items IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE memory_item_evidence IN SHARE ROW EXCLUSIVE MODE NOWAIT;
-- The seed's FK checks need these ALL historical keys, including closed/retired
-- owners. Do not replace the stronger active cutover SHARE fence below.
SELECT id FROM accounts
 WHERE id IN (SELECT DISTINCT account_id FROM memory_items)
 ORDER BY id FOR KEY SHARE NOWAIT;

-- C03 host-only metadata. No query terms, Memory prose, provider arguments or
-- bearer credentials. Identity/order registration remains the manifest owner's
-- responsibility. The capability stays disabled until every writer/reader is
-- wired and current final publication/authority evidence passes.
CREATE TABLE memory_item_lineage (
  account_id uuid NOT NULL REFERENCES accounts(id),
  memory_item_id uuid NOT NULL,
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  cleanup_epoch bigint NOT NULL DEFAULT 1 CHECK (cleanup_epoch > 0 AND cleanup_epoch <= epoch),
  cleanup_after_task uuid,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,memory_item_id)
  -- Deliberately no item FK/cascade: deletion/restoration must not reset epoch.
);
CREATE INDEX memory_item_lineage_dirty ON memory_item_lineage(changed_at,account_id,memory_item_id)
  WHERE cleanup_epoch < epoch;

CREATE FUNCTION saved_memory_verified_lab_cleanup(a uuid) RETURNS boolean LANGUAGE sql STABLE AS $function$
 SELECT COALESCE(current_setting('talent_signal.lab_cleanup_account',true)=a::text AND EXISTS (
   SELECT 1 FROM lab_test_workspaces w JOIN users u ON u.account_id=w.target_account_id AND u.id=w.target_user_id
   WHERE w.target_account_id=a AND w.state='deleting' AND u.kind='lab_human' AND u.status='revoked'),false)
$function$;

CREATE TABLE memory_discovery_queries (
  account_id uuid NOT NULL REFERENCES accounts(id),
  reader_actor_id uuid NOT NULL,
  id uuid NOT NULL,
  query_digest text NOT NULL CHECK (query_digest ~ '^[a-f0-9]{64}$'),
  projection_version integer NOT NULL CHECK (projection_version=1),
  cursor_key bytea NOT NULL CHECK (octet_length(cursor_key)=32),
  created_at timestamptz NOT NULL,
  cutoff timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(account_id,id),
  FOREIGN KEY(account_id,reader_actor_id) REFERENCES users(account_id,id),
  CHECK (isfinite(created_at) AND isfinite(cutoff) AND isfinite(expires_at)
    AND cutoff=created_at AND expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE INDEX memory_discovery_query_actor ON memory_discovery_queries(account_id,reader_actor_id,expires_at);
CREATE INDEX memory_discovery_query_expiry ON memory_discovery_queries(expires_at,account_id,id);

CREATE TABLE agent_task_memory_lineage (
  account_id uuid NOT NULL REFERENCES accounts(id),
  task_id uuid NOT NULL,
  reader_actor_id uuid NOT NULL,
  format_version integer NOT NULL CHECK (format_version=1),
  dependency_count integer NOT NULL CHECK (dependency_count BETWEEN 0 AND 256),
  proof_digest text NOT NULL CHECK (proof_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  cleanup_after_session uuid,
  cleanup_complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY(account_id,task_id),
  FOREIGN KEY(account_id,reader_actor_id) REFERENCES users(account_id,id),
  CHECK (isfinite(expires_at) AND isfinite(recorded_at) AND expires_at>recorded_at)
);
CREATE INDEX agent_task_memory_cleanup ON agent_task_memory_lineage(withdrawn_at,account_id,task_id)
  WHERE withdrawn_at IS NOT NULL AND NOT cleanup_complete;
CREATE TABLE agent_task_saved_memory_dependencies (
  account_id uuid NOT NULL,
  task_id uuid NOT NULL,
  memory_item_id uuid NOT NULL,
  item_version integer NOT NULL CHECK (item_version>0),
  lineage_epoch bigint NOT NULL CHECK (lineage_epoch>0),
  memory_owner_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('self','person','relationship')),
  subject_id uuid,
  relationship_context_id uuid,
  PRIMARY KEY(account_id,task_id,memory_item_id),
  FOREIGN KEY(account_id,task_id) REFERENCES agent_task_memory_lineage(account_id,task_id),
  CHECK ((scope='self' AND subject_id IS NULL AND relationship_context_id IS NULL)
    OR (scope='person' AND subject_id IS NOT NULL AND relationship_context_id IS NULL)
    OR (scope='relationship' AND subject_id IS NOT NULL AND relationship_context_id IS NOT NULL))
  -- No FK to the original item/epoch: dropping proof cannot mean independence.
);
CREATE INDEX agent_task_memory_by_item ON agent_task_saved_memory_dependencies(account_id,memory_item_id,lineage_epoch,task_id);
CREATE INDEX saved_memory_idempotency_task ON idempotency_records(account_id,(response_body->>'task_id'),id)
 WHERE operation_scope IN ('create_chat_task','create_unscoped_chat_task');
CREATE INDEX saved_memory_queue_task ON conversation_queue_entries(account_id,(result->'body'->>'task_id'),id);
CREATE TABLE agent_task_memory_session_copies (
  account_id uuid NOT NULL,
  task_id uuid NOT NULL,
  session_id uuid NOT NULL,
  PRIMARY KEY(account_id,task_id,session_id),
  FOREIGN KEY(account_id,task_id) REFERENCES agent_task_memory_lineage(account_id,task_id),
  FOREIGN KEY(account_id,session_id) REFERENCES agent_sessions(account_id,id) ON DELETE CASCADE
  -- This is routing metadata only. Deleting one actual Session body does not
  -- remove the original task dependency proof or another fork's copy mapping.
);

-- Seed before installing transition triggers. One controlled SDK cutover per
-- affected account, never one generation change per historical item.
INSERT INTO memory_item_lineage(account_id,memory_item_id) SELECT account_id,id FROM memory_items;
DO $cutover$
DECLARE owner uuid; workspace record; reason text;
BEGIN
 FOR owner IN SELECT DISTINCT account_id FROM memory_items ORDER BY account_id LOOP
  BEGIN
   -- Same account -> workspace order as the existing write fences. A competing
   -- lifecycle transition aborts this migration for a normal retry (NOWAIT),
   -- never a silent skip of a still-live owner. Retired/closed history keeps all
   -- backfilled epochs and remains quarantined for canonical cleanup.
   PERFORM 1 FROM accounts WHERE id=owner AND retired_at IS NULL FOR SHARE NOWAIT;
   IF NOT FOUND THEN CONTINUE; END IF;
   SELECT state,expires_at INTO workspace FROM lab_test_workspaces WHERE target_account_id=owner FOR SHARE NOWAIT;
   IF FOUND AND (workspace.state<>'active' OR workspace.expires_at<=clock_timestamp()) THEN CONTINUE; END IF;
   INSERT INTO harness_source_generations(account_id,generation) VALUES(owner,1)
     ON CONFLICT(account_id) DO UPDATE SET generation=harness_source_generations.generation+1;
   UPDATE harness_sessions SET invalidated_at=clock_timestamp() WHERE account_id=owner AND invalidated_at IS NULL;
   DELETE FROM harness_session_entries WHERE account_id=owner;
   -- Row locks cannot freeze natural time. If expiry crossed any of the above
   -- statements, roll back this owner's WHOLE cutover subtransaction. Do not
   -- disable or impersonate either existing retirement/Lab trigger.
   IF EXISTS (SELECT 1 FROM lab_test_workspaces WHERE target_account_id=owner
     AND (state<>'active' OR expires_at<=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LAB_TEST_WORKSPACE_CLOSED';
   END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
   IF reason<>'LAB_TEST_WORKSPACE_CLOSED' OR NOT EXISTS (SELECT 1 FROM lab_test_workspaces
     WHERE target_account_id=owner AND (state<>'active' OR expires_at<=clock_timestamp())) THEN RAISE; END IF;
   -- Only a proven current closed/expired owner is left untouched. Unknown
   -- guard/SQL errors still abort the entire canonical migration transaction.
  END;
 END LOOP;
END;
$cutover$;

-- Exactly the retained accepted-evidence policy, deliberately without raw
-- Session/image/receipt TTL. Pending-proposal qualification is a different role.
CREATE FUNCTION saved_memory_item_readable(a uuid,u uuid,item uuid,owned boolean)
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
    AND ((m.scope='self' AND m.owner_user_id=u AND m.subject_id IS NULL AND m.relationship_context_id IS NULL)
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

CREATE FUNCTION saved_memory_stamp_shape(stamp jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE k text; value text;
BEGIN
 IF jsonb_typeof(stamp) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(stamp))<>7 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['item_id','memory_owner_id'] LOOP
   IF jsonb_typeof(stamp->k) IS DISTINCT FROM 'string' OR stamp->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_typeof(stamp->'item_version') IS DISTINCT FROM 'number' OR stamp->>'item_version' !~ '^[1-9][0-9]{0,9}$' THEN RETURN false; END IF;
 IF (stamp->>'item_version')::numeric>2147483647 THEN RETURN false; END IF;
 IF jsonb_typeof(stamp->'lineage_epoch') IS DISTINCT FROM 'string' OR stamp->>'lineage_epoch' !~ '^[1-9][0-9]{0,18}$' THEN RETURN false; END IF;
 IF (stamp->>'lineage_epoch')::numeric>9223372036854775807 THEN RETURN false; END IF;
 IF jsonb_typeof(stamp->'scope') IS DISTINCT FROM 'string' OR stamp->>'scope' NOT IN ('self','person','relationship') THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['subject_id','relationship_context_id'] LOOP
   IF stamp->k IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(stamp->k) IS DISTINCT FROM 'string'
     OR stamp->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false; END IF;
 END LOOP;
 RETURN COALESCE((stamp->>'scope'='self' AND stamp->'subject_id'='null'::jsonb AND stamp->'relationship_context_id'='null'::jsonb)
   OR (stamp->>'scope'='person' AND stamp->'subject_id'<>'null'::jsonb AND stamp->'relationship_context_id'='null'::jsonb)
   OR (stamp->>'scope'='relationship' AND stamp->'subject_id'<>'null'::jsonb AND stamp->'relationship_context_id'<>'null'::jsonb),false);
END;
$function$;

-- This predicate supplies ONLY the Memory/query half of the final authority
-- SELECT. The actual login/claim/source/Lab owner MUST compose its own live
-- predicate and its original deadlines in that SAME envelope. It is not an
-- authentication function and must not be exposed as an HTTP/tool RPC. All
-- three read-only predicates are STABLE and take the actual outer MATERIALIZED
-- checked_at, never clock/statement/transaction time sampled inside a helper.
CREATE FUNCTION saved_memory_discovery_current(a uuid,u uuid,query_id uuid,digest text,projection integer,
 frozen_cutoff timestamptz,query_deadline timestamptz,stamps jsonb,delivered jsonb,patterns text[],page_limit integer,deadline timestamptz,
 checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $function$
DECLARE stamp jsonb;
BEGIN
 IF checked_at IS NULL OR NOT isfinite(checked_at)
   OR a IS NULL OR u IS NULL OR query_id IS NULL OR digest IS NULL OR digest !~ '^[a-f0-9]{64}$'
   OR projection IS DISTINCT FROM 1 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
   OR frozen_cutoff IS NULL OR NOT isfinite(frozen_cutoff) OR query_deadline IS NULL OR NOT isfinite(query_deadline)
   OR patterns IS NULL OR cardinality(patterns) NOT BETWEEN 1 AND 8
   OR EXISTS (SELECT 1 FROM unnest(patterns) p WHERE p IS NULL OR char_length(p)>242)
   OR (SELECT sum(octet_length(p)) FROM unnest(patterns) p)>4112
   OR jsonb_typeof(delivered) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(delivered)>page_limit OR saved_memory_read_set_current(a,u,stamps,deadline,checked_at) IS NOT TRUE
   OR NOT EXISTS (SELECT 1 FROM memory_discovery_queries q WHERE q.account_id=a AND q.reader_actor_id=u AND q.id=query_id
     AND q.query_digest=digest AND q.projection_version=projection AND q.cutoff=frozen_cutoff
     AND q.expires_at=query_deadline AND q.expires_at>checked_at) THEN RETURN false; END IF;
 FOR stamp IN SELECT value FROM jsonb_array_elements(delivered) LOOP
   IF saved_memory_stamp_shape(stamp) IS NOT TRUE OR NOT stamps @> jsonb_build_array(stamp) THEN RETURN false; END IF;
   IF NOT EXISTS (SELECT 1 FROM memory_items m LEFT JOIN subjects s ON s.account_id=m.account_id AND s.id=m.subject_id
     WHERE m.account_id=a AND m.id=(stamp->>'item_id')::uuid AND m.owner_user_id=u
       AND saved_memory_item_readable(a,u,m.id,true) AND m.created_at<=frozen_cutoff
       AND (m.display_text ILIKE ANY(patterns) OR m.original_display_text ILIKE ANY(patterns) OR s.display_label ILIKE ANY(patterns))) THEN RETURN false; END IF;
 END LOOP;
 RETURN deadline>checked_at AND query_deadline>checked_at;
END;
$function$;
CREATE FUNCTION saved_memory_read_set_current(a uuid,u uuid,stamps jsonb,deadline timestamptz,checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $function$
DECLARE stamp jsonb; previous uuid; item uuid;
BEGIN
 IF checked_at IS NULL OR NOT isfinite(checked_at) OR deadline IS NULL OR NOT isfinite(deadline) OR deadline<=checked_at
   OR jsonb_typeof(stamps) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
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
       AND m.scope=stamp->>'scope' AND m.subject_id IS NOT DISTINCT FROM (stamp->>'subject_id')::uuid
       AND m.relationship_context_id IS NOT DISTINCT FROM (stamp->>'relationship_context_id')::uuid
       AND saved_memory_item_readable(a,u,m.id,false)) THEN RETURN false; END IF;
 END LOOP;
 RETURN deadline>checked_at;
END;
$function$;

CREATE FUNCTION saved_memory_task_current(a uuid,task uuid,reader uuid,checked_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $function$
 SELECT checked_at IS NOT NULL AND isfinite(checked_at) AND COALESCE((SELECT t.format_version=1 AND t.withdrawn_at IS NULL AND t.expires_at>checked_at
   AND t.reader_actor_id=reader AND t.dependency_count=(SELECT count(*) FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task)
   AND saved_memory_read_set_current(a,reader,COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'item_id',d.memory_item_id::text,'item_version',d.item_version,'lineage_epoch',d.lineage_epoch::text,
     'memory_owner_id',d.memory_owner_id::text,'scope',d.scope,'subject_id',d.subject_id::text,
     'relationship_context_id',d.relationship_context_id::text) ORDER BY d.memory_item_id)
     FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.task_id=task),'[]'::jsonb),t.expires_at,checked_at)
   FROM agent_task_memory_lineage t WHERE t.account_id=a AND t.task_id=task),false)
$function$;

CREATE FUNCTION register_saved_memory_lineage(a uuid,u uuid,task uuid,deadline timestamptz,stamps jsonb,digest text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $function$
DECLARE stored agent_task_memory_lineage%ROWTYPE; stamp jsonb;
BEGIN
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' OR saved_memory_read_set_current(a,u,stamps,deadline,clock_timestamp()) IS NOT TRUE THEN RETURN false; END IF;
 INSERT INTO agent_task_memory_lineage(account_id,task_id,reader_actor_id,format_version,dependency_count,proof_digest,expires_at)
   VALUES(a,task,u,1,jsonb_array_length(stamps),digest,deadline) ON CONFLICT DO NOTHING;
 SELECT * INTO stored FROM agent_task_memory_lineage WHERE account_id=a AND task_id=task FOR UPDATE NOWAIT;
 IF stored.reader_actor_id<>u OR stored.expires_at<>deadline OR stored.proof_digest<>digest OR stored.withdrawn_at IS NOT NULL
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

CREATE FUNCTION record_saved_memory_session_copy(a uuid,u uuid,task uuid,target_session uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $function$
BEGIN
 -- Existing source/task retention must be admitted by the Session owner too.
 -- The lineage lock serializes withdrawal vs copy registration: a copy cannot
 -- appear behind a completed scrub frontier after withdrawal has committed.
 PERFORM 1 FROM agent_task_memory_lineage WHERE account_id=a AND task_id=task FOR SHARE NOWAIT;
 IF NOT FOUND OR saved_memory_task_current(a,task,u,clock_timestamp()) IS NOT TRUE THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM agent_sessions s WHERE s.account_id=a AND s.id=target_session
   AND s.created_by_user_id=u AND s.deleted_at IS NULL AND s.expires_at>clock_timestamp()) THEN RETURN false; END IF;
 INSERT INTO agent_task_memory_session_copies(account_id,task_id,session_id) VALUES(a,task,target_session) ON CONFLICT DO NOTHING;
 RETURN true;
END;
$function$;

-- Explicit writer helper for the still-to-be-wired exact source/target owners.
-- No body, Session or whole-account derivative fanout occurs in this function.
CREATE FUNCTION advance_saved_memory_epochs(a uuid,items uuid[]) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $function$
DECLARE changed integer;
BEGIN
 IF saved_memory_verified_lab_cleanup(a) THEN RETURN 0; END IF;
 IF items IS NULL OR cardinality(items)>256 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SAVED_MEMORY_EPOCH_BATCH_INVALID'; END IF;
 UPDATE memory_item_lineage SET epoch=epoch+1,cleanup_after_task=NULL,changed_at=clock_timestamp()
   WHERE account_id=a AND memory_item_id=ANY(items);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN
   INSERT INTO harness_source_generations(account_id,generation) VALUES(a,1)
     ON CONFLICT(account_id) DO UPDATE SET generation=harness_source_generations.generation+1;
   UPDATE harness_sessions SET invalidated_at=clock_timestamp() WHERE account_id=a AND invalidated_at IS NULL;
   DELETE FROM harness_session_entries WHERE account_id=a;
 END IF;
 RETURN changed;
END;
$function$;
CREATE FUNCTION saved_memory_item_transition() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE a uuid; item uuid;
BEGIN
 a:=CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END;
 item:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='DELETE' AND saved_memory_verified_lab_cleanup(a) THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN
   INSERT INTO memory_item_lineage(account_id,memory_item_id) VALUES(a,item)
     ON CONFLICT(account_id,memory_item_id) DO UPDATE SET epoch=memory_item_lineage.epoch+1,cleanup_after_task=NULL,changed_at=clock_timestamp();
 ELSIF TG_OP='DELETE' OR (to_jsonb(OLD)-'updated_at') IS DISTINCT FROM (to_jsonb(NEW)-'updated_at') THEN
   IF TG_OP='UPDATE' AND (OLD.account_id,OLD.id) IS DISTINCT FROM (NEW.account_id,NEW.id) THEN
     PERFORM advance_saved_memory_epochs(OLD.account_id,ARRAY[OLD.id]);
     INSERT INTO memory_item_lineage(account_id,memory_item_id) VALUES(a,item) ON CONFLICT DO NOTHING;
   END IF;
   PERFORM advance_saved_memory_epochs(a,ARRAY[item]);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
CREATE TRIGGER saved_memory_item_transition AFTER INSERT OR UPDATE OR DELETE ON memory_items
 FOR EACH ROW EXECUTE FUNCTION saved_memory_item_transition();
CREATE FUNCTION saved_memory_evidence_transition() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE a uuid; item uuid;
BEGIN
 a:=CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END;
 item:=CASE WHEN TG_OP='DELETE' THEN OLD.memory_item_id ELSE NEW.memory_item_id END;
 IF TG_OP='DELETE' AND saved_memory_verified_lab_cleanup(a) THEN RETURN OLD; END IF;
 IF TG_OP<>'UPDATE' OR OLD IS DISTINCT FROM NEW THEN PERFORM advance_saved_memory_epochs(a,ARRAY[item]); END IF;
 IF TG_OP='UPDATE' AND (OLD.account_id,OLD.memory_item_id) IS DISTINCT FROM (NEW.account_id,NEW.memory_item_id) THEN
   PERFORM advance_saved_memory_epochs(OLD.account_id,ARRAY[OLD.memory_item_id]);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
CREATE TRIGGER saved_memory_evidence_transition AFTER INSERT OR UPDATE OR DELETE ON memory_item_evidence
 FOR EACH ROW EXECUTE FUNCTION saved_memory_evidence_transition();

-- A typed Memory-only tombstone preserves the distinction from original source
-- withdrawal. Never insert an untyped source tombstone that would also erase
-- still-authorized authored human prose in the existing history reader.
CREATE FUNCTION redact_saved_memory_payload(a uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE turn jsonb; turns jsonb:='[]'::jsonb;
BEGIN
 IF body IS NULL OR jsonb_typeof(body->'turns') IS DISTINCT FROM 'array' THEN RETURN body; END IF;
 FOR turn IN SELECT value FROM jsonb_array_elements(body->'turns') LOOP
   IF EXISTS (SELECT 1 FROM agent_task_memory_lineage t WHERE t.account_id=a
     AND t.task_id::text=canonical_agent_session_id(turn->'response'->>'taskID') AND t.withdrawn_at IS NOT NULL) THEN
     turn:=jsonb_set(turn,'{response}',(turn->'response')-'savedBlocks'-'unboundConversationBlocks'-'unboundPersonResearchBlocks'-'media');
   END IF;
   turns:=turns||jsonb_build_array(turn);
 END LOOP;
 RETURN jsonb_set(body,'{turns}',turns);
END;
$function$;

-- Bounded metadata invalidation only; no account-wide Session body UPDATE.
CREATE FUNCTION invalidate_saved_memory_dependents(a uuid,item uuid,batch_limit integer)
RETURNS integer LANGUAGE plpgsql VOLATILE AS $function$
DECLARE current_epoch bigint; frontier uuid; next_frontier uuid; changed integer;
BEGIN
 IF batch_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SAVED_MEMORY_BATCH_INVALID'; END IF;
 SELECT epoch,cleanup_after_task INTO current_epoch,frontier FROM memory_item_lineage
   WHERE account_id=a AND memory_item_id=item AND cleanup_epoch<epoch FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN 0; END IF;
 WITH selected AS MATERIALIZED (
   SELECT t.task_id FROM agent_task_memory_lineage t JOIN agent_task_saved_memory_dependencies d
     ON d.account_id=t.account_id AND d.task_id=t.task_id
   WHERE d.account_id=a AND d.memory_item_id=item AND d.lineage_epoch<>current_epoch
     AND (frontier IS NULL OR t.task_id>frontier)
   ORDER BY t.task_id LIMIT batch_limit FOR UPDATE OF t NOWAIT
 ), marked AS (
   UPDATE agent_task_memory_lineage t SET withdrawn_at=COALESCE(withdrawn_at,clock_timestamp()),cleanup_complete=false
     FROM selected s WHERE t.account_id=a AND t.task_id=s.task_id RETURNING t.task_id
 ) SELECT count(*)::int,(array_agg(task_id ORDER BY task_id DESC))[1] INTO changed,next_frontier FROM marked;
 IF next_frontier IS NOT NULL THEN UPDATE memory_item_lineage SET cleanup_after_task=next_frontier
   WHERE account_id=a AND memory_item_id=item AND epoch=current_epoch; END IF;
 IF NOT EXISTS (SELECT 1 FROM agent_task_saved_memory_dependencies d WHERE d.account_id=a AND d.memory_item_id=item
   AND d.lineage_epoch<>current_epoch AND (COALESCE(next_frontier,frontier) IS NULL OR d.task_id>COALESCE(next_frontier,frontier))) THEN
   UPDATE memory_item_lineage SET cleanup_epoch=current_epoch,cleanup_after_task=NULL
     WHERE account_id=a AND memory_item_id=item AND epoch=current_epoch;
 END IF;
 RETURN changed;
END;
$function$;

CREATE FUNCTION scrub_saved_memory_task(a uuid,task uuid,batch_limit integer)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $function$
DECLARE frontier uuid; copy_id uuid; last_copy uuid; copied integer:=0;
BEGIN
 IF batch_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SAVED_MEMORY_BATCH_INVALID'; END IF;
 -- NOWAIT prevents a reverse publication order from waiting on these locks.
 PERFORM id FROM idempotency_records WHERE account_id=a AND operation_scope IN ('create_chat_task','create_unscoped_chat_task')
   AND response_body->>'task_id'=task::text ORDER BY id FOR UPDATE NOWAIT;
 SELECT cleanup_after_session INTO frontier FROM agent_task_memory_lineage WHERE account_id=a AND task_id=task
   AND withdrawn_at IS NOT NULL AND NOT cleanup_complete FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN true; END IF;
 UPDATE idempotency_records SET response_body=jsonb_build_object('task_id',task,'memory_context_unavailable',true)
   WHERE account_id=a AND operation_scope IN ('create_chat_task','create_unscoped_chat_task') AND response_body->>'task_id'=task::text;
 PERFORM id FROM conversation_queue_entries WHERE account_id=a AND result->'body'->>'task_id'=task::text ORDER BY id FOR UPDATE NOWAIT;
 -- Keep a non-NULL unavailable marker: NULL could be mistaken for permission
 -- to dispatch another model. Existing result readers must gate before decode.
 UPDATE conversation_queue_entries SET result=jsonb_build_object('memory_context_unavailable',true,'task_id',task)
   WHERE account_id=a AND result->'body'->>'task_id'=task::text;
 FOR copy_id IN SELECT session_id FROM agent_task_memory_session_copies
   WHERE account_id=a AND task_id=task AND (frontier IS NULL OR session_id>frontier)
   ORDER BY session_id LIMIT batch_limit LOOP
   PERFORM id FROM agent_sessions WHERE account_id=a AND id=copy_id FOR UPDATE NOWAIT;
   UPDATE agent_sessions SET payload=redact_saved_memory_payload(a,payload),revision=revision+1,updated_at=clock_timestamp()
     WHERE account_id=a AND id=copy_id AND deleted_at IS NULL AND payload IS DISTINCT FROM redact_saved_memory_payload(a,payload);
   last_copy:=copy_id; copied:=copied+1;
 END LOOP;
 IF last_copy IS NOT NULL THEN UPDATE agent_task_memory_lineage SET cleanup_after_session=last_copy WHERE account_id=a AND task_id=task; END IF;
 IF NOT EXISTS (SELECT 1 FROM agent_task_memory_session_copies WHERE account_id=a AND task_id=task
   AND (COALESCE(last_copy,frontier) IS NULL OR session_id>COALESCE(last_copy,frontier))) THEN
   UPDATE agent_task_memory_lineage SET cleanup_complete=true WHERE account_id=a AND task_id=task;
   RETURN true;
 END IF;
 RETURN false;
END;
$function$;

INSERT INTO lab_test_workspace_table_manifest(table_name,scope) VALUES
 ('memory_item_lineage','account'),('memory_discovery_queries','account'),('agent_task_memory_lineage','account'),
 ('agent_task_saved_memory_dependencies','account'),('agent_task_memory_session_copies','account');
DO $function$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['memory_item_lineage','memory_discovery_queries','agent_task_memory_lineage',
   'agent_task_saved_memory_dependencies','agent_task_memory_session_copies'] LOOP
  EXECUTE format('CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'')',item);
  EXECUTE format('CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard()',item);
 END LOOP;
END; $function$;
