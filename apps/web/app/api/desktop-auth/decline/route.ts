import { randomUUID } from "node:crypto";

import {
  DesktopAuthRequestError,
  declineDesktopBrowserLoginRequest,
  desktopAuthBearerClient,
  desktopAuthDeclineNotice,
  desktopAuthFormOriginAllowed,
  desktopAuthWebOrigin,
  readDesktopAuthFields,
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

/** Intentional browser decline: same-origin POST only, CSRF-sealed, state-bound. */
export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    if (!desktopAuthFormOriginAllowed(request)) {
      return html(
        renderDesktopAuthNoticeDocument({
          title: "无法取消",
          message: "这个表单不是来自登录页面。请回到 Mac 使用取消。",
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
          message: "浏览器还没有登录，无法取消这个请求。请在 Mac 上使用取消。",
          requestId,
        }),
        401,
      );
    }
    const result = await declineDesktopBrowserLoginRequest({
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
    const notice = desktopAuthDeclineNotice(
      result.state === "consumed"
        ? "consumed"
        : result.state === "expired"
          ? "expired"
          : "cancelled",
    );
    return html(
      renderDesktopAuthNoticeDocument({ title: notice.title, message: notice.message, requestId }),
      200,
    );
  } catch (error) {
    return html(
      renderDesktopAuthNoticeDocument({
        title: "无法取消",
        message: "取消没有完成。请回到 Mac 使用取消。",
        requestId,
      }),
      error instanceof DesktopAuthRequestError ? error.status : 502,
    );
  }
}
