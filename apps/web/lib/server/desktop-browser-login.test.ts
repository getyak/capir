import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  claims: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  grantResult: vi.fn(),
  consume: vi.fn(),
  approve: vi.fn(),
  decline: vi.fn(),
  currentSession: vi.fn(),
  status: vi.fn(),
  clientCalls: [] as Array<{ method: string; args: unknown[] }>,
}));

vi.mock("./backendAuth", () => ({
  AUTH_SESSION_COOKIE: "talent-signal.session-v2",
  authSecret: () => "synthetic-test-secret",
  backendAuthBaseUrl: () => "http://backend.invalid",
  readPrimaryBackendSessionClaims: fixture.claims,
}));

vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  class SyntheticClient {
    setClientPlatform = vi.fn();
    prepareDesktopBrowserLogin(...args: unknown[]) {
      fixture.clientCalls.push({ method: "prepare", args });
      return fixture.prepare(...args);
    }
    cancelDesktopBrowserLogin(...args: unknown[]) {
      fixture.clientCalls.push({ method: "cancel", args });
      return fixture.cancel(...args);
    }
    readDesktopBrowserLoginGrantResult(...args: unknown[]) {
      fixture.clientCalls.push({ method: "grantResult", args });
      return fixture.grantResult(...args);
    }
    consumeDesktopBrowserLogin(...args: unknown[]) {
      fixture.clientCalls.push({ method: "consume", args });
      return fixture.consume(...args);
    }
    approveDesktopBrowserLogin(...args: unknown[]) {
      fixture.clientCalls.push({ method: "approve", args });
      return fixture.approve(...args);
    }
    declineDesktopBrowserLogin(...args: unknown[]) {
      fixture.clientCalls.push({ method: "decline", args });
      return fixture.decline(...args);
    }
    currentSession(...args: unknown[]) {
      fixture.clientCalls.push({ method: "currentSession", args });
      return fixture.currentSession(...args);
    }
    readDesktopBrowserLoginStatus(...args: unknown[]) {
      fixture.clientCalls.push({ method: "status", args });
      return fixture.status(...args);
    }
  }
  return { ...actual, TalentSignalClient: SyntheticClient };
});

import { TalentSignalHttpError } from "@talent-signal/contracts";
import {
  DesktopAuthRequestError,
  approveDesktopBrowserLoginRequest,
  authorizeDesktopBrowserLogin,
  declineDesktopBrowserLoginRequest,
  desktopAuthDeclineNotice,
  desktopBrowserLoginCallbackUrl,
  desktopBrowserLoginGrantResultRoute,
  desktopBrowserLoginPrepareRoute,
  desktopBrowserLoginStatusRoute,
  desktopAuthFormOriginAllowed,
  renderDesktopAuthCompletionDocument,
  renderDesktopAuthNoticeDocument,
  renderDesktopAuthApprovedDocument,
  sealDesktopAuthCsrf,
  verifyDesktopAuthCsrf,
} from "./desktop-browser-login";

const SECRET = "p".repeat(43);
const SECRET2 = "q".repeat(43);
const SECRET3 = "r".repeat(43);
const ATTEMPT = "11111111-2222-3333-4444-555555555555";

it("escapes request identifiers as attributes and callbacks as script data", () => {
  const requestId = 'request\" onmouseover=\"alert(1)';
  const notice = renderDesktopAuthNoticeDocument({ title: "Notice", message: "Safe", requestId });
  expect(notice).toContain('data-request-id="request&quot; onmouseover=&quot;alert(1)"');
  expect(notice).not.toContain('data-request-id="request" onmouseover=');
  const approved = renderDesktopAuthApprovedDocument({ callbackUrl: "</script><script>alert(1)</script>", requestId });
  expect(approved).not.toContain("</script><script>alert(1)");
  expect(approved).toContain('window.location.replace("\\u003c/script>');
});

const claims = {
  backendAccountId: "account-one",
  backendUserId: "user-one",
  backendAccountName: "Workspace",
  backendAccountSlug: "workspace",
  backendAccessToken: "token-one",
  backendExpiresAt: "2099-01-01T00:00:00.000Z",
  backendRole: "admin" as const,
  backendUsername: null,
};

// The deployment origin is server-derived from AUTH_URL in these tests.
process.env.AUTH_URL = "https://web.test";

const session = {
  backendAccessToken: "token-one",
  backendAccountId: "account-one",
  backendUserId: "user-one",
};

const approveInput = (overrides: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT,
  state: SECRET2,
  csrfToken: "",
  csrfSealed: undefined as string | undefined,
  session,
  webOrigin: "https://web.test",
  ...overrides,
});

