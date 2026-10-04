-- Follow-up: preserve complete endpoints and invalidate stale cleanup claims.
-- DELETE /connect/session is supported, but an already-inflight callback may
-- have read the session before deletion. Capability watches remain open.
ALTER TABLE mcp_oauth_cleanup
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN claim_token uuid,
  DROP CONSTRAINT mcp_oauth_cleanup_target_origin_check,
  ADD CONSTRAINT mcp_oauth_cleanup_target_origin_check
    CHECK (char_length(target_origin) BETWEEN 1 AND 2048);
-- Collapse historical duplicate rows for one frozen attempt. The watch scans
-- every owned connection in this generation, rather than only the last ID.
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY account_id, connect_request_id
    ORDER BY created_at, id) AS keeper,
    first_value(lab_workspace_id) OVER (PARTITION BY account_id, connect_request_id
    ORDER BY (lab_workspace_id IS NULL), created_at, id) AS lab_id
  FROM mcp_oauth_cleanup WHERE connect_request_id IS NOT NULL
), labs AS (
  UPDATE mcp_oauth_cleanup c SET lab_workspace_id=r.lab_id,
    state='pending', confirmed_at=NULL, closure_state='open', next_attempt_at=clock_timestamp()
  FROM ranked r WHERE c.id=r.keeper AND r.id=r.keeper RETURNING c.id
)
DELETE FROM mcp_oauth_cleanup c USING ranked r WHERE c.id=r.id AND r.id<>r.keeper;
CREATE UNIQUE INDEX mcp_oauth_cleanup_generation_idx
  ON mcp_oauth_cleanup(account_id, connect_request_id)
  WHERE connect_request_id IS NOT NULL;
