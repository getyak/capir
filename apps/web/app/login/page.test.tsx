// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, redirect, jar, backend } = vi.hoisted(() => ({
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

import LoginPage from "./page";
import { LOGIN_COLLISION_TTL_SECONDS } from "@/lib/login-continuity";
import { sealLoginCollisionHint } from "@/lib/server/loginCollision";
import {
  AUTH_OPERATION_COOKIE,
  sealAuthOperation,
  sessionFingerprint,
  type AuthOperation,
} from "@/lib/server/stagedAuth";

const macCallback = "/desktop-auth/authorize?attempt=10000000-0000-4000-8000-000000000001&state=aB3_-cD9";

async function renderPage(parameters: Record<string, string | undefined>) {
  return renderToStaticMarkup(
    await LoginPage({ searchParams: Promise.resolve(parameters) }),
  );
}

/** Unescaped href of the anchor tag carrying the given marker. */
function anchorHref(html: string, marker: string): string {
  const at = html.indexOf(marker);
  const tag = html.slice(html.lastIndexOf("<a", at), html.indexOf(">", at));
  const match = /href="([^"]+)"/.exec(tag);
  return (match?.[1] ?? "").replace(/&amp;/g, "&");
}

function redirectTarget(): string {
  return String(redirect.mock.calls.at(-1)?.[0] ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-11T00:00:00.000Z"));
  jar.entries.clear();
  auth.mockReset();
  auth.mockResolvedValue(null);
  redirect.mockClear();
  backend.claims.mockReset();
  backend.claims.mockResolvedValue(null);
  backend.client.mockReset();
  backend.client.mockResolvedValue(null);
});

afterEach(() => vi.useRealTimers());

