import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ claims: vi.fn(), policy: vi.fn() }));
vi.mock("./backendAuth", () => ({
  readBackendSessionClaims: fixture.claims,
  backendAuthBaseUrl: () => "http://backend.invalid",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class { getDesktopCapturePolicy = fixture.policy; } };
});

import { desktopCaptureContextRoute } from "./desktopCapture";

const request = () => new Request("https://workspace.example/api/desktop-capture/context");
const claims = (account: string, token: string) => ({
  backendAccountId: account, backendUserId: "user", backendAccountName: "Workspace",
  backendAccessToken: token, backendExpiresAt: "2099-01-01T00:00:00.000Z",
});
beforeEach(() => {
  fixture.claims.mockReset(); fixture.policy.mockReset();
  fixture.policy.mockResolvedValue({ policy_version: "policy-one", available: true, source_retention_days: 30, processor_labels: ["Claude · sonnet"] });
});

it("requires an active signed-in workspace", async () => {
  fixture.claims.mockResolvedValue(null);
  expect((await desktopCaptureContextRoute(request())).status).toBe(401);
  expect(fixture.policy).not.toHaveBeenCalled();
});

it("keeps recovery scope stable across login rotation while changing its authority binding", async () => {
  fixture.claims.mockResolvedValueOnce(claims("account-one", "token-a")).mockResolvedValueOnce(claims("account-one", "token-b"));
  const first = await (await desktopCaptureContextRoute(request())).json();
  const second = await (await desktopCaptureContextRoute(request())).json();
  expect(first.owner_scope).toBe(second.owner_scope);
  expect(first.login_binding).not.toBe(second.login_binding);
  expect(JSON.stringify(first)).not.toContain("token-a");
  expect(first.processing).toMatchObject({ available: true, processor_labels: ["Claude · sonnet"] });
});

it("fences one account's staged screenshot from another account", async () => {
  fixture.claims.mockResolvedValueOnce(claims("account-one", "token-a")).mockResolvedValueOnce(claims("account-two", "token-b"));
  const first = await (await desktopCaptureContextRoute(request())).json();
  const second = await (await desktopCaptureContextRoute(request())).json();
  expect(first.owner_scope).not.toBe(second.owner_scope);
});
