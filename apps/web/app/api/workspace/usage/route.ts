import { NextRequest, NextResponse } from "next/server";

import {
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { loadWeeklyUsage } from "@/lib/server/weeklyUsage";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";

/**
 * Read-only weekly usage proxy for the signed-in workspace session.
 *
 * A failed read is never turned into a 0 count: the client keeps its error
 * state and retry until the real aggregate can be read.
 */
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      vary: "cookie, x-talent-signal-workspace, x-talent-signal-usage-binding",
      "x-content-type-options": "nosniff",
    },
  });

export async function GET(_request: NextRequest) {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt) ||
        _request.headers.get("x-talent-signal-workspace") !== claims.backendAccountId ||
        _request.headers.get("x-talent-signal-usage-binding") !== workspaceSessionsBinding(claims)) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    return response(await loadWeeklyUsage());
  } catch (error) {
    if (isBackendSessionExpiredError(error)) {
      return response(
        { code: "backend_session_expired", message: "请重新登录。" },
        401,
      );
    }
    return response(
      { code: "weekly_usage_unavailable", message: "暂时无法读取本周用量，请稍后重试。" },
      503,
    );
  }
}
