import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { auth, loadLabManifest } = vi.hoisted(() => ({
  auth: vi.fn(),
  loadLabManifest: vi.fn(),
}));
// Keep the production active-locale resolver exercised with the same request
// boundary Next supplies; no public locale cookie overrides this fixture.
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: () => false, get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "zh-CN,en;q=0.8" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/server/backendAuth",()=>({
 readPrimaryBackendSessionClaims:async()=>null,
 readBackendSessionClaims:async()=>({backendAccountId:"fixture",backendAccountName:"Fixture",backendAccountSlug:"fixture-alpha",backendExpiresAt:new Date(Date.now()+60000).toISOString()}),
 authSecret:()=>"workspace-loading-test-secret",
}));
vi.mock("@/lib/server/testWorkspaceSession",()=>({TEST_WORKSPACE_COOKIE:"test-cookie",testWorkspaceSession:async()=>null}));
vi.mock("@/app/workspace/settings/testing/actions",()=>({leaveTestWorkspace:vi.fn()}));
// Optional account settings are unavailable in this fixture, independently
// of the intentionally pending Lab request. Never call a real backend here.
vi.mock("@/lib/server/accountBackend", () => ({ loadAccountSettings: async () => { throw new Error("settings unavailable"); } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/app/login/actions", () => ({ signOutOfWorkspace: vi.fn(), signOutFromAccountMenu: vi.fn() }));
vi.mock("@/lib/server/labBackend", () => ({ loadLabManifest }));
vi.mock("@/components/workspace-shell-nav", () => ({
  WorkspaceShellNav: () => null,
  WorkspaceCaptureLink: () => null,
  WorkspaceMobileSourcesLink: () => null,
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/talent-signal-lab/lab-shell", () => ({
  TalentSignalLabShell: ({ children }: { children: React.ReactNode }) => children,
}));

import WorkspaceLayout from "@/app/workspace/layout";
import WorkspaceLoading from "@/app/workspace/loading";
import { LocaleProvider } from "@/components/locale-provider";

describe("workspace critical loading path", () => {
  afterEach(() => vi.resetAllMocks());

  it("renders the account and product when Lab never responds", async () => {
    auth.mockResolvedValue({ user: { name: "Synthetic Recruiter" }, account: { name: "Fixture", slug: "fixture-alpha" } });
    loadLabManifest.mockImplementation(() => new Promise(() => {}));
    const layout = await WorkspaceLayout({ children: createElement("main", null, "Current product state") });
    const html = renderToStaticMarkup(layout);
    expect(html).toContain("Current product state");
    expect(html).toContain("Synthetic Recruiter");
    expect(loadLabManifest).not.toHaveBeenCalled();
  });

  it("leaves unauthenticated redirects to the child without loading Lab", async () => {
    auth.mockResolvedValue(null);
    const child = createElement("main", null, "Authentication boundary");
    const html = renderToStaticMarkup(
      await WorkspaceLayout({ children: child }),
    );
    expect(html).toContain("Authentication boundary");
    expect(html).not.toContain("capri 工作台");
    expect(loadLabManifest).not.toHaveBeenCalled();
  });
});

describe("workspace loading surface", () => {
  it.each([
    ["en", "Opening this workspace", "You can still use the sidebar"],
    ["zh-CN", "正在打开当前工作台", "你仍可使用侧栏切换页面"],
    ["zh-TW", "正在開啟目前的工作區", "仍可使用側欄切換頁面"],
    ["ja", "ワークスペースを開いています", "サイドバーで別のページに移動できます"],
    ["ko", "워크스페이스를 여는 중", "사이드바에서 다른 페이지로 이동할 수 있습니다"],
  ] as const)("uses the active %s locale while a destination is loading", (locale, status, hint) => {
    const html = renderToStaticMarkup(<LocaleProvider locale={locale}><WorkspaceLoading /></LocaleProvider>);
    expect(html).toContain(status);
    expect(html).toContain(hint);
    if (locale === "en") expect(html).not.toContain("正在");
  });
  it("keeps the route loading boundary quiet and route-neutral", () => {
    const source = readFileSync(
      new URL("../app/workspace/loading.tsx", import.meta.url),
      "utf8",
    );
    // The status stays in the accessibility tree; it must not be a repeat hero.
    expect(source).not.toMatch(/<h1/);
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
  });
});
