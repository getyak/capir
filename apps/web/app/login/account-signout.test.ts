import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
const state = vi.hoisted(() => {
  process.env.AUTH_SECRET = "account-signout-synthetic-secret";
  return { jar: new Map<string, string>(), writes: [] as string[], effective: null as unknown, primary: null as unknown, backend: vi.fn(), remote: vi.fn(), dropCookieWrites: false, retainTestCookie: false, claimsReadError: null as Error | null };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000", "x-forwarded-proto": "http", cookie: [...state.jar].map(([key, value]) => `${key}=${value}`).join("; ") }),
  cookies: async () => ({
    get: (name: string) => state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { state.writes.push(name); if (!state.dropCookieWrites) state.jar.set(name, value); },
    delete: (name: string) => { state.writes.push(name); if (!state.dropCookieWrites && !(state.retainTestCookie && name === "talent-signal.test-workspace")) state.jar.delete(name); },
  }),
}));
vi.mock("@/lib/server/backendAuth", async () => ({ ...await vi.importActual("@/lib/server/backendAuth"), readBackendSessionClaims: async () => { if (state.claimsReadError) throw state.claimsReadError; return state.effective; }, readPrimaryBackendSessionClaims: async () => state.primary, authenticatedBackendClient: state.backend }));
import { AUTH_SESSION_COOKIE, type BackendSessionClaims } from "@/lib/server/backendAuth";
import { TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";
import * as Actions from "./actions";
const claims: BackendSessionClaims = { backendSessionId: "persistent-device-session", backendAccessToken: "synthetic-primary-access", backendAccountId: "account-one", backendAccountName: "Workspace", backendAccountSlug: "workspace", backendExpiresAt: "2030-01-01T00:00:00Z", backendRole: "member", backendUserId: "user-one", backendUsername: null };
function form(hosted = false, binding = workspaceSessionsBinding(claims)) { const data = new FormData(); data.set("desktopHost", String(hosted)); data.set("workspaceBinding", binding); data.set("redirectTo", "https://foreign.invalid/"); return data; }
beforeEach(async () => {
  state.jar.clear(); state.writes.length = 0; state.dropCookieWrites = false; state.retainTestCookie = false; state.claimsReadError = null; state.effective = claims; state.primary = claims;
  state.backend.mockReset().mockResolvedValue({ logout: state.remote.mockReset().mockResolvedValue({}) });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ contract_version: "test", revoked_session_id: claims.backendSessionId, revoked_at: new Date().toISOString() })));
  const token = await encode({ secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE, token: { sub: claims.backendUserId } });
  state.jar.set(AUTH_SESSION_COOKIE + ".0", token.slice(0, Math.floor(token.length / 2)));
  state.jar.set(AUTH_SESSION_COOKIE + ".1", token.slice(Math.floor(token.length / 2)));
  state.jar.set(TEST_WORKSPACE_COOKIE, "synthetic-test-selection");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([false, true])("returns completion only after actual NextAuth clears cookie chunks and test selection, preserving fixed destination (%s)", async hosted => {
  const result = await Actions.signOutFromAccountMenu(form(hosted));
  expect(result).toEqual({ status: "signed_out", binding: workspaceSessionsBinding(claims), redirectTo: hosted ? "/login?callbackUrl=%2Fworkspace&intent=sign-out" : "/" });
  expect([...state.jar].filter(([name, value]) => (name === AUTH_SESSION_COOKIE || name.startsWith(AUTH_SESSION_COOKIE + ".") || name === TEST_WORKSPACE_COOKIE) && value)).toEqual([]);
  expect(state.writes).toContain(AUTH_SESSION_COOKIE + ".0"); expect(state.writes).toContain(AUTH_SESSION_COOKIE + ".1"); expect(state.writes).toContain(TEST_WORKSPACE_COOKIE);
  expect(state.remote).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/auth/logout"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer synthetic-primary-access" }) }));
});
it("rejects a stale rendered binding before any backend or cookie mutation", async () => {
  state.effective = { ...claims, backendAccountId: "account-two" }; const before = [...state.jar];
  expect(await Actions.signOutFromAccountMenu(form())).toEqual({ status: "scope_changed" });
  expect(state.backend).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); expect([...state.jar]).toEqual(before);
});
it("does not issue completion if a cookie write fails to remove the real session", async () => {
  state.dropCookieWrites = true;
  await expect(Actions.signOutFromAccountMenu(form())).rejects.toThrow();
  expect(state.jar.get(AUTH_SESSION_COOKIE + ".0")).toBeTruthy();
});
it("still completes actual local logout after backend deadlines without pretending remote revocation is confirmed", async () => {
  vi.useFakeTimers(); state.remote.mockImplementation(() => new Promise(() => {})); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const pending = Actions.signOutFromAccountMenu(form(true)); await vi.advanceTimersByTimeAsync(3001);
  expect(await pending).toMatchObject({ status: "signed_out", redirectTo: "/login?callbackUrl=%2Fworkspace&intent=sign-out" });
  expect([...state.jar].some(([name, value]) => name.startsWith(AUTH_SESSION_COOKIE) && value)).toBe(false);
});

it("does not issue completion when the test selection survives even though actual Auth.js cleared the session chunks", async () => {
  state.retainTestCookie = true;
  await expect(Actions.signOutFromAccountMenu(form())).rejects.toThrow("Local sign-out could not be confirmed.");
  expect([...state.jar].some(([name, value]) => name.startsWith(AUTH_SESSION_COOKIE) && value)).toBe(false);
  expect(state.jar.get(TEST_WORKSPACE_COOKIE)).toBe("synthetic-test-selection");
});
it.each(["", "short", "x".repeat(64)])("refuses a missing or malformed rendered binding before mutation: %s", async binding => {
  expect(await Actions.signOutFromAccountMenu(form(false, binding))).toEqual({ status: "scope_changed" });
  expect(state.backend).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
});

it("does not mutate logout or cookies when the claim lookup itself fails", async () => {
  state.claimsReadError = new Error("private lookup failure"); const before = [...state.jar];
  expect(await Actions.signOutFromAccountMenu(form())).toEqual({ status: "scope_changed" });
  expect(state.backend).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); expect([...state.jar]).toEqual(before);
});
