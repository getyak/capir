import "server-only";
import { createHash, randomBytes } from "node:crypto";

import {
  TalentSignalClient,
  TalentSignalHttpError,
  type DesktopBrowserLoginApproveResponse,
  type DesktopBrowserLoginCancelResponse,
  type DesktopBrowserLoginGrantResultResponse,
  type DesktopBrowserLoginPrepareResponse,
  type DesktopBrowserLoginStatusResponse,
  type SessionResponse,
} from "@talent-signal/contracts";
import { decode, encode } from "next-auth/jwt";
import { headers } from "next/headers";

import {
  AUTH_SESSION_COOKIE,
  authSecret,
  backendAuthBaseUrl,
  readPrimaryBackendSessionClaims,
} from "@/lib/server/backendAuth";

/**
 * First-party Web side of the browser-owned macOS primary login (ADR 0022).
 *
 * The browser owns authentication and confirmation; this module only carries
 * bounded proof material between the native operation, the browser and the
 * backend. It never logs, echoes or DOM-renders a proof secret, never writes
 * cookies in read-only status, and never invents a token: the one session
 * cookie is installed only through the supported Auth.js `signIn` path.
 */

export const DESKTOP_BROWSER_LOGIN_PURPOSE = "macos-primary-login";
export const DESKTOP_BROWSER_LOGIN_PROTOCOL_VERSION = 1;
export const DESKTOP_BROWSER_LOGIN_CALLBACK_URL = "com.talentsignal.macos.auth://complete";
export const DESKTOP_AUTH_CSRF_COOKIE = "talent-signal.desktop-auth.csrf";
export const DESKTOP_AUTH_CONSUME_PATH = "/api/desktop-auth/consume";
export const DESKTOP_AUTH_AUTHORIZE_PATH = "/desktop-auth/authorize";

const SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

export function requireDesktopAuthSecret(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 256 ||
    !SECRET_PATTERN.test(value)
  ) {
    throw new DesktopAuthRequestError(
      400,
      "desktop_auth_secret_invalid",
      `The ${field} is not a well-formed operation secret.`,
    );
  }
  return value;
}

export class DesktopAuthRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DesktopAuthRequestError";
    this.status = status;
    this.code = code;
  }
}

function jsonError(error: unknown): Response {
  if (error instanceof DesktopAuthRequestError) {
    return jsonBody(
      { code: error.code, message: error.message },
      error.status,
    );
  }
  if (error instanceof TalentSignalHttpError) {
    return jsonBody(
      { code: "desktop_auth_backend_refused", message: "The login request could not be completed." },
      error.status >= 500 ? 502 : error.status,
    );
  }
  return jsonBody(
    { code: "desktop_auth_unavailable", message: "The login service is temporarily unavailable." },
    503,
  );
}

function jsonBody(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function anonymousClient(): TalentSignalClient {
  const client = new TalentSignalClient(backendAuthBaseUrl());
  client.setClientPlatform("web");
  return client;
}

/**
 * The exact Web origin owning the browser confirmation. It is derived from the
 * deployment configuration or the request itself; a client can never choose
 * the origin, callback or account authority of a grant.
 */
export function desktopAuthWebOrigin(request: Request): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https" : url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Deployment origin for server-invoked flows that hold no Request object
 * (the Auth.js provider). It never trusts a credential field: AUTH_URL first,
 * then this invocation's own request headers, otherwise it fails closed.
 */
export async function desktopAuthDeploymentOrigin(): Promise<string> {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    const proto = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
    if (host) return `${proto}://${host}`;
  } catch {
    // Outside a request scope there is no trustworthy origin source.
  }
  throw new DesktopAuthRequestError(
    503,
    "desktop_auth_unavailable",
    "The login service cannot determine its deployment origin.",
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to the honest rejection below
  }
  throw new DesktopAuthRequestError(
    400,
    "desktop_auth_request_invalid",
    "The login request body is not well formed.",
  );
}

