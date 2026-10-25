import "server-only";
import { createHmac } from "node:crypto";
import { authSecret, type BackendSessionClaims } from "./backendAuth";

/** Opaque non-authorizing exact-login binding. A Mac access generation may
 * rotate within the SAME canonical, independently revocable device session. */
export function contactHandoffSessionVersion(claims: BackendSessionClaims): string {
  return createHmac("sha256", authSecret()).update(JSON.stringify([
    "contact-image-handoff.v1", claims.backendAccountId, claims.backendUserId,
    ...(claims.backendSessionId
      ? ["persistent-macos.v1", claims.backendSessionId]
      : [claims.backendAccessToken, claims.backendExpiresAt]),
  ])).digest("hex");
}
