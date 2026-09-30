import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const directory = vi.hoisted(() => ({ data: null as unknown, loading: false, failed: false, retry: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => directory }));
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { SessionDirectory } from "./session-workbench/session-directory";
beforeEach(() => { directory.data = { sessions: { session_version: "a", sessions: [] } }; directory.loading = false; directory.failed = false; });
describe("quiet workspace chrome states", () => {
  it("keeps a named history entry without an empty placeholder or all link", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceRecentSessions, { binding: "a" }));
    expect(html).toContain('href="/workspace/sessions"');
    expect(html).toContain("对话记录");
    expect(html).not.toContain("还没有对话");
    expect(html).not.toContain(">全部<");
  });
  it("keeps read failure distinct from empty with a real retry", () => {
    directory.failed = true;
    const html = renderToStaticMarkup(createElement(WorkspaceRecentSessions, { binding: "a" }));
    expect(html).toContain("暂时无法读取");
    expect(html).toContain(">重试</button>");
    expect(html).not.toContain("还没有对话");
  });
  it("does not label a failed directory as an invitation to start empty", () => {
    const html = renderToStaticMarkup(createElement(SessionDirectory, { renderedAt: "2026-09-24T10:00:00Z", initialSessions: [], initialComplete: false, initialNextCursor: null, sessionVersion: "a", initialError: "无法读取", sessionRecoveryHref: null }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("每段思路");
    expect(html).not.toContain("开始一段新对话，它会留在这里");
  });
  it("renders language with an icon and preserves a truthful fixed-language value", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceAccountMenu, { accountName: "Synthetic User", workspaceName: "Test", signOutAction: () => {} }));
    expect(html).toMatch(/<svg[^>]*>[\s\S]*?<\/svg><span>语言<\/span><strong>简体中文<\/strong>/);
    expect(html).not.toContain('href="/workspace/plugs"');
  });
});

describe("account menu utilities and footer geometry", () => {
  it("renders weekly usage, mobile access and support without inventing a count", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceAccountMenu, { accountName: "Synthetic User", workspaceName: "Test", signOutAction: () => {} }));
    expect(html).toContain("本周已记录运行");
    expect(html).toContain("读取中");
    expect(html).toContain("移动端 Talent Signal");
    expect(html).toContain("帮助与支持");
    expect(html).toContain("/workspace/settings/diagnostics");
    expect(html).toContain("mailto:hello@talentsignal.ai");
    // No result, no fabricated number; and no fake multi-account capability.
    expect(html).not.toMatch(/本周已记录运行[^<]*[0-9]/);
    expect(html).not.toContain("添加账号");
    expect(html).not.toContain("添加账户");
  });

  it("keeps footer geometry, custom tooltips and reduced motion in the stylesheet", () => {
    const css = readFileSync(new URL("./workspace-shell.module.css", import.meta.url), "utf8");
    // Constant 216px strip: 40 avatar + 120 pill + 40 entry + two 8px gaps.
    expect(css).toContain("width: 216px");
    expect(css).toContain("width: 120px");
    // Hover OR keyboard focus contracts the pill and widens the entry in place.
    expect(css).toContain(":has(.footerEntryWrap:hover) .connectPill");
    expect(css).toContain(":has(.footerEntryWrap:focus-visible) .connectPill");
    expect(css).toContain(":has(.footerEntryWrap:hover) .footerEntry");
    expect(css).toMatch(/\.connectPill[\s\S]{0,400}transition:[\s\S]{0,120}220ms/);
    expect(css).toMatch(/\.footerEntry[\s\S]{0,600}transition:[\s\S]{0,160}220ms/);
    // Reduced motion applies the geometry immediately.
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]{0,220}\.footerEntry[\s\S]{0,120}transition: none/,
    );
    // The popover scrolls within the viewport instead of escaping it.
    expect(css).toMatch(/\.accountPopover[\s\S]{0,400}max-height: min\(70dvh/);
    expect(css).toMatch(/\.accountPopover[\s\S]{0,600}overflow-y: auto/);
    // Desktop targets stay at 40px with 44px on narrow screens.
    expect(css).toMatch(/\.footerEntry[\s\S]{0,400}height: 40px/);
    expect(css).toContain("height: 44px");
  });
});
