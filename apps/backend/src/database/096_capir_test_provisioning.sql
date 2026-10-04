-- Operator-owned test-account provisioning (capir test create, Task 1).
--
-- Control scope: the provisioning principal registry and the operation/run
-- records survive the isolated-account wipe as audit metadata. They contain no
-- secret material: operator credentials are high-entropy service keys stored
-- only as SHA-256 hashes, and replay compares the submitted password against
-- the account's existing salted scrypt credential.
--
-- Ownership lineage stays exclusive: a test workspace is owned either by the
-- existing human account/user pair or by exactly one provisioning principal,
-- and a Lab entry descends from either a human parent session or an operator
-- principal at its recorded generation. No ordinary human AuthContext is ever
-- fabricated for the operator flow.

CREATE TABLE capir_test_provisioners (
  id uuid PRIMARY KEY,
  label text NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 80),
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  state text NOT NULL DEFAULT 'enabled' CHECK (state IN ('enabled','revoked')),
  web_origin text NOT NULL CHECK (web_origin !~ '[[:space:]]' AND length(web_origin) <= 240),
  backend_origin text NOT NULL CHECK (backend_origin !~ '[[:space:]]' AND length(backend_origin) <= 240),
  max_active_runs integer NOT NULL DEFAULT 3 CHECK (max_active_runs BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((state = 'enabled' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL))
);

-- One row per provisioning operation, keyed by the caller's request ID. The
-- stored password credential lives with the account (password_credentials);
-- replay verifies the submitted password against that stored scrypt hash and
-- never rotates it. Account/user IDs are immutable audit references, not
-- foreign keys: the operation record must survive any account-graph wipe.
CREATE TABLE capir_test_runs (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  principal_id uuid NOT NULL REFERENCES capir_test_provisioners(id),
  principal_generation integer NOT NULL CHECK (principal_generation > 0),
  workspace_id uuid NOT NULL UNIQUE REFERENCES lab_test_workspaces(id),
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  username text NOT NULL,
  -- The exact optional username intent of the operation. NULL means the
  -- request omitted it; replay must repeat that exact omission.
  requested_username text,
  email text NOT NULL,
  preset text NOT NULL CHECK (preset IN ('daily','empty')),
  preset_version text NOT NULL CHECK (preset_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  preset_digest text NOT NULL CHECK (preset_digest ~ '^[a-f0-9]{64}$'),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  web_origin text NOT NULL CHECK (web_origin !~ '[[:space:]]' AND length(web_origin) <= 240),
  backend_origin text NOT NULL CHECK (backend_origin !~ '[[:space:]]' AND length(backend_origin) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, request_id)
);
CREATE INDEX capir_test_runs_principal ON capir_test_runs(principal_id, created_at DESC);

-- One-use Web handoffs. Only the secret hash is stored; the plaintext secret is
-- returned exactly once to the authenticated provisioning caller and travels to
-- the Web consumer over a private POST, never in a URL.
CREATE TABLE capir_test_handoffs (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES capir_test_runs(id),
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  web_origin text NOT NULL CHECK (web_origin !~ '[[:space:]]' AND length(web_origin) <= 240),
  backend_origin text NOT NULL CHECK (backend_origin !~ '[[:space:]]' AND length(backend_origin) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (run_id, request_id),
  FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id)
);

-- Classified before any test workspace can be created or cleaned under the
-- changed schema. Handoffs carry account data and are wiped with the account;
-- principal and run records are control-scope audit metadata.
INSERT INTO lab_test_workspace_table_manifest(table_name,scope) VALUES
 ('capir_test_provisioners','control'),('capir_test_runs','control'),
 ('capir_test_handoffs','account');
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['capir_test_handoffs'] LOOP
    EXECUTE format('CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'')',item);
    EXECUTE format('CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard()',item);
  END LOOP;
END $$;

-- Operator ownership for workspaces. Human owner FKs keep their meaning: a
-- NULL pair is legal only together with exactly one provisioning principal.
ALTER TABLE lab_test_workspaces ALTER COLUMN owner_account_id DROP NOT NULL;
ALTER TABLE lab_test_workspaces ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE lab_test_workspaces ADD COLUMN owner_principal_id uuid REFERENCES capir_test_provisioners(id);
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'lab_test_workspaces'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%owner_account_id <> target_account_id%' LOOP
    EXECUTE format('ALTER TABLE lab_test_workspaces DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
ALTER TABLE lab_test_workspaces ADD CONSTRAINT lab_test_workspaces_owner_lineage_check CHECK (
  ((owner_account_id IS NOT NULL AND owner_user_id IS NOT NULL AND owner_principal_id IS NULL)
    AND owner_account_id <> target_account_id)
  OR (owner_account_id IS NULL AND owner_user_id IS NULL AND owner_principal_id IS NOT NULL)
);

-- Operator entry lineage: exactly one of the human parent session or the
-- operator principal at its recorded generation.
ALTER TABLE lab_test_workspace_entries ALTER COLUMN owner_session_id DROP NOT NULL;
ALTER TABLE lab_test_workspace_entries ADD COLUMN owner_principal_id uuid REFERENCES capir_test_provisioners(id);
ALTER TABLE lab_test_workspace_entries ADD COLUMN principal_generation integer;
ALTER TABLE lab_test_workspace_entries ADD CONSTRAINT lab_test_workspace_entries_lineage_check CHECK (
  (owner_session_id IS NOT NULL AND owner_principal_id IS NULL AND principal_generation IS NULL)
  OR (owner_session_id IS NULL AND owner_principal_id IS NOT NULL
      AND principal_generation IS NOT NULL AND principal_generation > 0)
);
