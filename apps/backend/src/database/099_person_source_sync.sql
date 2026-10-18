-- GET-131 one-person / one already-bound public source periodic observation.
--
-- A grant is one owner's explicit, expiring confirmation to re-read ONE exact
-- already-authorized public URL on an honest 24-hour UTC interval. Every due
-- cycle freezes its request from immutable grant-time values (exact canonical
-- URL/domain plus the ORIGINAL grant actor/revision/time), never from a mutable
-- seed locator and never from a fabricated per-cycle approval. Captured pages
-- stay ordinary proposed research evidence through the existing pipeline.
--
-- Deletion redacts content in place while keeping an identity-only receipt and
-- the last operation id for response-loss reconciliation, mirroring
-- time_schedules (074). Run rows keep fixed content-free diagnostic codes only.

CREATE TABLE person_source_sync_grants (
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  -- Identity/source bindings. Null only after an explicit delete redaction.
  subject_id uuid,
  assignment_id uuid,
  seed_resource_id uuid,
  -- Frozen at creation: the exact authorized public source, never re-read
  -- from a mutable locator to build a cycle request.
  source_capture_id uuid,
  source_capture_version integer,
  source_url text,
  allowed_domain text,
  purpose text,
  -- Display only; the schedule is a real 86400-second UTC interval.
  time_zone text,
  interval_seconds integer NOT NULL CHECK (interval_seconds = 86400),
  expires_at timestamptz,
  next_due_at timestamptz,
  status text NOT NULL CHECK (status IN ('active','paused','revoked','deleted')),
  external_effect text NOT NULL CHECK (external_effect = 'none'),
  -- Retained across deletion so a lost response can be reconciled.
  revision integer NOT NULL CHECK (revision > 0),
  last_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, id, created_by_user_id),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  FOREIGN KEY (account_id, subject_id) REFERENCES subjects(account_id, id),
  FOREIGN KEY (account_id, assignment_id) REFERENCES assignments(account_id, id),
  FOREIGN KEY (account_id, seed_resource_id) REFERENCES source_resources(account_id, id),
  FOREIGN KEY (account_id, source_capture_id) REFERENCES captures(account_id, id),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (status <> 'deleted' OR (
    subject_id IS NULL AND assignment_id IS NULL AND seed_resource_id IS NULL
    AND source_capture_id IS NULL AND source_capture_version IS NULL
    AND source_url IS NULL AND allowed_domain IS NULL AND purpose IS NULL
    AND time_zone IS NULL AND expires_at IS NULL AND next_due_at IS NULL
  )),
  CHECK (status = 'deleted' OR (
    subject_id IS NOT NULL AND assignment_id IS NOT NULL
    AND seed_resource_id IS NOT NULL AND source_capture_id IS NOT NULL
    AND source_capture_version IS NOT NULL AND source_capture_version > 0
    AND source_url IS NOT NULL AND allowed_domain IS NOT NULL
    AND purpose IS NOT NULL AND time_zone IS NOT NULL
    AND expires_at IS NOT NULL AND next_due_at IS NOT NULL
    AND expires_at > created_at
  )),
  CHECK (source_url IS NULL OR (btrim(source_url) <> '' AND char_length(source_url) <= 2000)),
  CHECK (allowed_domain IS NULL OR (btrim(allowed_domain) <> '' AND char_length(allowed_domain) <= 253)),
  CHECK (purpose IS NULL OR (btrim(purpose) <> '' AND char_length(purpose) <= 500)),
  CHECK (time_zone IS NULL OR (btrim(time_zone) <> '' AND char_length(time_zone) <= 100)),
  CHECK (source_capture_version IS NULL OR source_capture_version > 0)
);
-- v1 is one person and one source: a paused grant still owns its person slot.
CREATE UNIQUE INDEX person_source_sync_grants_one_live_idx
  ON person_source_sync_grants(account_id, subject_id)
  WHERE status IN ('active','paused');
CREATE INDEX person_source_sync_grants_due_idx
  ON person_source_sync_grants(next_due_at, id)
  WHERE status = 'active';

