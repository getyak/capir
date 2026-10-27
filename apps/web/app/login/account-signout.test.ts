import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
const state = vi.hoisted(() => {
  process.env.AUTH_SECRET = "account-signout-synthetic-secret";
  return { jar: new Map<string, string>(), writes: [] as string[], dropCookieWrites: false, dropSignedOutWrite: false, retainTestCookie: false, claimsReadError: null as Error | null };
});
vi.mock("next/headers", () => ({
  headers: async () => { if (state.claimsReadError) throw state.claimsReadError; return new Headers({ host: "localhost:3000", "x-forwarded-proto": "http", cookie: [...state.jar].map(([key, value]) => `${key}=${value}`).join("; ") }); },
  cookies: async () => ({
    get: (name: string) => state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { state.writes.push(name); if (!state.dropCookieWrites && !(state.dropSignedOutWrite && name.startsWith("talent-signal.signed-out."))) state.jar.set(name, value); },
    delete: (name: string) => { state.writes.push(name); if (!state.dropCookieWrites && !(state.retainTestCookie && name === "talent-signal.test-workspace")) state.jar.delete(name); },
  }),
}));
import { AUTH_SESSION_COOKIE, readRawPrimaryBackendSessionClaims, type BackendSessionClaims } from "@/lib/server/backendAuth";
import { setTestWorkspaceSession, TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";
import { selectWebFamilyToken, writeWebFamilyToken, WEB_FAMILY_COOKIE_PREFIX, WEB_REVOCATION_COOKIE_PREFIX } from "@/lib/server/web-session-cookies";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";
import * as Actions from "./actions";
const claims: BackendSessionClaims = { backendSessionId: "33333333-3333-4333-8333-333333333333", backendAccessToken: "synthetic-primary-access", backendAccountId: "11111111-1111-4111-8111-111111111111", backendAccountName: "Workspace", backendAccountSlug: "workspace", backendExpiresAt: "2030-01-01T00:00:00Z", backendRole: "member", backendUserId: "22222222-2222-4222-8222-222222222222", backendUsername: null };
function form(hosted = false, binding = workspaceSessionsBinding(claims)) { const data = new FormData(); data.set("desktopHost", String(hosted)); data.set("workspaceBinding", binding); data.set("redirectTo", "https://foreign.invalid/"); return data; }
async function install(primary: BackendSessionClaims = claims, family = false, selection = true) {
  state.jar.clear();
  const token = { sub: primary.backendUserId, ...primary, backendLoginAt: Date.now() };
  const encoded = await encode({ secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE, token });
  state.jar.set(AUTH_SESSION_COOKIE + ".0", encoded.slice(0, Math.floor(encoded.length / 2)));
  state.jar.set(AUTH_SESSION_COOKIE + ".1", encoded.slice(Math.floor(encoded.length / 2)));
  if (family) await writeWebFamilyToken(token);
  if (selection) await setTestWorkspaceSession(primary, { workspaceId: primary.backendAccountId, entryId: "fixture-entry", name: "Fixture selection", claims: primary });
  state.writes.length = 0;
}
const activeAuthCookies = () => [...state.jar].filter(([name, value]) => (name === AUTH_SESSION_COOKIE || name.startsWith(AUTH_SESSION_COOKIE + ".") || name === TEST_WORKSPACE_COOKIE) && value);
beforeEach(async () => {
  state.dropCookieWrites = false; state.dropSignedOutWrite = false; state.retainTestCookie = false; state.claimsReadError = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/persistent/revoke") ? Response.json({ revoked: true }) : Response.json({ revoked_session_id: claims.backendSessionId, revoked_at: new Date().toISOString() })));
  await install();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([false, true])("returns completion only after actual NextAuth clears cookie chunks and test selection, preserving fixed destination (%s)", async hosted => {
  const result = await Actions.signOutFromAccountMenu(form(hosted));
  expect(result).toEqual({ status: "signed_out", binding: workspaceSessionsBinding(claims), redirectTo: hosted ? "/login?callbackUrl=%2Fworkspace&intent=sign-out" : "/" });
  expect(activeAuthCookies()).toEqual([]);
  expect(state.writes).toContain(AUTH_SESSION_COOKIE + ".0"); expect(state.writes).toContain(AUTH_SESSION_COOKIE + ".1"); expect(state.writes).toContain(TEST_WORKSPACE_COOKIE);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/auth/logout"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer synthetic-primary-access" }) }));
});
it("rejects a stale rendered binding before any backend or cookie mutation", async () => {
  await install({ ...claims, backendAccountId: "44444444-4444-4444-8444-444444444444" }); const before = [...state.jar];
  expect(await Actions.signOutFromAccountMenu(form())).toEqual({ status: "scope_changed" });
  expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); expect([...state.jar]).toEqual(before);
});
it("does not issue completion if a cookie write fails to remove the real session", async () => {
  state.dropCookieWrites = true; await expect(Actions.signOutFromAccountMenu(form())).rejects.toThrow();
  expect(state.jar.get(AUTH_SESSION_COOKIE + ".0")).toBeTruthy();
});
it("still completes actual local logout after backend deadlines without pretending remote revocation is confirmed", async () => {
  vi.useFakeTimers(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  let result: Awaited<ReturnType<typeof Actions.signOutFromAccountMenu>> | undefined;
  const pending = Actions.signOutFromAccountMenu(form(true)).then(value => { result = value; });
  await vi.waitFor(() => expect(result).toBeDefined(), { timeout: 10000, interval: 250 }); await pending;
  expect(result).toMatchObject({ status: "signed_out", redirectTo: "/login?callbackUrl=%2Fworkspace&intent=sign-out" }); expect(activeAuthCookies()).toEqual([]);
});
it("does not issue completion when the test selection survives even though actual Auth.js cleared the session chunks", async () => {
  state.retainTestCookie = true; await expect(Actions.signOutFromAccountMenu(form())).rejects.toThrow("Local sign-out could not be confirmed.");
  expect([...state.jar].some(([name, value]) => name.startsWith(AUTH_SESSION_COOKIE) && value)).toBe(false);
  expect(state.jar.get(TEST_WORKSPACE_COOKIE)).toBeTruthy();
});
it.each(["", "short", "x".repeat(64)])("refuses a missing or malformed rendered binding before mutation: %s", async binding => {
  expect(await Actions.signOutFromAccountMenu(form(false, binding))).toEqual({ status: "scope_changed" }); expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
});
it("does not mutate logout or cookies when the actual raw-claim lookup fails", async () => {
  state.claimsReadError = new Error("private lookup failure"); const before = [...state.jar];
  expect(await Actions.signOutFromAccountMenu(form())).toEqual({ status: "scope_changed" }); expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); expect([...state.jar]).toEqual(before);
});
it("retains real family barriers and revocation debt after outage but selects no renewable login", async () => {
  const renewable = { ...claims, backendRenewalSecret: "s".repeat(43) }; await install(renewable, true, false);
  const ordering: string[][] = [];
  vi.mocked(fetch).mockImplementation(async () => { ordering.push([...state.writes]); return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 503 }); });
  const result = await Actions.signOutFromAccountMenu(form(false, workspaceSessionsBinding(renewable)));
  const seal = "talent-signal.signed-out." + claims.backendSessionId, journal = WEB_REVOCATION_COOKIE_PREFIX + claims.backendSessionId;
  expect(result.status).toBe("signed_out"); expect(activeAuthCookies()).toEqual([]);
  expect(state.jar.get(seal)).toBe("1"); expect(state.jar.get(journal)).toBeTruthy(); expect(state.jar.get(WEB_FAMILY_COOKIE_PREFIX + claims.backendSessionId)).toBeTruthy();
  expect(ordering[0]?.indexOf(seal)).toBeLessThan(ordering[0]!.indexOf(journal)); expect(ordering[0]).toContain(journal);
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/v1/auth/persistent/revoke"); expect(await selectWebFamilyToken(null)).toBeNull(); expect(await readRawPrimaryBackendSessionClaims()).toBeNull();
});
it("withholds completion when a failed tombstone write leaves actual family restoration eligible", async () => {
  const renewable = { ...claims, backendRenewalSecret: "s".repeat(43) }; await install(renewable, true, false); state.dropSignedOutWrite = true;
  vi.mocked(fetch).mockImplementation(async () => Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 503 }));
  await expect(Actions.signOutFromAccountMenu(form(false, workspaceSessionsBinding(renewable)))).rejects.toThrow("Local sign-out could not be confirmed.");
  expect(activeAuthCookies()).toEqual([]); expect(await selectWebFamilyToken(null)).toMatchObject({ backendSessionId: claims.backendSessionId });
});

