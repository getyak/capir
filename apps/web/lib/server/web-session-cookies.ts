import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { encode, decode, type JWT } from "next-auth/jwt";
import { authCookieSecure } from "@/lib/auth-cookie-policy";
import { authSecret, type BackendSessionClaims } from "./backendAuth";
import { WEB_SESSION_MAX_AGE, WebSessionUnavailableError, revokeWebSession, webSessionWasSignedOut } from "./web-persistent-session";

export const WEB_FAMILY_COOKIE_PREFIX = "talent-signal.web-family.";
export const WEB_REVOCATION_COOKIE_PREFIX = "talent-signal.web-revoke.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const MAX_PENDING_REVOCATIONS = 4;
const options = () => ({ httpOnly: true, sameSite: "lax" as const, secure: authCookieSecure(), path: "/", maxAge: WEB_SESSION_MAX_AGE });
export function boundedWebAvatar(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null; }
  catch { return null; }
}
const familyName = (id: string) => WEB_FAMILY_COOKIE_PREFIX + id.toLowerCase();
// Compact fields keep one family plus four bounded revocation receipts below
// normal request-header budgets. Secrets remain encrypted with Auth.js JWE.
function pack(token: JWT) {
  return [token.backendSessionId, token.backendRenewalSecret, token.backendAccountId, token.backendUserId,
    token.backendLoginAt, token.backendAccessToken, token.backendExpiresAt, token.backendAccountName,
    token.backendAccountSlug, token.backendRole, token.backendUsername, token.name, token.email, token.backendPendingEnrollment === true,
    boundedWebAvatar(token.picture),
    token.backendLegacyAccessToken ?? null, token.backendLegacyExpiresAt ?? null];
}
function unpack(value: unknown): JWT | null {
  if (!Array.isArray(value) || ![13,14,15,17].includes(value.length)) return null;
  const [sid, secret, account, user, at, access, expires, name, slug, role, username, display, email, pending, picture, legacyAccess, legacyExpires] = value;
  if (![sid, account, user].every(v => typeof v === "string" && UUID.test(v)) || typeof secret !== "string" || !SECRET.test(secret) ||
      typeof at !== "number" || !Number.isFinite(at) || at <= 0 || typeof access !== "string" || !access ||
      typeof expires !== "string" || !Number.isFinite(Date.parse(expires)) || typeof name !== "string" || typeof slug !== "string" ||
      !["admin", "member"].includes(role) || !(typeof username === "string" || username === null)) return null;
  return { sub: user, backendSessionId: sid, backendRenewalSecret: secret, backendAccountId: account, backendUserId: user,
    backendLoginAt: at, backendAccessToken: access, ...(pending === true ? { backendPendingEnrollment: true } : {}), backendExpiresAt: expires, backendAccountName: name,
    backendAccountSlug: slug, backendRole: role, backendUsername: username,
    ...(typeof display === "string" ? { name: display } : {}), ...(typeof email === "string" ? { email } : {}),
    ...(boundedWebAvatar(picture) ? { picture: boundedWebAvatar(picture)! } : {}),
    ...(typeof legacyAccess === "string" && legacyAccess.length <= 256 && typeof legacyExpires === "string" && Number.isFinite(Date.parse(legacyExpires))
      ? { backendLegacyAccessToken: legacyAccess, backendLegacyExpiresAt: legacyExpires } : {}) };
}
async function familyTokens(): Promise<Array<{ name: string; token: JWT }>> {
  const jar = await cookies();
  const entries = typeof jar.getAll === "function" ? jar.getAll() : [];
  const candidates = entries.filter(c => c.name.startsWith(WEB_FAMILY_COOKIE_PREFIX) && UUID.test(c.name.slice(WEB_FAMILY_COOKIE_PREFIX.length)));
  // A bounded count prevents an attacker-supplied cookie inventory creating
  // unbounded decrypt work. Never silently select an older subset.
  if (candidates.length > 16) throw new WebSessionUnavailableError();
  const values = await Promise.all(candidates.map(async cookie => {
    try {
      const decoded = await decode({ token: cookie.value, secret: authSecret(), salt: cookie.name });
      const barrier = decoded?.b;
      if (Array.isArray(barrier) && barrier.length === 2 && barrier[0] === cookie.name.slice(WEB_FAMILY_COOKIE_PREFIX.length) &&
          typeof barrier[1] === "number" && Number.isFinite(barrier[1]) && barrier[1] > 0) {
        return { name: cookie.name, token: { backendLoginAt: barrier[1], backendFamilyBarrier: true } as JWT };
      }
      const token = unpack(decoded?.w);
      if (!token || token.backendSessionId !== cookie.name.slice(WEB_FAMILY_COOKIE_PREFIX.length)) return null;
      return { name: cookie.name, token };
    } catch { return null; }
  }));
  return values.filter((v): v is { name: string; token: JWT } => v !== null);
}
export async function selectWebFamilyToken(primary: JWT | null): Promise<JWT | null> {
  const families = await familyTokens();
  const latest = families.sort((a,b) => Number(b.token.backendLoginAt) - Number(a.token.backendLoginAt) || a.name.localeCompare(b.name))[0]?.token;
  // Every fresh primary login sets an immutable barrier, including a bounded
  // Lab/default/Mac login. A stale family cannot replace a newer primary.
  const primaryAt = typeof primary?.backendLoginAt === "number" ? primary.backendLoginAt : Number(primary?.iat ?? 0) * 1000;
  const same = primary?.backendSessionId ? families.find(f => f.token.backendSessionId === primary.backendSessionId)?.token : undefined;
  const selected = latest && (!primary || Number(latest.backendLoginAt) > primaryAt)
    ? latest : same && Number(same.backendLoginAt) >= primaryAt ? same : primary;
  if (selected?.backendFamilyBarrier || (selected && await webSessionWasSignedOut(selected.backendSessionId))) return null;
  return selected;
}
export async function nextWebLoginAt(): Promise<number> {
  const known = await familyTokens();
  // Sequential logins in one browser remain ordered even if the server clock
  // steps backwards. The primary pointer breaks any concurrent equal-time tie.
  return Math.max(Date.now(), ...known.map(f => Number(f.token.backendLoginAt) + 1));
}
export async function writeWebLoginBarrier(token: JWT): Promise<void> {
  if (typeof token.backendLoginAt !== "number") throw new WebSessionUnavailableError();
  const raw = createHmac("sha256", authSecret()).update(JSON.stringify(["web-login-barrier.v1", token.backendLoginAt,
    token.backendAccessToken ?? token.sub ?? token.email ?? null])).digest("hex").slice(0,32);
  const id = `${raw.slice(0,8)}-${raw.slice(8,12)}-4${raw.slice(13,16)}-8${raw.slice(17,20)}-${raw.slice(20)}`;
  const name = familyName(id);
  const value = await encode({ token: { b: [id, token.backendLoginAt] }, secret: authSecret(), salt: name, maxAge: WEB_SESSION_MAX_AGE });
  const jar = await cookies();
  for (const old of await familyTokens()) if (Number(old.token.backendLoginAt) < token.backendLoginAt) jar.delete(old.name);
  jar.set(name, value, options());
}
export async function writeWebFamilyToken(token: JWT): Promise<void> {
  if (!unpack(pack(token))) throw new WebSessionUnavailableError();
  const jar = await cookies();
  const name = familyName(String(token.backendSessionId));
  const value = await encode({ token: { w: pack(token) }, secret: authSecret(), salt: name, maxAge: WEB_SESSION_MAX_AGE });
  if (value.length > 2400) throw new WebSessionUnavailableError();
  // Cleanup is ordered by verified immutable login time. An old in-flight A
  // renewal never deletes a newer B cookie, even if B was already in its jar.
  for (const other of await familyTokens()) {
    if (other.name !== name && Number(other.token.backendLoginAt) < Number(token.backendLoginAt)) jar.delete(other.name);
  }
  // Confirmed old revocations no longer need per-family local tombstones.
  // Pending journals retain their fence. A late old cookie still fails the
  // backend's canonical revocation and cannot outrank this newer family.
  for (const old of typeof jar.getAll === "function" ? jar.getAll() : []) {
    const prefix = "talent-signal.signed-out.";
    const id = old.name.startsWith(prefix) ? old.name.slice(prefix.length) : "";
    if (UUID.test(id) && id !== token.backendSessionId && !jar.get(journalName(id))) jar.delete(old.name);
  }
  jar.set(name, value, options());
}
function journalName(id: string) { return WEB_REVOCATION_COOKIE_PREFIX + id.toLowerCase(); }
export async function queueWebRevocation(claims: BackendSessionClaims): Promise<void> {
  if (!claims.backendRenewalSecret || !claims.backendSessionId) return;
  const name = journalName(claims.backendSessionId);
  const value = await encode({ token: { revoke: [claims.backendSessionId, claims.backendAccountId, claims.backendUserId, claims.backendRenewalSecret,
    ...(claims.backendPendingEnrollment ? [claims.backendAccessToken] : [])] },
    secret: authSecret(), salt: name, maxAge: WEB_SESSION_MAX_AGE });
  (await cookies()).set(name, value, options());
}
/** A journal is never selected as login authority, and retry never renews it. */
export async function retryWebRevocations(): Promise<number> {
  const jar = await cookies();
  const entries = (typeof jar.getAll === "function" ? jar.getAll() : []).filter(c => c.name.startsWith(WEB_REVOCATION_COOKIE_PREFIX));
  if (entries.length > 32) throw new WebSessionUnavailableError();
  const attempts = await Promise.all(entries.map(async entry => {
    try {
      const decoded = await decode({ token: entry.value, secret: authSecret(), salt: entry.name });
      const value = decoded?.revoke;
      if (!Array.isArray(value) || ![4,5].includes(value.length) || !value.slice(0,3).every(v => typeof v === "string" && UUID.test(v)) ||
          typeof value[3] !== "string" || !SECRET.test(value[3]) || entry.name !== journalName(value[0])) return false;
      const [sid, account, user, secret, originalAccess] = value;
      if (originalAccess !== undefined && (typeof originalAccess !== "string" || !SECRET.test(originalAccess))) throw new WebSessionUnavailableError();
      await revokeWebSession({ backendSessionId: sid, backendAccountId: account, backendUserId: user, backendRenewalSecret: secret,
        backendAccessToken: originalAccess ?? "", ...(originalAccess ? { backendPendingEnrollment: true } : {}), backendExpiresAt: "", backendAccountName: "", backendAccountSlug: "", backendRole: "member", backendUsername: null });
      jar.delete(entry.name);
      return false;
    } catch { return true; }
  }));
  return attempts.filter(Boolean).length;
}
export async function hasPendingWebRevocations(): Promise<boolean> {
  const jar = await cookies();
  const entries = (typeof jar.getAll === "function" ? jar.getAll() : []).filter(c => c.name.startsWith(WEB_REVOCATION_COOKIE_PREFIX));
  for (const entry of entries.slice(0,32)) {
    try {
      const decoded = await decode({ token: entry.value, secret: authSecret(), salt: entry.name });
      const proof = decoded?.revoke;
      if (Array.isArray(proof) && [4,5].includes(proof.length) && typeof proof[0] === "string" && UUID.test(proof[0]) &&
          entry.name === journalName(proof[0]) && typeof proof[3] === "string" && SECRET.test(proof[3])) return true;
    } catch { /* Unverified URL/cookie data never claims a pending sign-out. */ }
  }
  return false;
}
export class PendingWebRevocationsError extends WebSessionUnavailableError {
  readonly reason = "pending_revocations";
}
export async function prepareWebEnrollment(): Promise<void> {
  if (await retryWebRevocations() >= MAX_PENDING_REVOCATIONS) throw new PendingWebRevocationsError();
}