-- Mutations carry owner-scoped idempotency receipts with stable identity-only
-- digests; no request payload content is retained (074 time_schedules pattern).
CREATE TABLE person_source_sync_operations (
  account_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  grant_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','pause','resume','delete')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  resulting_revision integer NOT NULL CHECK (resulting_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, actor_user_id, idempotency_key),
  FOREIGN KEY (account_id, actor_user_id) REFERENCES users(account_id, id),
  FOREIGN KEY (account_id, grant_id) REFERENCES person_source_sync_grants(account_id, id)
);

-- One row per due cycle. The UNIQUE cycle keys make materialization and replay
-- idempotent across replicas and restarts; the partial unique index keeps at
-- most one nonterminal cycle per grant so missed days never burst catch-up.
CREATE TABLE person_source_sync_runs (
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  grant_id uuid NOT NULL,
  cycle_key text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending','claimed','dispatched','completed','partial','failed','skipped','unknown')
  ),
  -- Attempt budget: at most 3 TOTAL attempts including the first, counted
  -- atomically before any DNS/authority/fetch/research lease.
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  lease_owner text,
  lease_expires_at timestamptz,
  -- Immutable frozen cycle request: exact canonical source URL/domain plus the
  -- ORIGINAL grant actor/authorization revision/time.
  frozen_seed_resource_id uuid NOT NULL,
  frozen_source_url text NOT NULL CHECK (char_length(frozen_source_url) BETWEEN 1 AND 2000),
  frozen_allowed_domain text NOT NULL CHECK (char_length(frozen_allowed_domain) BETWEEN 1 AND 253),
  grant_actor_user_id uuid NOT NULL,
  grant_authorization_revision integer NOT NULL CHECK (grant_authorization_revision > 0),
  grant_authorized_at timestamptz NOT NULL,
  source_capture_version integer NOT NULL CHECK (source_capture_version > 0),
  task_id uuid,
  -- Observation receipt: IDs and a stable extracted-body hash only.
  observed_resource_id uuid,
  observed_capture_id uuid,
  observed_canonical_url text,
  observed_body_hash text,
  new_observations integer NOT NULL DEFAULT 0 CHECK (new_observations BETWEEN 0 AND 1),
  -- Fixed content-free diagnostics only; raw exception or page text is
  -- never retained here.
  warning_codes text[] NOT NULL DEFAULT '{}',
  stop_reason text CHECK (stop_reason IS NULL OR stop_reason IN (
    'PERSON_SOURCE_SYNC_GRANT_PAUSED',
    'PERSON_SOURCE_SYNC_GRANT_REVOKED',
    'PERSON_SOURCE_SYNC_GRANT_EXPIRED',
    'PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE',
    'PERSON_SOURCE_SYNC_ACCOUNT_RETIRED',
    'PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE',
    'PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED',
    'PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED',
    'PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED',
    'PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED',
    'PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION',
    'PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED',
    'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED',
    'PERSON_SOURCE_SYNC_LEASE_LOST'
  )),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, cycle_key),
  UNIQUE (account_id, grant_id, due_at),
  FOREIGN KEY (account_id, grant_id) REFERENCES person_source_sync_grants(account_id, id),
  FOREIGN KEY (account_id, frozen_seed_resource_id) REFERENCES source_resources(account_id, id),
  FOREIGN KEY (account_id, grant_actor_user_id) REFERENCES users(account_id, id),
  FOREIGN KEY (account_id, task_id) REFERENCES research_tasks(account_id, id),
  FOREIGN KEY (account_id, observed_resource_id) REFERENCES source_resources(account_id, id),
  FOREIGN KEY (account_id, observed_capture_id) REFERENCES captures(account_id, id),
  CHECK (char_length(cycle_key) BETWEEN 1 AND 128),
  CHECK (observed_body_hash IS NULL OR observed_body_hash ~ '^[a-f0-9]{64}$'),
  CHECK (observed_canonical_url IS NULL OR char_length(observed_canonical_url) <= 2000),
  CHECK (COALESCE(array_length(warning_codes, 1), 0) <= 20),
  CHECK (warning_codes <@ ARRAY[
    'PUBLIC_RESEARCH_FETCH_FAILED',
    'PUBLIC_RESEARCH_CAPTURE_FAILED',
    'PUBLIC_RESEARCH_UNAVAILABLE',
    'PUBLIC_RESEARCH_RETRY_FAILED',
    'PERSON_SOURCE_SYNC_UNCHANGED',
    'PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED',
    'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED',
    'PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION',
    'PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED'
  ]::text[]),
  CHECK (
    (status IN ('claimed','dispatched') AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status NOT IN ('claimed','dispatched') AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((status IN ('pending','claimed','dispatched')) = (completed_at IS NULL)),
  CHECK ((observed_resource_id IS NULL) = (observed_capture_id IS NULL))
);
CREATE UNIQUE INDEX person_source_sync_runs_one_open_cycle_idx
  ON person_source_sync_runs(account_id, grant_id)
  WHERE status IN ('pending','claimed','dispatched');
CREATE INDEX person_source_sync_runs_open_idx
  ON person_source_sync_runs(account_id, grant_id, created_at)
  WHERE status IN ('pending','claimed','dispatched');
CREATE INDEX person_source_sync_runs_expired_lease_idx
  ON person_source_sync_runs(lease_expires_at, created_at)
  WHERE status IN ('claimed','dispatched');
-- Cross-cycle UNCHANGED dedup: grant/source lineage + canonical locator +
-- stable extracted body hash, never taskId or volatile fetch metadata.
CREATE INDEX person_source_sync_runs_observation_dedup_idx
  ON person_source_sync_runs(account_id, frozen_seed_resource_id, observed_canonical_url, observed_body_hash)
  WHERE observed_resource_id IS NOT NULL;

-- Durable job<->cycle round trip replacing closure-only recurring authority.
ALTER TABLE research_retrieval_jobs
  ADD COLUMN recurring_run_id uuid,
  ADD CONSTRAINT research_retrieval_jobs_recurring_run_fk
    FOREIGN KEY (account_id, recurring_run_id)
    REFERENCES person_source_sync_runs(account_id, id);

-- Additive calendar surfacing: a public_source_update activity exists only
-- while a genuinely committed new observation remains available evidence.
-- Unchanged cycles create no capture and therefore no card, and deleted or
-- deauthorized source content never reappears.
CREATE OR REPLACE FUNCTION time_activity_content(
  p_account uuid,
  p_user uuid,
  p_from date,
  p_to date,
  p_tz text,
  p_person uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  activity_id text,
  kind text,
  source_id uuid,
  source_revision integer,
  title text,
  summary text,
  occurred_at timestamptz,
  recorded_at timestamptz,
  ends_at timestamptz,
  local_day date,
  person_id uuid,
  person_label text,
  relationship_context_id uuid,
  context_label text,
  session_id uuid,
  status text,
  authority text,
  all_day boolean
) LANGUAGE sql STABLE AS $fn$
  WITH session_days AS (
    SELECT
      session.id AS session_id,
      session.revision AS source_revision,
      session.created_at AS recorded_at,
      CASE WHEN binding.person_label IS NOT NULL
        THEN '会话活动 · ' || binding.person_label
        ELSE '会话活动' END AS title,
      binding.person_id,
      binding.person_label,
      binding.context_id AS relationship_context_id,
      binding.context_label,
      (turn_at.occurred_at AT TIME ZONE p_tz)::date AS local_day,
      MIN(turn_at.occurred_at) AS occurred_at,
      COUNT(*)::int AS turn_count
    FROM agent_sessions session
    CROSS JOIN LATERAL (
      SELECT redact_agent_session_payload(session.account_id, session.payload) AS body
    ) redacted
    LEFT JOIN LATERAL time_session_person_binding(p_account, session.id) binding ON TRUE
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(redacted.body->'turns') = 'array'
        THEN redacted.body->'turns' ELSE '[]'::jsonb END
    ) AS turn(value)
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_typeof(turn.value->'createdAt') = 'string'
          AND (turn.value->>'createdAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
          AND pg_input_is_valid(turn.value->>'createdAt', 'timestamptz')
        THEN (turn.value->>'createdAt')::timestamptz
      END AS occurred_at
    ) turn_at
    WHERE session.account_id = p_account
      AND session.created_by_user_id = p_user
      AND session.deleted_at IS NULL
      AND session.expires_at > statement_timestamp()
      AND session.payload IS NOT NULL
      AND turn_at.occurred_at IS NOT NULL
      AND (p_ids IS NULL OR session.id = ANY(p_ids))
    GROUP BY session.id, session.revision, session.created_at,
      binding.person_id, binding.person_label,
      binding.context_id, binding.context_label,
      (turn_at.occurred_at AT TIME ZONE p_tz)::date
  )
  SELECT
    'session_activity:' || session_days.session_id::text || ':' || to_char(session_days.local_day, 'YYYY-MM-DD'),
    'session_activity'::text,
    session_days.session_id,
    session_days.source_revision,
    session_days.title,
    session_days.turn_count::text || ' 条当日会话记录',
    session_days.occurred_at,
    session_days.recorded_at,
    NULL::timestamptz,
    session_days.local_day,
    session_days.person_id,
    session_days.person_label,
    session_days.relationship_context_id,
    session_days.context_label,
    session_days.session_id,
    'recorded'::text,
    'system_record'::text,
    false
  FROM session_days
  WHERE session_days.local_day >= p_from AND session_days.local_day < p_to
    AND (p_kind IS NULL OR p_kind = 'session_activity')
    AND (p_person IS NULL OR session_days.person_id = p_person)
    AND (p_ids IS NULL OR session_days.session_id = ANY(p_ids))
  UNION ALL
  SELECT
    'person_created:' || subject.id::text,
    'person_created'::text,
    subject.id,
    1,
    subject.display_label,
    '新建人物',
    subject.created_at,
    subject.created_at,
    NULL::timestamptz,
    (subject.created_at AT TIME ZONE p_tz)::date,
    subject.id,
    subject.display_label,
    NULL::uuid,
    NULL::text,
    NULL::uuid,
    'recorded'::text,
    'system_record'::text,
    false
  FROM subjects subject
  WHERE subject.account_id = p_account
    AND subject.status = 'active'
    AND (subject.created_at AT TIME ZONE p_tz)::date >= p_from
    AND (subject.created_at AT TIME ZONE p_tz)::date < p_to
    AND (p_kind IS NULL OR p_kind = 'person_created')
    AND (p_person IS NULL OR subject.id = p_person)
    AND (p_ids IS NULL OR subject.id = ANY(p_ids))
  UNION ALL
  SELECT
    'meeting_draft:' || draft.id::text,
    'meeting_draft'::text,
    draft.id,
    draft.revision,
    draft.title,
    '未经确认的日程草稿'::text,
    draft.starts_at,
    draft.created_at,
    draft.ends_at,
    GREATEST((draft.starts_at AT TIME ZONE p_tz)::date, p_from),
    binding.person_id,
    binding.person_label,
    binding.context_id,
    binding.context_label,
    draft.origin_session_id,
    'needs_review'::text,
    'unconfirmed'::text,
    false
  FROM meeting_drafts draft
  LEFT JOIN LATERAL time_session_person_binding(p_account, draft.origin_session_id) binding ON TRUE
  WHERE draft.account_id = p_account
    AND draft.created_by_user_id = p_user
    AND draft.status = 'needs_review'
    AND draft.expires_at > statement_timestamp()
    AND meeting_draft_source_available(
      draft.account_id, draft.origin_session_id, draft.source_task_id
    )
    AND draft.starts_at < (p_to::timestamp AT TIME ZONE p_tz)
    AND draft.ends_at > (p_from::timestamp AT TIME ZONE p_tz)
    AND (p_kind IS NULL OR p_kind = 'meeting_draft')
    AND (p_person IS NULL OR binding.person_id = p_person)
    AND (p_ids IS NULL OR draft.id = ANY(p_ids))
  UNION ALL
  SELECT
    'schedule:' || schedule.id::text,
    'schedule'::text,
    schedule.id,
    schedule.revision,
    schedule.title,
    left(COALESCE(schedule.note, ''), 1000),
    schedule.starts_at,
    schedule.created_at,
    schedule.ends_at,
    GREATEST((schedule.starts_at AT TIME ZONE p_tz)::date, p_from),
    person.id,
    person.display_label,
    NULL::uuid,
    NULL::text,
    NULL::uuid,
    schedule.status,
    'user_authored'::text,
    schedule.all_day
  FROM time_schedules schedule
  LEFT JOIN subjects person
    ON person.account_id = schedule.account_id
   AND person.status = 'active'
   AND person.id = schedule.person_id
  WHERE schedule.account_id = p_account
    AND schedule.created_by_user_id = p_user
    AND schedule.status <> 'deleted'
    AND schedule.starts_at < (p_to::timestamp AT TIME ZONE p_tz)
    AND schedule.ends_at > (p_from::timestamp AT TIME ZONE p_tz)
    AND (p_kind IS NULL OR p_kind = 'schedule')
    AND (p_person IS NULL OR person.id = p_person)
    AND (p_ids IS NULL OR schedule.id = ANY(p_ids))
  UNION ALL
  SELECT
    'public_source_update:' || run.id::text,
    'public_source_update'::text,
    run.id,
    1,
    COALESCE(observation_resource.display_name, '公开来源更新'),
    '定时公开来源读取产生新的拟议依据，等待你审阅。'::text,
    observation_resource.observed_at,
    COALESCE(run.completed_at, run.updated_at),
    NULL::timestamptz,
    (observation_resource.observed_at AT TIME ZONE p_tz)::date,
    person.id,
    person.display_label,
    NULL::uuid,
    NULL::text,
    NULL::uuid,
    'needs_review'::text,
    'unconfirmed'::text,
    false
  FROM person_source_sync_runs run
  JOIN source_resources observation_resource
    ON observation_resource.account_id = run.account_id
   AND observation_resource.id = run.observed_resource_id
   AND observation_resource.processing_state <> 'deleted'
  JOIN captures observation_capture
    ON observation_capture.account_id = observation_resource.account_id
   AND observation_capture.id = observation_resource.capture_id
   AND observation_capture.status = 'active'
  JOIN source_retention_receipts observation_receipt
    ON observation_receipt.account_id = observation_capture.account_id
   AND observation_receipt.capture_id = observation_capture.id
   AND observation_receipt.authorization_state = 'authorized'
   AND (
     observation_receipt.authorization_expires_at IS NULL
     OR observation_receipt.authorization_expires_at > statement_timestamp()
   )
  LEFT JOIN subjects person
    ON person.account_id = observation_capture.account_id
   AND person.status = 'active'
   AND person.id = observation_capture.subject_id
  WHERE run.account_id = p_account
    AND run.observed_resource_id IS NOT NULL
    AND run.new_observations > 0
    AND run.status IN ('completed','partial','skipped','failed','unknown')
    AND (observation_resource.observed_at AT TIME ZONE p_tz)::date >= p_from
    AND (observation_resource.observed_at AT TIME ZONE p_tz)::date < p_to
    AND (p_kind IS NULL OR p_kind = 'public_source_update')
    AND (p_person IS NULL OR person.id = p_person)
    AND (p_ids IS NULL OR run.id = ANY(p_ids))
$fn$;

ALTER TABLE time_activity_snapshot_items
  DROP CONSTRAINT time_activity_snapshot_items_kind_check;
ALTER TABLE time_activity_snapshot_items
  ADD CONSTRAINT time_activity_snapshot_items_kind_check
  CHECK (kind IN ('person_created','session_activity','meeting_draft','schedule','public_source_update'));

INSERT INTO lab_test_workspace_table_manifest(table_name,scope)
VALUES
  ('person_source_sync_grants','account'),
  ('person_source_sync_operations','account'),
  ('person_source_sync_runs','account');
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON person_source_sync_grants
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON person_source_sync_operations
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON person_source_sync_runs
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();

-- New account tables after account identity ownership must share its
-- retirement lock (098 discipline) so a retired account cannot admit late
-- person-source-sync writes.
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY[
    'person_source_sync_grants',
    'person_source_sync_operations',
    'person_source_sync_runs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'')',
      item
    );
  END LOOP;
END $$;