const sessionResponse = {
  contract_version: "2026-08-24.10",
  access_token: "backend-access-token-value-that-must-not-leak",
  expires_at: "2099-01-01T00:00:00.000Z",
  account: { id: "account-one", slug: "workspace", name: "Workspace" },
  user: {
    id: "user-one",
    email: "person@example.test",
    display_name: "Real Person",
    kind: "password_human",
    role: "admin" as const,
    username: null,
  },
};

const currentSessionResponse = {
  contract_version: "2026-08-24.10",
  expires_at: "2099-01-01T00:00:00.000Z",
  account: { id: "account-one", slug: "workspace", name: "Workspace" },
  user: {
    id: "user-one",
    email: "person@example.test",
    display_name: "Real Person",
    kind: "password_human",
    role: "admin" as const,
    username: null,
  },
};

const request = (url: string, init?: RequestInit) =>
  new Request(`https://web.test${url}`, init);

const jsonPost = (url: string, body: unknown) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

it("requires exact form origin even when fetch metadata or Referer looks trusted", () => {
  for (const origin of ["null", "https://foreign.test", "http://web.test"]) {
    expect(desktopAuthFormOriginAllowed(request("/api/desktop-auth/approve", {
      method: "POST",
      headers: { origin, referer: "https://web.test/", "sec-fetch-site": "same-origin" },
    }))).toBe(false);
  }
  expect(desktopAuthFormOriginAllowed(request("/api/desktop-auth/approve", {
    method: "POST", headers: { origin: "https://web.test", referer: "https://web.test/" },
  }))).toBe(true);
  expect(desktopAuthFormOriginAllowed(request("/api/desktop-auth/approve", {
    method: "POST", headers: { "sec-fetch-site": "same-origin" },
  }))).toBe(false);
});

beforeEach(() => {
  for (const key of ["claims", "prepare", "cancel", "grantResult", "consume", "approve", "decline", "currentSession", "status"] as const) {
    fixture[key].mockReset();
  }
  fixture.clientCalls.length = 0;
  fixture.claims.mockResolvedValue(claims);
});

const prepareBody = {
  challenge: SECRET,
  state: SECRET2,
  cancel_secret: SECRET3,
};

it("prepares one bounded grant with the server-owned origin and writes no cookie", async () => {
  fixture.prepare.mockResolvedValue({
    contract_version: "2026-08-24.10",
    attempt_id: ATTEMPT,
    authorization_url: `https://web.test/desktop-auth/authorize?attempt=${ATTEMPT}&state=${SECRET2}`,
    expires_at: "2026-10-01T12:05:00.000Z",
    matching_hint: "K7QF-2M4",
  });
  const response = await desktopBrowserLoginPrepareRoute(jsonPost("/api/desktop-auth/prepare", prepareBody));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({ attempt_id: ATTEMPT, matching_hint: "K7QF-2M4" });
  const [forwarded] = fixture.prepare.mock.calls[0] as [Record<string, unknown>];
  // The Web origin is derived from the deployment/request, never chosen by the caller.
  expect(forwarded.web_origin).toBe("https://web.test");
  expect(forwarded.challenge).toBe(SECRET);
  expect(forwarded.purpose).toBe("macos-primary-login");
  expect(forwarded.protocol_version).toBe(1);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("refuses malformed proof material without touching the backend", async () => {
  const response = await desktopBrowserLoginPrepareRoute(
    jsonPost("/api/desktop-auth/prepare", { ...prepareBody, state: "short" }),
  );
  expect(response.status).toBe(400);
  expect(fixture.prepare).not.toHaveBeenCalled();
  const payload = await response.text();
  expect(payload).not.toContain(SECRET);
  expect(payload).not.toContain(SECRET3);
});

it("tells the truth without a session and never writes cookies from status", async () => {
  fixture.claims.mockResolvedValue(null);
  const response = await desktopBrowserLoginStatusRoute(request("/api/desktop-auth/status"));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ status: "unauthenticated" });
  // Read-only: no Set-Cookie ever leaves this endpoint, and without the
  // primary cookie there is no Lab/test fallback session to consult.
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fixture.currentSession).not.toHaveBeenCalled();
  expect(fixture.status).not.toHaveBeenCalled();
});

it("correlates a live session to the exact grant attempt without a cookie write", async () => {
  fixture.currentSession.mockResolvedValue(currentSessionResponse);
  fixture.status.mockResolvedValue({
    contract_version: "2026-08-24.10",
    attempt_id: ATTEMPT,
    state: "consumed",
    account_id: "account-one",
    user_id: "user-one",
    device_session_id: "device-session",
    consumed_at: "2026-10-01T12:01:00.000Z",
  });
  const response = await desktopBrowserLoginStatusRoute(
    request(`/api/desktop-auth/status?attempt=${ATTEMPT}`),
  );
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    status: "authenticated",
    account: { id: "account-one" },
    user: { id: "user-one" },
    attempt: { attempt_id: ATTEMPT, state: "consumed", account_id: "account-one", user_id: "user-one" },
  });
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(payload)).not.toContain("token-one");
});

