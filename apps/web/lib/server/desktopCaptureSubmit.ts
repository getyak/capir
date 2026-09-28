import "server-only";

import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";
import type { ConversationQueueAdmitRequest } from "@talent-signal/contracts";
import { backendAuthBaseUrl, readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired, isBackendSessionExpiredError } from "../backend-session";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionDraftStorageScope } from "./workspaceSessions";
import { conversationQueueRoute } from "./conversationQueue";
import { isAllowedMutationOrigin } from "../request-origin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 13_500_000;
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

type CaptureSubmission = ConversationQueueAdmitRequest & {
  policy_version: string;
  owner_scope: string;
};

/** The requested capture is the only body that may reach the existing queue. */
export async function desktopCaptureSubmitRoute(request: Request, sessionId: string, messageId: string): Promise<Response> {
  if (!UUID.test(sessionId) || !UUID.test(messageId)) return reply({ message: "截图标识无效。" }, 400);
  if (!isAllowedMutationOrigin(request.headers)) return reply({ message: "请求来源不受支持。" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ message: "请求格式无效。" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ message: "截图过大，请缩小选择范围。" }, 413);

  try {
    const claims = await readBackendSessionClaims();
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) {
      return reply({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    }
    if (request.headers.get("x-workspace-session") !== contactHandoffSessionVersion(claims)) {
      return reply({ code: "session_stale", message: "登录已改变；截图未上传。" }, 409);
    }
    if (request.headers.get("x-talent-signal-workspace") !== claims.backendAccountId) {
      return reply({ code: "session_stale", message: "工作区已改变；截图未上传。" }, 409);
    }

    const reader = request.body?.getReader();
    if (!reader) return reply({ message: "截图内容为空。" }, 400);
    const chunks: Uint8Array[] = [];
    let count = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.length;
      if (count > MAX_BODY_BYTES) {
        await reader.cancel();
        return reply({ message: "截图过大，请缩小选择范围。" }, 413);
      }
      chunks.push(chunk.value);
    }
    let input: CaptureSubmission;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CaptureSubmission; }
    catch { return reply({ message: "截图内容格式无效。" }, 400); }
    if (!input || input.session_id !== sessionId || input.message_id !== messageId || input.idempotency_key !== messageId ||
      input.owner_scope !== workspaceSessionDraftStorageScope(claims) ||
      input.objective !== "" || !Array.isArray(input.images) || input.images.length !== 1) {
      return reply({ code: "capture_intent_invalid", message: "截图与当前工作区不匹配。" },
        input?.owner_scope !== workspaceSessionDraftStorageScope(claims) ? 409 : 400);
    }
    const client = new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken);
    const processing = await client.getDesktopCapturePolicy();
    if (!processing.available || input.policy_version !== processing.policy_version) {
      return reply({ code: "capture_processing_changed", message: "截图处理方式已改变，请查看后再继续。" }, 409);
    }
    const queueInput: ConversationQueueAdmitRequest = {
      session_id: sessionId, message_id: messageId,
      idempotency_key: messageId, objective: "", images: input.images,
    };
    // Re-enter the same owner-checked durable queue path. It rechecks login and
    // image integrity; this wrapper owns only the explicit Mac capture scope.
    const delegated = new Request(request.url, {
      method: "POST", headers: request.headers, body: JSON.stringify(queueInput), signal: request.signal,
    });
    return await conversationQueueRoute(delegated, sessionId, "admit");
  } catch (error) {
    if (isBackendSessionExpiredError(error)) return reply({ code: "backend_session_expired", message: "请重新登录。" }, 401);
    if (error instanceof TalentSignalHttpError) return reply({ code: error.code, message: error.message }, error.status);
    return reply({ code: "capture_submit_unavailable", message: "送达结果尚未确认，请核对后重试。" }, 503);
  }
}
