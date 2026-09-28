import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ claims: vi.fn(), directory: vi.fn() }));
vi.mock("./backendAuth", () => ({ readBackendSessionClaims: f.claims, authSecret: () => "synthetic-secret" }));
vi.mock("./workspaceSessions", () => ({ loadWorkspaceSessionDirectory: f.directory }));
import { desktopCaptureRecentRoute } from "./desktopCaptureRecent";
import { contactHandoffSessionVersion } from "./contact-handoff-session";

const claims = { backendAccountId: "account", backendUserId: "user", backendAccessToken: "secret",
  backendExpiresAt: "2099-01-01T00:00:00Z", backendAccountName: "Workspace", backendAccountSlug: "workspace",
  backendRole: "member" as const, backendUsername: null };
const req = (binding = contactHandoffSessionVersion(claims)) =>
  new Request("https://workspace.example/api/desktop-capture/recent-session", { headers: { "x-workspace-session": binding } });
beforeEach(() => { f.claims.mockReset(); f.directory.mockReset(); f.claims.mockResolvedValue(claims); });

it("returns only an owner-scoped Session id for Continue", async () => {
  f.directory.mockResolvedValue({ sessions: [{ sessionId: "a072ed54-6d56-413d-af4b-3ebc01ba646a", title: "private title" }] });
  const response = await desktopCaptureRecentRoute(req());
  expect(await response.json()).toEqual({ session_id: "a072ed54-6d56-413d-af4b-3ebc01ba646a" });
  expect(f.directory).toHaveBeenCalledOnce();
});

it("does not expose history to a stale login", async () => {
  expect((await desktopCaptureRecentRoute(req("stale"))).status).toBe(409);
  expect(f.directory).not.toHaveBeenCalled();
});
