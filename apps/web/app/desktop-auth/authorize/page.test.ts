import { beforeEach, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";

const fixture = vi.hoisted(() => ({ auth: vi.fn(), claims: vi.fn(), current: vi.fn(), grant: vi.fn(), redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: fixture.auth }));
vi.mock("@/lib/server/backendAuth", () => ({ readPrimaryBackendSessionClaims: fixture.claims }));
vi.mock("next/navigation", () => ({ redirect: fixture.redirect }));
vi.mock("@/lib/server/desktop-browser-login", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/desktop-browser-login")>(),
  desktopAuthDeploymentOrigin: async () => "https://web.test",
  desktopAuthBearerClient: () => ({ currentSession: fixture.current, readDesktopBrowserLoginGrant: fixture.grant }),
}));
import AuthorizePage from "./page";

const attempt = "11111111-2222-4333-8444-555555555555", state = "s".repeat(43);
const returnTarget = `/desktop-auth/authorize?attempt=${attempt}&state=${state}`;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.auth.mockResolvedValue({ user: { id: "synthetic" } });
  fixture.claims.mockResolvedValue({ backendAccessToken: "synthetic", backendAccountId: "account", backendUserId: "user" });
  fixture.redirect.mockImplementation(() => { throw new Error("expected-redirect"); });
  fixture.grant.mockResolvedValue({ state: "prepared", matching_hint: "ABCD-12" });
});
it("revoked backend session with a valid browser cookie reaches ordinary browser reauthentication", async () => {
  fixture.current.mockRejectedValue(new TalentSignalHttpError(401, "AUTH_SESSION_REVOKED", "Session revoked", null));
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(returnTarget)}`);
});
it("incomplete primary claims cannot bounce through the existing user-present login redirect", async () => {
  fixture.claims.mockResolvedValue(null);
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(returnTarget)}`);
  expect(fixture.current).not.toHaveBeenCalled();
});
it("a genuinely signed-out browser returns to the exact unapproved attempt after normal sign-in", async () => {
  fixture.auth.mockResolvedValue(null);
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(returnTarget)}`);
});
