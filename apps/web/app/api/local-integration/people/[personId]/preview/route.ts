import { TalentSignalHttpError } from "@talent-signal/contracts";
import { NextResponse } from "next/server";
import { backendSessionIsExpired } from "@/lib/backend-session";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { isIntegrationMode } from "@/lib/server/localBackend";
import { loadPersonContextPreview } from "@/lib/server/personContextPreview";
import { isWorkspaceSessionId, workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {
  "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff",
}});

export async function GET(request: Request, context: {params: Promise<{personId: string}>}) {
  if (!isIntegrationMode()) return reply({code: "local_integration_disabled"}, 404);
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return reply({code: "backend_session_expired"}, 401);
    const binding = workspaceSessionsBinding(claims);
    if (request.headers.get("x-workspace-session") !== binding) return reply({code: "session_stale"}, 409);
    const {personId} = await context.params;
    if (!isWorkspaceSessionId(personId)) return reply({code: "person_invalid"}, 400);
    return reply(await loadPersonContextPreview(personId, binding));
  } catch (error) {
    if (error instanceof TalentSignalHttpError) return reply({code: error.code}, error.status);
    if (error && typeof error === "object" && "status" in error && error.status === 401) return reply({code: "authentication_required"}, 401);
    return reply({code: "person_preview_unavailable"}, 503);
  }
}
