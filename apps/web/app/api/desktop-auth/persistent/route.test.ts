import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claims: vi.fn(), signIn: vi.fn(), decode: vi.fn(), status: vi.fn(), revoke: vi.fn(), cookies: vi.fn(), cookieValue: "", rebind: vi.fn(),
}));
vi.mock("@/auth", () => ({ signIn: mocks.signIn }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: async () => new Headers() }));
vi.mock("next-auth/jwt", () => ({ decode: mocks.decode }));
vi.mock("@/lib/server/testWorkspaceSession", () => ({ rebindTestWorkspaceParent: mocks.rebind }));
vi.mock("@/lib/server/backendAuth", () => ({
  AUTH_SESSION_COOKIE: "talent-signal.session-v2", authSecret: () => "fixture-secret",
  backendAuthBaseUrl: () => "http://backend.test", readPrimaryBackendSessionClaims: mocks.claims,
}));
vi.mock("@/lib/server/desktop-persistent-session", async original => ({
  ...await original<typeof import("@/lib/server/desktop-persistent-session")>(),
  readDesktopPersistentStatus: mocks.status, revokeDesktopPersistentSession: mocks.revoke,
}));
import { GET, POST } from "./route";
import { DesktopPersistentSessionError } from "@/lib/server/desktop-persistent-session";
const account = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const fields = { action: "renew", device_secret: "p".repeat(43), account_id: account, user_id: user };
const live = { status: "authenticated", account_id: account, user_id: user, session_id: session, session_expires_at: "2099-01-01T00:00:00.000Z" };
function request(action = "renew") {
  return new Request("https://web.test/api/desktop-auth/persistent", {
    method: "POST", headers: { "content-type": "application/json", "x-capri-desktop-session": "1" },
    body: JSON.stringify({ ...fields, action }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  process.env.AUTH_URL = "https://web.test";
  mocks.claims.mockResolvedValue({ backendAccessToken: "incoming-old-access", backendAccountId: account, backendUserId: user });
  mocks.cookieValue = "incoming-old-cookie";
  mocks.cookies.mockResolvedValue({ get: () => undefined, getAll: () => [{ name: "talent-signal.session-v2", value: mocks.cookieValue }] });
  mocks.decode.mockResolvedValue({ backendAccessToken: "installed-new-access" });
  mocks.signIn.mockImplementation(async () => { mocks.cookieValue = "new-cookie"; return "https://web.test/workspace"; });
  mocks.status.mockResolvedValue(live);
});
it("installs via the real provider name and verifies the installed cookie, not cached incoming claims", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.signIn).toHaveBeenCalledWith("desktop-persistent", expect.objectContaining({ ...fields, redirect: false }));
  expect(mocks.status).toHaveBeenCalledWith("installed-new-access");
  expect(await response.json()).toEqual(live);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("never reports success for a missing installed cookie or an identity mismatch", async () => {
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  expect((await POST(request())).status).toBe(503);
  mocks.cookieValue = "incoming-old-cookie";
  mocks.cookies.mockResolvedValue({ getAll: () => [{ name: "talent-signal.session-v2", value: mocks.cookieValue }] });
  mocks.status.mockResolvedValue({ ...live, user_id: account });
  expect((await POST(request())).status).toBe(503);
  expect(mocks.status).toHaveBeenCalledWith("installed-new-access");
});
it("does not mistake an unchanged valid incoming cookie for installation on an Auth.js config fallback", async () => {
  mocks.signIn.mockResolvedValue("https://web.test/api/auth/callback/desktop-persistent");
  const response = await POST(request("enroll"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(mocks.status).not.toHaveBeenCalled();
});
it("keeps service failure recoverable, distinguishes revoked credentials, and never returns proof material", async () => {
  mocks.signIn.mockRejectedValue({ type: "CredentialsSignin", code: "service_unavailable" });
  const failed = await POST(request());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ status: "unavailable" });
  mocks.signIn.mockRejectedValue({ type: "CredentialsSignin" });
  const revoked = await POST(request());
  expect(revoked.status).toBe(401);
  expect(await revoked.json()).toEqual({ status: "revoked" });
});
it("refuses enrollment for an unexpected incoming identity before signIn", async () => {
  mocks.claims.mockResolvedValue({ backendAccountId: user, backendUserId: user });
  expect((await POST(request("enroll"))).status).toBe(401);
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("enrollment forwards only the server-owned current bearer to its provider", async () => {
  expect((await POST(request("enroll"))).status).toBe(200);
  expect(mocks.signIn).toHaveBeenCalledWith("desktop-persistent", expect.objectContaining({
    backend_access_token: "incoming-old-access", action: "enroll",
  }));
});
it("recovers a legacy selected workspace when a lost enrollment response is retried through renewal", async () => {
  expect((await POST(request("renew"))).status).toBe(200);
  expect(mocks.rebind).toHaveBeenCalledWith(
    expect.objectContaining({ backendAccessToken: "incoming-old-access" }),
    expect.objectContaining({ backendSessionId: session, backendAccountId: account, backendUserId: user }));
});
it("can renew after the access cookie is completely gone without requiring a primary-cookie readback", async () => {
  mocks.claims.mockResolvedValue(null);
  expect((await POST(request("renew"))).status).toBe(200);
  expect(mocks.rebind).not.toHaveBeenCalled();
});
it("GET reads the live session without any auth refresh or cookie write", async () => {
  const response = await GET();
  expect(await response.json()).toEqual(live);
  expect(mocks.signIn).not.toHaveBeenCalled();
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(response.headers.has("set-cookie")).toBe(false);
  mocks.status.mockRejectedValue(new DesktopPersistentSessionError(401));
  expect(await (await GET()).json()).toEqual({ status: "signed_out" });
});
it("revocation uses proof directly, including after an access cookie expired", async () => {
  mocks.claims.mockResolvedValue(null);
  expect(await (await POST(request("revoke"))).json()).toEqual({ status: "revoked" });
  expect(mocks.revoke).toHaveBeenCalled();
  expect(mocks.signIn).not.toHaveBeenCalled();
});
