import { TalentSignalHttpError } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

import { reconcileWorkspaceSessionRecoveryHref } from "@/components/use-workspace-session-recovery";
import {
  BackendSessionExpiredError,
  backendSessionRecoveryHref,
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "./backend-session";

describe("backend session boundary", () => {
  it("treats an elapsed backend session as expired", () => {
    expect(
      backendSessionIsExpired("2026-08-26T08:00:00.000Z", 1_788_000_000_001),
    ).toBe(true);
  });

  it("treats malformed expiration data as expired rather than active", () => {
    expect(backendSessionIsExpired("not-a-date")).toBe(true);
  });

  it("keeps the expired state distinct from a missing legacy backend session", () => {
    const error = new BackendSessionExpiredError();
    expect(error.name).toBe("BackendSessionExpiredError");
    expect(error.status).toBe(401);
    expect(error.code).toBe("backend_session_expired");
    expect(isBackendSessionExpiredError(error)).toBe(true);
    expect(
      backendSessionRecoveryHref("/workspace?surface=desk"),
    ).toBe(
      "/login?callbackUrl=%2Fworkspace%3Fsurface%3Ddesk&reason=backend_session_expired",
    );
  });

  it("reconciles a soft server refresh without erasing a client expiry event", () => {
    const clientRecovery =
      "/login?callbackUrl=%2Fworkspace%2Ftoday&reason=backend_session_expired";
    const serverRecovery =
      "/login?callbackUrl=%2Fworkspace%2Fpeople&reason=backend_session_expired";

    expect(
      reconcileWorkspaceSessionRecoveryHref({
        currentHref: clientRecovery,
        nextInitialHref: null,
        previousInitialHref: null,
      }),
    ).toBe(clientRecovery);
    expect(
      reconcileWorkspaceSessionRecoveryHref({
        currentHref: null,
        nextInitialHref: serverRecovery,
        previousInitialHref: null,
      }),
    ).toBe(serverRecovery);
    expect(
      reconcileWorkspaceSessionRecoveryHref({
        currentHref: serverRecovery,
        nextInitialHref: null,
        previousInitialHref: serverRecovery,
      }),
    ).toBeNull();
  });
});

it("recognizes canonical revoked credentials without classifying network or permission failure as logout", () => {
  for (const code of ["SESSION_INVALID", "SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"]) {
    expect(isBackendSessionExpiredError(new TalentSignalHttpError(401, code, "Unavailable", null))).toBe(true);
  }
  expect(isBackendSessionExpiredError(new TalentSignalHttpError(503, "SESSION_INVALID", "Unavailable", null))).toBe(false);
  expect(isBackendSessionExpiredError(new TalentSignalHttpError(403, "FORBIDDEN", "Unavailable", null))).toBe(false);
  expect(isBackendSessionExpiredError(new TypeError("Failed to fetch"))).toBe(false);
});

it("recognizes canonical scoped 401 bodies without hiding unknown errors", async () => {
  const { workspaceSessionExpired } = await import("@/components/workspace-session-request");
  expect(workspaceSessionExpired(401, { error: { code: "SESSION_INVALID" } })).toBe(true);
  expect(workspaceSessionExpired(401, { code: "SESSION_EXPIRED" })).toBe(true);
  expect(workspaceSessionExpired(503, { code: "SESSION_INVALID" })).toBe(false);
  expect(workspaceSessionExpired(401, { code: "UNKNOWN" })).toBe(false);
});
