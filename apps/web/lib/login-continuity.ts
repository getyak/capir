/**
 * Login-continuity navigation hints for the Google/Apple account-continuity
 * flow (GET-141).
 *
 * Everything in this module is NON-SECRET navigation state. Public query
 * strings are navigation hints only: they steer where a completed login or a
 * verified link continues, and they are never treated as proof that a
 * collision happened, that an account exists, or that a link succeeded.
 * Collision knowledge comes from the server-sealed hint (see
 * `lib/server/loginCollision.ts`); link success comes only from the
 * authoritative backend settings readback.
 *
 * The only retained state across the flow is an allowlisted provider name and
 * a same-origin return path. No OAuth token, email or account detail is ever
 * carried in a URL or page state.
 */

import { safeRedirectTarget } from "./safe-redirect";

export const CONNECT_PROVIDERS = ["google", "apple"] as const;
export type ConnectProvider = (typeof CONNECT_PROVIDERS)[number];

/** Absolute lifetime of a sealed collision hint. An expired hint shows nothing. */
export const LOGIN_COLLISION_TTL_SECONDS = 600;

export type LoginCollisionHint = {
  provider: ConnectProvider;
  sealedAt: string;
};

/** Allowlisted provider hint; anything else collapses to "no hint". */
export function connectProviderFrom(value: unknown): ConnectProvider | null {
  return value === "google" || value === "apple" ? value : null;
}

/**
 * A sealed collision hint is live only inside its short absolute lifetime and
 * only with a well-formed provider and timestamp. An expired or malformed hint
 * discloses nothing.
 */
export function collisionHintIsLive(
  hint: LoginCollisionHint | null,
  now = Date.now(),
): hint is LoginCollisionHint {
  if (!hint || !connectProviderFrom(hint.provider)) return false;
  const sealedAt = Date.parse(hint.sealedAt);
  return (
    Number.isFinite(sealedAt) &&
    sealedAt <= now + 5_000 &&
    now - sealedAt <= LOGIN_COLLISION_TTL_SECONDS * 1_000
  );
}

/**
 * The same-origin destination a user may return to after the continuity chain.
 * Login and onboarding paths are rejected so a return can never loop back into
 * the chain; an external, protocol-relative or malformed value is dropped
 * entirely (never silently rewritten into a different journey).
 */
export function continuityReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const safe = safeRedirectTarget(value, "");
  if (!safe || /^\/(?:onboarding|login)(?:[/?#]|$)/.test(safe)) return null;
  return safe;
}

/**
 * Where the login forms should land after authentication when a connect hint
 * is active: the authenticated Settings account pane with the provider's
 * connecting panel preselected and the original callback preserved as a
 * return hint. The original target itself stays the caller's own safe target.
 */
export function loginContinuationTarget(input: {
  callbackUrl: string;
  provider: ConnectProvider;
}): string {
  const original = continuityReturnTo(input.callbackUrl) ?? "/workspace";
  return `/workspace/settings?section=account&connect=${input.provider}&returnTo=${encodeURIComponent(original)}`;
}

/**
 * A Settings return path carrying the validated hints, so a login hop (for
 * example session expiry at the connection entry) resumes the same journey
 * through the ordinary callback URL.
 */
export function settingsConnectPath(input: {
  returnPath: string;
  connect: ConnectProvider | null;
  returnTo: string | null;
}): string {
  const separator = input.returnPath.includes("?") ? "&" : "?";
  const returnTo = continuityReturnTo(input.returnTo);
  const query = [
    input.connect ? `connect=${input.connect}` : "",
    returnTo ? `returnTo=${encodeURIComponent(returnTo)}` : "",
  ].filter(Boolean).join("&");
  return input.returnPath + (query ? separator + query : "");
}

/**
 * Recoverable Settings failure target: the validated retry hint (which
 * provider to reopen) and the sanitized return target survive the failure.
 * Hints steer navigation only and never carry mutation authority.
 */
export function settingsLinkErrorTarget(input: {
  provider?: unknown;
  returnTo?: unknown;
}): string {
  const provider = connectProviderFrom(input.provider);
  const returnTo = continuityReturnTo(input.returnTo);
  return (
    "/workspace/settings?section=account&link=error" +
    (provider ? `&connect=${provider}` : "") +
    (returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "")
  );
}

/** Validated hints for the Settings account pane. */
export function settingsConnectHints(parameters: {
  connect?: unknown;
  returnTo?: unknown;
}): { connect: ConnectProvider | null; returnTo: string | null } {
  return {
    connect: connectProviderFrom(parameters.connect),
    returnTo: continuityReturnTo(parameters.returnTo),
  };
}
