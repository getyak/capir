import { beforeEach, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { BackendSessionExpiredError } from "@/lib/backend-session";
const mock = vi.hoisted(() => ({ locale: "zh-CN", auth: vi.fn(), mode: vi.fn(), load: vi.fn(), claims: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mock.auth }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("@/lib/server/pursuitBackend", () => ({ isPursuitIntegrationMode: mock.mode, loadPursuitToday: mock.load }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mock.claims }));
vi.mock("@/lib/server/workspaceSessions", () => ({ workspaceSessionsBinding: () => "current-binding" }));
vi.mock("@/components/pursuit-today-page", () => ({ PursuitTodayPage: () => null }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => mock.locale }));
import Page, { generateMetadata } from "./page";
beforeEach(() => {
  vi.clearAllMocks(); mock.locale = "zh-CN"; mock.auth.mockResolvedValue({ user: { id: "owner" } });
  mock.mode.mockReturnValue(false);
  mock.claims.mockResolvedValue({ backendExpiresAt: "2030-01-01T00:00:00Z" });
  mock.load.mockResolvedValue({ projection: { items: [], totalPursuits: 0 }, providerMode: "live_remote" });
});
it("keeps authenticated Today reachable with canonical consumption when the Pursuit producer is disabled", async () => {
  const result = await Page({ searchParams: Promise.resolve({}) });
  expect(result.props).toMatchObject({ binding: "current-binding", expiresAt: "2030-01-01T00:00:00Z", pursuitEnabled: false, projection: null });
  expect(mock.load).not.toHaveBeenCalled();
});
it("preserves the existing governed producer when enabled", async () => {
  mock.mode.mockReturnValue(true);
  const result = await Page({ searchParams: Promise.resolve({ view: "all" }) });
  expect(result.props).toMatchObject({ binding: "current-binding", pursuitEnabled: true, expanded: true, providerMode: "live_remote" });
  expect(mock.load).toHaveBeenCalledWith({ expanded: true });
});
it("keeps unauthenticated access behind login with the exact Today return path", async () => {
  mock.auth.mockResolvedValue(null);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login?callbackUrl=%2Fworkspace%2Ftoday");
  expect(mock.load).not.toHaveBeenCalled();
});
it("does not invent a read binding for absent or expired backend credentials", async () => {
  mock.claims.mockResolvedValue({ backendExpiresAt: "2000-01-01T00:00:00Z" });
  expect((await Page({ searchParams: Promise.resolve({}) })).props.binding).toBe("");
  mock.claims.mockResolvedValue(null);
  expect((await Page({ searchParams: Promise.resolve({}) })).props.binding).toBe("");
});

it("localizes Today metadata and local outage chrome without changing the expanded read", async () => {
  mock.locale = "en"; mock.mode.mockReturnValue(true); mock.load.mockRejectedValue(new Error("unavailable"));
  expect(await generateMetadata()).toMatchObject({ title: "Today", description: "Goals, pending reviews and assigned actions that need attention.", robots: { follow: false, index: false } });
  const result = await Page({ searchParams: Promise.resolve({ view: "all" }) });
  expect(result.props.error).toBe("Cannot read this account's goals right now. Try again later.");
  expect(mock.load).toHaveBeenCalledExactlyOnceWith({ expanded: true });
});

it("localizes the actual canonical expiry error on the English Today route without changing recovery", async () => {
  mock.locale = "en"; mock.mode.mockReturnValue(true); mock.load.mockRejectedValue(new BackendSessionExpiredError());
  const result = await Page({ searchParams: Promise.resolve({}) });
  expect(result.props.error).toBe("Your session is no longer valid. Sign in again to continue.");
  expect(result.props.sessionRecoveryHref).toBe("/login?callbackUrl=%2Fworkspace%2Ftoday&reason=backend_session_expired");
  expect(result.props.projection).toBeNull();
  expect(mock.load).toHaveBeenCalledExactlyOnceWith({ expanded: false });
});
it.each(["用户返回的错误原文", "登录状态已失效，请重新登录后继续。"])
  ("preserves arbitrary returned expiry detail %s without treating it as locally owned copy", async (message) => {
    mock.locale = "en"; mock.mode.mockReturnValue(true);
    mock.load.mockRejectedValue(new TalentSignalHttpError(401, "backend_session_expired", message, null));
    const result = await Page({ searchParams: Promise.resolve({}) });
    expect(result.props.error).toBe(message);
    expect(result.props.sessionRecoveryHref).toBe("/login?callbackUrl=%2Fworkspace%2Ftoday&reason=backend_session_expired");
  });
it("keeps a custom message on an expiry subclass original", async () => {
  const error = new BackendSessionExpiredError(); error.message = "定制错误原文";
  mock.locale = "en"; mock.mode.mockReturnValue(true); mock.load.mockRejectedValue(error);
  const result = await Page({ searchParams: Promise.resolve({}) });
  expect(result.props.error).toBe(error.message);
});