/** Anonymous, rate-limited preparation of one bounded browser grant. */
export async function desktopBrowserLoginPrepareRoute(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const challenge = requireDesktopAuthSecret(body.challenge, "challenge");
    const state = requireDesktopAuthSecret(body.state, "state");
    const cancelSecret = requireDesktopAuthSecret(body.cancel_secret, "cancel secret");
    const prepared: DesktopBrowserLoginPrepareResponse =
      await anonymousClient().prepareDesktopBrowserLogin({
        protocol_version: DESKTOP_BROWSER_LOGIN_PROTOCOL_VERSION,
        purpose: DESKTOP_BROWSER_LOGIN_PURPOSE,
        challenge,
        state,
        cancel_secret: cancelSecret,
        web_origin: desktopAuthWebOrigin(request),
      });
    return jsonBody(prepared, 200);
  } catch (error) {
    return jsonError(error);
  }
}

/** Native cancellation proved by the prepared cancellation secret. */
export async function desktopBrowserLoginCancelRoute(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const attemptId = requireDesktopAuthAttemptId(body.attempt_id);
    const cancelSecret = requireDesktopAuthSecret(body.cancel_secret, "cancel secret");
    const result: DesktopBrowserLoginCancelResponse = await anonymousClient().cancelDesktopBrowserLogin(
      attemptId,
      { attempt_id: attemptId, cancel_secret: cancelSecret },
    );
    return jsonBody(result, 200);
  } catch (error) {
    return jsonError(error);
  }
}

export function requireDesktopAuthAttemptId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/iu.test(value)) {
    throw new DesktopAuthRequestError(
      400,
      "desktop_auth_attempt_invalid",
      "The login request identifier is not well formed.",
    );
  }
  return value;
}

/**
 * Secret-bound read-only result for an unknown exchange outcome. It never
 * mints a session, a code or a cookie.
 */
export async function desktopBrowserLoginGrantResultRoute(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const attemptId = requireDesktopAuthAttemptId(body.attempt_id);
    const verifier =
      typeof body.verifier === "string" && body.verifier
        ? requireDesktopAuthSecret(body.verifier, "verifier")
        : undefined;
    const cancelSecret =
      typeof body.cancel_secret === "string" && body.cancel_secret
        ? requireDesktopAuthSecret(body.cancel_secret, "cancel secret")
        : undefined;
    if (!verifier && !cancelSecret) {
      throw new DesktopAuthRequestError(
        400,
        "desktop_auth_secret_invalid",
        "A proof secret is required to read this login result.",
      );
    }
    const result: DesktopBrowserLoginGrantResultResponse =
      await anonymousClient().readDesktopBrowserLoginGrantResult(attemptId, {
        attempt_id: attemptId,
        ...(verifier ? { verifier } : {}),
        ...(cancelSecret ? { cancel_secret: cancelSecret } : {}),
      });
    return jsonBody(result, 200);
  } catch (error) {
    return jsonError(error);
  }
}

export type DesktopAuthStatusBody = {
  status: "authenticated";
  attempt?: DesktopBrowserLoginStatusResponse;
  account: { id: string; name: string; slug: string };
  user: { id: string; email: string; display_name: string };
  session_expires_at: string;
};

/**
 * Fixed read-only status for the selected WebKit context. It decodes the
 * primary encrypted cookie without an Auth.js refresh, checks the live backend
 * session, writes no cookie and never falls back to a Lab/test session.
 */
export async function desktopBrowserLoginStatusRoute(request: Request): Promise<Response> {
  try {
    const claims = await readPrimaryBackendSessionClaims();
    if (!claims) {
      return jsonBody(
        {
          status: "unauthenticated",
          message: "This Mac browser context has no signed-in session.",
        },
        401,
      );
    }
    const client = new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken);
    client.setClientPlatform("web");
    let live: Awaited<ReturnType<TalentSignalClient["currentSession"]>>;
    try {
      live = await client.currentSession();
    } catch (error) {
      if (error instanceof TalentSignalHttpError && error.status === 401) {
        return jsonBody(
          {
            status: "unauthenticated",
            message: "The backend session for this Mac browser context is no longer active.",
          },
          401,
        );
      }
      throw error;
    }
    const attemptId = new URL(request.url).searchParams.get("attempt");
    let attempt: DesktopBrowserLoginStatusResponse | undefined;
    if (attemptId) {
      attempt = await client.readDesktopBrowserLoginStatus(requireDesktopAuthAttemptId(attemptId));
    }
    const body: DesktopAuthStatusBody = {
      status: "authenticated",
      ...(attempt ? { attempt } : {}),
      account: { id: live.account.id, name: live.account.name, slug: live.account.slug },
      user: {
        id: live.user.id,
        email: live.user.email,
        display_name: live.user.display_name,
      },
      session_expires_at: live.expires_at,
    };
    return jsonBody(body, 200);
  } catch (error) {
    return jsonError(error);
  }
}

