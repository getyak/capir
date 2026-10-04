-- Durable Nango broker-cleanup ledger.
--
-- Local disconnect/replacement and Lab teardown stop local access, but Nango
-- still holds the OAuth credential until an authenticated DELETE confirms its
-- removal. This ledger keeps the server-bound cleanup identity (provider, the
-- exact Nango connection or frozen connect attempt, account/owner, environment
-- and frozen target) with no secret material, until external removal is
-- confirmed. A new authorization creates a new identity: cleanup only ever
-- targets its own frozen identity.
--
-- Classification: `control` scope, like the Lab control records themselves.
-- These are cleanup identities and receipts, not product data: they must
-- SURVIVE the Lab account wipe (which deletes account-scoped tables) so the
-- wipe cannot destroy the only outstanding broker-cleanup identity. Because
-- they survive by design and are written during teardown, they carry no
-- Lab write guard; nothing here grants product capability.
CREATE TABLE mcp_oauth_cleanup (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  lab_workspace_id uuid,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  -- The exact identity cleanup targets. For an attempt that never received a
  -- connection, the frozen server-generated connect_request_id identifies the
  -- only grant this ledger may ever clean.
  nango_connection_id text
    CHECK (nango_connection_id IS NULL OR char_length(nango_connection_id) BETWEEN 1 AND 200),
  connect_request_id text
    CHECK (connect_request_id IS NULL OR char_length(connect_request_id) BETWEEN 1 AND 120),
  environment text
    CHECK (environment IS NULL OR char_length(environment) BETWEEN 1 AND 80),
  target_origin text NOT NULL CHECK (char_length(target_origin) BETWEEN 1 AND 240),
  provenance text NOT NULL
    CHECK (provenance IN ('disconnect','endpoint_replaced','credential_replaced',
      'session_ended','lab_stop','late_grant','withdrawn')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','confirmed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  CHECK (nango_connection_id IS NOT NULL OR connect_request_id IS NOT NULL),
  CHECK ((state = 'confirmed' AND confirmed_at IS NOT NULL)
    OR (state IN ('pending','failed') AND confirmed_at IS NULL))
);
CREATE INDEX mcp_oauth_cleanup_pending_idx
  ON mcp_oauth_cleanup(account_id, created_at)
  WHERE state <> 'confirmed';
CREATE INDEX mcp_oauth_cleanup_attempt_idx
  ON mcp_oauth_cleanup(connect_request_id)
  WHERE connect_request_id IS NOT NULL AND nango_connection_id IS NULL;

INSERT INTO lab_test_workspace_table_manifest(table_name, scope)
VALUES ('mcp_oauth_cleanup','control');

-- Lab teardown keeps an honest external-pending count instead of claiming a
-- fully verified deletion while broker cleanup is unresolved.
ALTER TABLE lab_test_workspaces
  ADD COLUMN external_cleanup_pending integer NOT NULL DEFAULT 0
    CHECK (external_cleanup_pending BETWEEN 0 AND 1000);
