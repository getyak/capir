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

it("continues past a page of expired or deleted Sessions before claiming none", async () => {
  const sessionId = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
  f.directory.mockResolvedValueOnce({ sessions: [], complete: false, nextCursor: "after-first-page" })
    .mockResolvedValueOnce({ sessions: [{ sessionId }], complete: true, nextCursor: null });
  const response = await desktopCaptureRecentRoute(req());
  expect(await response.json()).toEqual({ session_id: sessionId });
  expect(f.directory).toHaveBeenNthCalledWith(1, { cursor: null });
  expect(f.directory).toHaveBeenNthCalledWith(2, { cursor: "after-first-page" });
});

it("reports an empty history only after the directory is complete", async () => {
  f.directory.mockResolvedValueOnce({ sessions: [], complete: true, nextCursor: null });
  expect(await (await desktopCaptureRecentRoute(req())).json()).toEqual({ session_id: null });
});

it("does not turn a broken or bounded scan into a false empty state", async () => {
  f.directory.mockResolvedValue({ sessions: [], complete: false, nextCursor: "repeated-cursor" });
  const response = await desktopCaptureRecentRoute(req());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "recent_session_scan_incomplete" });
});