it("allows legacy no-attempt readback for an existing Mac session", async () => {
  fixture.currentSession.mockResolvedValue(currentSessionResponse);
  const response = await desktopBrowserLoginStatusRoute(request("/api/desktop-auth/status"));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.attempt).toBeUndefined();
  expect(payload).toMatchObject({ status: "authenticated", user: { id: "user-one" } });
  expect(fixture.status).not.toHaveBeenCalled();
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("reports an inactive backend session truthfully", async () => {
  fixture.currentSession.mockRejectedValue(
    new TalentSignalHttpError(401, "SESSION_INVALID", "gone", null),
  );
  const response = await desktopBrowserLoginStatusRoute(request("/api/desktop-auth/status"));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ status: "unauthenticated" });
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("reads the secret-bound grant result without minting anything", async () => {
  fixture.grantResult.mockResolvedValue({
    contract_version: "2026-08-24.10",
    attempt_id: ATTEMPT,
    state: "consumed",
    account_id: "account-one",
    user_id: "user-one",
    committed: true,
    expires_at: "2026-10-01T12:05:00.000Z",
  });
  const response = await desktopBrowserLoginGrantResultRoute(
    jsonPost("/api/desktop-auth/grant-result", { attempt_id: ATTEMPT, verifier: SECRET }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ committed: true, account_id: "account-one" });
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("maps the desktop-browser exchange to the ordinary backend claims", async () => {
  fixture.consume.mockResolvedValue(sessionResponse);
  const user = await authorizeDesktopBrowserLogin({
    attempt_id: ATTEMPT,
    code: SECRET,
    verifier: SECRET2,
    state: SECRET3,
  });
  expect(user).toEqual({
    id: "user-one",
    email: "person@example.test",
    name: "Real Person",
    backendAccessToken: sessionResponse.access_token,
    backendAccountId: "account-one",
    backendAccountName: "Workspace",
    backendAccountSlug: "workspace",
    backendExpiresAt: "2099-01-01T00:00:00.000Z",
    backendRole: "admin",
    backendUserId: "user-one",
    backendUsername: null,
  });
  const [forwarded] = fixture.consume.mock.calls[0] as [Record<string, unknown>];
  expect(forwarded).toEqual({
    attempt_id: ATTEMPT,
    code: SECRET,
    verifier: SECRET2,
    state: SECRET3,
    // Derived server side from the deployment, never client-chosen authority.
    web_origin: "https://web.test",
  });
});

it("never falls through to a partial session when the exchange is refused", async () => {
  fixture.consume.mockRejectedValue(
    new TalentSignalHttpError(403, "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH", "no", null),
  );
  expect(
    await authorizeDesktopBrowserLogin({ attempt_id: ATTEMPT, code: SECRET, verifier: SECRET2, state: SECRET3 }),
  ).toBeNull();
  fixture.consume.mockRejectedValue(
    new TalentSignalHttpError(500, "INTERNAL_ERROR", "no", null),
  );
  await expect(
    authorizeDesktopBrowserLogin({ attempt_id: ATTEMPT, code: SECRET, verifier: SECRET2, state: SECRET3 }),
  ).rejects.toSatisfy((error: unknown) => (error as DesktopAuthRequestError).status === 503);
});

it("seals each confirmation form to its exact attempt, state and live session", async () => {
  const { token, sealed } = await sealDesktopAuthCsrf(ATTEMPT, SECRET2, session);
  expect(await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET2, token, sealed, session })).toBe(true);
  expect(
    await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET3, token, sealed, session }),
  ).toBe(false);
  expect(
    await verifyDesktopAuthCsrf({ attemptId: "99999999-2222-3333-4444-555555555555", state: SECRET2, token, sealed, session }),
  ).toBe(false);
  expect(
    await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET2, token: "forged", sealed, session }),
  ).toBe(false);
  expect(
    await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET2, token, sealed: undefined, session }),
  ).toBe(false);
});

