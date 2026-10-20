import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ claims: vi.fn(), result: vi.fn() }));
vi.mock("./backendAuth", () => ({ readBackendSessionClaims: f.claims,
  backendAuthBaseUrl: () => "http://backend.invalid", authSecret: () => "synthetic-test-secret" }));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class { getDesktopCaptureResult = f.result; } };
});
import { desktopCaptureResultRoute } from "./desktopCaptureReceipt";
import { contactHandoffSessionVersion } from "./contact-handoff-session";

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30", mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const claims = { backendAccountId: "account", backendUserId: "user", backendAccessToken: "secret",
  backendExpiresAt: "2099-01-01T00:00:00Z", backendAccountName: "Workspace", backendAccountSlug: "workspace",
  backendRole: "member" as const, backendUsername: null };
const request = (binding = contactHandoffSessionVersion(claims)) =>
  new Request(`https://workspace.example/api/desktop-capture/${sid}/${mid}/result`, { headers: { "x-workspace-session": binding } });
beforeEach(() => {
  f.claims.mockReset(); f.result.mockReset(); f.claims.mockResolvedValue(claims);
  f.result.mockResolvedValue({ session_id: sid, message_id: mid, observation: null });
});

it("reads only the authenticated exact result without caching private clues", async () => {
  const response = await desktopCaptureResultRoute(request(), sid, mid);
  expect(response.status).toBe(200);
  expect(f.result).toHaveBeenCalledWith(sid, mid);
  expect(await response.json()).toMatchObject({ session_id: sid, message_id: mid, observation: null });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("blocks changed login, expired sessions and invalid IDs before backend access", async () => {
  expect((await desktopCaptureResultRoute(request("stale"), sid, mid)).status).toBe(409);
  f.claims.mockResolvedValue({ ...claims, backendExpiresAt: "2000-01-01T00:00:00Z" });
  expect((await desktopCaptureResultRoute(request(), sid, mid)).status).toBe(401);
  expect((await desktopCaptureResultRoute(request(), "invalid", mid)).status).toBe(400);
  expect(f.result).not.toHaveBeenCalled();
});

it("rejects another message and sanitizes unavailable readback", async () => {
  f.result.mockResolvedValue({ session_id: sid, message_id: sid, observation: { private: "FOREIGN_CANARY" } });
  const mismatch = await desktopCaptureResultRoute(request(), sid, mid);
  expect(mismatch.status).toBe(502);
  expect(await mismatch.text()).not.toContain("FOREIGN_CANARY");
  f.result.mockRejectedValue(new Error("PRIVATE_ERROR_CANARY"));
  const failure = await desktopCaptureResultRoute(request(), sid, mid);
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain("PRIVATE_ERROR_CANARY");
});
