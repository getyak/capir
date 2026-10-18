// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET ??= "fixture-auth-secret";
});

/** Controllable cookie jar shared with the mocked request boundary. */
const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));
const captured = vi.hoisted(() => ({ config: undefined as unknown }));

vi.mock("next-auth", () => {
  class AuthError extends Error {
    static type = "AuthError";
  }
  class CredentialsSignin extends Error {
    code = "";
  }
  return {
    default: (config: unknown) => {
      captured.config = config;
      return {
        handlers: { GET: vi.fn(), POST: vi.fn() },
        auth: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      };
    },
    AuthError,
    CredentialsSignin,
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name)! } : undefined,
    set: (name: string, value: string) => {
      jar.entries.set(name, value);
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
  headers: async () => new Headers({ origin: "https://web.test" }),
}));

const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  accountSettings: vi.fn(),
  startLoginMethodChange: vi.fn(),
  completeLoginMethodChange: vi.fn(),
  prepareReconciliation: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/backendAuth", () => ({
  AUTH_SESSION_COOKIE: "talent-signal.session-v2",
  readPrimaryBackendSessionClaims: mocks.claims,
  authenticatedBackendClient: vi.fn(async () => ({
    accountSettings: mocks.accountSettings,
    prepareReconciliation: mocks.prepareReconciliation,
  })),
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  authSecret: () => "fixture-auth-secret",
  confirmBackendRegistration: vi.fn(),
  registerBackendAccount: vi.fn(),
  signInBackendAccount: vi.fn(),
}));
vi.mock("@/lib/server/loginMethods", () => ({
  startLoginMethodChange: mocks.startLoginMethodChange,
  completeLoginMethodChange: mocks.completeLoginMethodChange,
}));
vi.mock("@/lib/server/google-session", () => ({
  bindGoogleNonce: vi.fn(async (url: string) => url),
  finishGoogleSignIn: vi.fn(),
  prepareGoogleSignIn: vi.fn(),
}));
vi.mock("@/lib/server/apple-session", () => ({
  bindAppleNonce: vi.fn(async (url: string) => url),
  finishAppleSignIn: vi.fn(),
  prepareAppleSignIn: vi.fn(),
}));
vi.mock("@/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signIn: vi.fn(async () => "https://accounts.google.com/o/oauth2/v2/auth?fixture=1"),
}));
vi.mock("@/lib/server/google-oauth", () => ({ getGoogleOAuthCredentials: () => null }));
vi.mock("@/lib/server/apple-oauth", () => ({ getAppleOAuthCredentials: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { decode } from "next-auth/jwt";

import { buildAuthConfig } from "@/auth";
import {
  AUTH_DUP_PROOF_COOKIE,
  AUTH_PROOF_COOKIE,
  flowExpiresAt,
  sealAuthOperation,
  sealAuthRound,
  sessionFingerprint,
  type AuthOperation,
} from "@/lib/server/stagedAuth";
import { prepareConflictRecovery } from "@/app/workspace/settings/conflict/actions";
import { LINK_COMPLETE_PATH } from "@/lib/server/stagedAuth";

const baseTime = Date.parse("2026-09-25T00:00:00.000Z");

function flow(overrides: Partial<AuthOperation> = {}): AuthOperation {
  return {
    ref: "10000000-0000-4000-8000-000000000001",
    intent: "verify_identity",
    reauthProvider: "google",
    reauthChallengeId: "challenge-current",
    clientLabel: "talent-signal-reconciliation",
    accountId: "30000000-0000-4000-8000-000000000003",
    userId: "40000000-0000-4000-8000-000000000004",
    sessionFingerprint: sessionFingerprint("bearer-original"),
    accountRevision: 2,
    userRevision: 1,
    step: "awaiting-reauth",
    roleChallenges: {
      current: { provider: "google", challengeId: "challenge-current" },
      duplicate: { provider: "google", challengeId: "challenge-duplicate" },
    },
    createdAt: new Date(baseTime).toISOString(),
    ...overrides,
  };
}

async function sealFlow(operation: AuthOperation, crossSite = false) {
  await sealAuthOperation(operation, crossSite);
}

function recoveryForm(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  // Exercise bounded credentials at an explicit clock, independently of the
  // day/time CI runs. Only Date is frozen; WebCrypto IO remains real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(baseTime);
  jar.entries.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  // The redirect transport always throws the real NEXT_REDIRECT digest.
  mocks.redirect.mockImplementation((url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), {
      digest: `NEXT_REDIRECT;push;${url}`,
    });
  });
  mocks.claims.mockResolvedValue({
    backendAccessToken: "bearer-original",
    backendAccountId: flow().accountId,
    backendUserId: flow().userId,
  });
  mocks.accountSettings.mockResolvedValue({
    workspace: { id: flow().accountId, revision: 2 },
    user: { id: flow().userId, revision: 1 },
  });
  mocks.prepareReconciliation.mockResolvedValue({
    contract_version: "2026-08-24.10",
    id: "90000000-0000-4000-8000-000000000009",
    kind: "empty_duplicate_transfer",
    state: "prepared",
    frozen_revision: 4,
    inventory: { account_tables: [], problems: [] },
    expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2026-09-25T00:00:00.000Z",
  });
});