export type DesktopBrowserLoginCredentials = {
  attempt_id: unknown;
  code: unknown;
  verifier: unknown;
  state: unknown;
};

export type DesktopBrowserLoginUser = {
  id: string;
  email: string;
  name: string;
  backendAccessToken: string;
  backendAccountId: string;
  backendAccountName: string;
  backendAccountSlug: string;
  backendExpiresAt: string;
  backendRole: "admin" | "member";
  backendUserId: string;
  backendUsername: string | null;
};

/**
 * The `desktop-browser` Credentials provider authorization: one atomic
 * backend exchange in the selected WKWebView context. It maps the ordinary
 * backend session claims exactly like the other login providers; nothing here
 * invents a token format and nothing accepts a Lab fallback session.
 */
export async function authorizeDesktopBrowserLogin(
  credentials: Partial<DesktopBrowserLoginCredentials>,
): Promise<DesktopBrowserLoginUser | null> {
  const attemptId = requireDesktopAuthAttemptId(credentials.attempt_id);
  const code = requireDesktopAuthSecret(credentials.code, "code");
  const verifier = requireDesktopAuthSecret(credentials.verifier, "verifier");
  const state = requireDesktopAuthSecret(credentials.state, "state");
  // The deployment origin is derived server side (AUTH_URL or the request
  // headers of this invocation). Even the Auth.js credentials callback route
  // cannot choose the origin authority of an exchange.
  const webOrigin = await desktopAuthDeploymentOrigin();
  try {
    const session: SessionResponse = await anonymousClient().consumeDesktopBrowserLogin({
      attempt_id: attemptId,
      code,
      verifier,
      state,
      web_origin: webOrigin,
    });
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.display_name,
      backendAccessToken: session.access_token,
      backendAccountId: session.account.id,
      backendAccountName: session.account.name,
      backendAccountSlug: session.account.slug,
      backendExpiresAt: session.expires_at,
      backendRole: session.user.role,
      backendUserId: session.user.id,
      backendUsername: session.user.username,
    };
  } catch (error) {
    if (error instanceof DesktopAuthRequestError) throw error;
    if (error instanceof TalentSignalHttpError && error.status >= 400 && error.status < 500) {
      // A refused proof is a failed sign-in, never a partial session.
      return null;
    }
    throw new DesktopAuthRequestError(
      503,
      "desktop_auth_unavailable",
      "The login service is temporarily unavailable.",
    );
  }
}

export type DesktopAuthCsrfIssue = {
  /** Raw value for the intentional form; the sealed cookie holds its twin. */
  token: string;
  sealed: string;
};

/** Seal one intentional confirmation form to its exact attempt, state and
 * browser session. The (token, sealed) pair travels as hidden form fields;
 * the seal binds a hash of the primary backend token plus account and user,
 * and the routes reverify it against the LIVE primary claims before any
 * approval or decline, so a tab whose cookie changed cannot post a form that
 * was rendered for another session. */
export async function sealDesktopAuthCsrf(
  attemptId: string,
  state: string,
  session: { backendAccessToken: string; backendAccountId: string; backendUserId: string },
  now = Date.now(),
): Promise<DesktopAuthCsrfIssue> {
  const token = randomBytes(32).toString("base64url");
  const sealed = await encode({
    secret: authSecret(),
    salt: DESKTOP_AUTH_CSRF_COOKIE,
    maxAge: 5 * 60,
    token: {
      desktopAuthCsrf: {
        attemptId,
        stateHash: createHash("sha256").update(state).digest("hex"),
        tokenHash: createHash("sha256").update(token).digest("hex"),
        sessionHash: createHash("sha256").update(session.backendAccessToken).digest("hex"),
        accountId: session.backendAccountId,
        userId: session.backendUserId,
        issuedAt: now,
      },
    },
  });
  return { token, sealed };
}

