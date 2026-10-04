import { cookies } from "next/headers";
import { encode } from "next-auth/jwt";
import { TalentSignalHttpError } from "@talent-signal/contracts";

import { authCookieSecure } from "@/lib/auth-cookie-policy";
import {
  AUTH_SESSION_COOKIE,
  authSecret,
} from "@/lib/server/backendAuth";
import {
  clampedSessionMaxAgeSeconds,
  configuredCapirTestWebOrigin,
  exchangeCapirTestHandoff,
} from "@/lib/server/capir-test-entry";
import { TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function originOf(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof TalentSignalHttpError) {
    return new Response(
      JSON.stringify({ error: { code: error.code, message: error.message } }),
      { status: error.status, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({
      error: { code: "CAPIR_TEST_ENTRY_FAILED", message: "Private test entry failed." },
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

/**
 * Private POST one-use handoff exchange.
 *
 * The secret travels in the POST body only (never in a public URL), the
 * trusted Web consumer key stays server-side, and the target test session is
 * installed only after exact origin, account, run, dataset and expiry
 * verification. A replayed, foreign, malformed or expired handoff fails
 * closed with no cookie written.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TalentSignalHttpError(400, "CAPIR_TEST_HANDOFF_INVALID", "The request body must be JSON.", null);
    }
    const handoffSecret = (body as { handoff_secret?: unknown } | null)?.handoff_secret;
    if (typeof handoffSecret !== "string") {
      throw new TalentSignalHttpError(400, "CAPIR_TEST_HANDOFF_INVALID", "The handoff secret is required.", null);
    }
    // Nonsecret expected target of the private POST: the canonical run must
    // match it before any cookie exists.
    const expectedRunId = (body as { run_id?: unknown } | null)?.run_id;
    if (expectedRunId !== undefined && typeof expectedRunId !== "string") {
      throw new TalentSignalHttpError(400, "CAPIR_TEST_HANDOFF_INVALID", "The expected run id is malformed.", null);
    }
    const result = await exchangeCapirTestHandoff({
      handoffSecret,
      requestOrigin: originOf(request),
      ...(expectedRunId === undefined ? {} : { expectedRunId }),
    });
    const maxAge = clampedSessionMaxAgeSeconds({
      sessionExpiresAt: result.claims.backendExpiresAt,
      runExpiresAt: result.run.expires_at,
      ceilingSeconds: SESSION_MAX_AGE_SECONDS,
    });
    const value = await encode({
      secret: authSecret(),
      salt: AUTH_SESSION_COOKIE,
      maxAge,
      token: {
        sub: result.claims.backendUserId,
        name: result.claims.backendAccountName,
        backendAccessToken: result.claims.backendAccessToken,
        backendAccountId: result.claims.backendAccountId,
        backendAccountName: result.claims.backendAccountName,
        backendAccountSlug: result.claims.backendAccountSlug,
        backendExpiresAt: result.claims.backendExpiresAt,
        backendRole: result.claims.backendRole,
        backendUserId: result.claims.backendUserId,
        backendUsername: result.claims.backendUsername,
      },
    });
    const jar = await cookies();
    jar.set(AUTH_SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: authCookieSecure(),
      path: "/",
      maxAge,
    });
    // Entry installs ONLY the target test session: no human primary selection
    // cookie is adopted, reused or fabricated.
    jar.delete(TEST_WORKSPACE_COOKIE);
    // The runner contract: HTTP 303 with a relative Location of /workspace.
    void configuredCapirTestWebOrigin();
    return new Response(null, { status: 303, headers: { location: "/workspace" } });
  } catch (error) {
    return errorResponse(error);
  }
}
