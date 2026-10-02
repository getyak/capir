import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const pathname = vi.hoisted(() => ({ current: "/workspace" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import * as shellNav from "@/components/workspace-shell-nav";

/**
 * The generic "More" disclosure was removed. These regression checks keep the
 * approved direct primary order and prove the removed export did not return.
 */
describe("workspace navigation without a generic More disclosure", () => {
  it("no longer exports the removed More destinations surface", () => {
    expect("WorkspaceMoreDestinations" in shellNav).toBe(false);
  });

  it("renders the direct primary order with no 更多 row", () => {
    pathname.current = "/workspace";
    const html = renderToStaticMarkup(
      createElement(shellNav.WorkspaceShellNav, { binding: null }),
    );

    expect(html).not.toContain("更多");
    expect(html).not.toContain("更多目的地");
    const primary = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
    const order = [
      "/workspace/today",
      "/workspace",
      "/workspace/people",
      "/workspace/meetings",
    ];
    const indices = order.map((href) => primary.indexOf(`href="${href}"`));
    expect(primary).toContain('aria-label="搜索人物或对话"');
    for (const index of indices) expect(index).toBeGreaterThan(-1);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("keeps Sources and duplicate Sessions out of the primary rail", () => {
    pathname.current = "/workspace";
    const html = renderToStaticMarkup(
      createElement(shellNav.WorkspaceShellNav, { binding: null }),
    );

    const primary = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(primary).toBeDefined();
    expect(primary).not.toContain('href="/workspace/captures"');
    expect(primary).not.toContain('href="/workspace/sessions"');
    // The collapsed utility retains the full directory, including empty state.
    expect(html).toContain('href="/workspace/sessions"');
  });
});
