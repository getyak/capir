import { beforeEach, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({ auth: vi.fn(), claims: vi.fn(), current: vi.fn(), grant: vi.fn(), redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: fixture.auth }));
vi.mock("@/lib/server/backendAuth", () => ({ readPrimaryBackendSessionClaims: fixture.claims }));
vi.mock("next/navigation", () => ({ redirect: fixture.redirect }));
vi.mock("@/lib/server/desktop-browser-login", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/desktop-browser-login")>(),
  desktopAuthDeploymentOrigin: async () => "https://web.test",
  desktopAuthBearerClient: () => ({ currentSession: fixture.current, readDesktopBrowserLoginGrant: fixture.grant }),
}));
import AuthorizePage from "./page";

const attempt = "11111111-2222-4333-8444-555555555555", state = "s".repeat(43);
const returnTarget = `/desktop-auth/authorize?attempt=${attempt}&state=${state}`;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.auth.mockResolvedValue({ user: { id: "synthetic" } });
  fixture.claims.mockResolvedValue({ backendAccessToken: "synthetic", backendAccountId: "account", backendUserId: "user" });
  fixture.redirect.mockImplementation(() => { throw new Error("expected-redirect"); });
  fixture.grant.mockResolvedValue({ state: "prepared", matching_hint: "ABCD-12" });
});
it("revoked backend session with a valid browser cookie reaches ordinary browser reauthentication", async () => {
  fixture.current.mockRejectedValue(new TalentSignalHttpError(401, "AUTH_SESSION_REVOKED", "Session revoked", null));
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(returnTarget)}`);
});
it("incomplete primary claims cannot bounce through the existing user-present login redirect", async () => {
  fixture.claims.mockResolvedValue(null);
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?reason=backend_session_expired&callbackUrl=${encodeURIComponent(returnTarget)}`);
  expect(fixture.current).not.toHaveBeenCalled();
});
it("a genuinely signed-out browser returns to the exact unapproved attempt after normal sign-in", async () => {
  fixture.auth.mockResolvedValue(null);
  await expect(AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) })).rejects.toThrow("expected-redirect");
  expect(fixture.redirect).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(returnTarget)}`);
});

it.each([
  new TalentSignalHttpError(503, "BACKEND_UNAVAILABLE", "Service unavailable", null),
  Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }),
])("keeps a temporary upstream failure distinct from an invalid or expired request", async error => {
  fixture.current.mockRejectedValue(error);
  const html = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) }));
  expect(html).toContain("暂时无法连接登录服务");
  expect(html).not.toContain("无效、已过期");
  expect(fixture.redirect).not.toHaveBeenCalled();
});

it("explains that a restricted test identity cannot authorize a real Mac session", async () => {
  fixture.current.mockResolvedValue({ account: { id: "account" }, user: { id: "user" } });
  fixture.grant.mockRejectedValue(new TalentSignalHttpError(403, "DESKTOP_BROWSER_LOGIN_IDENTITY_REFUSED", "Test identities cannot inspect a Mac login request.", null));
  const html = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) }));
  expect(html).toContain("测试身份不能授权 Mac 登录");
  expect(html).not.toContain("无效、已过期");
  expect(fixture.redirect).not.toHaveBeenCalled();
});

it.each([400, 404, 410])("still explains a rejected or missing request (HTTP %s)", async status => {
  fixture.current.mockResolvedValue({ account: { id: "account" }, user: { id: "user" } });
  fixture.grant.mockRejectedValue(new TalentSignalHttpError(status, "DESKTOP_REQUEST_INVALID", "Request unavailable", null));
  const html = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) }));
  expect(html).toContain("无效、已过期");
  expect(html).not.toContain("暂时无法连接登录服务");
  expect(fixture.redirect).not.toHaveBeenCalled();
});

it.each([
  [403, "DESKTOP_BROWSER_LOGIN_PROOF_MISMATCH"],
  [409, "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED"],
] as const)("explains a permanently mismatched request (%s %s)", async (status, code) => {
  fixture.current.mockResolvedValue({ account: { id: "account" }, user: { id: "user" } });
  fixture.grant.mockRejectedValue(new TalentSignalHttpError(status, code, "Request mismatch", null));
  const html = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve({ attempt, state }) }));
  expect(html).toContain("登录请求无法核对");
  expect(html).toContain("与当前浏览器不匹配");
  expect(html).not.toContain("登录服务暂时不可用");
  expect(fixture.redirect).not.toHaveBeenCalled();
});
