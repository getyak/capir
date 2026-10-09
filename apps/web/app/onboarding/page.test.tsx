import { beforeEach, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), auth: vi.fn(), onboarding: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mocks.claims, authenticatedBackendClient: async () => ({ accountOnboarding: mocks.onboarding }) }));
vi.mock("@/lib/server/workspaceSessions", () => ({ workspaceSessionsBinding: () => "scope" }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
import OnboardingPage from "./page";
const claims = { backendAccountId: "account", backendUserId: "user", backendExpiresAt: "2099-01-01T00:00:00Z" };
beforeEach(() => { vi.resetAllMocks(); mocks.claims.mockResolvedValue(claims); mocks.auth.mockResolvedValue({ user: {} }); });
it("asks an unsigned visitor to sign in without claiming a session expired", async () => {
  mocks.claims.mockResolvedValue(null); mocks.auth.mockResolvedValue(null);
  await expect(OnboardingPage({ searchParams: Promise.resolve({ callbackUrl: "/workspace/people" }) })).rejects.toThrow("redirect:/login?callbackUrl=%2Fworkspace%2Fpeople");
});
it("takes canonical revocation through the login recovery path", async () => {
  mocks.onboarding.mockRejectedValue(new TalentSignalHttpError(401, "SESSION_INVALID", "Sign in again", null));
  await expect(OnboardingPage({ searchParams: Promise.resolve({ callbackUrl: "/workspace/people" }) })).rejects.toThrow("redirect:/login?reason=backend_session_expired&callbackUrl=%2Fworkspace%2Fpeople");
});
it("leaves a network outage in the readable retry surface", async () => {
  mocks.onboarding.mockRejectedValue(new TypeError("Failed to fetch"));
  expect(await OnboardingPage({ searchParams: Promise.resolve({}) })).toBeTruthy();
});
