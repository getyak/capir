import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  complete: vi.fn(),
  start: vi.fn(),
  claims: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => boundary.jar.has(name) ? { value: boundary.jar.get(name)! } : undefined,
    set: (name: string, value: string) => { boundary.jar.set(name, value); },
    delete: (name: string) => { boundary.jar.delete(name); },
  }),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "parent-result-regression-secret-only",
  backendAuthBaseUrl: () => "https://backend.example.invalid",
  readPrimaryBackendSessionClaims: boundary.claims,
  authenticatedBackendClient: async () => ({ accountSettings: async () => ({ workspace: { revision: 2 }, user: { revision: 3 } }) }),
}));
vi.mock("@/lib/server/loginMethods", () => ({
  startLoginMethodChange: boundary.start,
  completeLoginMethodChange: boundary.complete,
}));
vi.mock("@/lib/server/apple-session", () => ({ bindAppleNonce: vi.fn() }));
vi.mock("@/lib/server/google-session", () => ({ bindGoogleNonce: vi.fn() }));
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
// Keep next/navigation's real redirect implementation: it throws framework
// control flow. A no-op mock would hide successful mutations being caught.
import { completeStagedUnlink, saveAccountPassword } from "./actions";
import { readAuthOperation, sealAuthOperation, sessionFingerprint, type AuthOperation } from "@/lib/server/stagedAuth";

const actor = { accountId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000002" };
function form(extra: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...actor, accountRevision: "2", userRevision: "3", operationRef: "current-unlink", ...extra })) result.set(key, value);
  return result;
}
beforeEach(async () => {
  boundary.jar.clear();
  boundary.complete.mockReset(); boundary.start.mockReset(); boundary.claims.mockReset();
  boundary.claims.mockResolvedValue({ backendAccountId: actor.accountId, backendUserId: actor.userId, backendAccessToken: "original-session-fixture" });
  boundary.start.mockResolvedValue({ attempt_id: "credential-attempt", attempt_secret: "fixture-attempt-secret" });
  const operation: AuthOperation = {
    ref: "current-unlink", intent: "unlink_provider", reauthProvider: "google", unlinkProvider: "apple",
    reauthChallengeId: "current-proof", clientLabel: "talent-signal-web", ...actor,
    sessionFingerprint: sessionFingerprint("original-session-fixture"), accountRevision: 2, userRevision: 3,
    step: "awaiting-reauth", createdAt: new Date().toISOString(),
    attempt: { attempt_id: "credential-attempt", attempt_secret: "fixture-attempt-secret", challenge_id: "current-proof", challenge_nonce: "fixture-nonce" },
  };
  await sealAuthOperation(operation, false);
});

describe("credential completion outcome", () => {
  it("does not catch the real success redirect after a staged unlink commits", async () => {
    boundary.complete.mockResolvedValue({ status: "unlinked", settings: {} });
    await expect(completeStagedUnlink(form())).rejects.toMatchObject({
      digest: expect.stringContaining("/workspace/settings?section=account&link=done"),
    });
    expect(boundary.complete).toHaveBeenCalledExactlyOnceWith({ attempt_id: "credential-attempt", attempt_secret: "fixture-attempt-secret" });
    expect(await readAuthOperation()).toBeNull();
  });

  it("keeps a lost unlink response uncertain and never repeats the mutation", async () => {
    boundary.complete.mockRejectedValue(new TypeError("Response lost after server commit"));
    await expect(completeStagedUnlink(form())).rejects.toMatchObject({
      digest: expect.stringContaining("/workspace/settings?section=account&link=error"),
    });
    expect(boundary.complete).toHaveBeenCalledTimes(1);
  });

  it.each(["missing-ref", "old-ref", "changed-session"])("refuses %s before consuming a staged unlink", async (kind) => {
    const submitted = form();
    if (kind === "missing-ref") submitted.delete("operationRef");
    if (kind === "old-ref") submitted.set("operationRef", "another-operation");
    if (kind === "changed-session") boundary.claims.mockResolvedValue({
      backendAccountId: actor.accountId, backendUserId: actor.userId, backendAccessToken: "sibling-session-fixture",
    });
    boundary.complete.mockResolvedValue({ status: "unlinked", settings: {} });
    await expect(completeStagedUnlink(submitted)).rejects.toMatchObject({
      digest: expect.stringContaining("/workspace/settings?section=account&link=error"),
    });
    expect(boundary.complete).not.toHaveBeenCalled();
  });

  it("does not claim an unconfirmed password mutation had no effect", async () => {
    boundary.complete.mockRejectedValue(new TypeError("Response lost after server commit"));
    const state = await saveAccountPassword({}, form({ currentPassword: "fixture-old-password", newPassword: "fixture-new-password", hasPassword: "true" }));
    expect(boundary.complete).toHaveBeenCalledTimes(1);
    expect(state.saved).not.toBe(true);
    expect(state.error).toContain("无法确认");
    expect(state.error).not.toContain("未生效");
  });
});
