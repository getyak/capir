-- One immutable attempt for the existing canonical client intent. A lost owner
-- never creates a replacement model call. Exact private result bytes are TEXT,
-- not JSONB: the checkpoint checksum is over its original encoded bytes.
CREATE TABLE legacy_chat_executions (
  account_id uuid NOT NULL REFERENCES accounts(id),
  idempotency_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  request_message_id uuid,
  state text NOT NULL CHECK (state IN (
    'admitted','dispatch_started','result_ready','completed','cancelled',
    'expired','authority_lost','unknown','result_unavailable','content_unavailable')),
  owner_instance uuid NOT NULL,
  owner_generation bigint NOT NULL DEFAULT 1 CHECK (owner_generation > 0),
  owner_nonce uuid NOT NULL,
  original_proof jsonb,
  source_snapshot jsonb,
  frozen_provider jsonb,
  execution_deadline timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  dispatch_started_at timestamptz,
  checkpoint text,
  checkpoint_bytes integer,
  checkpoint_sha256 text,
  checkpoint_expires_at timestamptz,
  terminal_reason text CHECK (terminal_reason IN (
    'source_withdrawn','credential_lost','client_disconnected','expired',
    'lease_lost','checkpoint_invalid','operator_cancelled','commit_unknown')),
  completed_at timestamptz,
  content_retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id,idempotency_id),
  UNIQUE (account_id,task_id),
  UNIQUE (account_id,attempt_id),
  FOREIGN KEY (account_id,idempotency_id)
    REFERENCES idempotency_records(account_id,id),
  CHECK (lease_until <= execution_deadline),
  CHECK (execution_deadline > created_at
    AND execution_deadline <= created_at + interval '60 seconds'),
  CHECK (COALESCE(
    (frozen_provider IS NULL OR (
      jsonb_typeof(frozen_provider)='object'
      AND frozen_provider ?& ARRAY['providerID','model','configurationDigest']
      AND frozen_provider - ARRAY['providerID','model','configurationDigest']='{}'::jsonb
      AND frozen_provider->>'providerID'='deepseek-chat-completions'
      AND jsonb_typeof(frozen_provider->'model')='string'
      AND octet_length(frozen_provider->>'model') BETWEEN 1 AND 256
      AND (frozen_provider->'configurationDigest'='null'::jsonb OR (
        jsonb_typeof(frozen_provider->'configurationDigest')='string'
        AND frozen_provider->>'configurationDigest' ~ '^sha256:[a-f0-9]{64}$')))), false)),
  CHECK (COALESCE(
    CASE WHEN state IN ('admitted','dispatch_started','result_ready') THEN
      jsonb_typeof(original_proof)='object' AND octet_length(original_proof::text)<=16384
      AND jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=4096
      AND terminal_reason IS NULL AND completed_at IS NULL AND content_retired_at IS NULL
    ELSE original_proof IS NULL AND source_snapshot IS NULL END, false)),
  CHECK (COALESCE(
    CASE WHEN state='result_ready' THEN
      checkpoint IS NOT NULL AND checkpoint_bytes=octet_length(checkpoint)
      AND checkpoint_bytes BETWEEN 1 AND 1048576
      AND checkpoint_sha256 ~ '^[a-f0-9]{64}$'
      AND checkpoint_sha256=encode(sha256(convert_to(checkpoint,'UTF8')),'hex')
      AND checkpoint_expires_at IS NOT NULL
      AND checkpoint_expires_at<=execution_deadline
    ELSE checkpoint IS NULL AND checkpoint_bytes IS NULL
      AND checkpoint_sha256 IS NULL AND checkpoint_expires_at IS NULL END, false)),
  CHECK (state NOT IN ('dispatch_started','unknown') OR dispatch_started_at IS NOT NULL),
  CHECK (state<>'result_ready' OR frozen_provider IS NULL OR dispatch_started_at IS NOT NULL),
  CHECK (state<>'completed' OR completed_at IS NOT NULL),
  CHECK (state<>'content_unavailable' OR content_retired_at IS NOT NULL)
);
CREATE INDEX legacy_chat_executions_retirement
  ON legacy_chat_executions(execution_deadline,lease_until)
  WHERE state IN ('admitted','dispatch_started','result_ready');
INSERT INTO lab_test_workspace_table_manifest(table_name,scope)
  VALUES ('legacy_chat_executions','account');
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON legacy_chat_executions
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER account_retirement_fence
  BEFORE INSERT OR UPDATE ON legacy_chat_executions
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');
