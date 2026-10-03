import { describe, expect, it } from "vitest";
import {
  appleFormPostCookiesSupported,
  deriveRegistrationDisplayName,
  encodeConfiguredPassword,
  getAuthAvailability,
  getDefaultAccount,
  safeRedirectTarget,
  verifyConfiguredPassword,
} from "./auth-config";

const configuredEnvironment = {
  AUTH_DEFAULT_ACCOUNT_EMAIL: "  Recruiter@TalentSignal.ai ",
  AUTH_DEFAULT_ACCOUNT_ENABLED: "true",
  AUTH_DEFAULT_ACCOUNT_NAME: "Morgan Lee",
  AUTH_DEFAULT_ACCOUNT_PASSWORD_SCRYPT: encodeConfiguredPassword(
    "clear-context",
    "00112233445566778899aabbccddeeff",
  ),
  AUTH_DEFAULT_ACCOUNT_QUICK_LOGIN: "true",
  AUTH_GOOGLE_ID: "google-id",
  AUTH_GOOGLE_SECRET: "google-secret",
};

const appleClientId = "com.talentsignal.web";

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// A syntactically valid static Apple client-secret JWT. Its signature is not
// verified locally; the metadata shape is what the provider config validates.
function appleClientSecretJwt(clientId: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return [
    base64UrlJson({ alg: "ES256", kid: "ABCDEFGHIJ", typ: "JWT" }),
    base64UrlJson({
      iss: "ABCDEFGHIJ",
      iat: issuedAt,
      exp: issuedAt + 3600,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
    "fixture-signature",
  ].join(".");
}

describe("default account configuration", () => {
  it("never enables configured fixture credentials in production", () => {
    const account = getDefaultAccount({ ...configuredEnvironment, NODE_ENV: "production" });
    expect(account.enabled).toBe(false);
    expect(account.quickLoginEnabled).toBe(false);
    expect(account.emailPasswordEnabled).toBe(false);
  });
  it("enables configured email and quick-login paths", () => {
    const account = getDefaultAccount(configuredEnvironment);

    expect(account.email).toBe("recruiter@talentsignal.ai");
    expect(account.emailPasswordEnabled).toBe(true);
    expect(account.quickLoginEnabled).toBe(true);
  });

  it("keeps incomplete providers unavailable", () => {
    const availability = getAuthAvailability(configuredEnvironment);

    expect(availability.google).toBe(true);
    expect(availability.apple).toBe(false);
    expect(availability.email).toBe(true);
  });

  it("accepts a validated server-side Google credentials override", () => {
    const availability = getAuthAvailability(
      {
        ...configuredEnvironment,
        AUTH_GOOGLE_ID: undefined,
        AUTH_GOOGLE_SECRET: undefined,
      },
      { google: true },
    );

    expect(availability.google).toBe(true);
  });

  it("keeps Apple unavailable without credentials or over HTTPS only", () => {
    const withCredentials = {
      ...configuredEnvironment,
      AUTH_APPLE_ID: appleClientId,
      AUTH_APPLE_SECRET: appleClientSecretJwt(appleClientId),
    };
    expect(getAuthAvailability(withCredentials).apple).toBe(false);
    expect(
      getAuthAvailability({
        ...withCredentials,
        NODE_ENV: "production",
        AUTH_URL: "http://127.0.0.1:3000",
      }).apple,
    ).toBe(false);
    expect(
      getAuthAvailability({
        ...withCredentials,
        NODE_ENV: "production",
        AUTH_URL: "https://app.talentsignal.test",
      }).apple,
    ).toBe(true);
  });

  it("accepts a server-side Apple availability override", () => {
    expect(getAuthAvailability(configuredEnvironment, { apple: true }).apple).toBe(
      true,
    );
    expect(
      appleFormPostCookiesSupported({ NODE_ENV: "production" }),
    ).toBe(true);
  });
});

describe("registration display name", () => {
  it("prefers an explicit name, then the email local-part, then a neutral name", () => {
    expect(deriveRegistrationDisplayName("ada@example.test", "  Ada L  ")).toBe(
      "Ada L",
    );
    expect(deriveRegistrationDisplayName("Ada.Lovelace@example.test", "  ")).toBe(
      "ada.lovelace",
    );
    expect(deriveRegistrationDisplayName("@example.test", undefined)).toBe(
      "capri user",
    );
    expect(
      deriveRegistrationDisplayName(`${'a'.repeat(150)}@example.test`, undefined),
    ).toHaveLength(100);
  });
});

describe("configured password verification", () => {
  it("compares the configured scrypt value without storing plaintext", () => {
    const encoded = configuredEnvironment.AUTH_DEFAULT_ACCOUNT_PASSWORD_SCRYPT;

    expect(verifyConfiguredPassword("clear-context", encoded)).toBe(true);
    expect(verifyConfiguredPassword("wrong-context", encoded)).toBe(false);
  });
});

describe("safeRedirectTarget", () => {
  it.each(["/\t/attacker.example", "/\n/attacker.example", "/\r/attacker.example"])("rejects URL-normalized external target %j", target => {
    expect(safeRedirectTarget(target)).toBe("/workspace");
  });
  it("accepts only local application paths", () => {
    expect(safeRedirectTarget("/workspace?view=list")).toBe(
      "/workspace?view=list",
    );
    expect(safeRedirectTarget("//host.example")).toBe("/workspace");
    expect(safeRedirectTarget("https://host.example")).toBe("/workspace");
    expect(safeRedirectTarget("/\\host.example")).toBe("/workspace");
  });
});
