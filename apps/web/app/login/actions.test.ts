import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock("@/auth", () => ({ signIn: signInMock, signOut: vi.fn() }));
const { registerBackendAccountMock } = vi.hoisted(() => ({
  registerBackendAccountMock: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authenticatedBackendClient: vi.fn().mockResolvedValue(null),
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  readPrimaryBackendSessionClaims: vi.fn().mockResolvedValue(null),
  registerBackendAccount: registerBackendAccountMock,
}));
vi.mock("@/lib/server/testWorkspaceSession", () => ({
  clearTestWorkspaceSession: vi.fn(),
}));
vi.mock("@/lib/server/google-session", () => ({
  bindGoogleNonce: vi.fn(),
  prepareGoogleSignIn: vi.fn(),
}));
vi.mock("@/lib/server/apple-session", () => ({
  bindAppleNonce: vi.fn(),
  prepareAppleSignIn: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-auth", () => {
  class AuthError extends Error {
    type = "AuthError";
  }
  class CredentialsSignin extends AuthError {
    type = "CredentialsSignin";
    code = "credentials";
  }
  return { AuthError, CredentialsSignin };
});

import { clearTestWorkspaceSession } from "@/lib/server/testWorkspaceSession";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import {
  bindAppleNonce,
  prepareAppleSignIn,
} from "@/lib/server/apple-session";
import {
  registerPasswordAccount,
  signInWithApple,
  signInWithEmail,
  signInWithPasswordAccount,
  type SignInState,
} from "./actions";

const initialState: SignInState = { error: "" };

class ServiceCredentialsError extends CredentialsSignin {
  code = "service_unavailable";
}

class RateLimitedCredentialsError extends CredentialsSignin {
  code = "rate_limited";
}

class AccountExistsCredentialsError extends CredentialsSignin {
  code = "account_exists";
}

function formOf(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  signInMock.mockReset();
  vi.mocked(clearTestWorkspaceSession).mockReset();
  vi.mocked(redirect).mockReset();
  registerBackendAccountMock.mockReset();
});

