-- Ordinary Web/iOS login continuation. A capability is scoped to one canonical
-- real-user session; only its digest is stored. Access keeps its own deadline.
CREATE TABLE persistent_session_credentials (
  session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  client_kind text NOT NULL CHECK (client_kind IN ('web','ios')),
  access_generation integer NOT NULL DEFAULT 0 CHECK (access_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id,user_id,session_id)
    REFERENCES sessions(account_id,user_id,id) ON DELETE CASCADE
);
INSERT INTO lab_test_workspace_table_manifest(table_name, scope) VALUES
  ('persistent_session_credentials','account');
CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');
CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();

CREATE FUNCTION preserve_persistent_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.session_id,NEW.account_id,NEW.user_id,NEW.credential_hash,NEW.client_kind)
     IS DISTINCT FROM ROW(OLD.session_id,OLD.account_id,OLD.user_id,OLD.credential_hash,OLD.client_kind) THEN
    RAISE EXCEPTION 'Persistent login identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER persistent_session_identity_immutable BEFORE UPDATE ON persistent_session_credentials
  FOR EACH ROW EXECUTE FUNCTION preserve_persistent_session_identity();
