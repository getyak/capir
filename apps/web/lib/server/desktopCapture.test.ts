import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ claims: vi.fn(), primary: vi.fn(), policy: vi.fn(), status: vi.fn() }));
vi.mock("./backendAuth", () => ({
  readBackendSessionClaims: fixture.claims,
  readPrimaryBackendSessionClaims: fixture.primary,
  backendAuthBaseUrl: () => "http://backend.invalid",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("./desktop-persistent-session", async importOriginal => ({
  ...await importOriginal<typeof import("./desktop-persistent-session")>(),
  readDesktopPersistentStatus: fixture.status,
}));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class { getDesktopCapturePolicy = fixture.policy; } };
});

import { desktopCaptureContextRoute } from "./desktopCapture";
import { DesktopPersistentSessionError } from "./desktop-persistent-session";

const claims = (account: string, token: string) => ({
  backendAccountId: account, backendUserId: "user", backendAccountName: "Workspace",
  backendAccessToken: token, backendExpiresAt: "2099-01-01T00:00:00.000Z",
});
beforeEach(() => {
  fixture.claims.mockReset(); fixture.primary.mockReset(); fixture.policy.mockReset(); fixture.status.mockReset();
  fixture.primary.mockResolvedValue(claims("account-one", "primary-token"));
  fixture.policy.mockResolvedValue({ policy_version: "policy-one", available: true, source_retention_days: 30, processor_labels: ["Claude · sonnet"] });
});

const primary = {
  ...claims("11111111-1111-4111-8111-111111111111", "primary-token"),
  backendUserId: "22222222-2222-4222-8222-222222222222",
  backendSessionId: "33333333-3333-4333-8333-333333333333",
};
const primaryStatus = {
  status: "authenticated", account_id: primary.backendAccountId,
  user_id: primary.backendUserId, session_id: primary.backendSessionId,
  session_expires_at: primary.backendExpiresAt,
};

it("keeps verified primary ownership separate from a selected business workspace", async () => {
  fixture.primary.mockResolvedValue(primary);
  fixture.claims.mockResolvedValue(claims("selected-test-workspace", "target-token"));
  fixture.status.mockResolvedValue(primaryStatus);
  const result = await desktopCaptureContextRoute();
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body).toMatchObject({
    workspace_account_id: "selected-test-workspace",
    primary_account_id: primary.backendAccountId,
    primary_user_id: primary.backendUserId,
    primary_session_id: primary.backendSessionId,
  });
  expect(fixture.status).toHaveBeenCalledWith("primary-token");
  expect(JSON.stringify(body)).not.toMatch(/primary-token|target-token/);
});

it.each(["account_id", "user_id", "session_id"] as const)("rejects a changed primary %s before exposing capture context", async field => {
  fixture.primary.mockResolvedValue(primary);
  fixture.claims.mockResolvedValue(claims("selected-test-workspace", "target-token"));
  fixture.status.mockResolvedValue({ ...primaryStatus, [field]: "44444444-4444-4444-8444-444444444444" });
  expect((await desktopCaptureContextRoute()).status).toBe(503);
  expect(fixture.policy).not.toHaveBeenCalled();
});

it("does not authorize a selected workspace after the primary short access expires", async () => {
  fixture.primary.mockResolvedValue(primary);
  fixture.claims.mockResolvedValue(claims("selected-test-workspace", "target-token"));
  fixture.status.mockRejectedValue(new DesktopPersistentSessionError(401));
  expect((await desktopCaptureContextRoute()).status).toBe(401);
  expect(fixture.policy).not.toHaveBeenCalled();
});

it.each([null, { ...primary, backendExpiresAt: "2000-01-01T00:00:00.000Z" }])("requires a live primary even when selected business claims remain usable", async owner => {
  fixture.primary.mockResolvedValue(owner);
  fixture.claims.mockResolvedValue(claims("selected-test-workspace", "target-token"));
  expect((await desktopCaptureContextRoute()).status).toBe(401);
  expect(fixture.status).not.toHaveBeenCalled();
  expect(fixture.policy).not.toHaveBeenCalled();
});

it.each(["primary", "live owner", "business"])("bounds context expiry to the %s deadline", async shortest => {
  const soon = new Date(Date.now() + 60_000).toISOString();
  fixture.primary.mockResolvedValue({ ...primary,
    backendExpiresAt: shortest === "primary" ? soon : primary.backendExpiresAt });
  fixture.status.mockResolvedValue({ ...primaryStatus,
    session_expires_at: shortest === "live owner" ? soon : primaryStatus.session_expires_at });
  fixture.claims.mockResolvedValue({ ...claims("selected-test-workspace", "target-token"),
    backendExpiresAt: shortest === "business" ? soon : primary.backendExpiresAt });
  const result = await desktopCaptureContextRoute();
  expect(result.status).toBe(200);
  expect((await result.json()).expires_at).toBe(soon);
});

it("requires an active signed-in workspace", async () => {
  fixture.claims.mockResolvedValue(null);
  expect((await desktopCaptureContextRoute()).status).toBe(401);
  expect(fixture.policy).not.toHaveBeenCalled();
});

it("keeps recovery scope stable across login rotation while changing its authority binding", async () => {
  fixture.claims.mockResolvedValueOnce(claims("account-one", "token-a")).mockResolvedValueOnce(claims("account-one", "token-b"));
  const first = await (await desktopCaptureContextRoute()).json();
  const second = await (await desktopCaptureContextRoute()).json();
  expect(first.owner_scope).toBe(second.owner_scope);
  expect(first.workspace_account_id).toBe("account-one");
  expect(first.login_binding).not.toBe(second.login_binding);
  expect(JSON.stringify(first)).not.toContain("token-a");
  expect(first.processing).toMatchObject({ available: true, processor_labels: ["Claude · sonnet"], workspace_label: "Workspace" });
});

it("fences one account's staged screenshot from another account", async () => {
  fixture.claims.mockResolvedValueOnce(claims("account-one", "token-a")).mockResolvedValueOnce(claims("account-two", "token-b"));
  const first = await (await desktopCaptureContextRoute()).json();
  const second = await (await desktopCaptureContextRoute()).json();
  expect(first.owner_scope).not.toBe(second.owner_scope);
});