describe("login action failure contract", () => {
  it("clears a stale test selection only after a successful replacement login", async () => {
    signInMock.mockResolvedValue("/onboarding?callbackUrl=%2Fworkspace");
    await signInWithPasswordAccount(initialState, formOf({identifier:"proof@example.invalid",password:"synthetic-password",redirectTo:"/workspace"}));
    expect(clearTestWorkspaceSession).toHaveBeenCalledTimes(1);
    expect(signInMock.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(clearTestWorkspaceSession).mock.invocationCallOrder[0]!);
    expect(redirect).toHaveBeenCalledWith("/onboarding?callbackUrl=%2Fworkspace");
    vi.mocked(clearTestWorkspaceSession).mockClear();
    signInMock.mockRejectedValue(new ServiceCredentialsError());
    await signInWithPasswordAccount(initialState,formOf({identifier:"proof@example.invalid",password:"synthetic-password"}));
    expect(clearTestWorkspaceSession).not.toHaveBeenCalled();
  });

  it("keeps the identifier and stores a retryable outage state", async () => {
    signInMock.mockRejectedValue(new ServiceCredentialsError());
    const state = await signInWithPasswordAccount(
      initialState,
      formOf({
        identifier: "recruiter@example.com",
        password: "correct horse battery",
        redirectTo: "/workspace/pursuits/42",
      }),
    );

    expect(state.code).toBe("service_unavailable");
    expect(state.retryable).toBe(true);
    expect(state.values).toEqual({ identifier: "recruiter@example.com" });
    expect(signInMock).toHaveBeenCalledWith(
      "password-account",
      expect.objectContaining({
        identifier: "recruiter@example.com",
        mode: "sign-in",
        redirectTo: "/onboarding?callbackUrl=%2Fworkspace%2Fpursuits%2F42",
      }),
    );
  });

  it("reports a rate limit without retrying automatically", async () => {
    signInMock.mockRejectedValue(new RateLimitedCredentialsError());
    const state = await signInWithPasswordAccount(
      initialState,
      formOf({ identifier: "a@b.c", password: "secret" }),
    );

    expect(state.code).toBe("rate_limited");
    expect(state.retryable).toBe(false);
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("keeps registration inputs on a duplicate account without disclosing state", async () => {
    registerBackendAccountMock.mockRejectedValue(
      new TalentSignalHttpError(
        409,
        "PASSWORD_ACCOUNT_EXISTS",
        "An account already uses that username or email.",
        null,
      ),
    );
    const state = await registerPasswordAccount(
      initialState,
      formOf({
        displayName: "Recruiter",
        email: "recruiter@example.com",
        password: "correct horse battery",
        confirmPassword: "correct horse battery",
      }),
    );

    expect(state.code).toBe("account_exists");
    expect(state.values).toEqual({
      displayName: "Recruiter",
      email: "recruiter@example.com",
    });
    expect(state.sent).not.toBe(true);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("starts verified signup without signing in and without a code in the state", async () => {
    registerBackendAccountMock.mockResolvedValue({
      contract_version: "2026-08-24.10",
      status: "verification_sent",
    });
    const state = await registerPasswordAccount(
      initialState,
      formOf({
        email: "recruiter@example.com",
        password: "correct horse battery",
        redirectTo: "/workspace/pursuits/42",
      }),
    );

    expect(state.error).toBe("");
    expect(state.sent).toBe(true);
    // Verified signup never signs in directly and never returns a code.
    expect(signInMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toMatch(/code|secret/i);
    expect(registerBackendAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "recruiter@example.com",
        display_name: "recruiter",
      }),
    );
    expect(registerBackendAccountMock.mock.calls[0]?.[0]).not.toHaveProperty("confirmPassword");
  });

  it("fails honestly when delivery is unconfigured instead of claiming sent", async () => {
    registerBackendAccountMock.mockRejectedValue(
      new TalentSignalHttpError(
        503,
        "EMAIL_DELIVERY_UNAVAILABLE",
        "Email verification is not configured for this service.",
        null,
      ),
    );
    const state = await registerPasswordAccount(
      initialState,
      formOf({ email: "recruiter@example.com", password: "correct horse battery" }),
    );
    expect(state.code).toBe("service_unavailable");
    expect(state.sent).not.toBe(true);
    expect(state.error).toContain("账号未创建");
  });

  it("rejects an invalid registration email before calling the backend", async () => {
    const state = await registerPasswordAccount(
      initialState,
      formOf({ email: "not-an-email", password: "a".repeat(12) }),
    );

    expect(state.code).toBe("invalid_input");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("preserves the callback destination and email on email sign-in failure", async () => {
    signInMock.mockRejectedValue(new ServiceCredentialsError());
    const state = await signInWithEmail(
      initialState,
      formOf({
        email: "recruiter@example.com",
        password: "secret",
        redirectTo: "/workspace/today",
      }),
    );

    expect(state.values).toEqual({ email: "recruiter@example.com" });
    expect(signInMock).toHaveBeenCalledWith(
      "email-password",
      expect.objectContaining({
        email: "recruiter@example.com",
        redirectTo: "/workspace/today",
      }),
    );
  });
});

describe("server-side availability enforcement", () => {
  it("refuses registration when the provider is disabled", async () => {
    process.env.TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED = "false";
    try {
      const state = await registerPasswordAccount(
        initialState,
        formOf({ email: "recruiter@example.com", password: "a".repeat(12) }),
      );
      expect(state.error).toContain("注册暂未开放");
      expect(signInMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED;
    }
  });

  it("refuses password sign-in when the provider is disabled", async () => {
    process.env.TALENT_SIGNAL_PASSWORD_AUTH_ENABLED = "false";
    try {
      const state = await signInWithPasswordAccount(
        initialState,
        formOf({ identifier: "recruiter@example.com", password: "secret" }),
      );
      expect(state.error).toContain("密码登录暂未开放");
      expect(signInMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.TALENT_SIGNAL_PASSWORD_AUTH_ENABLED;
    }
  });
});

describe("Apple provider start", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockReset();
    vi.mocked(prepareAppleSignIn).mockReset();
    vi.mocked(bindAppleNonce).mockReset();
    signInMock.mockReset();
  });

  it("binds the backend challenge and continues through onboarding", async () => {
    vi.mocked(prepareAppleSignIn).mockResolvedValue("hashed-nonce");
    vi.mocked(bindAppleNonce).mockResolvedValue(
      "https://appleid.apple.com/auth/authorize?nonce=hashed-nonce",
    );
    signInMock.mockResolvedValue(
      "https://appleid.apple.com/auth/authorize?state=state",
    );

    await signInWithApple(
      formOf({ redirectTo: "/workspace/pursuits/42" }),
    );

    expect(signInMock).toHaveBeenCalledWith(
      "apple",
      expect.objectContaining({
        redirect: false,
        redirectTo: "/onboarding?callbackUrl=%2Fworkspace%2Fpursuits%2F42",
      }),
    );
    expect(bindAppleNonce).toHaveBeenCalledWith(
      "https://appleid.apple.com/auth/authorize?state=state",
      "hashed-nonce",
    );
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "https://appleid.apple.com/auth/authorize?nonce=hashed-nonce",
    );
  });

  it("returns to login instead of trapping a provider-start failure", async () => {
    vi.mocked(prepareAppleSignIn).mockRejectedValue(new Error("challenge down"));

    await signInWithApple(formOf({ redirectTo: "/workspace" }));

    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "/login?error=Configuration&callbackUrl=%2Fworkspace",
    );
    expect(signInMock).not.toHaveBeenCalled();
  });
});
