import { generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { NextAuthConfig } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resolve a real secret before `auth.ts` computes its module-level secret.
vi.hoisted(() => {
  process.env.AUTH_SECRET ??= "fixture-auth-secret";
});

// Capture the argument NextAuth receives. The whole point of the fix is that
// this is a lazy configuration function, so Auth.js resolves providers (and
// therefore regenerates the 15-minute Apple client secret) per request instead
// of once at module load.
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
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));

import "./auth";

// @auth/core is a dependency of next-auth, not of this workspace package, so it
// is resolved through next-auth's own module graph. This is the real
// env-default resolution NextAuth runs per lazy invocation; importing it lets
// the test prove providers are not captured once at module load.
type CoreSetEnvDefaults = (
  envObject: unknown,
  config: NextAuthConfig,
  suppressBasePathWarning?: boolean,
) => void;
const nextAuthRequire = createRequire(
  createRequire(import.meta.url).resolve("next-auth"),
);
const { setEnvDefaults } = (await import(
  pathToFileURL(nextAuthRequire.resolve("@auth/core")).href
)) as { setEnvDefaults: CoreSetEnvDefaults };

const clientId = "com.talentsignal.web";
const teamId = "ABCDEFGHIJ";
const keyId = "KLMNOPQRST";
const googleId = "google-client-id";
const googleSecret = "google-client-secret";
const frozenNow = new Date("2026-01-01T00:00:00.000Z");
const frozenNowSeconds = Math.floor(frozenNow.getTime() / 1000);
const fifteenMinutesMs = 15 * 60 * 1000;

