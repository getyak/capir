-- Durable continuation outbox for user-owned MCP human interactions.
--
-- A resolved human decision must re-enter the bound conversation exactly once
-- even across crashes, queue outages and process restarts. The continuation
-- intent is written in the SAME transaction that settles the request outcome,
-- and delivery uses the stored stable message id and idempotency key so the
-- ordinary queue's own idempotency makes re-delivery a no-op. Delivery state
-- is explicit: an unsent continuation is never labelled delivered, and a
-- delivered one is never re-executed.
CREATE TABLE mcp_continuation_outbox (
  account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  call_id uuid,
  session_id uuid NOT NULL,
  message_id uuid NOT NULL,
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  -- Host-only typed human-result provenance: the exact request/call identity,
  -- the original message, the acting human and the outcome. It travels with
  -- the queued continuation as host data and is never a user-authored claim.
  result_metadata jsonb
    CHECK (result_metadata IS NULL
      OR (jsonb_typeof(result_metadata) = 'object'
        AND octet_length(result_metadata::text) <= 4096)),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','delivered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, request_id),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  CHECK ((state = 'pending' AND delivered_at IS NULL)
    OR (state = 'delivered' AND delivered_at IS NOT NULL))
);
CREATE INDEX mcp_continuation_outbox_pending_idx
  ON mcp_continuation_outbox(account_id, created_at)
  WHERE state = 'pending';

-- The queued continuation carries the same host-owned typed result so the
-- persisted turn can render and store it as provenance instead of a synthetic
-- user message.
ALTER TABLE conversation_queue_entries
  ADD COLUMN host_result jsonb
    CHECK (host_result IS NULL
      OR (jsonb_typeof(host_result) = 'object'
        AND octet_length(host_result::text) <= 4096));

-- The stable identity of the connection being created/verified for a
-- connection-adding request. Crash recovery reconciles the recorded work with
-- this exact identity instead of creating a duplicate or retrying an effect.
ALTER TABLE mcp_interaction_requests
  ADD COLUMN work_connection_id uuid;

INSERT INTO lab_test_workspace_table_manifest(table_name, scope)
VALUES ('mcp_continuation_outbox','account');
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON mcp_continuation_outbox
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
