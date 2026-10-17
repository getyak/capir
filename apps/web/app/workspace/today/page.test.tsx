import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), mode: vi.fn(), load: vi.fn(), claims: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mock.auth }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("@/lib/server/pursuitBackend", () => ({ isPursuitIntegrationMode: mock.mode, loadPursuitToday: mock.load }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mock.claims }));
vi.mock("@/lib/server/workspaceSessions", () => ({ workspaceSessionsBinding: () => "current-binding" }));
vi.mock("@/components/pursuit-today-page", () => ({ PursuitTodayPage: () => null }));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks(); mock.auth.mockResolvedValue({ user: { id: "owner" } });
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
