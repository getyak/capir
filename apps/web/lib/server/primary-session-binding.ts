import "server-only";
import { createHash } from "node:crypto";
import type { BackendSessionClaims } from "./backendAuth";
type Identity = Pick<BackendSessionClaims, "backendAccessToken" | "backendAccountId" | "backendUserId" | "backendSessionId" | "backendLegacyAccessToken" | "backendLegacyExpiresAt">;

/** Exact primary-login fingerprint, independent of bounded access generation.
 * A server-verified canonical ID never grants authority by itself. */
export function primarySessionFingerprint(session: Identity): string {
  return createHash("sha256").update(session.backendLegacyAccessToken ?? (session.backendSessionId
    ? JSON.stringify(["primary-session.v1", session.backendAccountId, session.backendUserId, session.backendSessionId])
    : session.backendAccessToken)).digest("hex");
}

export function sessionBindingCredentials(session: BackendSessionClaims) {
  return session.backendLegacyAccessToken && session.backendLegacyExpiresAt
    ? { backendAccessToken: session.backendLegacyAccessToken, backendExpiresAt: session.backendLegacyExpiresAt, backendSessionId: undefined }
    : { backendAccessToken: session.backendAccessToken, backendExpiresAt: session.backendExpiresAt, backendSessionId: session.backendSessionId };
}
