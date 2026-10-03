import { randomUUID } from "node:crypto";

import { TalentSignalHttpError } from "@talent-signal/contracts";

import {
  DesktopAuthRequestError,
  approveDesktopBrowserLoginRequest,
  desktopAuthBearerClient,
  desktopAuthFormOriginAllowed,
  desktopAuthWebOrigin,
  readDesktopAuthFields,
  renderDesktopAuthApprovedDocument,
  renderDesktopAuthNoticeDocument,
  requireDesktopAuthAttemptId,
  requireDesktopAuthSecret,
} from "@/lib/server/desktop-browser-login";
import { readPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";

export const dynamic = "force-dynamic";

function html(document: string, status: number): Response {
  return new Response(document, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Intentional browser approval (ADR 0022): same-origin POST only, sealed
 * CSRF form proof, then one authenticated backend approval against the live
 * Web session. A GET can never approve anything.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    if (!desktopAuthFormOriginAllowed(request)) {
      return html(
        renderDesktopAuthNoticeDocument({
          title: "无法确认",
          message: "这个确认表单不是来自登录页面。请回到 Mac，重新发起登录。",
          requestId,
        }),
        403,
      );
    }
    const fields = await readDesktopAuthFields(request);
    const attemptId = requireDesktopAuthAttemptId(fields.attempt_id);
    const state = requireDesktopAuthSecret(fields.state, "state");
    const claims = await readPrimaryBackendSessionClaims();
    if (!claims) {
      return html(
        renderDesktopAuthNoticeDocument({
          title: "需要先登录",
          message: "浏览器还没有登录。请重新从 Mac 发起登录，登录后会回到确认页面。",
          requestId,
        }),
        401,
      );
    }
    const approved = await approveDesktopBrowserLoginRequest({
      attemptId,
      state,
      csrfToken: typeof fields.csrf_token === "string" ? fields.csrf_token : "",
      csrfSealed: typeof fields.csrf_sealed === "string" ? fields.csrf_sealed : undefined,
      session: {
        backendAccessToken: claims.backendAccessToken,
        backendAccountId: claims.backendAccountId,
        backendUserId: claims.backendUserId,
      },
      webOrigin: desktopAuthWebOrigin(request),
      client: desktopAuthBearerClient(claims.backendAccessToken),
    });
    if (approved.code) {
      return html(
        renderDesktopAuthApprovedDocument({
          callbackUrl: approved.callback_url,
          requestId,
        }),
        200,
      );
    }
    return html(
      renderDesktopAuthNoticeDocument({
        title: "已确认过",
        message: "这个 Mac 登录请求已经确认过，一次性代码不会再签发。如果 Mac 还在等待，请回到 Mac 重新发起登录。",
        requestId,
      }),
      200,
    );
  } catch (error) {
    const message =
      error instanceof DesktopAuthRequestError || error instanceof TalentSignalHttpError
        ? "这次确认没有完成。请回到 Mac，重新发起登录。"
        : "确认服务暂时不可用。请稍后回到 Mac 重试。";
    return html(
      renderDesktopAuthNoticeDocument({ title: "无法确认", message, requestId }),
      error instanceof DesktopAuthRequestError ? error.status : 502,
    );
  }
}
