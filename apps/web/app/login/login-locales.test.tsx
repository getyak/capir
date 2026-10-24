// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, redirect, jar, backend, language } = vi.hoisted(() => ({
  language: { locale: "en" as string },
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
  jar: { entries: new Map<string, string>() },
  backend: {
    claims: vi.fn(),
    client: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next-auth", () => {
  class AuthError extends Error {
    type = "AuthError";
  }
  class CredentialsSignin extends AuthError {
    type = "CredentialsSignin";
    code = "credentials";
  }
  return { AuthError, CredentialsSignin };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name)! } : undefined,
    set: (name: string, value: string) => {
      jar.entries.set(name, value);
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
  headers: async () => new Headers({ host: "web.test" }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/server/marketing-locale", () => ({getMarketingLocale: async () => language.locale}));

vi.mock("@/lib/server/backendAuth", () => ({
  AUTH_SESSION_COOKIE: "talent-signal.session-v2",
  authSecret: () => "login-page-fixture-secret",
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  readPrimaryBackendSessionClaims: backend.claims,
  authenticatedBackendClient: backend.client,
  confirmBackendRegistration: vi.fn(),
  registerBackendAccount: vi.fn(),
  signInBackendAccount: vi.fn(),
}));
vi.mock("@/lib/server/testWorkspaceSession", () => ({
  TEST_WORKSPACE_COOKIE: "talent-signal.test-workspace",
  clearTestWorkspaceSession: vi.fn(),
}));
vi.mock("@/lib/server/google-session", () => ({
  bindGoogleNonce: vi.fn(async (url: string) => url),
  finishGoogleSignIn: vi.fn(),
  prepareGoogleSignIn: vi.fn(),
}));
vi.mock("@/lib/server/apple-session", () => ({
  bindAppleNonce: vi.fn(async (url: string) => url),
  finishAppleSignIn: vi.fn(),
  prepareAppleSignIn: vi.fn(),
}));
vi.mock("@/lib/server/google-oauth", () => ({
  getGoogleOAuthCredentials: () => ({ clientId: "google-id", clientSecret: "google-secret" }),
}));
vi.mock("@/lib/server/apple-oauth", () => ({ getAppleOAuthCredentials: () => null }));

import LoginPage, { generateMetadata } from "./page";
import { LocaleProvider } from "@/components/locale-provider";
import type { LocaleTag } from "@talent-signal/contracts";
beforeEach(() => {
  auth.mockResolvedValue(null); jar.entries.clear();
  vi.stubEnv("TALENT_SIGNAL_PASSWORD_AUTH_ENABLED", "true");
  vi.stubEnv("TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["en", "Sign in to your workspace", "Email or username", "Show password"],
  ["zh-CN", "登录你的工作台", "邮箱或用户名", "显示密码"],
  ["zh-TW", "登入你的工作空間", "電子郵件或使用者名稱", "顯示密碼"],
  ["ja", "ワークスペースにログイン", "メールアドレスまたはユーザー名", "パスワードを表示"],
  ["ko", "워크스페이스에 로그인", "이메일 또는 사용자 이름", "비밀번호 표시"],
])("keeps the full sign-in entry in %s without changing the Mac callback", async (locale, title, identifier, reveal) => {
  language.locale = locale;
  const callback = "/desktop-auth/authorize?attempt=10000000-0000-4000-8000-000000000001&state=locale-synthetic";
  const page = await LoginPage({searchParams:Promise.resolve({callbackUrl:callback})});
  const html = renderToStaticMarkup(<LocaleProvider locale={locale as LocaleTag}>{page}</LocaleProvider>);
  const host = document.createElement("div"); host.innerHTML = html;
  expect(host.querySelector("h1")?.textContent).toBe(title);
  expect(host.querySelector("label[for=account-email]")?.textContent).toBe(identifier);
  expect(host.querySelector("button[aria-controls=account-password]")?.getAttribute("aria-label")).toBe(reveal);
  expect(host.querySelector<HTMLInputElement>("input[name=redirectTo]")?.value).toBe(callback);
  expect(host.querySelector<HTMLInputElement>("input[name=password]")?.autocomplete).toBe("current-password");
  if (locale === "en") {
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(host.querySelector("aside")?.getAttribute("aria-label")).toBe("Continue your work across devices");
    expect(host.querySelector("a.brand")?.getAttribute("aria-label")).toBe("Back to home");
    expect(host.querySelector("aside")?.textContent).toContain("context stay together");
  }
});

it("localizes metadata and an expired-session notice without changing its meaning", async () => {
  language.locale = "en";
  expect((await generateMetadata()).title).toBe("Sign in and sign up");
  const page = await LoginPage({searchParams:Promise.resolve({reason:"backend_session_expired"})});
  const html = renderToStaticMarkup(<LocaleProvider locale="en">{page}</LocaleProvider>);
  expect(html).toContain("Your session expired. Sign in again to continue your work.");
  expect(html).not.toContain("wrong password");
});

it("keeps the native login defense inert while following the selected language", async () => {
  const { DesktopNativeLoginNotice } = await import("./desktop-native-notice");
  const html = renderToStaticMarkup(<DesktopNativeLoginNotice locale="en" />);
  expect(html).toContain("Sign in from the capri app");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("<input");
});
