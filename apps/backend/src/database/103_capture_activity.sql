-- Per-Activity capabilities are encrypted and limited to one authenticated
-- owner, message and login. They never contain source or relationship content.
CREATE TABLE capture_activity_registrations (
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  message_id uuid NOT NULL,
  activity_instance_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  token_ciphertext text NOT NULL CHECK (length(token_ciphertext) <= 4096),
  token_hash text NOT NULL CHECK (length(token_hash) = 64),
  environment text NOT NULL CHECK (environment IN ('production','sandbox')),
  token_generation bigint NOT NULL CHECK (token_generation >= 1),
  registration_version bigint NOT NULL DEFAULT 1,
  delivery_sequence bigint NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  last_dispatched_at timestamptz,
  last_sent_revision bigint NOT NULL DEFAULT -1,
  last_phase text,
  terminal_since timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours',
  PRIMARY KEY (account_id, user_id, session_id, activity_instance_id),
  UNIQUE (token_hash),
  FOREIGN KEY (account_id, session_id) REFERENCES agent_sessions(account_id,id) ON DELETE CASCADE,
  FOREIGN KEY (account_id,user_id) REFERENCES users(account_id,id)
);
CREATE INDEX capture_activity_due_idx ON capture_activity_registrations(next_attempt_at,expires_at);
INSERT INTO lab_test_workspace_table_manifest(table_name,scope) VALUES ('capture_activity_registrations','account');
CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON capture_activity_registrations
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
