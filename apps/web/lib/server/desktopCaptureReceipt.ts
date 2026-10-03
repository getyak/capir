import "server-only";

import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";
import { backendAuthBaseUrl, readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function desktopCaptureReceiptRoute(request: Request, sessionId: string, messageId: string): Promise<Response> {
  if (!UUID.test(sessionId) || !UUID.test(messageId)) return reply({ message: "截图标识无效。" }, 400);
  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) return reply({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) {
      return reply({ code: "session_stale", message: "登录已改变；请重新读取截图状态。" }, 409);
    }
    const receipt = await new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken)
      .getDesktopCaptureReceipt(sessionId, messageId);
    if (receipt.session_id !== sessionId || receipt.message_id !== messageId) {
      return reply({ code: "capture_receipt_mismatch", message: "截图状态与原始请求不一致。" }, 502);
    }
    return reply(receipt);
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return reply({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) return reply({ code: error.code, message: error.message }, error.status);
    return reply({ code: "capture_receipt_unavailable", message: "暂时无法确认截图状态。" }, 503);
  }
}
