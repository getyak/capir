import "server-only";

import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";
import { backendAuthBaseUrl, readBackendSessionClaims, readPrimaryBackendSessionClaims } from "./backendAuth";
import { DesktopPersistentSessionError, readDesktopPersistentStatus } from "./desktop-persistent-session";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionDraftStorageScope } from "./workspaceSessions";

const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

export async function desktopCaptureContextRoute(): Promise<Response> {
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return response({ code: "backend_session_expired", message: "请先登录工作区。" }, 401);
    }
    const primary = await readPrimaryBackendSessionClaims();
    if (!primary || backendSessionIsExpired(primary.backendExpiresAt)) {
      return response({ code: "backend_session_expired", message: "请先登录工作区。" }, 401);
    }
    // A selected test workspace has its own business account. Bind native
    // recovery to the live PRIMARY device owner without conflating the two.
    const owner = primary.backendSessionId
      ? await readDesktopPersistentStatus(primary.backendAccessToken) : undefined;
    if (owner && (owner.account_id !== primary.backendAccountId ||
        owner.user_id !== primary.backendUserId || owner.session_id !== primary.backendSessionId)) {
      return response({ code: "capture_context_unavailable", message: "暂时无法确认截图处理范围。" }, 503);
    }
    const processing = await new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken).getDesktopCapturePolicy();
    const expires_at = new Date(Math.min(Date.parse(claims.backendExpiresAt),
      Date.parse(primary.backendExpiresAt), owner ? Date.parse(owner.session_expires_at) : Infinity,
      Date.now() + 5 * 60_000)).toISOString();
    return response({
      protocol_version: 1,
      owner_scope: workspaceSessionDraftStorageScope(claims),
      workspace_account_id: claims.backendAccountId,
      ...(owner ? { primary_account_id: owner.account_id, primary_user_id: owner.user_id,
        primary_session_id: owner.session_id } : {}),
      login_binding: contactHandoffSessionVersion(claims),
      expires_at,
      processing: { ...processing, workspace_label: claims.backendAccountName },
    });
  } catch (error) {
    if (error instanceof DesktopPersistentSessionError && error.status === 401) {
      return response({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    }
    if (isBackendSessionExpiredError(error)) return response({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) return response({ code: error.code, message: error.message }, error.status);
    return response({ code: "capture_context_unavailable", message: "暂时无法确认截图处理范围。" }, 503);
  }
}
