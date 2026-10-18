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
  finishGoogleSignIn: vi.fn(),
  finishAppleSignIn: vi.fn(),
  startLoginMethodChange: vi.fn(),
  completeLoginMethodChange: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({
  AUTH_SESSION_COOKIE: "talent-signal.session-v2",
  readPrimaryBackendSessionClaims: vi.fn(async () => null),
  authenticatedBackendClient: vi.fn(async () => null),
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  authSecret: () => "fixture-auth-secret",
  confirmBackendRegistration: vi.fn(),
  registerBackendAccount: vi.fn(),
  signInBackendAccount: vi.fn(),
}));
vi.mock("@/lib/server/loginMethods", () => ({
  CREDENTIAL_ATTEMPT_COOKIE: "talent-signal.credential-attempt",
  startLoginMethodChange: mocks.startLoginMethodChange,
  completeLoginMethodChange: mocks.completeLoginMethodChange,
}));
// The REAL oauth-session module stays unmocked so `OAuthAccountLinkRequired`
// is the exact class the backend boundary throws and auth.ts checks.
vi.mock("@/lib/server/google-session", () => ({
  bindGoogleNonce: vi.fn(async (url: string) => url),
  finishGoogleSignIn: mocks.finishGoogleSignIn,
  prepareGoogleSignIn: vi.fn(),
}));
vi.mock("@/lib/server/apple-session", () => ({
  bindAppleNonce: vi.fn(async (url: string) => url),
  finishAppleSignIn: mocks.finishAppleSignIn,
  prepareAppleSignIn: vi.fn(),
}));
vi.mock("@/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signIn: vi.fn(),
}));
vi.mock("@/lib/server/google-oauth", () => ({ getGoogleOAuthCredentials: () => null }));
vi.mock("@/lib/server/apple-oauth", () => ({ getAppleOAuthCredentials: () => null }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), {
      digest: `NEXT_REDIRECT;push;${url}`,
    });
  }),
}));

import { OAuthAccountLinkRequired } from "@/lib/server/oauth-session";
// Loading the real auth module registers the lazy NextAuth configuration the
// framework would receive; the mock captures it.
import "@/auth";
import { AUTH_PROOF_COOKIE, AUTH_DUP_PROOF_COOKIE } from "@/lib/server/stagedAuth";
import { LOGIN_COLLISION_COOKIE, readLoginCollisionHint } from "@/lib/server/loginCollision";
import { CREDENTIAL_ATTEMPT_COOKIE } from "@/lib/server/loginMethods";

const sessionCookie = "talent-signal.session-v2";

async function runProviderReturn(provider: "google" | "apple", idToken: string) {
  // NextAuth receives a LAZY configuration factory; invoke it like the
  // framework does per request.
  const factory = captured.config as unknown as () => {
    callbacks: { jwt: (input: Record<string, unknown>) => Promise<unknown> };
  };
  const config = typeof factory === "function" ? factory() : factory;
  return config.callbacks.jwt({
    token: { sub: "existing-user" },
    user: undefined,
    account: { provider, id_token: idToken },
    profile: undefined,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-11T00:00:00.000Z"));
  jar.entries.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  // A prior signed-in browser session, to prove a rejected login never
  // replaces or clears it.
  jar.entries.set(sessionCookie, "prior-session-token");
});

afterEach(() => vi.useRealTimers());

describe("rejected unbound OAuth sign-in (real auth callback)", () => {
  it("reports the link-required outcome and seals only a provider hint", async () => {
    mocks.finishGoogleSignIn.mockRejectedValue(
      new OAuthAccountLinkRequired("Use the original sign-in method for this account."),
    );
    const error = (await runProviderReturn("google", "google-id-token").then(
      () => null,
      (caught: unknown) => caught,
    )) as { constructor: { type?: string } } | null;

    // The Auth.js framework contract: the callback terminates with the
    // supported OAuthAccountNotLinked type and never creates a session.
    expect(error).not.toBeNull();
    expect(error!.constructor.type).toBe("OAuthAccountNotLinked");

    // Only the sealed provider hint survives the rejected login: no staged
    // proof, no credential attempt, no raw token in any cookie or page state.
    const hint = await readLoginCollisionHint();
    expect(hint).toMatchObject({ provider: "google" });
    expect(Object.keys(hint!).sort()).toEqual(["provider", "sealedAt"]);
    expect(jar.entries.has(AUTH_PROOF_COOKIE)).toBe(false);
    expect(jar.entries.has(AUTH_DUP_PROOF_COOKIE)).toBe(false);
    expect(jar.entries.has(CREDENTIAL_ATTEMPT_COOKIE)).toBe(false);
    for (const value of jar.entries.values()) {
      expect(value).not.toContain("google-id-token");
    }

    // The prior session survives untouched and no credential change or other
    // external write is attempted on this path.
    expect(jar.entries.get(sessionCookie)).toBe("prior-session-token");
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(mocks.completeLoginMethodChange).not.toHaveBeenCalled();
  });

  it("records the Apple collision under its own provider hint", async () => {
    mocks.finishAppleSignIn.mockRejectedValue(new OAuthAccountLinkRequired());
    const error = (await runProviderReturn("apple", "apple-id-token").then(
      () => null,
      (caught: unknown) => caught,
    )) as { constructor: { type?: string } } | null;
    expect(error!.constructor.type).toBe("OAuthAccountNotLinked");
    expect(await readLoginCollisionHint()).toMatchObject({ provider: "apple" });
    expect(jar.entries.has(AUTH_PROOF_COOKIE)).toBe(false);
    expect(jar.entries.get(sessionCookie)).toBe("prior-session-token");
  });

  it("never seals collision state for an unrelated sign-in failure", async () => {
    mocks.finishGoogleSignIn.mockRejectedValue(new Error("backend unavailable"));
    await expect(runProviderReturn("google", "google-id-token")).rejects.toThrow(
      /backend unavailable|Configuration/,
    );
    expect(jar.entries.has(LOGIN_COLLISION_COOKIE)).toBe(false);
    // A service failure keeps the retry surface ordinary: no collision panel
    // claim and no account information.
    expect(await readLoginCollisionHint()).toBeNull();
    expect(jar.entries.get(sessionCookie)).toBe("prior-session-token");
    expect(mocks.startLoginMethodChange).not.toHaveBeenCalled();
    expect(mocks.completeLoginMethodChange).not.toHaveBeenCalled();
  });
});
