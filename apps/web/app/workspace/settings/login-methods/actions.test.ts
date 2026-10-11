import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  accountSettings: vi.fn(),
  createGoogleLoginChallenge: vi.fn(),
  createAppleLoginChallenge: vi.fn(),
  startLoginMethodChange: vi.fn(),
  completeLoginMethodChange: vi.fn(),
  sealCredentialAttempt: vi.fn(),
  readSealedCredentialAttempt: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({
  readPrimaryBackendSessionClaims: mocks.claims,
  authenticatedBackendClient: vi.fn(async () => ({
    accountSettings: mocks.accountSettings,
    createGoogleLoginChallenge: mocks.createGoogleLoginChallenge,
    createAppleLoginChallenge: mocks.createAppleLoginChallenge,
  })),
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
}));
vi.mock("@/lib/server/loginMethods", () => ({
  startLoginMethodChange: mocks.startLoginMethodChange,
  completeLoginMethodChange: mocks.completeLoginMethodChange,
  sealCredentialAttempt: mocks.sealCredentialAttempt,
}));
vi.mock("@/lib/server/stagedAuth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readAuthOperation: vi.fn().mockResolvedValue(null),
  readAuthProof: vi.fn().mockResolvedValue(null),
  clearStagedAuth: vi.fn(),
  sealAuthOperation: vi.fn(),
  sealAuthRound: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/google-session", () => ({ bindGoogleNonce: vi.fn(async (url: string) => url) }));
vi.mock("@/lib/server/apple-session", () => ({ bindAppleNonce: vi.fn(async (url: string) => url) }));
vi.mock("@/auth", () => ({ signIn: vi.fn(async () => "https://accounts.example.test/authorize?fixture=1") }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
      digest: `NEXT_REDIRECT;push;${url};307;`,
    });
  }),
}));

import { sealAuthOperation, readAuthOperation, type AuthOperation } from "@/lib/server/stagedAuth";
import {
  continueTargetLink,
  saveAccountPassword,
  startPasswordStepUpLink,
  startProviderReauth,
  unlinkLoginMethod,
} from "./actions";

function formOf(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const renderedScope = {
  accountId: "10000000-0000-4000-8000-00000000000a",
  userId: "20000000-0000-4000-8000-00000000000b",
  accountRevision: "2",
  userRevision: "2",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.mocked(sealAuthOperation).mockClear();
  vi.mocked(readAuthOperation).mockResolvedValue(null);
  // The rival account B is signed in with the SAME revisions and password.
  mocks.claims.mockResolvedValue({
    backendAccessToken: "bearer-b",
    backendAccountId: "30000000-0000-4000-8000-00000000000c",
    backendUserId: "40000000-0000-4000-8000-00000000000d",
  });
  mocks.accountSettings.mockResolvedValue({
    workspace: { revision: 2 },
    user: { revision: 2 },
  });
  mocks.startLoginMethodChange.mockResolvedValue({
    attempt_id: "attempt-1",
    attempt_secret: "secret",
    provider_challenge: { challenge_id: "target-challenge", nonce: "target-nonce" },
  });
  mocks.completeLoginMethodChange.mockResolvedValue({
    status: "password_set",
    settings: { sign_in_methods: [] },
  });
});

describe("rendered actor binding", () => {
  it("refuses a stale form on another signed-in account even with identical revisions and password", async () => {
    const state = await saveAccountPassword(
      {},
      formOf({
        ...renderedScope,
        currentPassword: "same-password",
        newPassword: "brand-new-password",
        hasPassword: "true",
      }),
    );
    // Account B is live; A's form must not mutate B or even mint an attempt.
    expect(state.error).toContain("登录账户已变化");
    expect(state.data).toBeUndefined();
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(mocks.completeLoginMethodChange).not.toHaveBeenCalled();
  });

  it("refuses unlink for a stale actor the same way", async () => {
    const state = await unlinkLoginMethod(
      {},
      formOf({
        ...renderedScope,
        provider: "google",
        currentPassword: "same-password",
      }),
    );
    expect(state.error).toContain("登录账户已变化");
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
  });

  it("proceeds when the rendered actor matches the live session", async () => {
    mocks.claims.mockResolvedValue({
      backendAccessToken: "bearer-a",
      backendAccountId: renderedScope.accountId,
      backendUserId: renderedScope.userId,
    });
    const state = await saveAccountPassword(
      {},
      formOf({
        ...renderedScope,
        currentPassword: "same-password",
        newPassword: "brand-new-password",
        hasPassword: "true",
      }),
    );
    expect(state.error).toBeUndefined();
    // The rendered revisions are the authorization the backend enforces.
    expect(mocks.startLoginMethodChange).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_account_revision: 2,
        expected_user_revision: 2,
      }),
    );
    expect(mocks.completeLoginMethodChange).toHaveBeenCalled();
  });

  it("rejects when live revisions drifted from the rendered form", async () => {
    mocks.claims.mockResolvedValue({
      backendAccessToken: "bearer-a",
      backendAccountId: renderedScope.accountId,
      backendUserId: renderedScope.userId,
    });
    mocks.accountSettings.mockResolvedValue({
      workspace: { revision: 3 },
      user: { revision: 2 },
    });
    const state = await saveAccountPassword(
      {},
      formOf({
        ...renderedScope,
        currentPassword: "same-password",
        newPassword: "brand-new-password",
        hasPassword: "true",
      }),
    );
    expect(state.error).toContain("登录账户已变化");
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
  });
});

