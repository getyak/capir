-- Negotiated persistent CLI grants. v2 clients and already expired/revoked
-- grants retain their finite deadlines; no migration revives old authority.
ALTER TABLE capir_auth_codes ADD COLUMN protocol_version text NOT NULL DEFAULT 'capir-auth.v2'
  CHECK (protocol_version IN ('capir-auth.v2','capir-auth.v3'));
ALTER TABLE capir_auth_grants ADD COLUMN protocol_version text NOT NULL DEFAULT 'capir-auth.v2'
  CHECK (protocol_version IN ('capir-auth.v2','capir-auth.v3'));
ALTER TABLE capir_auth_grants ALTER COLUMN absolute_expires_at DROP NOT NULL;
ALTER TABLE capir_auth_grants ADD CONSTRAINT capir_grant_deadline_protocol CHECK (
  (protocol_version='capir-auth.v2' AND absolute_expires_at IS NOT NULL) OR
  (protocol_version='capir-auth.v3' AND absolute_expires_at IS NULL));
ALTER TABLE capir_auth_refresh_tokens ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE capir_auth_refresh_tokens ALTER COLUMN absolute_expires_at DROP NOT NULL;
-- A refresh intent binds consumed history to one exact client transaction.
-- Only hashes are stored; successor credentials are HMAC-derived from the
-- presented predecessor secret and a domain-separated transaction identity.
ALTER TABLE capir_auth_refresh_tokens ADD COLUMN request_id_hash text
  CHECK (request_id_hash IS NULL OR request_id_hash ~ '^[a-f0-9]{64}$');