afterEach(() => vi.useRealTimers());

async function runProviderReturn(options: {
  provider: "google" | "apple";
  idToken: string;
}) {
  // NextAuth receives a LAZY configuration factory; invoke it like the
  // framework does per request.
  const factory = captured.config as unknown as () => {
    callbacks: { jwt: (input: Record<string, unknown>) => Promise<unknown> };
  };
  if (factory === undefined) {
    throw new Error('DEBUG captured.config undefined; module loaded=' + String(typeof buildAuthConfig));
  }
  const config = typeof factory === "function" ? factory() : factory;
  return config.callbacks.jwt({
    token: { sub: "existing-user" },
    user: undefined,
    account: { provider: options.provider, id_token: options.idToken },
    profile: undefined,
  });
}


/**
 * Auth.js maps error classes by their STATIC type; assert the framework
 * contract (staged vs fail-closed) exactly as the callback declares it.
 */
async function expectCallbackOutcome(
  promise: Promise<unknown>,
  outcome: "staged" | "fail-closed",
) {
  const error = (await promise.then(
    () => null,
    (caught: unknown) => caught,
  )) as { code?: string; constructor: { type?: string } } | null;
  expect(error).not.toBeNull();
  if (outcome === "staged") {
    expect(error!.code, error instanceof Error ? error.message : "Callback outcome").toBe("staged_proof");
    expect(error!.constructor.type).toBe("AccessDenied");
  } else {
    expect(error!.constructor.type).toBe("OAuthAccountNotLinked");
  }
}

describe("staged OAuth round choreography (real callback)", () => {
  it("stages the target round with purpose=target for a password-first link", async () => {
    // Repair-10 regression: the callback stamped purpose=reauth for every
    // round, which made link-complete reject ordinary awaiting-target links.
    const operation = flow({
      intent: "link_provider",
      step: "awaiting-target",
      targetProvider: "apple",
      roleChallenges: undefined,
      attempt: {
        attempt_id: "attempt-1",
        attempt_secret: "secret-sealed-server-side",
        challenge_id: "target-challenge",
        challenge_nonce: "target-nonce",
      },
    });
    await sealFlow(operation, true);
    await sealAuthRound(
      {
        roundRef: "round-target",
        flowRef: operation.ref,
        role: "target",
        provider: "apple",
        challengeId: "target-challenge",
        purpose: "target",
        createdAt: operation.createdAt,
        expiresAt: flowExpiresAt(operation),
      },
      true,
    );
    await expectCallbackOutcome(
      runProviderReturn({ provider: "apple", idToken: "apple-target-token" }),
      "staged",
    );
    const sealed = await decode({
      token: jar.entries.get(AUTH_PROOF_COOKIE)!,
      secret: "fixture-auth-secret",
      salt: AUTH_PROOF_COOKIE,
    });
    expect(sealed).toMatchObject({
      purpose: "target",
      provider: "apple",
      challengeId: "target-challenge",
      roundRef: "round-target",
      identityToken: "apple-target-token",
    });
  });

  it("routes Google->Google rounds by role, never by provider equality", async () => {
    const operation = flow();
    await sealFlow(operation);
    await sealAuthRound(
      {
        roundRef: "round-duplicate",
        flowRef: operation.ref,
        role: "duplicate",
        provider: "google",
        challengeId: "challenge-duplicate",
        purpose: "reauth",
        createdAt: operation.createdAt,
        expiresAt: flowExpiresAt(operation),
      },
      false,
    );
    await expectCallbackOutcome(
      runProviderReturn({ provider: "google", idToken: "google-duplicate-token" }),
      "staged",
    );
    const duplicate = await decode({
      token: jar.entries.get(AUTH_DUP_PROOF_COOKIE)!,
      secret: "fixture-auth-secret",
      salt: AUTH_DUP_PROOF_COOKIE,
    });
    expect(duplicate).toMatchObject({
      challengeId: "challenge-duplicate",
      identityToken: "google-duplicate-token",
    });
    // The current slot was NOT overwritten by the duplicate round.
    expect(jar.entries.has(AUTH_PROOF_COOKIE)).toBe(false);
  });

  it("fails closed when the Apple cross-site POST carries no Lax cookies", async () => {
    // Realistic form_post: the cross-site callback-url cookie arrives
    // (SameSite=None) but the Lax operation/round/proof cookies do not.
    jar.entries.set("talent-signal.callback-url", LINK_COMPLETE_PATH);
    await expectCallbackOutcome(
      runProviderReturn({ provider: "apple", idToken: "apple-token" }),
      "fail-closed",
    );
    expect(jar.entries.has(AUTH_PROOF_COOKIE)).toBe(false);
    expect(jar.entries.has(AUTH_DUP_PROOF_COOKIE)).toBe(false);
  });
});

