import {
  TalentSignalClient,
  TalentSignalHttpError,
  type SystemHealthResponse,
} from "@talent-signal/contracts";
import { NextResponse } from "next/server";

import {
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  backendAuthBaseUrl,
  readBackendSessionClaims,
} from "@/lib/server/backendAuth";
import { unavailableSystemHealth } from "@/lib/system-health";
import { withSystemHealthTimeout } from "@/lib/system-health-timeout";

export const dynamic = "force-dynamic";

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      vary: "cookie, x-talent-signal-workspace",
      "x-content-type-options": "nosniff",
    },
  });

export async function GET() {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    const client = new TalentSignalClient(
      backendAuthBaseUrl(),
      claims.backendAccessToken,
    );
    client.setClientPlatform("web");
    const backend = await withSystemHealthTimeout(
      (signal) => client.systemHealth(signal),
      { timeoutMs: 4_000 },
    );
    return response({
      ...backend,
      components: [
        {
          id: "web",
          label: "capri Web",
          kind: "service",
          required: true,
          status: "healthy",
          duration_ms: null,
          detail_code: "request_completed",
        },
        ...backend.components,
      ],
    } satisfies SystemHealthResponse);
  } catch (error) {
    if (
      isBackendSessionExpiredError(error) ||
      (error instanceof TalentSignalHttpError && error.status === 401)
    ) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    return response(unavailableSystemHealth(), 503);
  }
}
