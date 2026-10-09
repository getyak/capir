import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { TalentSignalHttpError } from "@talent-signal/contracts";

const { backendSignIn } = vi.hoisted(() => ({ backendSignIn: vi.fn() }));
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError { code = "credentials"; }
  return {
    default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
    AuthError,
    CredentialsSignin,
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/backendAuth", async importOriginal => ({
  ...(await importOriginal<object>()),
  signInBackendAccount: backendSignIn,
}));
import { buildAuthConfig } from "./auth";

beforeEach(() => {
  backendSignIn.mockReset();
  vi.stubEnv("TALENT_SIGNAL_PASSWORD_AUTH_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

function authorize() {
  const providers = buildAuthConfig().providers.map(provider =>
    typeof provider === "function" ? provider({}) : provider,
  );
  // Credentials keeps its configured handler in options until Auth.js merges
  // provider defaults. Exercise that real handler, not the mock's root signIn.
  const provider = providers.find(provider =>
    (provider.options?.id ?? provider.id) === "password-account",
  ) as CredentialsConfig & { options?: Partial<CredentialsConfig> };
  const handler = provider.options?.authorize ?? provider.authorize;
  return handler(
    { identifier: "synthetic-feedback", password: "synthetic-password", mode: "sign-in" },
    new Request("https://web.example.invalid/login"),
  );
}

describe("password provider error boundary", () => {
  it("preserves the verified Lab admission limit instead of reporting an outage", async () => {
    backendSignIn.mockRejectedValue(
      new TalentSignalHttpError(409, "LAB_WORKSPACE_ENTRY_LIMIT", "Private backend detail", null),
    );
    await expect(authorize()).rejects.toMatchObject({ code: "test_workspace_session_limit" });
    expect(backendSignIn).toHaveBeenCalledOnce();
  });

  it.each([
    [409, "UNKNOWN_CONFLICT"],
    [503, "LAB_WORKSPACE_ENTRY_LIMIT"],
    [503, "SERVICE_UNAVAILABLE"],
  ] as const)("keeps an unknown %s/%s failure generic", async (status, code) => {
    backendSignIn.mockRejectedValue(
      new TalentSignalHttpError(status, code, "Private backend detail", null),
    );
    await expect(authorize()).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("keeps bad credentials indistinguishable from an unknown account", async () => {
    backendSignIn.mockRejectedValue(
      new TalentSignalHttpError(401, "PASSWORD_SIGN_IN_FAILED", "Private backend detail", null),
    );
    await expect(authorize()).resolves.toBeNull();
  });
});
