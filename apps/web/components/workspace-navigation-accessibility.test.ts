import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const pathname = vi.hoisted(() => ({ current: "/workspace" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkspaceShellNav, WorkspaceMobileSourcesLink } from "@/components/workspace-shell-nav";
import {
  WORKSPACE_NAV_ROUTES,
  workspaceMobileNavRoutes,
} from "@/lib/workspace-navigation";

const webRoot = resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

function render() {
  pathname.current = "/workspace";
  return renderToStaticMarkup(
    createElement(WorkspaceShellNav, { binding: null }),
  );
}

describe("workspace navigation accessibility and reachability", () => {
  it("names the navigation landmark and every primary destination", () => {
    const html = render();
    expect(html).toContain('aria-label="工作台导航"');
    for (const [label, href] of [["今日","/workspace/today"],["对话","/workspace"],["人物","/workspace/people"],["时间","/workspace/meetings"]]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-label="搜索人物或对话"');
  });

  it("renders the compact desktop order and preserves the collapsed history destination", () => {
    const html = render();
    expect(html).not.toContain("更多");
    expect(html).toContain('href="/workspace/sessions"');
    expect(html).toContain('aria-label="打开对话记录"');
    expect(html).not.toContain('href="/workspace/plugs"');
    const primary = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
    const indices = [
      "/workspace/today",
      "/workspace",
      "/workspace/people",
      "/workspace/meetings",
    ].map((href) => primary.indexOf(`href="${href}"`));
    expect(primary).toContain('aria-label="搜索人物或对话"');
    expect(indices.every((index) => index > -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("keeps the compact dock to four destinations plus a named extension button", () => {
    expect(workspaceMobileNavRoutes().map((item) => item.id)).toEqual([
      "home",
      "today",
      "people",
      "meetings",
    ]);
    const html = render();
    for (const route of WORKSPACE_NAV_ROUTES.filter(item => item.mobile)) {
      expect(html).toContain(
        `data-mobile="${route.mobile ? "true" : "false"}"`,
      );
    }
    expect(read("components/workspace-shell-nav.tsx")).toContain(
      'aria-label="打开扩展"',
    );
  });

  it("keeps both conversations and extensions directly reachable on narrow screens", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceMobileSourcesLink));
    expect(html).toContain('href="/workspace/sessions"');
    expect(html).toContain('aria-label="打开对话记录"');
    expect(html).toContain('href="/workspace/extensions"');
    expect(html).toContain('aria-label="打开扩展"');
  });

  it("keeps the removed routes reachable through their owning surfaces", () => {
    const nav = read("components/workspace-shell-nav.tsx");
    const recentSessions = read("components/workspace-recent-sessions.tsx");

    // Sessions: recent-Sessions header when expanded, one named icon link when
    // the rail is collapsed.
    expect(recentSessions).toContain('href="/workspace/sessions"');
    expect(nav).toContain("RailSessionShortcuts");
    expect(nav).toContain("data-collapsed-only");
    expect(nav).not.toContain("WorkspaceMoreDestinations");
    expect(render()).toContain('href="/workspace/extensions"');
    expect(render()).not.toContain('href="/workspace/captures"');
  });
});