it("the legacy producer retains the same raw-family fence and revocation journal before its real redirect", async () => {
  const renewable = { ...claims, backendRenewalSecret: "s".repeat(43) }; await install(renewable, true, false);
  vi.mocked(fetch).mockImplementation(async () => Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 503 }));
  await expect(Actions.signOutOfWorkspace(form(true))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  expect(activeAuthCookies()).toEqual([]); expect(state.jar.get("talent-signal.signed-out." + claims.backendSessionId)).toBe("1");
  expect(state.jar.get(WEB_REVOCATION_COOKIE_PREFIX + claims.backendSessionId)).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/v1/auth/persistent/revoke"); expect(await selectWebFamilyToken(null)).toBeNull();
});
it("does not revoke a newer selected family B when an old primary pointer and rendered binding still name A", async () => {
  const renewable = { ...claims, backendRenewalSecret: "s".repeat(43) }; await install(renewable, true, false);
  const newer = { ...renewable, backendSessionId: "44444444-4444-4444-8444-444444444444", backendLoginAt: Date.now() + 1000 };
  await writeWebFamilyToken(newer); state.writes.length = 0; const before = [...state.jar];
  expect(await Actions.signOutFromAccountMenu(form())).toEqual({ status: "scope_changed" });
  expect(state.writes).toEqual([]); expect(fetch).not.toHaveBeenCalled(); expect([...state.jar]).toEqual(before);
  expect(await selectWebFamilyToken(null)).toMatchObject({ backendSessionId: newer.backendSessionId });
});
