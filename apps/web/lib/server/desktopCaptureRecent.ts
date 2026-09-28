import "server-only";

import { readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { loadWorkspaceSessionDirectory } from "./workspaceSessions";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function desktopCaptureRecentRoute(request: Request): Promise<Response> {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return reply({ code: "backend_session_expired" }, 401);
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) return reply({ code: "session_stale" }, 409);
    const directory = await loadWorkspaceSessionDirectory({ cursor: null });
    return reply({ session_id: directory.sessions[0]?.sessionId ?? null });
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return reply({ code: "backend_session_expired" }, 401);
    return reply({ code: "recent_session_unavailable" }, 503);
  }
}
