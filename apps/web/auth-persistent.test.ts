import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxHeaderSize } from "node:http";
import { encode, decode } from "next-auth/jwt";
import { NextRequest } from "next/server";
type Context = { token: Record<string,unknown> | null; jar: Map<string,string>; writes: Map<string,string|null> };
const fixture = vi.hoisted(() => ({ config: undefined as unknown, context: undefined as AsyncLocalStorage<Context> | undefined,
  fallback: { token: null, jar: new Map(), writes: new Map() } as Context, signIn: vi.fn(), oauth: vi.fn() }));
vi.mock("next-auth", () => {
  class AuthError extends Error {} class CredentialsSignin extends AuthError { code = "credentials"; }
  return { default: (config: unknown) => { fixture.config = config; return { handlers: { GET: vi.fn() }, auth: vi.fn(), signIn: fixture.signIn, signOut: vi.fn() }; }, AuthError, CredentialsSignin };
});
vi.mock("next-auth/jwt", async original => {
  const implementation = await original<typeof import("next-auth/jwt")>();
  return { ...implementation, getToken: async (options: Parameters<typeof implementation.getToken>[0]) => {
    const context = fixture.context?.getStore() ?? fixture.fallback;
    if (context.token) return context.token;
    const headers = new Headers({ cookie: [...context.jar].map(([name,value]) => `${name}=${value}`).join("; ") });
    return implementation.getToken({ ...options, req: { headers } });
  } };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://web.test" }), cookies: async () => {
  const context = fixture.context?.getStore() ?? fixture.fallback;
  return { get: (name: string) => context.jar.has(name) ? { name, value: context.jar.get(name)! } : undefined,
    getAll: () => [...context.jar].map(([name,value]) => ({name,value})),
    set: (name: string, value: string) => { context.jar.set(name,value); context.writes.set(name,value); },
    delete: (name: string) => { context.jar.delete(name); context.writes.set(name,null); } };
} }));
vi.mock("@/lib/server/google-session", () => ({ finishGoogleSignIn: fixture.oauth }));
vi.mock("@/lib/server/apple-session", () => ({ finishAppleSignIn: fixture.oauth }));
import { auth, handlers, buildAuthConfig } from "./auth";
import { POST } from "./app/api/auth/persistent/route";
import { readPrimaryBackendSessionClaims, AUTH_SESSION_COOKIE } from "./lib/server/backendAuth";
import { markWebSessionSignedOut } from "./lib/server/web-persistent-session";
import { queueWebRevocation, WEB_FAMILY_COOKIE_PREFIX, WEB_REVOCATION_COOKIE_PREFIX, writeWebFamilyToken, writeWebLoginBarrier } from "./lib/server/web-session-cookies";
const account = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222", sid = "33333333-3333-4333-8333-333333333333";
const secondSid = "44444444-4444-4444-8444-444444444444";
const session = (id = sid) => ({ contract_version: "2026-08-24.10", session_id: id, access_token: "fresh-access", expires_at: new Date(Date.now()+8*3600000).toISOString(),
  account: { id: account, name: "Account", slug: "account" }, user: { id: user, display_name: "Member", email: "member@example.invalid", username: "member", role: "member", kind: "password_human" } });
const claims = () => ({ backendAccessToken: "o".repeat(43), backendAccountId: account, backendAccountName: "Account", backendAccountSlug: "account",
  backendExpiresAt: new Date(Date.now()+60000).toISOString(), backendRole: "member", backendUserId: user, backendUsername: "member" });
const renewable = (id = sid, at = Date.now()) => ({ ...claims(), backendSessionId: id, backendRenewalSecret: "s".repeat(43), backendLoginAt: at,
  name: "Member", email: "member@example.invalid", picture: "https://images.example.invalid/member.png" });
const jwt = (token: Record<string, unknown>, providerId?: string, person?: Record<string,unknown>) => buildAuthConfig().callbacks!.jwt!({ token,
  user: person as never, account: providerId ? { provider: providerId, type: "credentials", providerAccountId: user, id_token: "synthetic-provider-identity-proof" } : null,
  trigger: providerId ? "signIn" : undefined, session: undefined });
