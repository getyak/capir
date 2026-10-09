-- Broker-cleanup provenance and capability-watch correction (091 follow-up).
--
-- 091 recorded cleanup identity but could not prove identity ownership before
-- a destructive DELETE and could not represent the outstanding late-authorization
-- capability of a frozen Connect attempt. This migration freezes everything
-- needed for safe dispatch and honest lifecycle:
--   * the trusted broker base and environment actually used at creation time
--     (a changed deployment must never delete in a different environment);
--   * the actual returned Connect-session expiry as provenance (it is NOT a
--     closure proof: the pinned runtime does not validate the token TTL on an
--     already-started OAuth callback);
--   * a durable capability watch that outlives credential removal and is only
--     ever closed by source-backed closure (none is currently supported, so
--     watches stay open honestly);
--   * restart-safe retry scheduling with claims/leases instead of silently
--     abandoning a potentially late grant.
ALTER TABLE mcp_oauth_cleanup
  ADD COLUMN broker_base_url text
    CHECK (broker_base_url IS NULL OR char_length(broker_base_url) BETWEEN 1 AND 240),
  ADD COLUMN capability_expires_at timestamptz,
  ADD COLUMN closure_state text NOT NULL DEFAULT 'open'
    CHECK (closure_state IN ('open','closed')),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN claimed_until timestamptz,
  ALTER COLUMN attempts DROP DEFAULT,
  ALTER COLUMN attempts TYPE integer,
  DROP CONSTRAINT IF EXISTS mcp_oauth_cleanup_attempts_check;
ALTER TABLE mcp_oauth_cleanup
  ADD CONSTRAINT mcp_oauth_cleanup_attempts_check
    CHECK (attempts BETWEEN 0 AND 1000000);

-- One live identity per account: a Lab stop or a later transition merges into
-- the same outstanding record instead of dropping ownership of a pending
-- watch.
CREATE UNIQUE INDEX mcp_oauth_cleanup_live_identity_idx
  ON mcp_oauth_cleanup(
    account_id, coalesce(nango_connection_id, ''), coalesce(connect_request_id, '')
  )
  WHERE closure_state = 'open' OR state <> 'confirmed';

-- Frozen attempt provenance for OAuth connect attempts: the actual trusted
-- broker base/environment and the actual returned session expiry travel with
-- the attempt so cleanup can validate the full identity before any dispatch.
ALTER TABLE mcp_oauth_connect_requests
  ADD COLUMN environment text
    CHECK (environment IS NULL OR char_length(environment) BETWEEN 1 AND 80),
  ADD COLUMN broker_base_url text
    CHECK (broker_base_url IS NULL OR char_length(broker_base_url) BETWEEN 1 AND 240),
  ADD COLUMN capability_expires_at timestamptz;