const { privateKey: fixturePrivateKey, publicKey: fixturePublicKey } =
  generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const fixturePrivateKeyPem = fixturePrivateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const managedEnvironmentKeys = [
  "AUTH_URL",
  "AUTH_APPLE_ID",
  "AUTH_APPLE_TEAM_ID",
  "AUTH_APPLE_KEY_ID",
  "AUTH_APPLE_PRIVATE_KEY",
  "AUTH_APPLE_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_TRUST_HOST",
  "VERCEL",
  "NODE_ENV",
];
const savedEnvironment = new Map<string, string | undefined>();

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function staticAppleSecret(expiresAt: number): string {
  return [
    encodeSegment({ alg: "ES256", kid: keyId, typ: "JWT" }),
    encodeSegment({
      iss: teamId,
      iat: frozenNowSeconds,
      exp: expiresAt,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
    "fixture-signature",
  ].join(".");
}

function lazyConfig(): (request?: unknown) => NextAuthConfig {
  if (typeof captured.config !== "function") {
    throw new Error("NextAuth must receive a lazy configuration function");
  }
  return captured.config as (request?: unknown) => NextAuthConfig;
}

/** Run the real env-default resolution NextAuth performs per lazy invocation. */
function resolveConfig(): NextAuthConfig {
  const config = lazyConfig()();
  setEnvDefaults(process.env, config, true);
  return config;
}

type ResolvedProvider = {
  id: string;
  clientSecret?: string;
  options?: { id?: string; clientSecret?: string };
};

function resolvedProvider(
  provider: NextAuthConfig["providers"][number],
): ResolvedProvider {
  return (
    typeof provider === "function" ? provider({}) : provider
  ) as unknown as ResolvedProvider;
}

function providerById(config: NextAuthConfig, id: string) {
  return config.providers
    .map(resolvedProvider)
    .find((provider) => (provider.options?.id ?? provider.id) === id);
}

function providerIds(config: NextAuthConfig): string[] {
  return config.providers
    .map(resolvedProvider)
    .map((provider) => provider.options?.id ?? provider.id);
}

function appleClientSecret(config: NextAuthConfig): string {
  const apple = providerById(config, "apple");
  const secret = apple?.clientSecret ?? apple?.options?.clientSecret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Apple provider is missing its client secret");
  }
  return secret;
}

function decodeSegment(segment: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment ?? "", "base64url").toString("utf8"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(frozenNow);
  for (const key of managedEnvironmentKeys) {
    savedEnvironment.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.AUTH_URL = "https://app.talentsignal.test";
  process.env.AUTH_APPLE_ID = clientId;
  process.env.AUTH_APPLE_TEAM_ID = teamId;
  process.env.AUTH_APPLE_KEY_ID = keyId;
  process.env.AUTH_APPLE_PRIVATE_KEY = fixturePrivateKeyPem;
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of managedEnvironmentKeys) {
    const value = savedEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnvironment.clear();
});

describe("lazy Apple auth configuration", () => {
  it("accepts canonical IDs only from verified persistent authorization, including ordinary Web enrollment", async () => {
    const jwt = resolveConfig().callbacks!.jwt!;
    const user = { id: "33333333-3333-4333-8333-333333333333", backendAccessToken: "bounded-access", backendAccountId: "44444444-4444-4444-8444-444444444444",
      backendAccountName: "Account", backendAccountSlug: "account", backendExpiresAt: "2099-01-01T00:00:00.000Z",
      backendRole: "member", backendUserId: "33333333-3333-4333-8333-333333333333", backendUsername: null,
      backendSessionId: "11111111-1111-4111-8111-111111111111" };
    const mac = await jwt({ token: {}, user, account: { provider: "desktop-persistent", type: "credentials", providerAccountId: user.id },
      trigger: "signIn", session: undefined });
    expect(mac?.backendSessionId).toBe(user.backendSessionId);
    const serverId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ session_id: serverId, access_token: "web-bounded-access",
      expires_at: "2099-01-01T00:00:00.000Z", account: { id: user.backendAccountId, name: "Account", slug: "account" },
      user: { id: user.backendUserId, role: "member", username: null } })));
    const ordinary = await jwt({ token: { backendSessionId: user.backendSessionId }, user,
      account: { provider: "password-account", type: "credentials", providerAccountId: user.id },
      trigger: "signIn", session: undefined });
    expect(ordinary?.backendSessionId).toBe(serverId);
    expect(ordinary?.backendSessionId).not.toBe(user.backendSessionId);
    expect(ordinary?.backendRenewalSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    vi.unstubAllGlobals();
  });
  it("configures NextAuth lazily so provider resolution runs per invocation", () => {
    expect(typeof captured.config).toBe("function");
    expect(providerIds(resolveConfig())).toContain("apple");
  });

  it("regenerates a fresh 15-minute Apple secret beyond the token lifetime", () => {
    const first = resolveConfig();
    const firstSecret = appleClientSecret(first);

    vi.setSystemTime(
      new Date(frozenNow.getTime() + fifteenMinutesMs + 5 * 60 * 1000),
    );
    const second = resolveConfig();
    const secondSecret = appleClientSecret(second);

    expect(secondSecret).not.toBe(firstSecret);

    const [header, payload, signature] = secondSecret.split(".");
    expect(decodeSegment(payload)).toMatchObject({
      iss: teamId,
      iat: frozenNowSeconds + 20 * 60,
      exp: frozenNowSeconds + 20 * 60 + fifteenMinutesMs / 1000,
      aud: "https://appleid.apple.com",
      sub: clientId,
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`, "utf8"),
        { key: fixturePublicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("does not reuse the configuration or provider arrays between invocations", () => {
    const first = lazyConfig()();
    const second = lazyConfig()();

    expect(first).not.toBe(second);
    expect(first.providers).not.toBe(second.providers);
    expect(first.cookies).not.toBe(second.cookies);
  });

  it("omits Apple but keeps Google and password when Apple config is invalid", () => {
    // A private-key setting is supplied without the complete set.
    delete process.env.AUTH_APPLE_PRIVATE_KEY;
    process.env.AUTH_GOOGLE_ID = googleId;
    process.env.AUTH_GOOGLE_SECRET = googleSecret;

    const config = resolveConfig();
    const ids = providerIds(config);

    expect(ids).not.toContain("apple");
    expect(ids).toContain("google");
    expect(ids).toContain("password-account");
    expect(ids).toContain("email-password");
  });

  it("expires and restores a static Apple secret without reimporting the module", () => {
    delete process.env.AUTH_APPLE_TEAM_ID;
    delete process.env.AUTH_APPLE_KEY_ID;
    delete process.env.AUTH_APPLE_PRIVATE_KEY;
    process.env.AUTH_APPLE_SECRET = staticAppleSecret(frozenNowSeconds + 3600);
    process.env.AUTH_GOOGLE_ID = googleId;
    process.env.AUTH_GOOGLE_SECRET = googleSecret;

    expect(providerIds(resolveConfig())).toContain("apple");

    vi.setSystemTime(new Date(frozenNow.getTime() + 61 * 60 * 1000));
    const ids = providerIds(resolveConfig());

    expect(ids).not.toContain("apple");
    expect(ids).toContain("google");
    expect(ids).toContain("password-account");
    expect(ids).toContain("email-password");

    process.env.AUTH_APPLE_SECRET = staticAppleSecret(frozenNowSeconds + 7200);
    const restored = resolveConfig();
    expect(providerIds(restored)).toEqual(expect.arrayContaining([
      "apple", "google", "password-account", "email-password",
    ]));
    expect(appleClientSecret(restored)).toBe(process.env.AUTH_APPLE_SECRET);
  });
});
