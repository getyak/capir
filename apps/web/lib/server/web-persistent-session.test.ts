import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value) }) }));
vi.mock("./backendAuth", () => ({ authSecret: () => "synthetic-auth-secret", backendAuthBaseUrl: () => "http://127.0.0.1:4317" }));
import { enrollWebSession, renewWebSession, revokeWebSession, markWebSessionSignedOut, webSessionWasSignedOut } from "./web-persistent-session";
const account = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const sid = "33333333-3333-4333-8333-333333333333";
const secret = "s".repeat(43);
const expiry = () => new Date(Date.now() + 8 * 3600_000).toISOString();
const claims = () => ({ backendAccessToken: "old-access", backendAccountId: account, backendAccountName: "Account", backendAccountSlug: "account",
  backendExpiresAt: expiry(), backendRole: "member" as const, backendUserId: user, backendUsername: null });
const renewable = () => ({ ...claims(), backendSessionId: sid, backendRenewalSecret: secret });
const payload = () => ({ session_id: sid, access_token: "new-bounded-access", expires_at: expiry(), account: { id: account, name: "Account", slug: "account" },
  user: { id: user, username: null, role: "member" } });
const json = (value: unknown, status = 200) => Response.json(value, { status });
afterEach(() => { vi.unstubAllGlobals(); jar.clear(); });
beforeEach(() => { jar.clear(); });

describe("renewable Web capability", () => {
  it("enrolls normal access, keeps retry secret deterministic only for the same legacy login", async () => {
    const fetcher = vi.fn().mockImplementation(async () => json(payload())); vi.stubGlobal("fetch", fetcher);
    const initial = claims();
    const first = await enrollWebSession(initial, true);
    const retry = await enrollWebSession(initial, true);
    expect(first.backendRenewalSecret).toBe(retry.backendRenewalSecret);
    expect(first.backendSessionId).toBe(sid);
    await enrollWebSession({ ...initial, backendAccessToken: "different-login-access" }, true);
    const bodies = fetcher.mock.calls.map(call => JSON.parse(String(call[1].body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0].renewal_secret).not.toBe(bodies[2].renewal_secret);
    expect(bodies[0]).toMatchObject({ client_kind: "web" });
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer old-access");
  });
  it("renews after bounded access expires without sending it as authority", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(payload())); vi.stubGlobal("fetch", fetcher);
    const result = await renewWebSession({ ...renewable(), backendExpiresAt: "2000-01-01T00:00:00Z" });
    expect(result.backendAccessToken).toBe("new-bounded-access");
    const [, init] = fetcher.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ renewal_secret: secret, account_id: account, user_id: user, session_id: sid });
  });
  it("coalesces only concurrent requests, not authority across later requests", async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockImplementation(async () => json(payload()));
    vi.stubGlobal("fetch", fetcher);
    const first = renewWebSession(renewable()); const second = renewWebSession(renewable());
    expect(fetcher).toHaveBeenCalledTimes(1); release(json(payload()));
    expect(await first).toEqual(await second);
    await renewWebSession(renewable()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[401, "UNKNOWN_PROXY_DENIAL"], [401, "PERSISTENT_SESSION_PROOF_INVALID"], [403, "AUTH_ORIGIN_MISMATCH"], [503, "UPSTREAM_UNAVAILABLE"]])("preserves retryability for %s/%s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code } }, status as number)));
    await expect(renewWebSession(renewable())).rejects.toMatchObject({ code: "session_temporarily_unavailable", status: 503 });
  });
  it.each([[401, "PERSISTENT_SESSION_REVOKED"], [403, "PERSISTENT_SESSION_INELIGIBLE"]])("treats only canonical %s/%s as terminal", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code } }, status as number)));
    await expect(renewWebSession(renewable())).rejects.toMatchObject({ code: "backend_session_expired" });
  });
  it("does not grant persistence to Lab/ineligible or an expired legacy login", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: { code: "PERSISTENT_SESSION_INELIGIBLE" } }, 403)); vi.stubGlobal("fetch", fetcher);
    const lab = claims(); expect(await enrollWebSession(lab)).toEqual(lab);
    await expect(enrollWebSession({ ...claims(), backendExpiresAt: "2000-01-01T00:00:00Z" }, true)).rejects.toMatchObject({ code: "backend_session_expired" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never enrolls a canonical Mac session through the ordinary Web route", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const mac = { ...claims(), backendSessionId: sid };
    expect(await enrollWebSession(mac)).toEqual(mac); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects identity or canonical-session drift", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...payload(), session_id: "44444444-4444-4444-8444-444444444444" })));
    await expect(renewWebSession(renewable())).rejects.toMatchObject({ code: "session_temporarily_unavailable" });
  });
  it("revokes with capability despite expired access and keeps independent signout tombstones per family", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ revoked: true })); vi.stubGlobal("fetch", fetcher);
    await markWebSessionSignedOut(sid);
    await revokeWebSession({ ...renewable(), backendExpiresAt: "2000-01-01T00:00:00Z" });
    expect(await webSessionWasSignedOut(sid)).toBe(true);
    expect(await webSessionWasSignedOut("44444444-4444-4444-8444-444444444444")).toBe(false);
    await markWebSessionSignedOut("44444444-4444-4444-8444-444444444444");
    expect(await webSessionWasSignedOut(sid)).toBe(true);
    expect(fetcher.mock.calls[0][0]).toContain("/revoke"); expect(fetcher.mock.calls[0][1].headers.authorization).toBeUndefined();
  });
});

it("pending logout sends original access solely as a destructive atomic revoke proof", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ revoked: true })); vi.stubGlobal("fetch", fetcher);
  try {
    await revokeWebSession({ ...renewable(), backendPendingEnrollment: true, backendAccessToken: "o".repeat(43), backendExpiresAt: "2000-01-01T00:00:00Z" });
    expect(fetcher.mock.calls[0][0]).toContain("/v1/auth/persistent/revoke");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ renewal_secret: secret, account_id: account, user_id: user, session_id: sid,
      original_access_token: "o".repeat(43) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