export async function verifyDesktopAuthCsrf(input: {
  attemptId: string;
  state: string;
  token: string;
  sealed: string | undefined;
  session: { backendAccessToken: string; backendAccountId: string; backendUserId: string };
}): Promise<boolean> {
  if (!input.sealed || !input.token) return false;
  let decoded: {
    desktopAuthCsrf?: {
      attemptId?: string;
      stateHash?: string;
      tokenHash?: string;
      sessionHash?: string;
      accountId?: string;
      userId?: string;
    };
  } | null;
  try {
    decoded = await decode({
      token: input.sealed,
      secret: authSecret(),
      salt: DESKTOP_AUTH_CSRF_COOKIE,
    });
  } catch {
    return false;
  }
  const record = decoded?.desktopAuthCsrf;
  if (!record) return false;
  return (
    record.attemptId === input.attemptId &&
    record.stateHash === createHash("sha256").update(input.state).digest("hex") &&
    record.tokenHash === createHash("sha256").update(input.token).digest("hex") &&
    record.sessionHash ===
      createHash("sha256").update(input.session.backendAccessToken).digest("hex") &&
    record.accountId === input.session.backendAccountId &&
    record.userId === input.session.backendUserId
  );
}

export type DesktopAuthApproveInput = {
  attemptId: string;
  state: string;
  csrfToken: string;
  csrfSealed: string | undefined;
  /** The LIVE primary session the routes just decoded; the seal must match it. */
  session: { backendAccessToken: string; backendAccountId: string; backendUserId: string };
  /** Server-derived deployment origin; never body authority. */
  webOrigin: string;
  client?: TalentSignalClient;
};

/**
 * Intentional browser approval: CSRF first, then one authenticated backend
 * approval against the live Web session. The one-use code is returned to the
 * caller for the fixed-scheme callback; it is never logged.
 */
export async function approveDesktopBrowserLoginRequest(
  input: DesktopAuthApproveInput,
): Promise<DesktopBrowserLoginApproveResponse> {
  const csrfValid = await verifyDesktopAuthCsrf({
    attemptId: input.attemptId,
    state: input.state,
    token: input.csrfToken,
    sealed: input.csrfSealed,
    session: input.session,
  });
  if (!csrfValid) {
    throw new DesktopAuthRequestError(
      403,
      "desktop_auth_csrf_invalid",
      "This confirmation form expired. Reopen the login request on the Mac.",
    );
  }
  const client = input.client ?? anonymousClient();
  return client.approveDesktopBrowserLogin(input.attemptId, {
    state: input.state,
    web_origin: input.webOrigin,
  });
}

/** Intentional browser decline: authenticated, state-bound, never a mutation of another grant. */
export async function declineDesktopBrowserLoginRequest(
  input: DesktopAuthApproveInput,
): Promise<DesktopBrowserLoginCancelResponse> {
  const csrfValid = await verifyDesktopAuthCsrf({
    attemptId: input.attemptId,
    state: input.state,
    token: input.csrfToken,
    sealed: input.csrfSealed,
    session: input.session,
  });
  if (!csrfValid) {
    throw new DesktopAuthRequestError(
      403,
      "desktop_auth_csrf_invalid",
      "This confirmation form expired. Reopen the login request on the Mac.",
    );
  }
  const client = input.client ?? anonymousClient();
  return client.declineDesktopBrowserLogin(input.attemptId, {
    state: input.state,
    web_origin: input.webOrigin,
  });
}

/** The fixed-scheme callback carrying opaque attempt, code and state only. */
export function desktopBrowserLoginCallbackUrl(
  attemptId: string,
  code: string,
  state: string,
): string {
  const query = new URLSearchParams({ attempt: attemptId, code, state });
  return `${DESKTOP_BROWSER_LOGIN_CALLBACK_URL}?${query.toString()}`;
}

export type DesktopAuthCompletionReceipt = {
  account_id: string;
  user_id: string;
  attempt_id: string;
  request_id: string;
};

/**
 * The content-free completion document served after one successful exchange.
 * It carries the approved account/user and request correlation only: no
 * token, code, verifier, state or provider assertion may enter the DOM.
 */
export function renderDesktopAuthCompletionDocument(
  receipt: DesktopAuthCompletionReceipt,
): string {
  const payload = JSON.stringify(receipt);
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Talent Signal · 登录完成</title></head>",
    `<body data-talent-signal-receipt='${payload.replace(/'/g, "&#39;")}'>`,
    "<main><h1>登录完成</h1>",
    "<p>可以回到 Talent Signal 继续。此页面不包含任何凭据。</p>",
    "</main></body></html>",
  ].join("\n");
}

export function isAuthSessionCookie(name: string): boolean {
  return name === AUTH_SESSION_COOKIE;
}

