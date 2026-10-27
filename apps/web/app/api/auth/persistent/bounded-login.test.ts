import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decode, encode, type JWT } from "next-auth/jwt";
import type { SessionResponse } from "@talent-signal/contracts";

const browser = vi.hoisted(() => ({ jar: new Map<string, string>(), writes: new Set<string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: [...browser.jar].map(([name, value]) => `${name}=${value}`).join("; ") }),
  cookies: async () => ({
    get: (name: string) => browser.jar.has(name) ? { name, value: browser.jar.get(name)! } : undefined,
    getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { browser.jar.set(name, value); browser.writes.add(name); },
    delete: (name: string) => { browser.jar.delete(name); browser.writes.add(name); },
  }),
}));

import { POST } from "./route";
import { AUTH_SESSION_COOKIE, readPrimarySessionToken, readRawPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";
import { selectWebFamilyToken, WEB_FAMILY_COOKIE_PREFIX, writeWebFamilyToken } from "@/lib/server/web-session-cookies";

const start = Date.parse("2030-01-02T12:34:56.000Z");
const boundedExpiry = "2030-01-02T16:34:56.000Z";
const secret = "synthetic-bounded-login-auth-secret";
const account = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const sid = "33333333-3333-4333-8333-333333333333";
const olderSid = "44444444-4444-4444-8444-444444444444";
const claims = {
  backendAccessToken: "bounded-access", backendAccountId: account, backendUserId: user,
  backendAccountName: "Bounded account", backendAccountSlug: "bounded-account",
  backendRole: "member" as const, backendUsername: null, backendExpiresAt: boundedExpiry,
};
const session = (kind: SessionResponse["user"]["kind"]): SessionResponse & { session_id: string } => ({
  contract_version: "2026-08-24.10", session_id: sid, access_token: claims.backendAccessToken, expires_at: boundedExpiry,
  account: { id: account, name: claims.backendAccountName, slug: claims.backendAccountSlug },
  user: { id: user, display_name: "Bounded member", email: "bounded@example.invalid", username: null, role: "member", kind },
});
const heartbeat = () => new Request("https://web.test/api/auth/persistent", {
  method: "POST", headers: { origin: "https://web.test", "x-capri-session-renewal": "1", "sec-fetch-site": "same-origin" },
});
async function installPrimary(extra: JWT = {}) {
  const value = await encode({ token: { ...claims, sub: user, ...extra }, secret, salt: AUTH_SESSION_COOKIE, maxAge: 4 * 3600 });
  browser.jar.set(AUTH_SESSION_COOKIE, value);
  return { value, token: (await decode({ token: value, secret, salt: AUTH_SESSION_COOKIE }))! };
}

beforeEach(() => {
  browser.jar.clear(); browser.writes.clear();
  vi.useFakeTimers(); vi.setSystemTime(start);
  vi.stubEnv("AUTH_SECRET", secret); vi.stubEnv("AUTH_URL", "https://web.test");
  vi.stubEnv("TALENT_SIGNAL_BACKEND_URL", "http://127.0.0.1:4317");
  // Keep the real legacy eligibility validator; only its HTTP transport is synthetic.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url !== "http://127.0.0.1:4317/v1/auth/session") throw new Error("Unexpected backend write");
    return Response.json(session("lab_human"));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
  { name: "the signed primary iat fallback", extra: {}, loginAt: start },
  { name: "an existing immutable backendLoginAt", extra: { backendLoginAt: start - 7 }, loginAt: start - 7 },
])("keeps a bounded login at $name across repeated heartbeats without extending authority", async ({ extra, loginAt }) => {
  await writeWebFamilyToken({ ...claims, backendAccessToken: "older-login-access", backendSessionId: olderSid,
    backendRenewalSecret: "s".repeat(43), backendLoginAt: start - 2000 });
  const olderName = WEB_FAMILY_COOKIE_PREFIX + olderSid;
  const lateOlderCookie = browser.jar.get(olderName)!;
  const primary = await installPrimary(extra);
  expect(await readPrimarySessionToken()).toEqual(primary.token);
  browser.writes.clear();

  for (let heartbeatIndex = 0; heartbeatIndex < 3; heartbeatIndex += 1) {
    vi.setSystemTime(start + heartbeatIndex * 60_000);
    const response = await POST(heartbeat());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "authenticated" });
    expect(await readPrimarySessionToken()).toEqual(primary.token);
    expect(await readRawPrimaryBackendSessionClaims()).toEqual(claims);
    expect(browser.jar.get(AUTH_SESSION_COOKIE)).toBe(primary.value);
    expect(browser.writes.has(AUTH_SESSION_COOKIE)).toBe(false);
    const familyCookies = [...browser.jar].filter(([name]) => name.startsWith(WEB_FAMILY_COOKIE_PREFIX));
    expect(familyCookies).toHaveLength(1);
    const [name, value] = familyCookies[0];
    const barrier = await decode({ token: value, secret, salt: name });
    expect(barrier?.b).toEqual([name.slice(WEB_FAMILY_COOKIE_PREFIX.length), loginAt]);
    expect(barrier?.w).toBeUndefined();
  }

  // A delayed older family cannot revive when the bounded primary disappears.
  browser.jar.set(olderName, lateOlderCookie);
  expect(await selectWebFamilyToken(primary.token)).toEqual(primary.token);
  browser.jar.delete(AUTH_SESSION_COOKIE);
  expect(await readPrimarySessionToken()).toBeNull();
  expect(await selectWebFamilyToken(null)).toBeNull();
  expect((await POST(heartbeat())).status).toBe(401);

  // Restoring the exact unchanged primary cannot extend its signed deadline.
  browser.jar.set(AUTH_SESSION_COOKIE, primary.value);
  vi.setSystemTime(start + 4 * 3600_000 + 60_000);
  await expect(decode({ token: primary.value, secret, salt: AUTH_SESSION_COOKIE })).rejects.toThrow();
  expect(await readPrimarySessionToken()).toBeNull();
});

it("lets eligible legacy pending enrollment outrank an iat-only primary by one millisecond", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url !== "http://127.0.0.1:4317/v1/auth/session") throw new Error("Enrollment committed before its pending cookie was delivered");
    return Response.json(session("password_human"));
  }));
  const primary = await installPrimary();
  const response = await POST(heartbeat());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "pending" });
  const selected = await readPrimarySessionToken();
  expect(selected).toMatchObject({ ...claims, backendSessionId: sid, backendPendingEnrollment: true, backendLoginAt: start + 1 });
  expect(selected?.backendRenewalSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(browser.jar.get(AUTH_SESSION_COOKIE)).toBe(primary.value);
  expect(browser.writes.has(AUTH_SESSION_COOKIE)).toBe(false);
});
