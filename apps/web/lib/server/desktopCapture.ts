import "server-only";

import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";
import { backendAuthBaseUrl, readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionDraftStorageScope } from "./workspaceSessions";

const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

export async function desktopCaptureContextRoute(_request: Request): Promise<Response> {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return response({ code: "backend_session_expired", message: "请先登录工作区。" }, 401);
    }
    const processing = await new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken).getDesktopCapturePolicy();
    const expires_at = new Date(Math.min(Date.parse(claims.backendExpiresAt), Date.now() + 5 * 60_000)).toISOString();
    return response({
      protocol_version: 1,
      owner_scope: workspaceSessionDraftStorageScope(claims),
      login_binding: contactHandoffSessionVersion(claims),
      expires_at,
      processing,
    });
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return response({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) return response({ code: error.code, message: error.message }, error.status);
    return response({ code: "capture_context_unavailable", message: "暂时无法确认截图处理范围。" }, 503);
  }
}
