import { readRawPrimaryBackendSessionClaims, readPrimarySessionToken, backendAuthBaseUrl, type BackendSessionClaims } from "@/lib/server/backendAuth";
import { rebindTestWorkspaceParent } from "@/lib/server/testWorkspaceSession";
import { renewWebSession, readLegacyWebSession, legacyWebRenewalSecret } from "@/lib/server/web-persistent-session";
import { prepareWebEnrollment, retryWebRevocations, writeWebFamilyToken, writeWebLoginBarrier } from "@/lib/server/web-session-cookies";
import { isBackendSessionExpiredError } from "@/lib/backend-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (status: string, code: number) => Response.json({ status }, { status: code,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });

/** Only the exact family's cookie rolls; the shared Auth.js primary pointer
 * is owned by deliberate login. A delayed A response cannot overwrite B.
 * https://nextjs.org/docs/app/api-reference/functions/cookies */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const canonical = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : origin;
  if (request.headers.get("origin") !== canonical || request.headers.get("x-capri-session-renewal") !== "1" ||
      ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) return response("forbidden", 403);
  try {
    // Runs even after local logout, on a public page or browser restart.
    // These proofs have revoke-only use and never enter the login resolver.
    await retryWebRevocations();
    const token = await readPrimarySessionToken();
    const before = await readRawPrimaryBackendSessionClaims();
    if (!token || !before) return response("signed_out", 401);
    if (before.backendSessionId && !before.backendRenewalSecret) return response("native", 200);
    if (!before.backendRenewalSecret) {
      await prepareWebEnrollment();
      const original = await readLegacyWebSession(before);
      const loginAt = typeof token.backendLoginAt === "number" ? token.backendLoginAt : Number(token.iat ?? Math.floor(Date.now()/1000)) * 1000 + 1;
      if (!original.eligible) {
        await writeWebLoginBarrier({ ...token, backendLoginAt: loginAt });
        return response("authenticated", 200);
      }
      // Phase one is read-only at the backend. The browser must RECEIVE this
      // protected pending cookie before any enrollment can commit in phase two.
      const pending = { ...before, backendSessionId: original.session_id, backendRenewalSecret: legacyWebRenewalSecret(before),
        backendPendingEnrollment: true, backendLegacyAccessToken: before.backendAccessToken, backendLegacyExpiresAt: before.backendExpiresAt,
        backendExpiresAt: new Date(Math.min(Date.parse(original.expires_at), Date.parse(before.backendExpiresAt))).toISOString() };
      await writeWebFamilyToken({ ...token, ...pending, backendLoginAt: loginAt });
      await rebindTestWorkspaceParent(before, pending);
      return response("pending", 200);
    }
    const renewed = await renewWebSession(before);
    const live = await fetch(backendAuthBaseUrl() + "/v1/auth/session", { headers: { authorization: "Bearer " + renewed.backendAccessToken },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!live.ok) return response("unavailable", 503);
    const session = await live.json();
    if (session.account?.id !== before.backendAccountId || session.user?.id !== before.backendUserId ||
        (renewed.backendSessionId && session.session_id !== renewed.backendSessionId)) return response("unavailable", 503);
    if (renewed.backendRenewalSecret) {
      await writeWebFamilyToken({ ...token, ...renewed,
        backendLoginAt: typeof token.backendLoginAt === "number" ? token.backendLoginAt : Number(token.iat ?? Math.floor(Date.now()/1000)) * 1000 + 1 });
      await rebindTestWorkspaceParent(before, renewed as BackendSessionClaims);
    } else {
      await writeWebLoginBarrier({ ...token, backendLoginAt: typeof token.backendLoginAt === "number"
        ? token.backendLoginAt : Number(token.iat ?? Math.floor(Date.now()/1000)) * 1000 + 1 });
    }
    return response("authenticated", 200);
  } catch (error) {
    const revoked = isBackendSessionExpiredError(error);
    return response(revoked ? "revoked" : "unavailable", revoked ? 401 : 503);
  }
}