it("refuses a confirmation form after the browser session changes", async () => {
  // Tab A renders the form for account A / token A; another tab replaces the
  // primary cookie with account B / token B. Posting the stale form must fail
  // closed instead of approving under B while the UI named A.
  const { token, sealed } = await sealDesktopAuthCsrf(ATTEMPT, SECRET2, session);
  const changed = {
    backendAccessToken: "token-two",
    backendAccountId: "account-two",
    backendUserId: "user-two",
  };
  expect(
    await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET2, token, sealed, session: changed }),
  ).toBe(false);
  await expect(
    approveDesktopBrowserLoginRequest(approveInput({ csrfToken: token, csrfSealed: sealed, session: changed })),
  ).rejects.toSatisfy((error: unknown) => (error as DesktopAuthRequestError).code === "desktop_auth_csrf_invalid");
  expect(fixture.approve).not.toHaveBeenCalled();
  // The unchanged live session still verifies the same form.
  expect(
    await verifyDesktopAuthCsrf({ attemptId: ATTEMPT, state: SECRET2, token, sealed, session }),
  ).toBe(true);
});

it("approves only behind a valid CSRF seal and never re-mints codes", async () => {
  const { token, sealed } = await sealDesktopAuthCsrf(ATTEMPT, SECRET2, session);
  fixture.approve.mockResolvedValue({
    contract_version: "2026-08-24.10",
    attempt_id: ATTEMPT,
    state: "approved",
    code: SECRET,
    code_expires_at: "2026-10-01T12:01:00.000Z",
    callback_url: desktopBrowserLoginCallbackUrl(ATTEMPT, SECRET, SECRET2),
    matching_hint: "K7QF-2M4",
    account_id: "account-one",
    user_id: "user-one",
    already_approved: false,
  });
  const approved = await approveDesktopBrowserLoginRequest(
    approveInput({ csrfToken: token, csrfSealed: sealed }),
  );
  expect(approved.callback_url).toBe(`com.talentsignal.macos.auth://complete?attempt=${ATTEMPT}&code=${SECRET}&state=${SECRET2}`);
  expect(fixture.approve).toHaveBeenCalledWith(ATTEMPT, { state: SECRET2, web_origin: "https://web.test" });

  await expect(
    approveDesktopBrowserLoginRequest(approveInput({ csrfToken: "forged", csrfSealed: sealed })),
  ).rejects.toSatisfy((error: unknown) => (error as DesktopAuthRequestError).code === "desktop_auth_csrf_invalid");
  // A refused form never reaches the backend.
  expect(fixture.approve).toHaveBeenCalledTimes(1);
});

it("declines only behind a valid CSRF seal", async () => {
  const { token, sealed } = await sealDesktopAuthCsrf(ATTEMPT, SECRET2, session);
  fixture.decline.mockResolvedValue({
    contract_version: "2026-08-24.10",
    attempt_id: ATTEMPT,
    state: "cancelled",
    cancellation_recorded: true,
  });
  const result = await declineDesktopBrowserLoginRequest(
    approveInput({ csrfToken: token, csrfSealed: sealed }),
  );
  expect(result).toMatchObject({ state: "cancelled", cancellation_recorded: true });
  expect(fixture.decline).toHaveBeenCalledWith(ATTEMPT, { state: SECRET2, web_origin: "https://web.test" });
});

it("distinguishes consumed, expired and cancelled decline outcomes truthfully", () => {
  const consumed = desktopAuthDeclineNotice("consumed");
  expect(consumed.title).not.toContain("取消");
  expect(consumed.message).toContain("不会回滚");
  const expired = desktopAuthDeclineNotice("expired");
  expect(expired.title).toContain("过期");
  const cancelled = desktopAuthDeclineNotice("cancelled");
  expect(cancelled.title).toContain("取消");
  // An already-completed request is never reported as cancelled.
  expect(consumed.title).not.toBe(cancelled.title);
  expect(expired.title).not.toBe(cancelled.title);
});

it("keeps the callback limited to attempt, code and state", () => {
  const url = new URL(desktopBrowserLoginCallbackUrl("a", "b", "c"));
  expect(url.protocol).toBe("com.talentsignal.macos.auth:");
  expect(url.host).toBe("complete");
  expect(url.pathname === "" || url.pathname === "/").toBe(true);
  expect([...url.searchParams.keys()].sort()).toEqual(["attempt", "code", "state"]);
});

it("renders a completion document with identity and correlation but no secret material", () => {
  const html = renderDesktopAuthCompletionDocument({
    account_id: "account-one",
    user_id: "user-one",
    attempt_id: ATTEMPT,
    request_id: "request-correlation-1",
  });
  expect(html).toContain("account-one");
  expect(html).toContain("user-one");
  expect(html).toContain(ATTEMPT);
  expect(html).toContain("request-correlation-1");
  for (const secret of [SECRET, SECRET2, SECRET3, "backend-access-token-value-that-must-not-leak"]) {
    expect(html).not.toContain(secret);
  }
  expect(html).not.toContain("access_token");
  expect(html).not.toContain("verifier");
});
