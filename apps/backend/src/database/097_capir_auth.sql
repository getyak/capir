-- GET-139 browser-owned CLI authorization (`capir-auth.v2`).
--
-- Control scope: every token is opaque high-entropy material and only its
-- SHA-256 digest is stored; no raw access, refresh, code or verifier material
-- exists in this schema. Grants are bound to the real browser identity, the
-- exact configured backend/Web origin pair and the recorded scopes. A grant
-- owns exactly one independent canonical backing session whose generic session
-- token never leaves the backend: revoking that session immediately invalidates
-- the grant, while browser logout stays independent of CLI logout.
--
-- Refresh credentials rotate per family. A consumed refresh row is retained as
-- durable history; replay of a consumed token revokes the whole family inside
-- one committed transaction and can never be rolled back by a later failure.

CREATE TABLE capir_auth_grants (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- Independent canonical backing session (session-revocation liveness only).
  backing_session_id uuid NOT NULL UNIQUE REFERENCES sessions(id),
  client_label text NOT NULL CHECK (length(client_label) BETWEEN 1 AND 80),
  web_origin text NOT NULL CHECK (web_origin !~ '[[:space:]]' AND length(web_origin) <= 240),
  backend_origin text NOT NULL CHECK (backend_origin !~ '[[:space:]]' AND length(backend_origin) <= 240),
  scopes text[] NOT NULL CHECK (
    scopes <@ ARRAY['grants.read','grants.revoke','test.create','test.status','test.stop','test.handoff']
    AND cardinality(scopes) BETWEEN 1 AND 6),
  -- Entitlement generation observed when this grant's consent was minted. A
  -- revoke -> regrant bumps the registry generation, so authority derived
  -- under an older generation can never be resurrected by a dynamic
  -- state='active' check alone.
  test_entitlement_generation integer CHECK (test_entitlement_generation > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  -- Current opaque access credential, stored only as its SHA-256 digest and
  -- replaced wholesale by every refresh rotation.
  access_token_hash text UNIQUE CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  access_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN (
    'logout','refresh_replay','user_revoked','account_retired',
    'membership_revoked','backing_session_revoked')),
  FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id),
  CHECK ((state = 'active' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX capir_auth_grants_account ON capir_auth_grants(account_id, user_id, created_at DESC);

-- One-use authorization codes. The code exists only for the 60-second window
-- between a deliberate browser consent POST and the CLI exchange. State and
-- PKCE challenge are bound here; the verifier is never stored. A code is
-- consumed on its first exchange attempt and stays consumed on a bad proof or
-- replay (safe abuse policy).
CREATE TABLE capir_auth_codes (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  browser_session_id uuid NOT NULL REFERENCES sessions(id),
  web_origin text NOT NULL CHECK (web_origin !~ '[[:space:]]' AND length(web_origin) <= 240),
  backend_origin text NOT NULL CHECK (backend_origin !~ '[[:space:]]' AND length(backend_origin) <= 240),
  -- Literal loopback redirect with an ephemeral port; never a remote origin.
  redirect_uri text NOT NULL CHECK (redirect_uri ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}/capir/callback$'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  -- The exact scopes rendered for this consent, frozen at the click. Exchange
  -- mints exactly these; a later admin grant can never broaden what was shown.
  scopes text[] NOT NULL CHECK (
    scopes <@ ARRAY['grants.read','grants.revoke','test.create','test.status','test.stop','test.handoff']
    AND cardinality(scopes) BETWEEN 1 AND 6),
  client_label text NOT NULL CHECK (length(client_label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX capir_auth_codes_live ON capir_auth_codes(expires_at) WHERE consumed_at IS NULL;

-- Rotating refresh credentials, one row per generation. Consumed rows are the
-- durable family history: presenting a consumed token is replay and revokes
-- the entire family in a committed transaction.
CREATE TABLE capir_auth_refresh_tokens (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES capir_auth_grants(id),
  family_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  account_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Idle deadline, extended only by rotation; the absolute deadline never moves.
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (family_id, generation)
);
CREATE INDEX capir_auth_refresh_family ON capir_auth_refresh_tokens(family_id, generation);
CREATE INDEX capir_auth_refresh_grant ON capir_auth_refresh_tokens(grant_id, generation DESC);

-- Server-owned user test entitlement registry. Deny by default: no row means
-- no test scope, and only an explicit operator action can create one. Being
-- logged in or holding an admin role never implies an entitlement.
CREATE TABLE capir_user_test_entitlements (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- Bumped on every revoke -> regrant so previously derived test authority
  -- stays invalid instead of being silently revived.
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  scopes text[] NOT NULL CHECK (
    scopes <@ ARRAY['test.create','test.status','test.stop','test.handoff']
    AND cardinality(scopes) BETWEEN 1 AND 4),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  granted_by text NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text CHECK (length(revoke_reason) BETWEEN 1 AND 200),
  UNIQUE (account_id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id),
  CHECK ((state = 'active' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL))
);

-- Classified before any authorization or test data can be written under the
-- changed schema. Grant, code, refresh and entitlement records carry account
-- identity and are wiped with the account; the retirement fence blocks every
-- new write for a retired account so no authority can outlive retirement.
INSERT INTO lab_test_workspace_table_manifest(table_name,scope) VALUES
 ('capir_auth_grants','account'),('capir_auth_codes','account'),
 ('capir_auth_refresh_tokens','account'),('capir_user_test_entitlements','account');
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['capir_auth_grants','capir_auth_codes','capir_auth_refresh_tokens','capir_user_test_entitlements'] LOOP
    EXECUTE format('CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'')',item);
    EXECUTE format('CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard()',item);
  END LOOP;
END $$;

-- Explicit test-run ownership mapping. Operator provisioning keeps its
-- existing exclusive lineage; a user-grant run records its real requesting
-- user and the exact grant that authorized it, so revoking one grant disables
-- only its derived entries while cleanup keeps the audit metadata.
ALTER TABLE capir_test_runs ADD COLUMN owner_kind text NOT NULL DEFAULT 'operator'
  CHECK (owner_kind IN ('operator','user_grant'));
ALTER TABLE capir_test_runs ADD COLUMN owner_account_id uuid;
ALTER TABLE capir_test_runs ADD COLUMN owner_user_id uuid;
ALTER TABLE capir_test_runs ADD COLUMN owner_grant_id uuid;
ALTER TABLE capir_test_runs ADD CONSTRAINT capir_test_runs_owner_lineage_check CHECK (
  (owner_kind = 'operator' AND owner_account_id IS NULL AND owner_user_id IS NULL AND owner_grant_id IS NULL)
  OR (owner_kind = 'user_grant' AND owner_account_id IS NOT NULL AND owner_user_id IS NOT NULL
      AND owner_grant_id IS NOT NULL)
);
CREATE INDEX capir_test_runs_owner ON capir_test_runs(owner_account_id, owner_user_id, created_at DESC);

-- Each admitted entry descends from the grant that actually authorized that
-- admission (or the mapped owner's current live grant for direct password
-- admission), never from the run's original grant forever. The run keeps its
-- stable per-user owner so re-login can manage prior runs.
ALTER TABLE capir_test_handoffs ADD COLUMN authorizing_grant_id uuid;

-- Internal per-user provisioner mapping for user-grant runs. It exists only
-- with explicit real-user provenance; it has no credential and can never be
-- used as an operator credential or an ordinary AuthContext.
ALTER TABLE capir_test_provisioners ADD COLUMN source text NOT NULL DEFAULT 'operator'
  CHECK (source IN ('operator','user_grant'));
ALTER TABLE capir_test_provisioners ADD COLUMN owner_account_id uuid;
ALTER TABLE capir_test_provisioners ADD COLUMN owner_user_id uuid;
ALTER TABLE capir_test_provisioners ALTER COLUMN credential_hash DROP NOT NULL;
ALTER TABLE capir_test_provisioners ADD CONSTRAINT capir_test_provisioners_source_lineage_check CHECK (
  (source = 'operator' AND credential_hash IS NOT NULL AND owner_account_id IS NULL AND owner_user_id IS NULL)
  OR (source = 'user_grant' AND credential_hash IS NULL AND owner_account_id IS NOT NULL AND owner_user_id IS NOT NULL)
);
-- Control-plane owner UUIDs are immutable audit references. They must survive
-- account-graph deletion; creation holds the real user and account admission
-- locks, and retirement fences prevent new control writes afterwards.
-- Run owner columns are immutable audit references (no FK: they must survive
-- an account-graph wipe), but no write may ever land for a retired account.
DO $$ BEGIN
  EXECUTE format('CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON capir_test_provisioners FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''owner_account_id'')');
  EXECUTE format('CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON capir_test_runs FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'',''owner_account_id'')');
END $$;
CREATE UNIQUE INDEX capir_test_provisioners_user_owner
  ON capir_test_provisioners(owner_account_id, owner_user_id, web_origin, backend_origin) WHERE source = 'user_grant';

-- New Lab-issued MCP grants remain tied to the exact issuing entry. A later
-- login to the same test user cannot revive a revoked entry's bearer. Legacy
-- operator/human grants keep their existing compatibility path.
ALTER TABLE mcp_client_grants ADD COLUMN issuing_lab_session_id uuid;
