import { TalentSignalHttpError } from "@talent-signal/contracts";

/** Same-origin API metadata remains readable after its transport is cancelled. */
export const WORKSPACE_SESSION_STATUS_HEADER = "X-Talent-Signal-Session-Status";

export function workspaceSessionExpired(status: number, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const nested = "error" in payload && payload.error && typeof payload.error === "object"
    ? payload.error : null;
  const code = "code" in payload ? payload.code
    : nested && "code" in nested ? nested.code : null;
  return status === 401 && typeof code === "string" &&
    ["backend_session_expired", "SESSION_INVALID", "SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(code);
}

/** Only confirmed credential failures receive this closed, non-personal value. */
export function workspaceSessionExpiryHeaders(status: number, payload: unknown): Record<string, string> {
  return workspaceSessionExpired(status, payload)
    ? { [WORKSPACE_SESSION_STATUS_HEADER]: "expired" } : {};
}

export class BackendSessionExpiredError extends TalentSignalHttpError {
  constructor() {
    super(
      401,
      "backend_session_expired",
      "登录状态已失效，请重新登录后继续。",
      null,
    );
    this.name = "BackendSessionExpiredError";
  }
}

export function isBackendSessionExpiredError(
  error: unknown,
): error is BackendSessionExpiredError {
  return (
    error instanceof BackendSessionExpiredError ||
    (error instanceof TalentSignalHttpError &&
      (error.code === "backend_session_expired" ||
        (error.status === 401 &&
          ["SESSION_INVALID", "SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(error.code)))) ||
    (error !== null &&
      error !== undefined &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "BackendSessionExpiredError")
  );
}

export function backendSessionRecoveryHref(callbackUrl: string): string {
  const parameters = new URLSearchParams({
    callbackUrl,
    reason: "backend_session_expired",
  });
  return `/login?${parameters.toString()}`;
}

export function backendSessionIsExpired(
  expiresAt: string,
  now = Date.now(),
) {
  const expiration = Date.parse(expiresAt);
  return !Number.isFinite(expiration) || expiration <= now;
}