const macCallback = "/desktop-auth/authorize?attempt=a&state=b";

function liveAsRenderedActor() {
  mocks.claims.mockResolvedValue({
    backendAccessToken: "bearer-a",
    backendAccountId: renderedScope.accountId,
    backendUserId: renderedScope.userId,
  });
}

function stagedOperation(): Record<string, unknown> {
  return vi.mocked(sealAuthOperation).mock.calls.at(-1)![0] as Record<string, unknown>;
}

describe("link continuity (GET-141)", () => {
  it("seals the sanitized return hint with a password-first link and drops forged targets", async () => {
    liveAsRenderedActor();
    await expect(
      startPasswordStepUpLink(
        {},
        formOf({
          ...renderedScope,
          currentPassword: "same-password",
          targetProvider: "google",
          returnTo: macCallback,
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(stagedOperation()).toMatchObject({
      intent: "link_provider",
      targetProvider: "google",
      returnTo: macCallback,
      step: "awaiting-target",
    });
    // The password crossed only the direct step-up; nothing token-like is
    // retained in the sealed navigation state.
    expect(JSON.stringify(stagedOperation())).not.toContain("same-password");
    expect(mocks.startLoginMethodChange).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "link_provider",
        provider: "google",
        step_up: { kind: "password", password: "same-password" },
      }),
    );

    // A forged external target never becomes a redirect destination.
    vi.mocked(sealAuthOperation).mockClear();
    await expect(
      startPasswordStepUpLink(
        {},
        formOf({
          ...renderedScope,
          currentPassword: "same-password",
          targetProvider: "google",
          returnTo: "https://evil.example/steal",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(stagedOperation().returnTo).toBeUndefined();
  });

  it("lets a provider-only owner start the link with a linked provider and no password", async () => {
    liveAsRenderedActor();
    mocks.createAppleLoginChallenge.mockResolvedValue({
      challenge_id: "reauth-challenge",
      nonce: "reauth-nonce",
    });
    await expect(
      startProviderReauth(
        formOf({
          ...renderedScope,
          intent: "link_provider",
          reauthProvider: "apple",
          targetProvider: "google",
          returnTo: macCallback,
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // The current identity is proven with the linked provider; the fresh
    // target proof happens on its own round after reauthentication.
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(stagedOperation()).toMatchObject({
      intent: "link_provider",
      reauthProvider: "apple",
      targetProvider: "google",
      returnTo: macCallback,
      step: "awaiting-reauth",
    });
  });

  it("keeps the stale cross-account scope refusal on the continuity path too", async () => {
    // Account B stays signed in; A's rendered form must not mint an attempt.
    await expect(
      startPasswordStepUpLink(
        {},
        formOf({
          ...renderedScope,
          currentPassword: "same-password",
          targetProvider: "google",
          returnTo: macCallback,
        }),
      ),
    ).rejects.toThrow(/link=error/);
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(vi.mocked(sealAuthOperation)).not.toHaveBeenCalled();
  });

  it("keeps validated hints on a mid-flow failure instead of dropping navigation", async () => {
    liveAsRenderedActor();
    mocks.startLoginMethodChange.mockRejectedValue(new Error("backend down"));
    await expect(
      startPasswordStepUpLink(
        {},
        formOf({
          ...renderedScope,
          currentPassword: "same-password",
          targetProvider: "google",
          returnTo: macCallback,
        }),
      ),
    ).rejects.toThrow(
      new RegExp(`link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`),
    );
  });

  it("uses sealed operation hints for continueTargetLink failures, over form forgeries", async () => {
    const operation: AuthOperation = {
      ref: "current-link",
      intent: "link_provider",
      reauthProvider: "google",
      reauthChallengeId: "target-challenge",
      clientLabel: "talent-signal-web",
      targetProvider: "google",
      accountId: renderedScope.accountId,
      userId: renderedScope.userId,
      sessionFingerprint: "fixture-fingerprint",
      accountRevision: 2,
      userRevision: 2,
      step: "awaiting-target",
      returnTo: macCallback,
      createdAt: new Date().toISOString(),
      attempt: {
        attempt_id: "attempt-1",
        attempt_secret: "secret",
        challenge_id: "target-challenge",
        challenge_nonce: "target-nonce",
      },
    };
    vi.mocked(readAuthOperation).mockResolvedValue(operation);
    await expect(
      continueTargetLink(
        formOf({
          ...renderedScope,
          operationRef: "stale-other-flow",
          returnTo: "https://evil.example/steal",
        }),
      ),
    ).rejects.toThrow(
      new RegExp(`link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`),
    );
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(mocks.completeLoginMethodChange).not.toHaveBeenCalled();
  });
});
