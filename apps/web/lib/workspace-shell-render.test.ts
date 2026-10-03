import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { auth, claims, route } = vi.hoisted(() => ({
  route: { pathname: "/workspace" },
  auth: vi.fn(),
  claims: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => false }) }));
vi.mock("@/lib/server/accountBackend", () => ({ loadAccountSettings: async () => { throw new Error("offline"); } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/app/login/actions", () => ({ signOutOfWorkspace: vi.fn() }));
vi.mock("@/app/workspace/settings/testing/actions", () => ({
  leaveTestWorkspace: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  readPrimaryBackendSessionClaims: async () => null,
  readBackendSessionClaims: claims,
  authSecret: () => "workspace-shell-render-test-secret",
}));
vi.mock("@/lib/server/testWorkspaceSession", () => ({
  TEST_WORKSPACE_COOKIE: "test-cookie",
  testWorkspaceSession: async () => null,
}));
vi.mock("@/components/talent-signal-lab/lab-shell", () => ({
  TalentSignalLabShell: ({ children }: { children: React.ReactNode }) => children,
}));
// The canvas is a client surface; a bare react-dom/server render still needs
// the router context Next provides in the app.
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import WorkspaceLayout from "@/app/workspace/layout";
import { WorkspaceNewConversation } from "@/components/new-conversation";

function liveClaims() {
  return {
    backendAccountId: "account-1",
    backendAccountName: "Alpha 寻访测试",
    backendAccountSlug: "alpha",
    backendExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("quiet workspace shell render", () => {
  afterEach(() => { vi.clearAllMocks(); route.pathname = "/workspace"; });

  it("renders the reference chrome: brand, primary nav, real account footer", async () => {
    auth.mockResolvedValue({ user: { name: "Synthetic Recruiter" } });
    claims.mockResolvedValue(liveClaims());
    const html = renderToStaticMarkup(
      await WorkspaceLayout({ children: createElement("main", null, "child") }),
    );

    expect(html).toContain("capri");
    expect(html).toContain("工作台导航");
    // Direct primary desktop order: new conversation, Today, People, Meetings,
    // Extensions — with no generic "More" disclosure.
    const destinationOrder = [
      'href="/workspace"',
      'href="/workspace/today"',
      'href="/workspace/people"',
      'href="/workspace/meetings"',
      'href="/workspace/extensions"',
    ].map((href) => html.indexOf(href));
    for (const index of destinationOrder) expect(index).toBeGreaterThan(-1);
    expect(destinationOrder).toEqual([...destinationOrder].sort((a, b) => a - b));
    expect(html).not.toContain("更多目的地");
    expect(html).toContain('aria-label="打开对话记录"');
    // Extensions has one canonical primary destination.
    expect(html).not.toContain('href="/workspace/plugs"');
    // The account footer carries the real account and workspace, not just initials.
    expect(html).toContain("Synthetic Recruiter");
    expect(html).toContain("Alpha 寻访测试");
    expect(html).toContain(">SR<");
    expect(html).toContain("账号与空间操作");
    expect(html).toContain("child");
  });

  it("renders the durable queue surface as the default entry", async () => {
    auth.mockResolvedValue({ user: { name: "Synthetic Recruiter" } });
    claims.mockResolvedValue(liveClaims());
    const html = renderToStaticMarkup(
      await WorkspaceLayout({
        children: createElement(WorkspaceNewConversation, {
          accountId: "account-1",
          sessionBinding: "session-binding",
          sessionVersion: "session-version",
          storageScope: "a".repeat(64),
        }),
      }),
    );

    expect(html).toContain("今天想推进什么？");
    expect(html).toContain("有什么想一起理清的？");
    // The default composer stays a single attachment/send pair: the person and
    // capture affordances live behind one compact add control, not a strip.
    expect(html).toContain("添加截图或查找人物");
    expect(html).toContain('aria-controls="composer-add-panel"');
    expect(html).not.toContain("未关联人物");
    expect(html).not.toContain("选择人物");
    expect(html).toContain("queued-conversation-composer");
    // A local legacy draft must never swap the default entry back to the old
    // blocking canvas, including before hydration.
    expect(html).not.toContain("new-conversation-objective");
  });

  it("renders only the private surface without history, account names or Lab chrome", async () => {
    route.pathname = "/workspace/private";
    auth.mockResolvedValue({ user: { name: "Synthetic Recruiter" } });
    claims.mockResolvedValue(liveClaims());
    const html = renderToStaticMarkup(await WorkspaceLayout({ children: createElement("main", null, "private room") }));
    expect(html).toContain("private room");
    expect(html).not.toContain("工作台导航");
    expect(html).not.toContain("Synthetic Recruiter");
    expect(html).not.toContain("Alpha 寻访测试");
    expect(html).not.toContain("最近对话");
    expect(html).not.toContain("workspace-content");
  });

  it("keeps the unauthenticated boundary free of product chrome", async () => {
    auth.mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await WorkspaceLayout({ children: createElement("main", null, "boundary") }),
    );
    expect(html).toContain("boundary");
    expect(html).not.toContain("工作台导航");
  });
});