/** Same-origin guard for the intentional browser forms; POST only. */
export function desktopAuthFormOriginAllowed(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const origin = desktopAuthWebOrigin(request);
  if (originHeader) return originHeader === origin;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === origin;
  } catch {
    return false;
  }
}

/** Form or JSON request bodies share one bounded reader. */
export async function readDesktopAuthFields(
  request: Request,
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") fields[key] = value;
    }
    return fields;
  }
  return readJsonBody(request) as Promise<Record<string, string>>;
}

/** Secret-bound read-only grant result used by the exchange readback. */
export async function readDesktopAuthGrantResult(
  attemptId: string,
  proof: { verifier?: string; cancel_secret?: string },
  client?: TalentSignalClient,
): Promise<DesktopBrowserLoginGrantResultResponse> {
  return (client ?? anonymousClient()).readDesktopBrowserLoginGrantResult(attemptId, {
    attempt_id: attemptId,
    ...(proof.verifier ? { verifier: proof.verifier } : {}),
    ...(proof.cancel_secret ? { cancel_secret: proof.cancel_secret } : {}),
  });
}

/**
 * Truthful decline outcomes: an already-completed request is never reported
 * as "cancelled", and an expired one is never reported as either.
 */
export function desktopAuthDeclineNotice(state: "consumed" | "cancelled" | "expired"): {
  title: string;
  message: string;
} {
  switch (state) {
    case "consumed":
      return {
        title: "登录请求已完成",
        message:
          "这个登录请求已经完成登录，取消不会回滚任何会话。如果这不是你的操作，请在设置中退出该 Mac 的会话。",
      };
    case "expired":
      return {
        title: "登录请求已过期",
        message: "这个 Mac 登录请求已过期，没有可取消的内容。请回到 Mac，重新发起登录。",
      };
    case "cancelled":
      return {
        title: "已取消",
        message: "已取消这个 Mac 登录请求。可以回到 Mac 重新发起登录。",
      };
  }
}

/** The browser confirmation page's backend client carries the live session. */
export function desktopAuthBearerClient(backendToken: string): TalentSignalClient {
  const client = new TalentSignalClient(backendAuthBaseUrl(), backendToken);
  client.setClientPlatform("web");
  return client;
}

/** Small standalone handoff documents share the calm confirmation layout. */
const desktopAuthDocumentStyle = `<style>
:root{color-scheme:light dark}body{margin:0;background:light-dark(#faf9f6,#141413);color:light-dark(#242421,#efeeea);font:14px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100svh;display:grid;place-items:center}main{width:min(440px,calc(100% - 48px));padding:48px 0}h1{font-size:26px;font-weight:550;line-height:1.45;letter-spacing:-.025em}p{color:light-dark(#696961,#aaa99f)}a{color:inherit;display:inline-flex;min-height:44px;align-items:center;text-underline-offset:4px}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}
</style>`;

/** Content-free notice document: one honest outcome, no secret material. */
export function renderDesktopAuthNoticeDocument(input: {
  title: string;
  message: string;
  requestId: string;
}): string {
  const escape = (value: string) =>
    value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Talent Signal · 登录</title>", desktopAuthDocumentStyle, "</head>",
    "<body><main>",
    `<h1>${escape(input.title)}</h1>`,
    `<p>${escape(input.message)}</p>`,
    `<p data-request-id="${escape(input.requestId)}"></p>`,
    "</main></body></html>",
  ].join("\n");
}

/**
 * Approved handoff document: the only content is the fixed-scheme callback
 * carrying opaque attempt/code/state, delivered as a link plus a location
 * assignment so every browser configuration can complete the native handoff.
 */
export function renderDesktopAuthApprovedDocument(input: {
  callbackUrl: string;
  requestId: string;
}): string {
  const escapedCallback = input.callbackUrl
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;");
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Talent Signal · 已确认</title>", desktopAuthDocumentStyle, "</head>",
    "<body><main>",
    "<h1>已确认在这台 Mac 上登录</h1>",
    "<p>正在返回 Talent Signal。如果应用没有自动回到前台，请点击下面的链接。</p>",
    `<p><a id="complete" href="${escapedCallback}">返回 Talent Signal</a></p>`,
    `<p data-request-id="${escapeAttribute(input.requestId)}"></p>`,
    `<script>window.location.replace(${JSON.stringify(input.callbackUrl)});</script>`,
    "</main></body></html>",
  ].join("\n");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}
