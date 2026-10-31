import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type CredentialChangeResult } from "@talent-signal/contracts";
import type { BackendSessionClaims } from "@/lib/server/backendAuth";

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
import { completeStagedPassword, completeStagedUnlink, saveAccountPassword } from "./actions";
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


describe("staged password completion recovery (GET-350)", () => {
  const syntheticSession: BackendSessionClaims = {
    backendSessionId: "30000000-0000-4000-8000-000000000003",
    backendAccessToken: "synthetic-staged-password-access-token",
    backendAccountId: actor.accountId,
    backendAccountName: "Synthetic account",
    backendAccountSlug: "synthetic-account",
    backendExpiresAt: "2026-10-31T01:00:00.000Z",
    backendRole: "admin",
    backendUserId: actor.userId,
    backendUsername: null,
  };
  const syntheticCompletion: CredentialChangeResult = {
    contract_version: CONTRACT_VERSION,
    status: "password_set",
    settings: {
      contract_version: CONTRACT_VERSION,
      user: {
        id: actor.userId, email: "synthetic-owner@example.test",
        display_name: "Synthetic owner", username: null, kind: "google_human",
        revision: 3, login_methods: ["google", "password"],
        email_verified_at: "2026-10-31T00:00:00.000Z",
      },
      sign_in_methods: [
        { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
        { provider: "google", state: "connected", hint: null, can_unlink: true },
        { provider: "password", state: "connected", hint: null, can_unlink: true },
      ],
      email_ownership_state: "verified",
      workspace: {
        id: actor.accountId, name: "Synthetic account", slug: "synthetic-account",
        revision: 3, owner_user_id: actor.userId, role: "admin", is_owner: true,
        can_manage: true, is_test: false,
      },
      sessions: [], members: [], activity: [], lab_enabled: false,
    },
  };

  beforeEach(async () => {
    // The already-sealed operation is one minute old. Completing it must not
    // mint a new operation or restart its original absolute lifetime.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-31T00:01:00.000Z"));
    boundary.claims.mockResolvedValue(syntheticSession);
    await sealAuthOperation({
      ref: "60000000-0000-4000-8000-000000000006", intent: "change_password",
      reauthProvider: "google", reauthChallengeId: "50000000-0000-4000-8000-000000000005",
      clientLabel: "talent-signal-web", ...actor,
      sessionFingerprint: sessionFingerprint(syntheticSession),
      accountRevision: 2, userRevision: 3, step: "awaiting-reauth",
      createdAt: "2026-10-31T00:00:00.000Z",
      attempt: {
        attempt_id: "40000000-0000-4000-8000-000000000004",
        attempt_secret: "synthetic-credential-attempt-secret",
        challenge_id: "50000000-0000-4000-8000-000000000005",
        challenge_nonce: "synthetic-current-nonce",
      },
    }, false);
  });
  afterEach(() => vi.useRealTimers());

  it.each(["transport unknown", "completion received"] as const)(
    "retains the original staged password operation after %s until browser confirmation",
    async (outcome) => {
      // Only the external backend completion boundary is controlled. This
      // unit does not claim that a real database committed or a browser lost
      // a response; those need separate PostgreSQL and HTTP evidence.
      if (outcome === "transport unknown") {
        boundary.complete.mockRejectedValue(new TypeError("Synthetic transport loss"));
      } else {
        boundary.complete.mockResolvedValue(syntheticCompletion);
      }
      await completeStagedPassword({}, form({
        operationRef: "60000000-0000-4000-8000-000000000006",
        newPassword: "synthetic-new-password",
      }));

      // Guard against a false green from a stale-scope early return: the
      // actual action must have reached the one intended backend operation.
      expect(boundary.complete).toHaveBeenCalledExactlyOnceWith({
        attempt_id: "40000000-0000-4000-8000-000000000004",
        attempt_secret: "synthetic-credential-attempt-secret",
        password: "synthetic-new-password",
      });
      expect(await readAuthOperation()).toMatchObject({
        ref: "60000000-0000-4000-8000-000000000006",
        createdAt: "2026-10-31T00:00:00.000Z",
        attempt: {
          attempt_id: "40000000-0000-4000-8000-000000000004",
          attempt_secret: "synthetic-credential-attempt-secret",
          challenge_id: "50000000-0000-4000-8000-000000000005",
          challenge_nonce: "synthetic-current-nonce",
        },
      });
    },
  );
});
