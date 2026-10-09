-- Browser-owned macOS primary login (ADR 0022).
--
-- One generic first-party browser grant replaces the per-provider native
-- linking protocol. The grant is anonymous at preparation, bound to the exact
-- allowlisted Web origin, the immutable macos-primary-login purpose and a
-- fixed protocol version. State, PKCE challenge material and the cancellation
-- secret are stored hashed; the raw state/cancel secrets and the one-use code
-- never appear in this table. The grant moves prepared -> approved ->
-- consumed/cancelled exactly once, expires five minutes after preparation,
-- and its exchange code lives at most sixty seconds after approval. Only the
-- consume transition creates one ordinary, independently revocable device
-- session and records its session id here.

CREATE TABLE desktop_browser_login_attempts (
  id uuid PRIMARY KEY,
  protocol_version integer NOT NULL CHECK (protocol_version = 1),
  purpose text NOT NULL CHECK (purpose = 'macos-primary-login'),
  origin text NOT NULL CHECK (origin ~ '^https?://' AND length(origin) <= 200),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  challenge text NOT NULL CHECK (length(challenge) BETWEEN 32 AND 128),
  cancel_secret_hash text NOT NULL CHECK (cancel_secret_hash ~ '^[0-9a-f]{64}$'),
  code_hash text CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  matching_hint text NOT NULL CHECK (length(matching_hint) BETWEEN 4 AND 32),
  state text NOT NULL CHECK (state IN ('prepared','approved','consumed','cancelled')),
  account_id uuid,
  user_id uuid,
  -- The approving browser session; consume re-verifies it is still live.
  browser_session_id uuid,
  -- The one ordinary Mac device session this grant created, if it committed.
  device_session_id uuid,
  failed_proof_count integer NOT NULL DEFAULT 0 CHECK (failed_proof_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz NOT NULL,
  code_expires_at timestamptz,
  FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

-- A grant is bounded to five minutes from preparation, and an exchange code
-- can never outlive its grant or live longer than sixty seconds after the
-- approval that minted it.
ALTER TABLE desktop_browser_login_attempts
  ADD CONSTRAINT desktop_browser_login_grant_window_check
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  ADD CONSTRAINT desktop_browser_login_code_window_check
  CHECK (code_expires_at IS NULL
    OR (approved_at IS NOT NULL
        AND code_expires_at > approved_at
        AND code_expires_at <= approved_at + interval '60 seconds'
        AND code_expires_at <= expires_at));

-- State stands or falls with its bindings: a prepared grant holds no identity,
-- an approved grant holds exactly its minted code, and a consumed grant holds
-- exactly the device session it created. A cancelled grant never claims a
-- device session, and a consumed grant is never cancelled.
ALTER TABLE desktop_browser_login_attempts
  ADD CONSTRAINT desktop_browser_login_state_shape_check
  CHECK (
    (state = 'prepared'
      AND account_id IS NULL AND user_id IS NULL AND browser_session_id IS NULL
      AND approved_at IS NULL AND code_hash IS NULL AND code_expires_at IS NULL
      AND device_session_id IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (state = 'approved'
      AND account_id IS NOT NULL AND user_id IS NOT NULL AND browser_session_id IS NOT NULL
      AND approved_at IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL
      AND device_session_id IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (state = 'consumed'
      AND account_id IS NOT NULL AND user_id IS NOT NULL AND browser_session_id IS NOT NULL
      AND approved_at IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL
      AND device_session_id IS NOT NULL AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state = 'cancelled'
      AND device_session_id IS NULL AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
  );

-- One device session can be traced to at most one grant, and one grant can
-- commit at most one device session.
CREATE UNIQUE INDEX desktop_browser_login_device_session_idx
  ON desktop_browser_login_attempts(device_session_id)
  WHERE device_session_id IS NOT NULL;

CREATE INDEX desktop_browser_login_expiry_idx
  ON desktop_browser_login_attempts(expires_at)
  WHERE state IN ('prepared', 'approved');

-- Lab/account inventory cleanup membership: unknown tables fail closed, so
-- this grant history is classified as account-scoped and carries the Lab
-- write guard like every other account table.
INSERT INTO lab_test_workspace_table_manifest(table_name, scope) VALUES
  ('desktop_browser_login_attempts', 'account');

-- Retirement fences: identity-bearing grant rows can never be written against
-- a retired account (083 attached the common fence at its own migration time,
-- so this later table attaches the same fences explicitly).
CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON desktop_browser_login_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');

CREATE TRIGGER lab_test_workspace_write_guard BEFORE INSERT OR UPDATE ON desktop_browser_login_attempts
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
