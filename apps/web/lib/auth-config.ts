import { scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getAppleOAuthCredentials } from "./server/apple-oauth";

const configuredPasswordPattern =
  /^scrypt\$([a-f0-9]{32,128})\$([a-f0-9]{128})$/i;

export const emailSignInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});

export const passwordSignInSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
});

export const passwordRegistrationSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(100).optional(),
  password: z.string().min(8).max(128),
});

export type DefaultAccount = {
  email: string;
  emailPasswordEnabled: boolean;
  enabled: boolean;
  name: string;
  passwordScrypt?: string;
  quickLoginEnabled: boolean;
};

type Environment = Record<string, string | undefined>;
type AuthAvailabilityOverrides = {
  apple?: boolean;
  google?: boolean;
};

/**
 * Apple delivers the callback as a cross-site form POST. Its state and nonce
 * cookies therefore need `Secure; SameSite=None`, which browsers only accept
 * over HTTPS. Availability must fail closed on plain HTTP rather than show a
 * button whose callback could never validate.
 */
export function appleFormPostCookiesSupported(
  environment: Environment = process.env,
): boolean {
  const authUrl = environment.AUTH_URL?.trim();
  if (authUrl) {
    try {
      return new URL(authUrl).protocol === "https:";
    } catch {
      return false;
    }
  }
  return environment.NODE_ENV === "production";
}

/**
 * Derive the single display name used by password registration. An explicit
 * name wins; otherwise the email local-part is a bounded, human-readable
 * fallback, and a neutral product name is the last resort.
 */
export function deriveRegistrationDisplayName(
  email: string,
  displayName?: string | null,
): string {
  const provided = typeof displayName === "string" ? displayName.trim() : "";
  if (provided) return provided.slice(0, 100);
  const localPart = email.trim().toLowerCase().split("@")[0] ?? "";
  const cleaned = localPart.replace(/[^\p{L}\p{N}._-]+/gu, " ").trim();
  if (cleaned) return cleaned.slice(0, 100);
  return "capri user";
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function safeRedirectTarget(
  value: FormDataEntryValue | null | undefined,
  fallback = "/workspace",
) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const target = new URL(value, "https://redirect.invalid");
    if (target.origin !== "https://redirect.invalid") return fallback;
    return target.pathname + target.search + target.hash;
  } catch { return fallback; }
}

export function getDefaultAccount(
  environment: Environment = process.env,
): DefaultAccount {
  const name = environment.AUTH_DEFAULT_ACCOUNT_NAME?.trim() ?? "";
  const email = normalizeEmail(
    environment.AUTH_DEFAULT_ACCOUNT_EMAIL?.trim() ?? "",
  );
  const passwordScrypt =
    environment.AUTH_DEFAULT_ACCOUNT_PASSWORD_SCRYPT?.trim();
  const enabled =
    environment.NODE_ENV !== "production" &&
    environment.AUTH_DEFAULT_ACCOUNT_ENABLED === "true" &&
    name.length > 0 &&
    z.string().email().safeParse(email).success;

  return {
    email,
    emailPasswordEnabled:
      enabled &&
      typeof passwordScrypt === "string" &&
      configuredPasswordPattern.test(passwordScrypt),
    enabled,
    name,
    passwordScrypt,
    quickLoginEnabled:
      enabled &&
      environment.AUTH_DEFAULT_ACCOUNT_QUICK_LOGIN === "true",
  };
}

export function getAuthAvailability(
  environment: Environment = process.env,
  overrides: AuthAvailabilityOverrides = {},
) {
  const account = getDefaultAccount(environment);

  return {
    apple:
      overrides.apple ??
      Boolean(
        getAppleOAuthCredentials(environment) &&
          appleFormPostCookiesSupported(environment),
      ),
    defaultAccount: account.quickLoginEnabled,
    defaultAccountEmail: account.email,
    defaultAccountName: account.name,
    email: account.emailPasswordEnabled,
    google:
      overrides.google ??
      Boolean(
        environment.AUTH_GOOGLE_ID?.trim() &&
          environment.AUTH_GOOGLE_SECRET?.trim(),
      ),
    password:
      environment.TALENT_SIGNAL_PASSWORD_AUTH_ENABLED === "true" ||
      (environment.NODE_ENV !== "production" &&
        environment.TALENT_SIGNAL_PASSWORD_AUTH_ENABLED !== "false"),
    registration:
      environment.TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED === "true" ||
      (environment.NODE_ENV !== "production" &&
        environment.TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED !== "false"),
  };
}

export function encodeConfiguredPassword(password: string, salt: string) {
  const normalizedSalt = salt.toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(normalizedSalt)) {
    throw new Error("密码盐必须是 16 至 64 字节的十六进制值。");
  }

  const hash = scryptSync(password, normalizedSalt, 64).toString("hex");
  return `scrypt$${normalizedSalt}$${hash}`;
}

export function verifyConfiguredPassword(
  password: string,
  encoded: string | undefined,
) {
  if (!encoded) {
    return false;
  }

  const match = configuredPasswordPattern.exec(encoded);
  if (!match) {
    return false;
  }

  const [, salt, expectedHex] = match;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
