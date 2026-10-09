import { TalentSignalHttpError } from "@talent-signal/contracts";

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
