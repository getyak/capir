import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authCookieSecure } from "@/lib/auth-cookie-policy";
import type { SessionResponse } from "@talent-signal/contracts";
import { BackendSessionExpiredError } from "@/lib/backend-session";
import { authSecret, backendAuthBaseUrl, type BackendSessionClaims } from "./backendAuth";

/** Browser storage has a finite cookie limit; active use rolls this deadline.
 * The backend renewal capability itself has no idle or absolute deadline. */
export const WEB_SESSION_MAX_AGE = 400 * 24 * 60 * 60;
export type RenewableWebClaims = BackendSessionClaims & { backendRenewalSecret?: string; backendPendingEnrollment?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export class WebSessionUnavailableError extends Error {
  readonly status = 503;
  readonly code = "session_temporarily_unavailable";
  constructor() { super("The session service is temporarily unavailable. Retry without signing out."); this.name = "WebSessionUnavailableError"; }
}
export function isWebSessionUnavailable(error: unknown): boolean {
  return error instanceof WebSessionUnavailableError || (typeof error === "object" && error !== null && "code" in error && error.code === "session_temporarily_unavailable");
}
class IneligibleSessionError extends Error {}

async function request(action: "enroll" | "renew" | "revoke", body: unknown, access?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(backendAuthBaseUrl() + "/v1/auth/persistent/" + action, {
      method: "POST", headers: { "content-type": "application/json", ...(access ? { authorization: "Bearer " + access } : {}) },
      body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
  } catch { throw new WebSessionUnavailableError(); }
  let value: unknown;
  try {
    const raw = await response.text();
    if (raw.length > 65_536) throw new Error("oversized response");
    value = JSON.parse(raw);
  } catch { throw new WebSessionUnavailableError(); }
  if (!response.ok) {
    const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
    if (response.status === 401 && code === "PERSISTENT_SESSION_REVOKED") throw new BackendSessionExpiredError();
    if (response.status === 403 && code === "PERSISTENT_SESSION_INELIGIBLE") {
      if (action === "enroll") throw new IneligibleSessionError();
      throw new BackendSessionExpiredError();
    }
    throw new WebSessionUnavailableError();
  }
  return value;
}
function fromSession(value: unknown, original: BackendSessionClaims, secret: string): RenewableWebClaims {
  const session = value as SessionResponse & { session_id: string };
  if (!session || !UUID.test(session.session_id ?? "") ||
      typeof session.access_token !== "string" || !session.access_token || session.access_token.length > 256 ||
      session.account?.id !== original.backendAccountId || session.user?.id !== original.backendUserId ||
      (original.backendSessionId && session.session_id !== original.backendSessionId) ||
      !(Date.parse(session.expires_at) > Date.now()) ||
      typeof session.account.name !== "string" || typeof session.account.slug !== "string" ||
      !["admin", "member"].includes(session.user.role)) throw new WebSessionUnavailableError();
  return { backendAccessToken: session.access_token, backendAccountId: session.account.id,
    backendAccountName: session.account.name, backendAccountSlug: session.account.slug,
    backendExpiresAt: session.expires_at, backendPendingEnrollment: false, backendRole: session.user.role, backendUserId: session.user.id,
    backendUsername: session.user.username ?? null, backendSessionId: session.session_id, backendRenewalSecret: secret,
    ...(original.backendLegacyAccessToken && original.backendLegacyExpiresAt ? {
      backendLegacyAccessToken: original.backendLegacyAccessToken, backendLegacyExpiresAt: original.backendLegacyExpiresAt } : {}) };
}
function proof(claims: RenewableWebClaims) {
  if (!SECRET.test(claims.backendRenewalSecret ?? "") || !UUID.test(claims.backendSessionId ?? "")) throw new WebSessionUnavailableError();
  return { renewal_secret: claims.backendRenewalSecret!, account_id: claims.backendAccountId,
    user_id: claims.backendUserId, session_id: claims.backendSessionId! };
}
export function legacyWebRenewalSecret(claims: BackendSessionClaims): string {
  return createHmac("sha256", authSecret()).update(JSON.stringify([
    "web-persistent-legacy-enrollment.v1", backendAuthBaseUrl(), claims.backendAccountId,
    claims.backendUserId, claims.backendAccessToken,
  ])).digest("base64url");
}
export async function enrollWebSession(claims: BackendSessionClaims, legacy = false, preparedSecret?: string): Promise<RenewableWebClaims> {
  if (!(Date.parse(claims.backendExpiresAt) > Date.now())) throw new BackendSessionExpiredError();
  // Existing Mac sessions keep their native-only proof and independent vault.
  if (claims.backendSessionId && !preparedSecret) return claims;
  if (preparedSecret && !SECRET.test(preparedSecret)) throw new WebSessionUnavailableError();
  const secret = preparedSecret ?? (legacy ? legacyWebRenewalSecret(claims) : randomBytes(32).toString("base64url"));
  try {
    return fromSession(await request("enroll", { renewal_secret: secret, client_kind: "web" }, claims.backendAccessToken), claims, secret);
  } catch (error) {
    // Temporary Lab/run/test identities deliberately retain their own deadline.
    if (error instanceof IneligibleSessionError) {
      if (preparedSecret) throw new BackendSessionExpiredError();
      return claims;
    }
    throw error;
  }
}

// This is only in-flight coalescing. Canonical DB locking owns correctness
// across tabs, SSR requests and multiple Web processes; never cache authority.
const renewals = new Map<string, Promise<RenewableWebClaims>>();
export async function renewWebSession(claims: RenewableWebClaims): Promise<RenewableWebClaims> {
  if (!claims.backendRenewalSecret) return claims;
  const body = proof(claims);
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const pending = renewals.get(key);
  if (pending) return pending;
  const operation = (async () => {
    try { return fromSession(await request("renew", body), claims, body.renewal_secret); }
    catch (error) {
      if (!(error instanceof BackendSessionExpiredError) || !claims.backendPendingEnrollment ||
          !(Date.parse(claims.backendExpiresAt) > Date.now())) throw error;
      // Pending proof was durably installed by a PREVIOUS HTTP response. Only
      // a still-live exact original session may complete first enrollment.
      const live = await readLegacyWebSession(claims);
      if (live.session_id !== claims.backendSessionId || !live.eligible) throw new BackendSessionExpiredError();
      return enrollWebSession(claims, true, body.renewal_secret);
    }
  })();
  renewals.set(key, operation);
  try { return await operation; }
  finally { if (renewals.get(key) === operation) renewals.delete(key); }
}
export async function readLegacyWebSession(claims: BackendSessionClaims): Promise<{ session_id: string; expires_at: string; eligible: boolean }> {
  if (!(Date.parse(claims.backendExpiresAt) > Date.now())) throw new BackendSessionExpiredError();
  let response: Response;
  try { response = await fetch(backendAuthBaseUrl() + "/v1/auth/session", { headers: { authorization: "Bearer " + claims.backendAccessToken },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) }); }
  catch { throw new WebSessionUnavailableError(); }
  let session: (SessionResponse & { session_id: string }) | { error?: { code?: string } };
  try { session = await response.json(); } catch { throw new WebSessionUnavailableError(); }
  if (!session || typeof session !== "object") throw new WebSessionUnavailableError();
  if (!response.ok) {
    const code = "error" in session ? session.error?.code : undefined;
    if (response.status === 401 && ["SESSION_INVALID", "SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(code ?? "")) throw new BackendSessionExpiredError();
    throw new WebSessionUnavailableError();
  }
  const value = session as SessionResponse & { session_id: string };
  if (!UUID.test(value.session_id ?? "") || value.account?.id !== claims.backendAccountId || value.user?.id !== claims.backendUserId ||
      !(Date.parse(value.expires_at) > Date.now())) throw new WebSessionUnavailableError();
  return { session_id: value.session_id, expires_at: value.expires_at,
    eligible: ["password_human", "google_human", "apple_human"].includes(value.user.kind) };
}
export async function revokeWebSession(claims: RenewableWebClaims): Promise<void> {
  if (!claims.backendRenewalSecret) return;
  try {
    const body = proof(claims);
    if (claims.backendPendingEnrollment && !SECRET.test(claims.backendAccessToken)) throw new WebSessionUnavailableError();
    // The backend locks the exact canonical session before testing either
    // proof. An expired original token can only authorize destructive revoke,
    // closing logout racing an enrollment whose commit is still in flight.
    const result = await request("revoke", { ...body, ...(claims.backendPendingEnrollment
      ? { original_access_token: claims.backendAccessToken } : {}) }) as { revoked?: unknown };
    if (result?.revoked !== true) throw new WebSessionUnavailableError();
  } catch (error) {
    if (!(error instanceof BackendSessionExpiredError)) throw error;
  }
}


const signedOutCookie = (id: string) => "talent-signal.signed-out." + id.toLowerCase();
export async function webSessionWasSignedOut(id: unknown): Promise<boolean> {
  return typeof id === "string" && UUID.test(id) && Boolean((await cookies()).get(signedOutCookie(id))?.value);
}
export async function markWebSessionSignedOut(id: string): Promise<void> {
  if (!UUID.test(id)) return;
  // This independent tombstone is never written by renewal. Even during a
  // backend outage a late Set-Cookie cannot revive an explicitly signed-out
  // family. A fresh login has a different canonical ID.
  (await cookies()).set(signedOutCookie(id), "1", { httpOnly: true, sameSite: "lax", secure: authCookieSecure(),
    path: "/", maxAge: WEB_SESSION_MAX_AGE });
}
