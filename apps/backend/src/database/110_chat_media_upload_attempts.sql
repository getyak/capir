-- A committed attempt fences deletion before bytes can leave this process.
-- Unknown remote outcomes never become idle merely because a lease expires.
ALTER TABLE chat_media_assets
  ADD COLUMN upload_state text NOT NULL DEFAULT 'idle'
    CHECK (upload_state IN ('idle', 'writing', 'unknown')),
  ADD COLUMN upload_attempt_id uuid,
  ADD COLUMN upload_started_at timestamptz,
  ADD COLUMN upload_storage_scope text,
  ADD COLUMN upload_settlement_receipt text;
ALTER TABLE chat_media_assets ADD CONSTRAINT chat_media_upload_attempt_present
  CHECK (upload_state = 'idle' OR
    (upload_attempt_id IS NOT NULL AND upload_started_at IS NOT NULL));
CREATE INDEX chat_media_unsettled_uploads
  ON chat_media_assets(account_id, upload_started_at) WHERE upload_state <> 'idle';
ALTER TABLE lab_test_workspace_media_writes ADD COLUMN settlement_receipt text;
