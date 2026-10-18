-- GET-37 source-safe usage diagnostics: one narrow, strictly sanitized
-- metadata-only exception to unrelated account generation drift.
-- Raw input/output keeps its original exact-generation fence unchanged.

-- Safe non-negative integer counters only. Anything else is unknown (NULL),
-- never an invented zero.
CREATE FUNCTION screenshot_usage_safe_count(value jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN
    CASE WHEN (value::text)::numeric >= 0
      AND (value::text)::numeric = trunc((value::text)::numeric)
      AND (value::text)::numeric <= 9007199254740991
    THEN (value::text)::numeric::bigint END
  END
$$;

-- Bounded sanitizer for the two known source-safe usage span shapes. Strict
-- per-field types, allowed values and identifier shapes only: raw request or
-- message ids, nested usage, prose, credentials and arbitrary keys never pass.
-- Returns NULL for any other span, so callers preserve nothing by default.
CREATE FUNCTION screenshot_usage_diagnostic_metadata(span jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN span->>'name' = 'contact.screenshot.preprocess.usage' AND span->>'kind' = 'llm' THEN
      (SELECT CASE WHEN m->>'provider' = 'volcano_ark'
         AND (m->>'model') ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
         AND (m->>'request_id_sha256') ~ '^[a-f0-9]{64}$'
         AND (m->>'source_image_index') ~ '^[0-9]$'
       THEN jsonb_build_object(
         'provider', 'volcano_ark',
         'model', m->>'model',
         'reported_model', CASE WHEN (m->>'reported_model') ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
           THEN m->>'reported_model' END,
         'raw_usage_known', (m->>'raw_usage_known') = 'true'
           AND screenshot_usage_safe_count(m->'raw_prompt_tokens') IS NOT NULL
           AND screenshot_usage_safe_count(m->'raw_completion_tokens') IS NOT NULL,
         'raw_prompt_tokens', CASE WHEN (m->>'raw_usage_known') = 'true'
           AND screenshot_usage_safe_count(m->'raw_prompt_tokens') IS NOT NULL
           AND screenshot_usage_safe_count(m->'raw_completion_tokens') IS NOT NULL
           THEN screenshot_usage_safe_count(m->'raw_prompt_tokens') END,
         'raw_completion_tokens', CASE WHEN (m->>'raw_usage_known') = 'true'
           AND screenshot_usage_safe_count(m->'raw_prompt_tokens') IS NOT NULL
           AND screenshot_usage_safe_count(m->'raw_completion_tokens') IS NOT NULL
           THEN screenshot_usage_safe_count(m->'raw_completion_tokens') END,
         'source_image_index', (m->>'source_image_index')::int,
         'request_id_sha256', m->>'request_id_sha256')
       END FROM (SELECT span->'metadata' AS m) AS ark)
    WHEN span->>'name' = 'harness.sdk.assistant' AND span->>'kind' = 'llm' THEN
      (SELECT CASE WHEN m->>'provider' = 'claude-agent-sdk'
         AND (m->>'model') ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'
         AND (m->>'sdk_message_id_sha256') ~ '^[a-f0-9]{64}$'
         AND m->>'sdk_usage_basis' = 'per_message_provider_reported_input_excludes_cache'
       THEN jsonb_build_object(
         'provider', 'claude-agent-sdk',
         'model', m->>'model',
         'sdk_message_id_sha256', m->>'sdk_message_id_sha256',
         'sdk_input_tokens', screenshot_usage_safe_count(m->'sdk_input_tokens'),
         'sdk_output_tokens', screenshot_usage_safe_count(m->'sdk_output_tokens'),
         'sdk_cache_read_input_tokens', screenshot_usage_safe_count(m->'sdk_cache_read_input_tokens'),
         'sdk_cache_creation_input_tokens', screenshot_usage_safe_count(m->'sdk_cache_creation_input_tokens'),
         'sdk_total_input_tokens', screenshot_usage_safe_count(m->'sdk_total_input_tokens'),
         'sdk_usage_basis', 'per_message_provider_reported_input_excludes_cache',
         'sdk_stop_reason', CASE WHEN m->>'sdk_stop_reason'
           IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal')
           THEN m->>'sdk_stop_reason' END)
       END FROM (SELECT span->'metadata' AS m) AS sdk)
  END
$$;

-- Narrow availability for canonical screenshot usage diagnostics only. It
-- revalidates the same-owner run/task, active account user, run/task/source
-- retention expiry and the actual own source lifecycle (deletion, cancel,
-- directory, capture retention and authorization). It ignores ONLY unrelated
-- account generation drift; a purged transport copy whose review completed is
-- the product's retained admitted-source state, while a deleted, expired or
-- revoked source is never authorized. Raw content availability is separate and
-- stays fenced by product_run_source_available.
CREATE FUNCTION screenshot_usage_diagnostics_available(run_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT COALESCE((
    SELECT r.task_id IS NOT NULL AND r.task_kind = 'screenshot'
      AND r.expires_at > clock_timestamp()
      AND t.created_by_user_id = r.user_id
      AND t.expires_at > clock_timestamp()
      AND t.status NOT IN ('deleted', 'cancelled')
      AND NOT COALESCE((t.state->>'deletion_requested')::boolean, false)
      AND NOT COALESCE((t.state->>'preprocessing_deletion_requested')::boolean, false)
      AND u.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM agent_session_retracted_tasks retracted
        WHERE retracted.account_id = r.account_id AND retracted.task_id = t.id::text)
      AND contact_task_directory_available(t.account_id, t.state)
      AND (t.capture_id IS NULL OR EXISTS (
        SELECT 1 FROM captures c
        JOIN subjects s ON s.account_id = c.account_id AND s.id = c.subject_id
        JOIN assignments a ON a.account_id = c.account_id AND a.id = c.assignment_id
          AND a.subject_id = c.subject_id
        JOIN source_retention_receipts sr ON sr.account_id = c.account_id AND sr.capture_id = c.id
        WHERE c.account_id = t.account_id AND c.id = t.capture_id AND c.status = 'active'
          AND s.status = 'active' AND a.status = 'active'
          AND c.subject_id = t.subject_id AND c.assignment_id = t.assignment_id
          AND (c.retention_until IS NULL OR c.retention_until > statement_timestamp())
          AND sr.authorization_state = 'authorized'
          AND (sr.authorization_expires_at IS NULL OR sr.authorization_expires_at > statement_timestamp())
          AND (sr.retention_until IS NULL OR sr.retention_until > statement_timestamp())
          AND (sr.source_access_state = 'available'
            OR (sr.source_access_state = 'purged' AND sr.source_access_reason = 'review_completed'))))
    FROM product_runs r
    JOIN screenshot_contact_tasks t ON t.account_id = r.account_id AND t.id = r.task_id
    JOIN users u ON u.account_id = r.account_id AND u.id = r.user_id
    WHERE r.id = run_id), false)
$$;

-- A generation rebind still purges every raw field and every non-diagnostic
-- span. Only the strictly sanitized usage subset above may survive, and only
-- while the narrow admission above holds for the same canonical run.
CREATE OR REPLACE FUNCTION purge_product_run_prior_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_generation IS DISTINCT FROM OLD.source_generation THEN
    NEW.input := '{"status":"unavailable","original_bytes":0,"retained_bytes":0,"sha256":null}'::jsonb; NEW.output := NULL; NEW.objective := '';
    NEW.comment := ''; NEW.correction := ''; NEW.selected_text := '';
    NEW.sentiment := NULL; NEW.reasons := '[]'::jsonb; NEW.feedback_updated_at := NULL;
    UPDATE product_run_spans SET span=(span-'input'-'output'-'error'-'metadata') || jsonb_build_object(
      'input',jsonb_build_object('status','unavailable','original_bytes',0,'retained_bytes',0,'sha256',NULL),
      'output',jsonb_build_object('status','unavailable','original_bytes',0,'retained_bytes',0,'sha256',NULL),
      'metadata',COALESCE(CASE WHEN screenshot_usage_diagnostics_available(OLD.id)
        THEN screenshot_usage_diagnostic_metadata(span) END,'{}'::jsonb),
      'error',CASE WHEN span->>'error' IS NOT NULL THEN 'Operation failed' ELSE NULL END)
      WHERE run_id=OLD.id;
    UPDATE product_run_feedback_events SET output='null'::jsonb,comment='',correction='',selected_text=''
      WHERE run_id=OLD.id;
  END IF;
  RETURN NEW;
END $$;
