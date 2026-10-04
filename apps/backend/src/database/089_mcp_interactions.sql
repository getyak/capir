-- User-owned MCP human interactions and guarded tool calls.
--
-- One durable request envelope covers approval, choice, form, secret and
-- oauth participation. Renderers own no authority: a card reloads the
-- canonical row here. The exact bound arguments, the original discovered
-- input schema hash and the connection revision are persisted so a stale or
-- cross-scope decision can never execute.
--
-- Secret values are never stored. A secret resolution is transient inside the
-- consuming transaction; only redacted displays, hashes and public receipts
-- are durable. `mcp_tool_calls` claims execution exactly once with a claim id
-- before any network effect, and an outcome that cannot be distinguished from
-- success after a send is recorded as 'outcome_unknown' with no retry.
CREATE TABLE mcp_interaction_requests (
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  call_id uuid NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('approval','choice','form','secret','oauth')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('waiting','pending','submitting','submitted','expired','rejected','failed','unknown')),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 1000),
  -- Exact target display plus stable connection identity; the server origin
  -- is derived from the stored connection and never trusted from a renderer.
  target jsonb NOT NULL
    CHECK (jsonb_typeof(target) = 'object' AND octet_length(target::text) <= 4096),
  arguments_display text NOT NULL
    CHECK (char_length(arguments_display) BETWEEN 1 AND 6000),
  -- The original bounded input schema as inert JSON text for validation and
  -- accessible forms. Never instructions and never authority.
  argument_schema text
    CHECK (argument_schema IS NULL OR char_length(argument_schema) BETWEEN 1 AND 20000),
  schema_unsupported_reason text
    CHECK (schema_unsupported_reason IS NULL OR char_length(schema_unsupported_reason) BETWEEN 1 AND 240),
  choices jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (
      CASE WHEN jsonb_typeof(choices) = 'array'
        THEN jsonb_array_length(choices) <= 40
          AND octet_length(choices::text) <= 16384
        ELSE false
      END
    ),
  oauth jsonb
    CHECK (oauth IS NULL OR (jsonb_typeof(oauth) = 'object' AND octet_length(oauth::text) <= 4096)),
  session_id uuid,
  message_id uuid,
  -- Exact arguments a single-use approval binds to. Redacted of secret-shaped
  -- values before persistence.
  bound_arguments text
    CHECK (bound_arguments IS NULL OR char_length(bound_arguments) BETWEEN 2 AND 20000),
  arguments_hash text
    CHECK (arguments_hash IS NULL OR arguments_hash ~ '^[a-f0-9]{64}$'),
  connection_id uuid,
  connection_revision integer CHECK (connection_revision IS NULL OR connection_revision > 0),
  schema_hash text CHECK (schema_hash IS NULL OR schema_hash ~ '^[a-f0-9]{64}$'),
  -- Redacted human resolution display (choice id or bounded form values).
  resolution_display text
    CHECK (resolution_display IS NULL OR char_length(resolution_display) BETWEEN 1 AND 6000),
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  CHECK (expires_at > created_at),
  CHECK ((state IN ('waiting','pending','submitting') AND resolved_at IS NULL)
    OR (state IN ('submitted','expired','rejected','failed','unknown') AND resolved_at IS NOT NULL))
);
CREATE INDEX mcp_interaction_requests_account_idx
  ON mcp_interaction_requests(account_id, created_at DESC, id);
CREATE INDEX mcp_interaction_requests_pending_idx
  ON mcp_interaction_requests(account_id, state, expires_at)
  WHERE state IN ('waiting','pending','submitting');
CREATE INDEX mcp_interaction_requests_session_idx
  ON mcp_interaction_requests(account_id, session_id, message_id);

