import "server-only";

import {
  TalentSignalHttpError,
  type CompleteCredentialChangeRequest,
  type CredentialChangeAttempt,
  type CredentialChangeResult,
  type CredentialChangeReadback,
  type ReadCredentialChangeResultRequest,
  type SignInMethodProvider,
  type StartCredentialChangeRequest,
} from "@talent-signal/contracts";
import { cookies, headers } from "next/headers";
import { decode, encode } from "next-auth/jwt";

import { withAuthRequestTimeout } from "@/lib/auth-request-timeout";
import { authCookieSecure } from "@/lib/auth-cookie-policy";
import {
  authSecret,
  authenticatedBackendClient,
  readPrimaryBackendSessionClaims,
} from "@/lib/server/backendAuth";

/**
 * Server-held credential-change attempts (ADR 0018).
 *
 * The attempt secret returned once by the backend is sealed into an HttpOnly
 * cookie bound to this browser session; it never appears in URLs or client
 * state. A provider callback completes the bound attempt and the original
 * authenticated account is preserved.
 */

export const CREDENTIAL_ATTEMPT_COOKIE = "talent-signal.credential-attempt";
export const CREDENTIAL_ATTEMPT_TTL_SECONDS = 300;

export type SealedCredentialAttempt = {
  attempt_id: string;
  attempt_secret: string;
  intent: StartCredentialChangeRequest["intent"];
  provider: SignInMethodProvider | null;
  client_label: string;
};

export async function sealCredentialAttempt(attempt: SealedCredentialAttempt): Promise<void> {
  const value = await encode({
    secret: authSecret(),
    salt: CREDENTIAL_ATTEMPT_COOKIE,
    maxAge: CREDENTIAL_ATTEMPT_TTL_SECONDS,
    token: attempt,
  });
  (await cookies()).set(CREDENTIAL_ATTEMPT_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CREDENTIAL_ATTEMPT_TTL_SECONDS,
    secure: authCookieSecure(),
  });
}

export async function readSealedCredentialAttempt(): Promise<SealedCredentialAttempt | null> {
  const jar = await cookies();
  const value = jar.get(CREDENTIAL_ATTEMPT_COOKIE)?.value;
  const attempt = value
    ? await decode({ token: value, secret: authSecret(), salt: CREDENTIAL_ATTEMPT_COOKIE })
    : null;
  if (
    !attempt ||
    typeof attempt.attempt_id !== "string" ||
    typeof attempt.attempt_secret !== "string"
  ) {
    return null;
  }
  return attempt as unknown as SealedCredentialAttempt;
}

export async function clearSealedCredentialAttempt(): Promise<void> {
  (await cookies()).delete(CREDENTIAL_ATTEMPT_COOKIE);
}

async function backendClient() {
  const client = await authenticatedBackendClient();
  if (!client) {
    throw new TalentSignalHttpError(401, "AUTH_REQUIRED", "请重新登录。", null);
  }
  return client;
}

export async function startLoginMethodChange(
  input: Omit<StartCredentialChangeRequest, "origin" | "client_label">,
): Promise<CredentialChangeAttempt> {
  const client = await backendClient();
  // The revisions travel with the authorization; the backend compares them
  // transactionally before minting an attempt. A Web precheck can never widen
  // them.
  return withAuthRequestTimeout(
    (signal) =>
      client.startLoginMethodChange(
        { ...input, origin: "server-derived", client_label: "talent-signal-web" },
        signal,
      ),
    { timeoutMs: 10_000 },
  );
}

export async function completeLoginMethodChange(
  input: Omit<CompleteCredentialChangeRequest, "origin">,
): Promise<CredentialChangeResult> {
  const client = await backendClient();
  return withAuthRequestTimeout(
    (signal) =>
      client.completeLoginMethodChange({ ...input, origin: "server-derived" }, signal),
    { timeoutMs: 10_000 },
  );
}

/** Inspect only the original held attempt; this never completes a change. */
export async function readLoginMethodChangeResult(
  input: ReadCredentialChangeResultRequest,
): Promise<CredentialChangeReadback> {
  const client = await backendClient();
  return withAuthRequestTimeout(
    (signal) => client.readCredentialChangeResult(input, signal),
    { timeoutMs: 10_000 },
  );
}

/**
 * Complete a provider binding from the OAuth callback. The backend attempt is
 * bound to the current backend auth session; a signed-out or switched account
 * fails recoverably and no provider session replaces the current one.
 */
export async function finishProviderLink(exchange: {
  provider: "apple" | "google";
  identityToken: string;
}): Promise<CredentialChangeResult | null> {
  const attempt = await readSealedCredentialAttempt();
  if (!attempt || attempt.intent !== "link_provider" || attempt.provider !== exchange.provider) {
    return null;
  }
  clearSealedCredentialAttempt();
  const claims = await readPrimaryBackendSessionClaims();
  if (!claims) {
    throw new TalentSignalHttpError(
      409,
      "CREDENTIAL_ATTEMPT_INVALID",
      "登录状态已变化，绑定未生效。请重新登录后再试。",
      null,
    );
  }
  return completeLoginMethodChange({
    attempt_id: attempt.attempt_id,
    attempt_secret: attempt.attempt_secret,
    identity_token: exchange.identityToken,
  });
}

export async function requestOriginLabel(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get("origin") ?? "server-derived";
}
