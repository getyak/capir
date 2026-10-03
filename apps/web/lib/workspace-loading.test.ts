import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { auth, loadLabManifest } = vi.hoisted(() => ({
  auth: vi.fn(),
  loadLabManifest: vi.fn(),
}));
vi.mock("next/headers", () => ({cookies:async()=>({has:()=>false})}));
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
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/app/login/actions", () => ({ signOutOfWorkspace: vi.fn() }));
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
  it("keeps the route loading boundary quiet and route-neutral", () => {
    const source = readFileSync(
      new URL("../app/workspace/loading.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("正在打开当前工作台");
    expect(source).toContain("你仍可使用侧栏切换页面");
    // The status stays in the accessibility tree; it must not be a repeat hero.
    expect(source).not.toMatch(/<h1/);
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
  });
});
