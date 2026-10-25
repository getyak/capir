-- Mac device capabilities remain revocable through one canonical session.
-- Only hashes are retained. Access generations always keep their own expiry.
ALTER TABLE sessions
  ADD COLUMN previous_token_hash text,
  ADD COLUMN previous_token_expires_at timestamptz,
  ADD CONSTRAINT sessions_previous_token_shape CHECK (
    (previous_token_hash IS NULL AND previous_token_expires_at IS NULL)
    OR (previous_token_hash IS NOT NULL
        AND previous_token_hash ~ '^[0-9a-f]{64}$' AND previous_token_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT sessions_persistent_identity_unique UNIQUE (account_id, user_id, id);
CREATE INDEX sessions_previous_token_idx ON sessions(previous_token_hash)
  WHERE previous_token_hash IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE desktop_persistent_session_credentials (
  session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  origin text NOT NULL CHECK (origin ~ '^https?://' AND length(origin) <= 200),
  access_generation integer NOT NULL DEFAULT 0 CHECK (access_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id,user_id,session_id)
    REFERENCES sessions(account_id,user_id,id) ON DELETE CASCADE
);
INSERT INTO lab_test_workspace_table_manifest(table_name, scope) VALUES
  ('desktop_persistent_session_credentials','account');
CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON desktop_persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');
CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON desktop_persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();

CREATE FUNCTION preserve_desktop_persistent_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.session_id,NEW.account_id,NEW.user_id,NEW.credential_hash,NEW.origin)
     IS DISTINCT FROM ROW(OLD.session_id,OLD.account_id,OLD.user_id,OLD.credential_hash,OLD.origin) THEN
    RAISE EXCEPTION 'Desktop device identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER desktop_persistent_identity_immutable BEFORE UPDATE ON desktop_persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION preserve_desktop_persistent_identity();
