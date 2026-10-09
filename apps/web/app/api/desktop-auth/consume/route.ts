import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { signIn } from "@/auth";
import { AUTH_SESSION_COOKIE } from "@/lib/server/backendAuth";
import {
  readDesktopAuthFields,
  readDesktopAuthGrantResult,
  renderDesktopAuthCompletionDocument,
  renderDesktopAuthNoticeDocument,
  requireDesktopAuthAttemptId,
  requireDesktopAuthSecret,
} from "@/lib/server/desktop-browser-login";

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
 * The one-use exchange in the selected WKWebView context (ADR 0022). The
 * supported Auth.js `signIn` installs the ordinary session cookie; this route
 * serves only a content-free receipt or an honest outcome document. No token,
 * code, verifier or state ever enters the DOM or a URL.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const fields = await readDesktopAuthFields(request);
    const attemptId = requireDesktopAuthAttemptId(fields.attempt_id);
    const code = requireDesktopAuthSecret(fields.code, "code");
    const verifier = requireDesktopAuthSecret(fields.verifier, "verifier");
    const state = requireDesktopAuthSecret(fields.state, "state");
    let signInFailed = false;
    try {
      const redirectTarget = await signIn("desktop-browser", {
        attempt_id: attemptId,
        code,
        verifier,
        state,
        redirect: false,
        redirectTo: "/workspace",
      });
      signInFailed =
        typeof redirectTarget === "string" &&
        new URL(redirectTarget, "https://desktop-auth.invalid").searchParams.has("error");
    } catch {
      signInFailed = true;
    }
    const result = await readDesktopAuthGrantResult(attemptId, { verifier }).catch(() => null);
    const cookieInstalled = Boolean((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
    if (result?.committed && result.account_id && result.user_id && !signInFailed && cookieInstalled) {
      return html(
        renderDesktopAuthCompletionDocument({
          account_id: result.account_id,
          user_id: result.user_id,
          attempt_id: attemptId,
          request_id: requestId,
        }),
        200,
      );
    }
    if (result?.committed) {
      // The grant committed but this browser context's session state is
      // unknown; never claim success the readback cannot prove.
      return html(
        renderDesktopAuthNoticeDocument({
          title: "登录结果待确认",
          message: "登录已在账号侧完成，但此浏览器上下文的会话状态未知。请在 Mac 上使用“检查登录结果”。",
          requestId,
        }),
        200,
      );
    }
    return html(
      renderDesktopAuthNoticeDocument({
        title: "登录未完成",
        message: "这次 Mac 登录没有完成。请回到 Mac，重新发起登录。",
        requestId,
      }),
      400,
    );
  } catch {
    return html(
      renderDesktopAuthNoticeDocument({
        title: "登录未完成",
        message: "这次登录请求无法解析。请回到 Mac，重新发起登录。",
        requestId,
      }),
      400,
    );
  }
}
