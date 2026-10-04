-- Cleanup observations are control-scope audit evidence: they survive Lab
-- product-data deletion and do not regrow its account-scoped audit_events.
-- The immutable frozen identity is captured before dispatch. A response fills
-- only the one open observation, independently of generation settlement CAS.
CREATE TABLE mcp_oauth_cleanup_effects (
  id uuid PRIMARY KEY,
  cleanup_id uuid NOT NULL REFERENCES mcp_oauth_cleanup(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  connect_request_id text NOT NULL,
  nango_connection_id text NOT NULL,
  provider text NOT NULL,
  broker_base_url text NOT NULL,
  environment text NOT NULL,
  target_origin text NOT NULL,
  generation_revision integer NOT NULL,
  claim_token uuid NOT NULL,
  outcome text NOT NULL DEFAULT 'dispatched'
    CHECK (outcome IN ('dispatched','confirmed','already_missing','accepted','forbidden','unconfirmed')),
  dispatched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observed_at timestamptz,
  CHECK ((outcome='dispatched' AND observed_at IS NULL) OR
         (outcome<>'dispatched' AND observed_at IS NOT NULL))
);
CREATE INDEX mcp_oauth_cleanup_effects_identity_idx
  ON mcp_oauth_cleanup_effects(cleanup_id, dispatched_at);
INSERT INTO lab_test_workspace_table_manifest(table_name, scope)
VALUES ('mcp_oauth_cleanup_effects', 'control');
