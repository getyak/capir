import "server-only";
import { testWorkspaceSession } from "./testWorkspaceSession";

import {
  TalentSignalClient,
  type PasswordLoginRequest,
  type PasswordRegistrationRequest,
  type PasswordRegistrationStartResponse,
  type PasswordVerificationConfirmRequest,
  type SessionResponse,
} from "@talent-signal/contracts";
import { headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { selectWebFamilyToken } from "./web-session-cookies";
import { cache } from "react";
import { renewWebSession, webSessionWasSignedOut } from "./web-persistent-session";

import { withAuthRequestTimeout } from "@/lib/auth-request-timeout";
import {
  BackendSessionExpiredError,
  backendSessionIsExpired,
} from "@/lib/backend-session";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export const AUTH_SESSION_COOKIE = "talent-signal.session-v2";

export function authSecret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 AUTH_SECRET。");
  }
  return "talent-signal-local-development-secret-v2";
}

export function backendAuthBaseUrl(): string {
  const parsed = new URL(
    process.env.TALENT_SIGNAL_BACKEND_URL?.trim() ??
      "http://127.0.0.1:4317",
  );
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed.origin;
  }
  throw new Error(
    "Password authentication must use HTTPS, except for an explicit loopback backend.",
  );
}

export const BACKEND_AUTH_REQUEST_TIMEOUT_MS = 5_000;

function authClient() {
  const client = new TalentSignalClient(backendAuthBaseUrl());
  client.setClientPlatform("web");
  return client;
}

export async function signInBackendAccount(
  request: Omit<PasswordLoginRequest, "client_label">,
): Promise<SessionResponse> {
  return withAuthRequestTimeout(
    (signal) =>
      authClient().signInWithPassword(
        { ...request, client_label: "talent-signal-web" },
        signal,
      ),
    { timeoutMs: BACKEND_AUTH_REQUEST_TIMEOUT_MS },
  );
}

/**
 * Start a verified password registration. The response is generic and never
 * contains a code; production without a configured transport fails honestly.
 */
export async function registerBackendAccount(
  request: Omit<PasswordRegistrationRequest, "client_label">,
): Promise<PasswordRegistrationStartResponse> {
  return withAuthRequestTimeout(
    (signal) =>
      authClient().registerWithPassword(
        { ...request, client_label: "talent-signal-web" },
        signal,
      ),
    { timeoutMs: BACKEND_AUTH_REQUEST_TIMEOUT_MS },
  );
}

/** Confirm the emailed verification and open the verified account session. */
export async function confirmBackendRegistration(
  request: PasswordVerificationConfirmRequest,
): Promise<SessionResponse> {
  return withAuthRequestTimeout(
    (signal) => authClient().confirmPasswordRegistration(request, signal),
    { timeoutMs: BACKEND_AUTH_REQUEST_TIMEOUT_MS },
  );
}


export type BackendSessionClaims = {
  /** Server-owned canonical login ID; stable while bounded access rotates. */
  backendSessionId?: string;
  /** Server-only encrypted-cookie capability; never expose in a public session. */
  backendRenewalSecret?: string;
  /** Only a protected cookie delivered before the enrollment request sets this. */
  backendPendingEnrollment?: boolean;
  /** Original legacy login identity for opaque UI bindings only; never IO authority. */
  backendLegacyAccessToken?: string;
  backendLegacyExpiresAt?: string;
  backendAccessToken: string;
  backendAccountId: string;
  backendAccountName: string;
  backendAccountSlug: string;
  backendExpiresAt: string;
  backendRole: "admin" | "member";
  backendUserId: string;
  backendUsername: string | null;
};

// React discards this memoization between server requests; never persist tokens.
// https://react.dev/reference/react/cache#caveats
export const readPrimarySessionToken = cache(async () => {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch (caught) {
    if (
      caught instanceof Error &&
      (caught.message.includes("outside a request scope") ||
        ("__NEXT_ERROR_CODE" in caught &&
          caught.__NEXT_ERROR_CODE === "E251"))
    ) {
      return null;
    }
    throw caught;
  }
  const token = await getToken({
    req: { headers: requestHeaders },
    cookieName: AUTH_SESSION_COOKIE,
    salt: AUTH_SESSION_COOKIE,
    secret: authSecret(),
  });
  return selectWebFamilyToken(token);
});
export const readRawPrimaryBackendSessionClaims = cache(async (): Promise<BackendSessionClaims | null> => {
  const token = await readPrimarySessionToken();
  if (token && await webSessionWasSignedOut(token.backendSessionId)) return null;
  if (
    !token ||
    typeof token.backendAccessToken !== "string" ||
    typeof token.backendAccountId !== "string" ||
    typeof token.backendAccountName !== "string" ||
    typeof token.backendAccountSlug !== "string" ||
    typeof token.backendExpiresAt !== "string" ||
    (token.backendRole !== "admin" && token.backendRole !== "member") ||
    typeof token.backendUserId !== "string" ||
    !(
      typeof token.backendUsername === "string" ||
      token.backendUsername === null
    )
  ) {
    return null;
  }
  return {
    backendAccessToken: token.backendAccessToken,
    ...(token.backendPendingEnrollment === true ? { backendPendingEnrollment: true } : {}),
    ...(typeof token.backendLegacyAccessToken === "string" && typeof token.backendLegacyExpiresAt === "string" &&
      Number.isFinite(Date.parse(token.backendLegacyExpiresAt)) ? {
        backendLegacyAccessToken: token.backendLegacyAccessToken, backendLegacyExpiresAt: token.backendLegacyExpiresAt } : {}),
    ...(typeof token.backendRenewalSecret === "string" && /^[A-Za-z0-9_-]{43}$/.test(token.backendRenewalSecret)
      ? { backendRenewalSecret: token.backendRenewalSecret } : {}),
    ...(typeof token.backendSessionId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token.backendSessionId)
      ? { backendSessionId: token.backendSessionId } : {}),
    backendAccountId: token.backendAccountId,
    backendAccountName: token.backendAccountName,
    backendAccountSlug: token.backendAccountSlug,
    backendExpiresAt: token.backendExpiresAt,
    backendRole: token.backendRole,
    backendUserId: token.backendUserId,
    backendUsername: token.backendUsername,
  };
});

// Server Components may read cookies but cannot set them. Renewal returns live
// bounded access here; the writable heartbeat separately rolls cookie storage.
export const readPrimaryBackendSessionClaims = cache(async (): Promise<BackendSessionClaims | null> => {
  const claims = await readRawPrimaryBackendSessionClaims();
  return claims ? renewWebSession(claims) : null;
});

export const readBackendSessionClaims = cache(async (): Promise<BackendSessionClaims | null> => {
  const expected = (await headers()).get("x-talent-signal-workspace");
  const primary = await readPrimaryBackendSessionClaims();
  if (!primary) {
    // A bound workspace request cannot fall back to a fixture account after
    // another tab replaces the authenticated backend session.
    if (expected) throw new BackendSessionExpiredError();
    return null;
  }
  const test = await testWorkspaceSession(primary);
  const claims = test?.claims ?? primary;
  if (expected && expected !== claims.backendAccountId) throw new BackendSessionExpiredError();
  return claims;
});

export async function authenticatedBackendClient(): Promise<TalentSignalClient | null> {
  const claims = await readBackendSessionClaims();
  if (!claims) {
    return null;
  }
  if (backendSessionIsExpired(claims.backendExpiresAt)) {
    throw new BackendSessionExpiredError();
  }
  return new TalentSignalClient(
    backendAuthBaseUrl(),
    claims.backendAccessToken,
  );
}
