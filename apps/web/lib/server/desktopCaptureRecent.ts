import "server-only";

import { readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { loadWorkspaceSessionDirectory } from "./workspaceSessions";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const MAX_PAGES = 20;

export async function desktopCaptureRecentRoute(request: Request): Promise<Response> {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return reply({ code: "backend_session_expired" }, 401);
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) return reply({ code: "session_stale" }, 409);
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const directory = await loadWorkspaceSessionDirectory({ cursor });
      const recent = directory.sessions[0];
      if (recent) return reply({ session_id: recent.sessionId });
      if (directory.complete) return reply({ session_id: null });
      const next = directory.nextCursor;
      // An incomplete scan cannot truthfully claim there is no conversation.
      if (!next || seen.has(next)) return reply({ code: "recent_session_scan_incomplete" }, 503);
      seen.add(next);
      cursor = next;
    }
    return reply({ code: "recent_session_scan_incomplete" }, 503);
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return reply({ code: "backend_session_expired" }, 401);
    return reply({ code: "recent_session_unavailable" }, 503);
  }
}