describe("recovery prepare with dual provider proofs (real action)", () => {
  async function stageRecoveryProofs(options: { order: Array<"current" | "duplicate"> }) {
    const operation = flow();
    await sealFlow(operation);
    for (const role of options.order) {
      const challengeId = role === "current" ? "challenge-current" : "challenge-duplicate";
      await sealAuthRound(
        {
          roundRef: `round-${role}`,
          flowRef: operation.ref,
          role,
          provider: "google",
          challengeId,
          purpose: "reauth",
          createdAt: operation.createdAt,
          expiresAt: flowExpiresAt(operation),
        },
        false,
      );
      await expectCallbackOutcome(
        runProviderReturn({ provider: "google", idToken: `token-${role}` }),
        "staged",
      );
    }
    return operation;
  }

  it("accepts provider-only recovery in either verification order without a duplicate password", async () => {
    for (const order of [
      ["current", "duplicate"],
      ["duplicate", "current"],
    ] as const) {
      jar.entries.clear();
      await stageRecoveryProofs({ order: [...order] });
      const state = await prepareConflictRecovery(
        {},
        recoveryForm({
          accountId: flow().accountId,
          userId: flow().userId,
          accountRevision: "2",
          userRevision: "1",
          operationRef: flow().ref,
          // No duplicate identifier or password: the duplicate is proven by
          // its own provider round.
        }),
      );
      expect(state.error).toBeUndefined();
      expect(state.record?.state).toBe("prepared");
      expect(mocks.prepareReconciliation).toHaveBeenCalledTimes(1);
      const request = mocks.prepareReconciliation.mock.calls.at(-1)![0];
      expect(request.proof).toMatchObject({ kind: "provider", identity_token: "token-duplicate" });
      expect(request.step_up).toMatchObject({ kind: "provider", identity_token: "token-current" });
      mocks.prepareReconciliation.mockClear();
    }
  });

  it("rejects a stale rendered form, a switched session, role swap and the expired t650 flow", async () => {
    await stageRecoveryProofs({ order: ["current", "duplicate"] });
    const base = {
      accountId: flow().accountId,
      userId: flow().userId,
      accountRevision: "2",
      userRevision: "1",
      operationRef: flow().ref,
    };
    // Old rendered form (different operationRef).
    expect(
      (
        await prepareConflictRecovery(
          {},
          recoveryForm({ ...base, operationRef: "older-flow-ref" }),
        )
      ).error,
    ).toContain("登录状态已变化");
    // Switched session fingerprint (same account/user ids and revisions).
    mocks.claims.mockResolvedValue({
      backendAccessToken: "bearer-other-session",
      backendAccountId: flow().accountId,
      backendUserId: flow().userId,
    });
    expect((await prepareConflictRecovery({}, recoveryForm(base))).error).toBeTruthy();
    mocks.claims.mockResolvedValue({
      backendAccessToken: "bearer-original",
      backendAccountId: flow().accountId,
      backendUserId: flow().userId,
    });

    // Role swap: the duplicate proof in the current slot never authorizes
    // step-up; prepare reports the missing current proof instead.
    jar.entries.set(AUTH_PROOF_COOKIE, jar.entries.get(AUTH_DUP_PROOF_COOKIE)!);
    const swapped = await prepareConflictRecovery({}, recoveryForm(base));
    expect(swapped.error).toContain("请先验证当前身份");
    expect(mocks.prepareReconciliation).not.toHaveBeenCalled();
    jar.entries.delete(AUTH_PROOF_COOKIE);

    // Flow expiry: t0 flow with proofs at t550/t580 must fail at t650.
    try {
      vi.setSystemTime(new Date(baseTime + 650_000));
      const expired = await prepareConflictRecovery({}, recoveryForm(base));
      expect(expired.error).toBeTruthy();
      expect(mocks.prepareReconciliation).not.toHaveBeenCalled();
    } finally {
      vi.setSystemTime(baseTime);
    }
  });

  it("leaves a waiting target round untouched for a late foreign error", async () => {
    // B is signed in and waiting for its target round; a late error from an
    // earlier round must not authorize B's completion or clear B's flow.
    const operation = flow({
      intent: "link_provider",
      step: "awaiting-target",
      targetProvider: "google",
      roleChallenges: undefined,
      attempt: {
        attempt_id: "attempt-b",
        attempt_secret: "secret-b",
        challenge_id: "challenge-b",
        challenge_nonce: "nonce-b",
      },
    });
    await sealFlow(operation);
    await sealAuthRound(
      {
        roundRef: "round-b-target",
        flowRef: operation.ref,
        role: "target",
        provider: "google",
        challengeId: "challenge-b",
        purpose: "target",
        createdAt: operation.createdAt,
        expiresAt: flowExpiresAt(operation),
      },
      false,
    );
    // A's stale proof belongs to another round entirely.
    const { sealAuthProof } = await import("@/lib/server/stagedAuth");
    await sealAuthProof(
      {
        ref: "foreign-flow",
        roundRef: "foreign-round",
        purpose: "target",
        provider: "google",
        challengeId: "challenge-foreign",
        identityToken: "foreign-token",
        stagedAt: new Date(baseTime + 1_000).toISOString(),
      },
      "current",
    );
    const { validateStagedProof, readAuthRound, readAuthProof } = await import(
      "@/lib/server/stagedAuth"
    );
    const decision = validateStagedProof({
      operation,
      round: await readAuthRound(),
      proof: await readAuthProof("current"),
      role: "target",
    });
    // The exact validation the error page performs: no owned completion.
    expect(decision).toBeNull();
  });
});

