import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ claims: vi.fn(), receipt: vi.fn() }));
vi.mock("./backendAuth", () => ({
  readBackendSessionClaims: f.claims,
  backendAuthBaseUrl: () => "http://backend.invalid",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class { getDesktopCaptureReceipt = f.receipt; } };
});
import { desktopCaptureReceiptRoute } from "./desktopCaptureReceipt";
import { contactHandoffSessionVersion } from "./contact-handoff-session";

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30", mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const claims = { backendAccountId: "account", backendUserId: "user", backendAccessToken: "secret",
  backendExpiresAt: "2099-01-01T00:00:00Z", backendAccountName: "Workspace", backendAccountSlug: "workspace",
  backendRole: "member" as const, backendUsername: null };
const request = (binding = contactHandoffSessionVersion(claims)) =>
  new Request(`https://workspace.example/api/desktop-capture/${sid}/${mid}`, { headers: { "x-workspace-session": binding } });
beforeEach(() => {
  f.claims.mockReset(); f.receipt.mockReset(); f.claims.mockResolvedValue(claims);
  f.receipt.mockResolvedValue({ session_id: sid, message_id: mid, status: "completed", result_recorded: true,
    image_manifest: [{ attachment_id: mid, byte_size: 8, content_hash: "a".repeat(64) }] });
});

it("returns only the exact owner-checked receipt without answer text", async () => {
  const response = await desktopCaptureReceiptRoute(request(), sid, mid);
  expect(response.status).toBe(200);
  expect(f.receipt).toHaveBeenCalledWith(sid, mid);
  expect(await response.json()).toMatchObject({ session_id: sid, message_id: mid, result_recorded: true });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("rejects stale login before contacting the backend", async () => {
  expect((await desktopCaptureReceiptRoute(request("stale"), sid, mid)).status).toBe(409);
  expect(f.receipt).not.toHaveBeenCalled();
});