const publicSession = (token: Record<string, unknown>) => buildAuthConfig().callbacks!.session!({ session: { user: { name: "Member", email: "member@example.invalid" }, expires: "2099-01-01" }, token } as never);
const heartbeat = () => new Request("https://web.test/api/auth/persistent", { method: "POST", headers: { origin: "https://web.test", "x-capri-session-renewal": "1", "sec-fetch-site": "same-origin" } });
const context = (token: Record<string,unknown> | null, jar = new Map<string,string>()): Context => ({ token, jar, writes: new Map() });
const run = <T>(ctx: Context, action: () => T) => fixture.context!.run(ctx, action);
function apply(jar: Map<string,string>, writes: Map<string,string|null>) {
  for (const [name,value] of writes) { if (value === null) jar.delete(name); else jar.set(name,value); }
}
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "synthetic-persistent-auth-secret"); vi.stubEnv("AUTH_URL", "https://web.test");
  fixture.context = new AsyncLocalStorage<Context>(); fixture.fallback = context(null); fixture.signIn.mockReset(); fixture.oauth.mockResolvedValue(session());
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(session())));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); fixture.context?.disable(); });

describe("production Web auth and writable renewal entry points", () => {
  it.each(["password-account", "email-verification", "google", "apple"])("enrolls %s and redacts the capability from public sessions", async providerId => {
    const person = { id: user, name: "Member", email: "member@example.invalid", ...claims() };
    const token = await jwt({}, providerId, person);
    expect(token?.backendSessionId).toBe(sid); expect(token?.backendRenewalSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const visible = await publicSession(token!);
    expect(JSON.stringify(visible)).not.toContain(String(token?.backendRenewalSecret)); expect(JSON.stringify(visible)).not.toContain("backendAccessToken");
    expect(fixture.fallback.jar.has(WEB_FAMILY_COOKIE_PREFIX + sid)).toBe(true);
  });
  it("a fresh primary clears legacy aliases and bounds provider avatars before any cookie is installed", async () => {
    const token = await jwt({ backendLegacyAccessToken: "old-login", backendLegacyExpiresAt: "2000-01-01T00:00:00Z",
      picture: "https://images.example.invalid/" + "x".repeat(2000) }, "password-account", { id: user, ...claims() });
    expect(token?.backendLegacyAccessToken).toBeUndefined(); expect(token?.backendLegacyExpiresAt).toBeUndefined();
    expect(token?.picture).toBeUndefined(); expect(fixture.fallback.jar.get(WEB_FAMILY_COOKIE_PREFIX+sid)!.length).toBeLessThan(2400);
  });
  it("renews in Auth.js and SSR after old access expiry while retaining canonical binding", async () => {
    fixture.fallback.token = { ...renewable(), backendExpiresAt: "2000-01-01T00:00:00Z" };
    const token = await jwt(fixture.fallback.token);
    expect(token?.backendAccessToken).toBe("fresh-access"); expect(token?.backendSessionId).toBe(sid);
    expect((await readPrimaryBackendSessionClaims())?.backendAccessToken).toBe("fresh-access");
  });
  it("preserves public recovery identity on transient failure but removes it for confirmed revocation", async () => {
    const token = { ...renewable(), backendExpiresAt: "2000-01-01T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const unavailable = await jwt({ ...token });
    expect(unavailable?.backendRenewalSecret).toBe(token.backendRenewalSecret);
    expect(await publicSession(unavailable!)).toMatchObject({ user: { name: "Member" }, renewalStatus: "unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ error: { code: "PERSISTENT_SESSION_REVOKED" } }, { status: 401 })));
    const revoked = await jwt({ ...token }); expect((await publicSession(revoked!)).user).toBeUndefined();
  });
  it("rolls only its family cookie and independently reads back bounded access", async () => {
    fixture.fallback.token = renewable(); fixture.fallback.jar.set(AUTH_SESSION_COOKIE, "unchanged-primary-pointer");
    const result = await POST(heartbeat());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ status: "authenticated" });
    expect(fixture.fallback.jar.get(AUTH_SESSION_COOKIE)).toBe("unchanged-primary-pointer"); expect(fixture.signIn).not.toHaveBeenCalled();
    const name = WEB_FAMILY_COOKIE_PREFIX + sid;
    const token = await decode({ token: fixture.fallback.jar.get(name), secret: process.env.AUTH_SECRET!, salt: name });
    expect(JSON.stringify(token)).toContain("s".repeat(43));
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe("http://127.0.0.1:4317/v1/auth/session");
    expect([...fixture.fallback.writes.keys()]).not.toContain(AUTH_SESSION_COOKIE);
  });
  it("upgrades a live legacy cookie through writable enrollment and selects the new family without replacing its pointer", async () => {
    fixture.fallback.token = { ...claims(), iat: Math.floor(Date.now()/1000)-60 };
    fixture.fallback.jar.set(AUTH_SESSION_COOKIE, "legacy-primary");
    expect((await POST(heartbeat())).status).toBe(200);
    expect(fixture.fallback.jar.get(AUTH_SESSION_COOKIE)).toBe("legacy-primary");
    expect((await readPrimaryBackendSessionClaims())?.backendSessionId).toBe(sid);
  });
  it("late A heartbeat response after logout A and login B cannot replace B", async () => {
    const at = Date.now() - 1000, first = renewable(sid, at), second = { ...renewable(secondSid, at+500), name: "New Login B" };
    const browser = new Map<string,string>(); const old = context(first, new Map(browser));
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/renew") && JSON.parse(String(init.body)).session_id === sid) { started(); await wait; }
      const id = url.endsWith("/renew") ? JSON.parse(String(init.body)).session_id : (fixture.context!.getStore()?.token?.backendSessionId ?? sid);
      return Response.json(session(id));
    }));
    const pending = run(old, () => POST(heartbeat())); await began;
    const signedOut = context(first, new Map(browser)); await run(signedOut, () => markWebSessionSignedOut(sid)); apply(browser, signedOut.writes);
    const newer = context(second, new Map(browser)); await run(newer, () => writeWebFamilyToken(second)); apply(browser, newer.writes);
    browser.set(AUTH_SESSION_COOKIE, "primary-B");
    release(); expect((await pending).status).toBe(200); apply(browser, old.writes);
    expect(browser.get(AUTH_SESSION_COOKIE)).toBe("primary-B");
    const after = context(second, browser);
    expect((await run(after, () => readPrimaryBackendSessionClaims()))?.backendSessionId).toBe(secondSid);
    expect(await run(after, () => auth())).toMatchObject({ user: { name: "New Login B" } });
  });
  it("latest tombstone or revocation never falls back to an older family, even without the main cookie", async () => {
    const at = Date.now()-1000;
    await writeWebFamilyToken(renewable(sid, at));
    const firstCookie = fixture.fallback.jar.get(WEB_FAMILY_COOKIE_PREFIX+sid)!;
    await writeWebFamilyToken(renewable(secondSid, at+500)); fixture.fallback.jar.set(WEB_FAMILY_COOKIE_PREFIX+sid,firstCookie);
    fixture.fallback.token = null;
    await markWebSessionSignedOut(secondSid); expect(await readPrimaryBackendSessionClaims()).toBeNull(); expect(await auth()).toBeNull();
    fixture.fallback.jar.delete("talent-signal.signed-out." + secondSid);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ error: { code: "PERSISTENT_SESSION_REVOKED" } }, { status: 401 })));
    await expect(readPrimaryBackendSessionClaims()).rejects.toMatchObject({ code: "backend_session_expired" }); expect(await auth()).toBeNull();
  });
  it("receives a durable pending cookie before enrollment and recovers a lost enroll response after the real 8h JWT expires", async () => {
    vi.useFakeTimers(); const start = Date.now(); vi.setSystemTime(start);
    const original = { ...claims(), picture: "https://images.example.invalid/member.png", iat: Math.floor(start/1000), backendExpiresAt: new Date(start+8*3600000).toISOString() };
    const oldJwt = await encode({ token: original, secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE, maxAge: 8*3600 });
    const browser = new Map([[AUTH_SESSION_COOKIE, oldJwt]]);
    let registered = false; let lostEnroll = true; let enrollCount = 0;
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/enroll")) { registered = true; enrollCount += 1; if (lostEnroll) { lostEnroll = false; throw new Error("response lost after commit"); } }
      if (url.endsWith("/renew") && !registered) return Response.json({ error: { code: "PERSISTENT_SESSION_REVOKED" } }, { status: 401 });
      return Response.json({ ...session(), expires_at: url.endsWith("/session") && !registered ? original.backendExpiresAt : session().expires_at });
    }); vi.stubGlobal("fetch", fetcher);
    const first = context(null, new Map(browser));
    const prepared = await run(first, () => POST(heartbeat()));
    expect(await prepared.json()).toEqual({ status: "pending" }); expect(enrollCount).toBe(0);
    expect(fetcher.mock.calls.every(([url]) => url.endsWith("/session"))).toBe(true);
    apply(browser, first.writes);
    const second = context(null, new Map(browser));
    expect((await run(second, () => POST(heartbeat()))).status).toBe(503); expect(enrollCount).toBe(1);
    // The first response's pending cookie remains unchanged after a lost
    // enrollment response. The old main JWT now truly fails Auth.js decode.
    vi.setSystemTime(start+9*3600000);
    await expect(decode({ token: oldJwt, secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE })).rejects.toThrow();
    const recovered = context(null, new Map(browser));
    expect((await run(recovered, () => POST(heartbeat()))).status).toBe(200); expect(enrollCount).toBe(1);
    apply(browser, recovered.writes);
    const restored = await run(context(null, browser), () => readPrimaryBackendSessionClaims());
    expect(restored?.backendSessionId).toBe(sid);
    expect(restored?.backendLegacyAccessToken).toBe(original.backendAccessToken);
    expect(await run(context(null, browser), () => auth())).toMatchObject({ user: { image: "https://images.example.invalid/member.png" } });
  });
  it("an expired pending cookie that never enrolled cannot create renewal authority", async () => {
    const pending = { ...renewable(), backendPendingEnrollment: true, backendExpiresAt: "2000-01-01T00:00:00Z" };
    await writeWebFamilyToken(pending); fixture.fallback.token = null;
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ error: { code: "PERSISTENT_SESSION_REVOKED" } }, { status: 401 })); vi.stubGlobal("fetch", fetcher);
    expect((await POST(heartbeat())).status).toBe(401); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/renew");
  });
  it("a same-timestamp primary B wins ties and a later bounded primary blocks older renewable families", async () => {
    const at = Date.now()-1000;
    await writeWebFamilyToken(renewable(sid, at));
    await writeWebFamilyToken(renewable(secondSid, at));
    fixture.fallback.token = renewable(secondSid, at);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(session(secondSid))));
    expect((await readPrimaryBackendSessionClaims())?.backendSessionId).toBe(secondSid);
    fixture.fallback.token = { ...claims(), backendLoginAt: at+1 };
    expect((await readPrimaryBackendSessionClaims())?.backendSessionId).toBeUndefined();
  });
  it("renews after the shared primary cookie naturally expires, using the latest verified family only", async () => {
    await writeWebFamilyToken(renewable(sid, Date.now()-1000));
    fixture.fallback.token = null;
    expect((await readPrimaryBackendSessionClaims())?.backendSessionId).toBe(sid);
    expect(await auth()).toMatchObject({ user: { name: "Member" } });
  });
  it("normal new family writes clean older login cookies and keep journal material outside authority", async () => {
    const at = Date.now()-1000;
    await writeWebFamilyToken(renewable(sid, at)); await queueWebRevocation(renewable(sid, at) as never);
    await writeWebFamilyToken(renewable(secondSid, at+500));
    expect([...fixture.fallback.jar.keys()].filter(name => name.startsWith(WEB_FAMILY_COOKIE_PREFIX))).toEqual([WEB_FAMILY_COOKIE_PREFIX+secondSid]);
    expect(fixture.fallback.jar.has(WEB_REVOCATION_COOKIE_PREFIX+sid)).toBe(true);
    expect([...fixture.fallback.jar].reduce((total,[name,value]) => total+name.length+value.length+2,0)).toBeLessThan(4096);
  });
  it("a newer bounded login barrier survives main-cookie removal and blocks late older renewable cookies", async () => {
    const at = Date.now()-1000;
    await writeWebFamilyToken(renewable(sid, at));
    const lateOld = fixture.fallback.jar.get(WEB_FAMILY_COOKIE_PREFIX+sid)!;
    await writeWebLoginBarrier({ ...claims(), sub: "bounded-Lab-user", backendLoginAt: at+500 });
    fixture.fallback.jar.set(WEB_FAMILY_COOKIE_PREFIX+sid, lateOld);
    fixture.fallback.token = { ...claims(), backendLoginAt: at+500 };
    expect((await readPrimaryBackendSessionClaims())?.backendSessionId).toBeUndefined();
    fixture.fallback.token = null;
    expect(await readPrimaryBackendSessionClaims()).toBeNull(); expect(await auth()).toBeNull();
  });
  it("bounds a complete cookie header with active login, four pending journals/fences and common auxiliary cookies", async () => {
    const token = renewable(); await writeWebFamilyToken(token);
    fixture.fallback.jar.set(AUTH_SESSION_COOKIE, await encode({ token, secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE, maxAge: 400*86400 }));
    for (let i=0;i<4;i++) {
      const id = `${String(i+10).padStart(8,"0")}-1111-4111-8111-111111111111`;
      await markWebSessionSignedOut(id); await queueWebRevocation({ ...renewable(id), backendPendingEnrollment: true } as never);
    }
    fixture.fallback.jar.set("talent-signal.callback-url", "https://web.test/workspace/settings?section=security");
    fixture.fallback.jar.set("talent-signal.test-workspace", await encode({ token: { testWorkspace: { workspaceId: sid, entryId: secondSid,
      name: "Isolated test", parentHash: "h".repeat(64), endpoint: "http://127.0.0.1:4317", claims: { ...claims() } } },
      secret: process.env.AUTH_SECRET!, salt: "talent-signal.test-workspace" }));
    const bytes = Buffer.byteLength([...fixture.fallback.jar].map(([name,value]) => `${name}=${value}`).join("; "));
    console.info("Web cookie header budget", { bytes, budget: 8192, nodeLimit: maxHeaderSize });
    expect(bytes).toBeLessThan(8192); expect(bytes).toBeLessThan(maxHeaderSize);
  });
  it("offline logout retains revoke-only proof and a signed-out heartbeat later revokes remotely", async () => {
    const raw = renewable(); fixture.fallback.token = raw; await writeWebFamilyToken(raw);
    await markWebSessionSignedOut(sid); await queueWebRevocation(raw as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await POST(heartbeat())).status).toBe(401); expect(fixture.fallback.jar.has(WEB_REVOCATION_COOKIE_PREFIX+sid)).toBe(true);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ revoked: true })); vi.stubGlobal("fetch", fetcher);
    expect((await POST(heartbeat())).status).toBe(401); expect(fixture.fallback.jar.has(WEB_REVOCATION_COOKIE_PREFIX+sid)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toContain("/revoke");
    expect(await readPrimaryBackendSessionClaims()).toBeNull();
  });
  it("retains all four pending revocation proofs and offers recoverable sign-in feedback instead of enrolling another family", async () => {
    for (let i=0;i<4;i++) {
      const id = `${String(i+20).padStart(8,"0")}-1111-4111-8111-111111111111`;
      await queueWebRevocation(renewable(id) as never);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("revoke service offline")));
    await expect(jwt({}, "password-account", { id: user, ...claims() })).rejects.toMatchObject({ code: "sign_out_pending" });
    expect([...fixture.fallback.jar.keys()].filter(name => name.startsWith(WEB_REVOCATION_COOKIE_PREFIX))).toHaveLength(4);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith("/revoke"))).toBe(true);
  });
  it("a lower enrollment cap still retries and preserves compatibility with eight already issued journal cookies", async () => {
    for (let i=0;i<8;i++) {
      const id = `${String(i+30).padStart(8,"0")}-1111-4111-8111-111111111111`;
      await queueWebRevocation(renewable(id) as never);
    }
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ revoked: true })); vi.stubGlobal("fetch", fetcher);
    expect((await POST(heartbeat())).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect([...fixture.fallback.jar.keys()].some(name => name.startsWith(WEB_REVOCATION_COOKIE_PREFIX))).toBe(false);
  });
  it("public Auth.js session GET shares the resolver and never rolls the main cookie", async () => {
    fixture.fallback.token = renewable();
    const result = await handlers.GET(new NextRequest("https://web.test/api/auth/session"));
    expect((await result.json()).user.name).toBe("Member"); expect(result.headers.has("set-cookie")).toBe(false);
    const update = await handlers.POST(new NextRequest("https://web.test/api/auth/session", { method: "POST" }));
    expect(update.headers.has("set-cookie")).toBe(false);
    expect(JSON.stringify(await run(context(renewable()), () => auth()))).not.toContain("s".repeat(43));
  });
  it("does not accept cross-site renewal or enroll a native session", async () => {
    fixture.fallback.token = { ...claims(), backendSessionId: sid };
    expect((await POST(new Request("https://web.test/api/auth/persistent", { method: "POST", headers: { origin: "https://evil.invalid", "x-capri-session-renewal": "1" } }))).status).toBe(403);
    expect((await POST(heartbeat())).status).toBe(200); expect(fetch).not.toHaveBeenCalled();
  });
});
