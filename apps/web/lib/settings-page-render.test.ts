import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { auth, loadAccountSettings, claims, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  loadAccountSettings: vi.fn(),
  claims: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect,
}));
vi.mock("@/lib/server/accountBackend", () => ({ loadAccountSettings }));
vi.mock("@/lib/server/backendAuth", () => ({
  readBackendSessionClaims: claims,
  authSecret: () => "settings-page-render-test-secret",
}));
vi.mock("@/lib/server/contact-handoff-session", () => ({
  contactHandoffSessionVersion: () => "session-version",
}));

import SettingsPage from "@/app/workspace/settings/page";

const account = {
  contract_version: "1.0.0",
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    display_name: "林顾问",
    username: null,
    kind: "human",
    revision: 1,
    login_methods: ["password"],
    email_verified_at: null,
  },
  sign_in_methods: [
    { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
    { provider: "google", state: "unconnected", hint: null, can_unlink: false },
    { provider: "password", state: "legacy_unverified", hint: null, can_unlink: false },
  ],
  email_ownership_state: "legacy_unverified",
  workspace: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Alpha 寻访测试",
    slug: "fixture-alpha",
    revision: 1,
    owner_user_id: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    is_owner: true,
    can_manage: true,
    is_test: true,
  },
  sessions: [],
  members: [],
  activity: [],
  lab_enabled: true,
};

describe("settings page server composition", () => {
  beforeEach(() => {
    // Next's redirect throws a control-flow error; mirror it so the page stops
    // and the test can assert the exact callback target.
    redirect.mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), {
        digest: `NEXT_REDIRECT;replace;${url};307;`,
      });
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("renders every section from the server without calling a client predicate", async () => {
    auth.mockResolvedValue({ user: { name: "林顾问" } });
    loadAccountSettings.mockResolvedValue(account);
    claims.mockResolvedValue({
      backendAccountId: "22222222-2222-4222-8222-222222222222",
      backendExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    for (const section of [
      "account",
      "workspace",
      "appearance",
      "connections",
      "advanced",
      "testing",
    ]) {
      const html = renderToStaticMarkup(
        await SettingsPage({ searchParams: Promise.resolve({ section }) }),
      );
      expect(html).toContain("设置");
      expect(html).toContain("账号与安全");
    }
  });

  it("falls back to the account section when the query is unknown or testing is disabled", async () => {
    auth.mockResolvedValue({ user: { name: "林顾问" } });
    loadAccountSettings.mockResolvedValue({ ...account, lab_enabled: false });
    claims.mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await SettingsPage({
        searchParams: Promise.resolve({ section: "testing" }),
      }),
    );
    expect(html).toContain("账号与安全");
    expect(html).not.toContain("测试与诊断");
  });

  it("carries a validated section into the login callback", async () => {
    auth.mockResolvedValue(null);
    await expect(
      SettingsPage({ searchParams: Promise.resolve({ section: "connections" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(
      "/login?callbackUrl=%2Fworkspace%2Fsettings%3Fsection%3Dconnections",
    );
  });

  it("preserves every schema section through login", async () => {
    auth.mockResolvedValue(null);
    for (const section of [
      "overview",
      "account",
      "workspace",
      "appearance",
      "connections",
      "advanced",
      "testing",
    ]) {
      redirect.mockClear();
      await expect(
        SettingsPage({ searchParams: Promise.resolve({ section }) }),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(redirect).toHaveBeenCalledWith(
        `/login?callbackUrl=${encodeURIComponent(`/workspace/settings?section=${section}`)}`,
      );
    }
  });

  it("drops unknown, malformed, and empty sections instead of reflecting them", async () => {
    auth.mockResolvedValue(null);
    for (const section of [
      undefined,
      "",
      "billing",
      "connections ",
      "//evil.example",
      "https://evil.example/login",
      "/login?callbackUrl=https://evil.example",
    ]) {
      redirect.mockClear();
      await expect(
        SettingsPage({
          searchParams: Promise.resolve(section === undefined ? {} : { section }),
        }),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(redirect).toHaveBeenCalledWith("/login?callbackUrl=%2Fworkspace%2Fsettings");
    }
  });

  it("renders a truthful unavailable pane when settings cannot be read", async () => {
    auth.mockResolvedValue({ user: { name: "林顾问" } });
    loadAccountSettings.mockRejectedValue(new Error("offline"));
    claims.mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await SettingsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("账号设置暂时无法连接");
  });

  it("does not show the primary account photo in an isolated test identity", async () => {
    auth.mockResolvedValue({ user: { image: "https://example.test/private-photo" } });
    loadAccountSettings.mockResolvedValue({ ...account, user: { ...account.user, kind: "lab_human" } });
    claims.mockResolvedValue(null);
    const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("https://example.test/private-photo");
  });

  it("leads with editable profile and only the supported capabilities", async () => {
    auth.mockResolvedValue({ user: { name: "林顾问" } });
    loadAccountSettings.mockResolvedValue({ ...account, lab_enabled: false });
    claims.mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await SettingsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("林顾问");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("编辑显示名称");
    expect(html).toContain("更换头像");
    expect(html).toContain("账号与安全");
    expect(html).toContain("个人资料");
    expect(html).toContain("头像保存在哪里？");
    expect(html).not.toContain("连接诊断");
    // A workspace without the Lab does not advertise its testing surface.
    expect(html).not.toContain("测试与诊断");
  });
});
