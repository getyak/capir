import { safeRedirectTarget } from "./safe-redirect";
import { connectProviderFrom } from "./login-continuity";

export const ONBOARDING_PATH = "/onboarding";

/**
 * True when a target is the onboarding page itself. Onboarding must not send a
 * user back into onboarding, so such a target is normalized to the workspace.
 */
export function isOnboardingTarget(value: string): boolean {
  return (
    value === ONBOARDING_PATH ||
    value.startsWith(`${ONBOARDING_PATH}?`) ||
    value.startsWith(`${ONBOARDING_PATH}/`) ||
    value.startsWith(`${ONBOARDING_PATH}#`)
  );
}

/**
 * The safe post-authentication destination for a flow that must run
 * onboarding first. The original same-origin target is preserved (encoded) as
 * `callbackUrl` so onboarding can redirect returning users immediately.
 */
export function onboardingStartTarget(
  rawTarget: FormDataEntryValue | null | undefined,
): string {
  const safe = safeRedirectTarget(rawTarget);
  const target = isOnboardingTarget(safe) ? "/workspace" : safe;
  return `${ONBOARDING_PATH}?callbackUrl=${encodeURIComponent(target)}`;
}

/**
 * The original target an onboarding page may redirect to after deciding the
 * user is already complete, or after the user finishes/skips. Never returns an
 * onboarding path, preventing a redirect loop.
 */
export function onboardingCallbackTarget(
  rawTarget: FormDataEntryValue | null | undefined,
): string {
  const safe = safeRedirectTarget(rawTarget);
  return isOnboardingTarget(safe) ? "/workspace" : safe;
}

/**
 * Whether a canonical onboarding readback still requires the user to see the
 * onboarding step. Pending users must be onboarded; completed and skipped
 * users are redirected immediately.
 */
export function onboardingRequiresStep(status: string | null | undefined) {
  return status === "pending";
}

/** Recover Auth.js' same-origin callback after provider cancellation/failure. */
export function oauthRetryTarget(raw: string | undefined, origin: string): string {
  if (!raw) return "/workspace";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin) return "/workspace";
    return onboardingCallbackTarget(url.pathname === ONBOARDING_PATH
      ? url.searchParams.get("callbackUrl") : url.pathname + url.search + url.hash);
  } catch { return "/workspace"; }
}

/** Begin production login on its callback origin, so OAuth cookies come back. */
export function canonicalLoginTarget(requestOrigin: string, configured: string | undefined,
  parameters: { callbackUrl?: string; error?: string; reason?: string; mode?: string; connect?: string }, production: boolean): string | null {
  if (!production || !configured) return null;
  let canonical: URL; let incoming: URL;
  try { canonical = new URL(configured); incoming = new URL(requestOrigin); } catch { return null; }
  if (canonical.protocol !== "https:" || canonical.username || canonical.password ||
      canonical.pathname !== "/" || canonical.search || canonical.hash || canonical.origin === incoming.origin) return null;
  const destination = new URL("/login", canonical);
  destination.searchParams.set("callbackUrl", onboardingCallbackTarget(parameters.callbackUrl));
  if (parameters.mode === "register") destination.searchParams.set("mode", "register");
  if (parameters.error) destination.searchParams.set("error", parameters.error.slice(0, 100));
  if (parameters.reason === "backend_session_expired") destination.searchParams.set("reason", parameters.reason);
  // The allowlisted connect hint is navigation state and must survive the
  // canonical hop; any other value is simply dropped.
  const connect = connectProviderFrom(parameters.connect);
  if (connect) destination.searchParams.set("connect", connect);
  return destination.toString();
}