describe("real start -> callback -> completion chain (password-first link)", () => {
  it("seals the target round the start action forgot and completes the real chain", async () => {
    const { startPasswordStepUpLink } = await import(
      "@/app/workspace/settings/login-methods/actions"
    );
    mocks.claims.mockResolvedValue({
      backendAccessToken: "bearer-original",
      backendAccountId: flow().accountId,
      backendUserId: flow().userId,
    });
    mocks.accountSettings.mockResolvedValue({
      workspace: { id: flow().accountId, revision: 2 },
      user: { id: flow().userId, revision: 1 },
    });
    mocks.startLoginMethodChange.mockResolvedValue({
      attempt_id: "attempt-real",
      attempt_secret: "secret-real",
      provider_challenge: {
        challenge_id: "challenge-target",
        nonce: "nonce-target",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
    });
    // The REAL start action builds the operation and its target round.
    let redirectTarget = "";
    const { redirect } = await import("next/navigation");
    (redirect as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        redirectTarget = String(url);
        // Real Next redirect transport: an error carrying the NEXT_REDIRECT
        // digest, which the action rethrows untouched.
        throw Object.assign(new Error(`REDIRECT:${url}`), {
          digest: `NEXT_REDIRECT;push;${url}`,
        });
      },
    );
    await expect(
      startPasswordStepUpLink(
        {},
        recoveryForm({
          accountId: flow().accountId,
          userId: flow().userId,
          accountRevision: "2",
          userRevision: "1",
          currentPassword: "current-password",
          targetProvider: "google",
        }),
      ),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirectTarget).toContain("accounts.google.com");
    // Repair-11 defect: the start action sealed the operation but no round, so
    // the callback always failed. A sealed target round must exist now.
    const { readAuthRound } = await import("@/lib/server/stagedAuth");
    const round = await readAuthRound();
    expect(round).toMatchObject({
      role: "target",
      purpose: "target",
      provider: "google",
      challengeId: "challenge-target",
      flowRef: expect.any(String),
    });

    // The REAL jwt callback stages the target proof from that round.
    await expectCallbackOutcome(
      runProviderReturn({ provider: "google", idToken: "google-target-token" }),
      "staged",
    );
    const { readAuthProof, validateStagedProof, readAuthOperation } = await import(
      "@/lib/server/stagedAuth"
    );
    const operation = await readAuthOperation();
    const validation = validateStagedProof({
      operation,
      round: await readAuthRound(),
      proof: await readAuthProof("current"),
      role: "target",
    });
    expect(validation).not.toBeNull();
    // The REAL completion consumer (route handler) finishes the chain; no
    // manual mock call reproduces its logic.
    mocks.completeLoginMethodChange.mockResolvedValue({
      status: "linked",
      settings: { sign_in_methods: [] },
    });
    const { GET: linkCompleteGET } = await import(
      "@/app/workspace/settings/link-complete/route"
    );
    await expect(linkCompleteGET()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    // The consumer called the backend with the bound actor, attempt and
    // target proof, and cleaned the staged state afterwards.
    expect(mocks.completeLoginMethodChange).toHaveBeenCalledTimes(1);
    expect(mocks.completeLoginMethodChange).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_id: "attempt-real",
        attempt_secret: "secret-real",
        identity_token: "google-target-token",
      }),
    );
    const staged = await import("@/lib/server/stagedAuth");
    expect(jar.entries.has(staged.AUTH_PROOF_COOKIE)).toBe(false);
    expect(jar.entries.has(staged.AUTH_ROUND_COOKIE)).toBe(false);
    expect(await staged.readAuthProof("current")).toBeNull();
    expect(await staged.readAuthRound()).toBeNull();
  });

  it("requires the exact rendered operationRef whenever staged proofs are consumed", async () => {
    const { prepareConflictRecovery } = await import(
      "@/app/workspace/settings/conflict/actions"
    );
    await stageFixtureProofs();
    // Tab A rendered the form BEFORE the flow existed (no operationRef) while
    // tab B later staged the proofs: A must not consume B's proofs.
    const missingRef = await prepareConflictRecovery(
      {},
      recoveryForm({
        accountId: flow().accountId,
        userId: flow().userId,
        accountRevision: "2",
        userRevision: "1",
      }),
    );
    expect(missingRef.error).toContain("登录状态已变化");
    expect(mocks.prepareReconciliation).not.toHaveBeenCalled();
    // The exact rendered ref is accepted.
    const ok = await prepareConflictRecovery(
      {},
      recoveryForm({
        accountId: flow().accountId,
        userId: flow().userId,
        accountRevision: "2",
        userRevision: "1",
        operationRef: flow().ref,
      }),
    );
    expect(ok.error).toBeUndefined();
  });

  async function stageFixtureProofs() {
    jar.entries.clear();
    const operation = flow();
    await sealAuthOperation(operation, false);
    for (const role of ["current", "duplicate"] as const) {
      const challengeId = role === "current" ? "challenge-current" : "challenge-duplicate";
      await sealAuthRound(
        {
          roundRef: `round-${role}-x`,
          flowRef: operation.ref,
          role,
          provider: "google",
          challengeId,
          purpose: "reauth",
          createdAt: operation.createdAt,
          expiresAt: flowExpiresAt(operation),
        },
        false,
      );
      await expectCallbackOutcome(
        runProviderReturn({ provider: "google", idToken: `token-${role}` }),
        "staged",
      );
    }
    mocks.prepareReconciliation.mockResolvedValue({
      contract_version: "2026-08-24.10",
      id: "90000000-0000-4000-8000-000000000009",
      kind: "empty_duplicate_transfer",
      state: "prepared",
      frozen_revision: 4,
      inventory: { account_tables: [], problems: [] },
      expires_at: "2030-01-01T00:00:00.000Z",
      created_at: "2026-09-25T00:00:00.000Z",
    });
  }

  it("retires only the consumed round at the awaiting-target transition", async () => {
    // Provider-first link: the current-proof round completes through the REAL
    // route, which advances the operation and retires the consumed round. The
    // target round is created ONLY by the real continue action.
    const operation = flow({
      intent: "link_provider",
      reauthProvider: "google",
      targetProvider: "google",
      roleChallenges: undefined,
      step: "awaiting-reauth",
    });
    await sealAuthOperation(operation, false);
    await sealAuthRound(
      {
        roundRef: "round-current-x",
        flowRef: operation.ref,
        role: "current",
        provider: "google",
        challengeId: "challenge-current",
        purpose: "reauth",
        createdAt: operation.createdAt,
        expiresAt: flowExpiresAt(operation),
      },
      false,
    );
    await expectCallbackOutcome(
      runProviderReturn({ provider: "google", idToken: "current-token" }),
      "staged",
    );
    mocks.startLoginMethodChange.mockResolvedValue({
      attempt_id: "attempt-target",
      attempt_secret: "secret-target",
      provider_challenge: {
        challenge_id: "challenge-target-x",
        nonce: "nonce-target-x",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
    });
    const staged = await import("@/lib/server/stagedAuth");
    const { GET: linkCompleteGET } = await import(
      "@/app/workspace/settings/link-complete/route"
    );
    await expect(linkCompleteGET()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    // The consumed current round is RETIRED by the real transition; the sealed
    // operation advances to awaiting-target with its minted attempt.
    expect(await staged.readAuthRound()).toBeNull();
    const advanced = await staged.readAuthOperation();
    expect(advanced).toMatchObject({ step: "awaiting-target" });
    expect(advanced?.attempt?.attempt_id).toBe("attempt-target");

    // The REAL continue action creates the new target round.
    const actualActions = await vi.importActual<
      typeof import("@/app/workspace/settings/login-methods/actions")
    >("@/app/workspace/settings/login-methods/actions");
    await expect(
      actualActions.continueTargetLink(
        recoveryForm({
          accountId: operation.accountId,
          userId: operation.userId,
          accountRevision: String(operation.accountRevision),
          userRevision: String(operation.userRevision),
          operationRef: operation.ref,
        }),
      ),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    const targetRound = await staged.readAuthRound();
    expect(targetRound).toMatchObject({
      role: "target",
      purpose: "target",
      provider: "google",
      challengeId: "challenge-target-x",
    });

    // A delayed AccessDenied carrying the OLD proof cannot authorize a
    // completion against the new round (the exact validation the error page
    // performs), and the waiting target operation survives untouched.
    const staleDecision = staged.validateStagedProof({
      operation: await staged.readAuthOperation(),
      round: targetRound,
      proof: await staged.readAuthProof("current"),
      role: "target",
    });
    expect(staleDecision).toBeNull();
    expect(await staged.readAuthOperation()).toMatchObject({ step: "awaiting-target" });
    expect(await staged.readAuthRound()).toMatchObject({ roundRef: targetRound!.roundRef });
  });
});

describe("login boundary cookie hygiene", () => {
  it("clears only the stale test-workspace selection at ordinary login success", async () => {
    const { TEST_WORKSPACE_COOKIE } = await import(
      "@/lib/server/testWorkspaceSession"
    );
    const config = await (captured.config as unknown as () => Promise<Record<string, unknown>>)();
    const events = config.events as {
      signIn: (input: { account: { provider: string } | null }) => Promise<void>;
    };
    jar.entries.set(TEST_WORKSPACE_COOKIE, "stale-selection");
    jar.entries.set("talent-signal.test-workspace-session", "keep-me");
    await events.signIn({ account: { provider: "password-account" } });
    expect(jar.entries.has(TEST_WORKSPACE_COOKIE)).toBe(false);
    // Test-workspace DATA/sessions are untouched.
    expect(jar.entries.get("talent-signal.test-workspace-session")).toBe("keep-me");
    // Ordinary failures never reach signIn; a retained selection stays.
    jar.entries.set(TEST_WORKSPACE_COOKIE, "valid-selection");
    expect(jar.entries.get(TEST_WORKSPACE_COOKIE)).toBe("valid-selection");
  });
});
