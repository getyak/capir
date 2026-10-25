import { REAL_USER_KINDS } from "./accountIdentity.js";

/** Retention only, for queries aliasing the canonical sessions table as `s`.
 * A short access deadline does not end a revocable first-party login family.
 * This predicate neither authenticates requests nor extends any Lab lease.
 * CLI/MCP grants are separate scoped authority, not normal Lab-route sessions.
 */
export const retainsRenewableSessionReplaySQL = `(s.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM accounts a JOIN users u ON u.account_id=a.id
    WHERE a.id=s.account_id AND a.retired_at IS NULL AND u.id=s.user_id
      AND u.status='active' AND u.kind IN (${REAL_USER_KINDS.map(kind => `'${kind}'`).join(", ")})
  ) AND (
    EXISTS (SELECT 1 FROM persistent_session_credentials p
      WHERE p.session_id=s.id AND p.account_id=s.account_id AND p.user_id=s.user_id)
    OR EXISTS (SELECT 1 FROM desktop_persistent_session_credentials d
      WHERE d.session_id=s.id AND d.account_id=s.account_id AND d.user_id=s.user_id)
  ))`;
