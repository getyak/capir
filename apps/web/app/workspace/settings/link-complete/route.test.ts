import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  claims: vi.fn(),
  client: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      boundary.jar.has(name) ? { value: boundary.jar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      boundary.jar.set(name, value);
    },
    delete: (name: string) => {
      boundary.jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "link-complete-return-fixture-secret",
  backendAuthBaseUrl: () => "https://backend.example.invalid",
  readPrimaryBackendSessionClaims: boundary.claims,
  authenticatedBackendClient: async () => ({ accountSettings: boundary.client }),
}));
vi.mock("@/lib/server/loginMethods", () => ({
  startLoginMethodChange: boundary.start,
  completeLoginMethodChange: boundary.complete,
}));
// Keep next/navigation's real redirect: it throws framework control flow.

import {
  AUTH_OPERATION_COOKIE,
  AUTH_PROOF_COOKIE,
  AUTH_ROUND_COOKIE,
  flowExpiresAt,
  sealAuthOperation,
  sealAuthProof,
  sealAuthRound,
  sessionFingerprint,
  type AuthOperation,
} from "@/lib/server/stagedAuth";
import { GET } from "./route";

const actor = {
  accountId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
};
const macCallback = "/desktop-auth/authorize?attempt=a&state=b";

function operation(overrides: Partial<AuthOperation> = {}): AuthOperation {
  return {
    ref: "current-link",
    intent: "link_provider",
    reauthProvider: "google",
    reauthChallengeId: "target-challenge",
    clientLabel: "talent-signal-web",
    targetProvider: "google",
    ...actor,
    sessionFingerprint: sessionFingerprint("original-session-fixture"),
    accountRevision: 2,
    userRevision: 3,
    step: "awaiting-target",
    returnTo: macCallback,
    attempt: {
      attempt_id: "credential-attempt",
      attempt_secret: "fixture-attempt-secret",
      challenge_id: "target-challenge",
      challenge_nonce: "fixture-nonce",
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function stageTargetRound(op: AuthOperation) {
  await sealAuthOperation(op, false);
  await sealAuthRound(
    {
      roundRef: "round-target",
      flowRef: op.ref,
      role: "target",
      provider: "google",
      challengeId: op.attempt!.challenge_id,
      purpose: "target",
      createdAt: op.createdAt,
      expiresAt: flowExpiresAt(op),
    },
    false,
  );
}

async function runGet(): Promise<string> {
  const error = await GET().then(
    () => null,
    (caught: unknown) => caught as { digest?: string },
  );
  expect(error?.digest).toMatch(/^NEXT_REDIRECT/);
  // `NEXT_REDIRECT;<type>;<url>;<status>;<extra>`; none of our targets carry
  // a semicolon, so the third segment is the exact redirect target.
  return error!.digest!.split(";")[2]!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-11T00:00:00.000Z"));
  boundary.jar.clear();
  boundary.claims.mockReset();
  boundary.client.mockReset();
  boundary.start.mockReset();
  boundary.complete.mockReset();
  boundary.claims.mockResolvedValue({
    backendAccessToken: "original-session-fixture",
    backendAccountId: actor.accountId,
    backendUserId: actor.userId,
  });
  boundary.client.mockResolvedValue({
    workspace: { revision: 2 },
    user: { revision: 3 },
  });
  boundary.complete.mockResolvedValue({ settings: {} });
});

describe("link completion redirects (GET-141 continuity)", () => {
  it("claims success only after the backend call and continues to the original callback", async () => {
    const op = operation();
    await stageTargetRound(op);
    await sealAuthProof(
      {
        ref: op.ref,
        roundRef: "round-target",
        purpose: "target",
        provider: "google",
        challengeId: "target-challenge",
        identityToken: "fresh-google-proof",
        stagedAt: new Date().toISOString(),
      },
      "current",
    );
    expect(await runGet()).toBe(
      `/workspace/settings?link=done&method=google&state=connected&returnTo=${encodeURIComponent(macCallback)}`,
    );
    // The fresh target proof is what completes the attempt, and success is
    // never claimed without this authoritative backend call.
    expect(boundary.complete).toHaveBeenCalledWith({
      attempt_id: "credential-attempt",
      attempt_secret: "fixture-attempt-secret",
      identity_token: "fresh-google-proof",
    });
    // One-use: nothing staged survives completion.
    expect(boundary.jar.has(AUTH_OPERATION_COOKIE)).toBe(false);
    expect(boundary.jar.has(AUTH_ROUND_COOKIE)).toBe(false);
    expect(boundary.jar.has(AUTH_PROOF_COOKIE)).toBe(false);
  });

  it("keeps a cancelled or expired round recoverable: no write, retry hint, return escape", async () => {
    // The user cancelled the Google round: no staged proof arrives.
    await stageTargetRound(operation());
    expect(await runGet()).toBe(
      `/workspace/settings?link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    expect(boundary.complete).not.toHaveBeenCalled();
    expect(boundary.start).not.toHaveBeenCalled();

    // Expired flow fails closed the same way, still recoverable in Settings.
    boundary.jar.clear();
    const op = operation({ createdAt: new Date(Date.now() - 700_000).toISOString() });
    await stageTargetRound(op);
    expect(await runGet()).toBe(
      `/workspace/settings?link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    expect(boundary.complete).not.toHaveBeenCalled();
    expect(boundary.start).not.toHaveBeenCalled();
  });

  it("fails closed for a switched account or stale revisions without any write", async () => {
    // Cross-account: another session on different ids renders nothing.
    boundary.claims.mockResolvedValue({
      backendAccessToken: "other-session-fixture",
      backendAccountId: "99999999-0000-4000-8000-000000000009",
      backendUserId: "99999999-0000-4000-8000-000000000008",
    });
    await stageTargetRound(operation());
    await sealAuthProof(
      {
        ref: "current-link",
        roundRef: "round-target",
        purpose: "target",
        provider: "google",
        challengeId: "target-challenge",
        identityToken: "fresh-google-proof",
        stagedAt: new Date().toISOString(),
      },
      "current",
    );
    expect(await runGet()).toContain("link=error");
    expect(boundary.complete).not.toHaveBeenCalled();

    // Stale scope: a change landed after the authorization was rendered.
    boundary.jar.clear();
    boundary.claims.mockResolvedValue({
      backendAccessToken: "original-session-fixture",
      backendAccountId: actor.accountId,
      backendUserId: actor.userId,
    });
    boundary.client.mockResolvedValue({
      workspace: { revision: 7 },
      user: { revision: 3 },
    });
    await stageTargetRound(operation());
    expect(await runGet()).toContain("link=error");
    expect(boundary.complete).not.toHaveBeenCalled();
  });

  it("drops a forged return hint sealed into an operation", async () => {
    const op = operation({ returnTo: "https://evil.example/steal" });
    await stageTargetRound(op);
    await sealAuthProof(
      {
        ref: op.ref,
        roundRef: "round-target",
        purpose: "target",
        provider: "google",
        challengeId: "target-challenge",
        identityToken: "fresh-google-proof",
        stagedAt: new Date().toISOString(),
      },
      "current",
    );
    const target = await runGet();
    expect(target).not.toContain("evil.example");
    expect(target).not.toContain("returnTo=");
  });
});