describe("login page account continuity", () => {
  it("shows the neutral continuity panel only with a live sealed collision hint", async () => {
    await sealLoginCollisionHint("google");
    const html = await renderPage({
      error: "OAuthAccountNotLinked",
      callbackUrl: macCallback,
    });

    expect(html).toContain("data-login-connect-continuity");
    // Concise neutral copy: title, preserved records, explicit action.
    expect(html).toContain("继续使用已有账号");
    expect(html).toContain("联系人和会话会保留在同一个账号中");
    // No red generic error and no private account details.
    expect(html).not.toContain("这个邮箱已有账号");
    // The original CLI/Mac callback travels with both explicit actions.
    expect(anchorHref(html, "data-connect-continuity-primary")).toBe(
      `/login?connect=google&callbackUrl=${encodeURIComponent(macCallback)}`,
    );
    expect(anchorHref(html, "data-connect-continuity-escape")).toBe(
      `/login?callbackUrl=${encodeURIComponent(macCallback)}`,
    );
  });

  it("keeps the CLI authorization query through collision guidance and original login", async () => {
    // Same route and fields produced by apps/cli/src/login.ts; only public
    // state/PKCE challenge travels to Web, never the CLI verifier.
    const cliCallback = "/capir/authorize?" + new URLSearchParams({
      schema_version: "capir-auth.v2",
      redirect_uri: "http://127.0.0.1:49152/capir/callback",
      state: "a".repeat(43),
      code_challenge: "b".repeat(43),
      code_challenge_method: "S256",
      web_origin: "https://app.example",
      backend_origin: "https://backend.example.invalid",
      client_label: "GET-141",
    });
    await sealLoginCollisionHint("google");
    const panel = await renderPage({ error: "OAuthAccountNotLinked", callbackUrl: cliCallback });
    const entry = new URL(anchorHref(panel, "data-connect-continuity-primary"), "https://app.example");
    expect(entry.searchParams.get("callbackUrl")).toBe(cliCallback);
    const login = await renderPage({ connect: entry.searchParams.get("connect")!, callbackUrl: cliCallback });
    const redirectTo = login.match(/name="redirectTo" value="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(redirectTo).toBeDefined();
    const destination = new URL(redirectTo!, entry.origin);
    expect(destination.pathname).toBe("/workspace/settings");
    expect(destination.searchParams.get("returnTo")).toBe(cliCallback);
  });

  it("recovers a safe original callback from the Auth.js navigation cookie", async () => {
    await sealLoginCollisionHint("apple");
    jar.entries.set(
      "talent-signal.callback-url",
      "/onboarding?callbackUrl=%2Fworkspace%2Fpursuits%2F42",
    );
    const html = await renderPage({ error: "OAuthAccountNotLinked" });
    expect(html).toContain("data-login-connect-continuity");
    expect(html).toContain("Apple");
    expect(anchorHref(html, "data-connect-continuity-primary")).toBe(
      `/login?connect=apple&callbackUrl=${encodeURIComponent("/workspace/pursuits/42")}`,
    );
  });

  it("keeps a forged or expired error hint fully silent about accounts", async () => {
    // Forged query alone: no sealed hint, no collision panel, no disclosure.
    let html = await renderPage({ error: "OAuthAccountNotLinked", callbackUrl: "/workspace" });
    expect(html).not.toContain("data-login-connect-continuity");
    expect(html).not.toContain("继续使用已有账号");
    expect(html).not.toContain("这个邮箱已有账号");
    expect(html).toContain("登录未完成，请重试或换一种方式。");

    // Expired hint discloses nothing either.
    await sealLoginCollisionHint("google");
    vi.setSystemTime(Date.parse("2026-10-11T00:00:00.000Z") + (LOGIN_COLLISION_TTL_SECONDS + 1) * 1_000);
    html = await renderPage({ error: "OAuthAccountNotLinked" });
    expect(html).not.toContain("data-login-connect-continuity");
    expect(html).not.toContain("继续使用已有账号");
  });

  it("routes every sign-in path through the preselected connecting continuation", async () => {
    const html = await renderPage({ connect: "google", callbackUrl: macCallback });
    // The gentle reminder is a navigation promise, not a claim.
    expect(html).toContain("登录后会带你继续连接 Google");
    const continuation = `/workspace/settings?section=account&connect=google&returnTo=${encodeURIComponent(macCallback)}`;
    expect(html).toContain(`value="${continuation.replace(/&/g, "&amp;")}"`);
    // The plain login form stays available without any collision messaging.
    expect(html).not.toContain("data-login-connect-continuity");
  });

  it("drops forged connect hints instead of steering the journey", async () => {
    const html = await renderPage({ connect: "https://evil.example", callbackUrl: "/workspace" });
    expect(html).not.toContain("登录后会带你继续连接");
    expect(html).toContain('value="/workspace"');
  });

  it("continues an authenticated collision to Settings and other errors recoverably", async () => {
    auth.mockResolvedValue({ user: { name: "Owner" } });
    await sealLoginCollisionHint("google");
    await expect(
      renderPage({ error: "OAuthAccountNotLinked", callbackUrl: macCallback }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget()).toBe(
      `/workspace/settings?section=account&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );

    // A non-collision error keeps the generic recoverable Settings return and
    // never opens a connecting panel.
    jar.entries.clear();
    await expect(renderPage({ error: "Configuration" })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget()).toBe("/workspace/settings?link=error");
  });

  it("sends an already-authenticated connect hint to the preselected continuation", async () => {
    auth.mockResolvedValue({ user: { name: "Owner" } });
    await expect(
      renderPage({ connect: "google", callbackUrl: macCallback }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const continuation = `/workspace/settings?section=account&connect=google&returnTo=${encodeURIComponent(macCallback)}`;
    expect(redirectTarget()).toBe(`/onboarding?callbackUrl=${encodeURIComponent(continuation)}`);
  });

  it("keeps a staged error recoverable with sealed hints and untouched operation", async () => {
    const operation: AuthOperation = {
      ref: "staged-link",
      intent: "link_provider",
      reauthProvider: "google",
      reauthChallengeId: "target-challenge",
      clientLabel: "talent-signal-web",
      targetProvider: "google",
      accountId: "10000000-0000-4000-8000-000000000001",
      userId: "20000000-0000-4000-8000-000000000002",
      sessionFingerprint: sessionFingerprint("bearer-original"),
      accountRevision: 2,
      userRevision: 1,
      step: "awaiting-target",
      returnTo: macCallback,
      createdAt: new Date().toISOString(),
    };
    await sealAuthOperation(operation, false);
    // A delayed error from an unknown round: no valid staged proof.
    await expect(renderPage({ error: "AccessDenied" })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget()).toBe(
      `/workspace/settings?link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    // The current operation is left untouched for its own pages to resolve.
    expect(jar.entries.has(AUTH_OPERATION_COOKIE)).toBe(true);
  });

  it("keeps cancellation and session expiry ordinary and recoverable", async () => {
    // A cancelled provider round without staged state is a plain cancellation;
    // it never borrows collision messaging.
    let html = await renderPage({ error: "AccessDenied", callbackUrl: "/workspace" });
    expect(html).not.toContain("data-login-connect-continuity");
    expect(html).toContain("登录已取消。准备好后，可以再试一次。");

    html = await renderPage({ reason: "backend_session_expired", callbackUrl: "/workspace" });
    expect(html).toContain("登录已过期。重新登录后，可以继续刚才的工作。");
  });
});