CREATE TABLE mcp_tool_calls (
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  connection_id uuid,
  connection_revision integer NOT NULL CHECK (connection_revision > 0),
  tool_name text NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 128),
  arguments text NOT NULL CHECK (char_length(arguments) BETWEEN 2 AND 20000),
  arguments_hash text NOT NULL CHECK (arguments_hash ~ '^[a-f0-9]{64}$'),
  schema_hash text CHECK (schema_hash IS NULL OR schema_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','succeeded','failed','outcome_unknown')),
  claim_id uuid,
  claimed_at timestamptz,
  executed_at timestamptz,
  is_error boolean NOT NULL DEFAULT false,
  error_code text CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 80),
  result_summary text
    CHECK (result_summary IS NULL OR char_length(result_summary) BETWEEN 1 AND 4000),
  result_json text
    CHECK (result_json IS NULL OR char_length(result_json) BETWEEN 1 AND 24000),
  protocol_version text
    CHECK (protocol_version IS NULL OR char_length(protocol_version) BETWEEN 1 AND 40),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  FOREIGN KEY (account_id, request_id) REFERENCES mcp_interaction_requests(account_id, id),
  -- A settled outcome always carries its execution time. 'failed' may also
  -- settle before any claim when an approval is invalidated by a connection
  -- change and must never execute.
  CHECK ((state = 'pending' AND claim_id IS NULL AND claimed_at IS NULL)
    OR (state = 'claimed' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL)
    OR (state IN ('succeeded','failed','outcome_unknown') AND executed_at IS NOT NULL))
);
CREATE INDEX mcp_tool_calls_account_idx
  ON mcp_tool_calls(account_id, created_at DESC, id);
CREATE INDEX mcp_tool_calls_request_idx
  ON mcp_tool_calls(account_id, request_id);

-- Server-generated Nango connect sessions. The connect_request_id binds
-- account, user, session, approved MCP server URL and provider; an incoming
-- webhook is verified against this row and the authoritative backend metadata
-- readback. A client-supplied connection id is never authority.
CREATE TABLE mcp_oauth_connect_requests (
  connect_request_id text NOT NULL
    CHECK (char_length(connect_request_id) BETWEEN 8 AND 120),
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  session_id uuid,
  connection_id uuid,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  mcp_server_url text NOT NULL CHECK (char_length(mcp_server_url) BETWEEN 1 AND 2048),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','completed','failed','expired')),
  nango_connection_id text
    CHECK (nango_connection_id IS NULL OR char_length(nango_connection_id) BETWEEN 1 AND 200),
  -- Public connection metadata only. Never credentials or refresh tokens.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192),
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (connect_request_id),
  FOREIGN KEY (account_id, created_by_user_id) REFERENCES users(account_id, id),
  FOREIGN KEY (account_id, id) REFERENCES mcp_interaction_requests(account_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX mcp_oauth_connect_requests_account_idx
  ON mcp_oauth_connect_requests(account_id, created_at DESC, connect_request_id);
CREATE INDEX mcp_oauth_connect_requests_request_idx
  ON mcp_oauth_connect_requests(account_id, id);

-- Connection-level authorization mode. A credential or endpoint change bumps
-- `mcp_connections.revision`, which is what invalidates stale approvals; an
-- OAuth connection names its Nango connection and provider so calls can only
-- travel through the frozen Nango proxy target.
ALTER TABLE mcp_connections
  ADD COLUMN auth_mode text NOT NULL DEFAULT 'anonymous'
    CHECK (auth_mode IN ('anonymous','bearer','oauth'));
UPDATE mcp_connections SET auth_mode = 'bearer' WHERE credential_ciphertext IS NOT NULL;
ALTER TABLE mcp_connections
  ADD COLUMN nango_connection_id text
    CHECK (nango_connection_id IS NULL OR char_length(nango_connection_id) BETWEEN 1 AND 200),
  ADD COLUMN nango_provider text
    CHECK (nango_provider IS NULL OR char_length(nango_provider) BETWEEN 1 AND 80),
  ADD CONSTRAINT mcp_connections_oauth_binding_check
    CHECK ((auth_mode = 'oauth') = (nango_connection_id IS NOT NULL));

INSERT INTO lab_test_workspace_table_manifest(table_name, scope)
VALUES
  ('mcp_interaction_requests','account'),
  ('mcp_tool_calls','account'),
  ('mcp_oauth_connect_requests','account');
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON mcp_interaction_requests
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON mcp_tool_calls
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON mcp_oauth_connect_requests
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
