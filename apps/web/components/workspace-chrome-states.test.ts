// @vitest-environment happy-dom
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const directory = vi.hoisted(() => ({ data: null as unknown, loading: false, failed: false, retry: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => directory }));
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { SessionDirectory } from "./session-workbench/session-directory";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function openAccount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const loading = { status: "loading" } as const;
  await act(async () => root!.render(createElement(WorkspaceAccountMenu, { usage: { subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} }, accountName: "Synthetic User", workspaceName: "Test", signOutAction: () => {} })));
  await act(async () => host.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
  return document.querySelector<HTMLElement>("[aria-label='账号与空间操作']")!.outerHTML;
}
beforeEach(() => { directory.data = { sessions: { session_version: "a", sessions: [] } }; directory.loading = false; directory.failed = false; });
describe("quiet workspace chrome states", () => {
  it("keeps directory access beneath an icon-only header when history is empty", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceRecentSessions, { binding: "a" }));
    expect(html).toContain('href="/workspace/sessions"');
    expect(html).toContain("对话记录");
    expect(html).not.toContain("还没有对话");
    expect(html).not.toContain(">全部<");
    expect(html).not.toContain(">新对话<");
    expect(html).not.toContain("aria-expanded");
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
  it("renders language with an icon and preserves a truthful fixed-language value", async () => {
    const html = await openAccount();
    expect(html).toMatch(/<svg[^>]*>[\s\S]*?<\/svg><span>语言<\/span><strong>简体中文<\/strong>/);
    expect(html).not.toContain('href="/workspace/plugs"');
  });
});

describe("account menu utilities and footer geometry", () => {
  it("renders weekly usage, mobile access and support without inventing a count", async () => {
    const html = await openAccount();
    expect(html).toContain("本周已记录运行");
    expect(html).toContain("读取中");
    expect(html).toContain("移动端 capri");
    expect(html).toContain("帮助与支持");
    expect(html).toContain("/workspace/settings/diagnostics");
    expect(html).toContain("mailto:hello@talentsignal.ai");
    // No result, no fabricated number; and no fake multi-account capability.
    expect(html).not.toMatch(/本周已记录运行[^<]*[0-9]/);
    expect(html).not.toContain("添加账号");
    expect(html).not.toContain("添加账户");
  });

  it("keeps reduced motion and bounded account popovers in the stylesheet", () => {
    const css = readFileSync(resolve(import.meta.dirname, "workspace-shell.module.css"), "utf8");
    // Geometry requires rendered acceptance; source strings cannot prove it.
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]{0,220}\.footerEntry[\s\S]{0,120}transition: none/,
    );
    // The popover scrolls within the viewport instead of escaping it.
    expect(css).toContain("var(--radix-popover-content-available-height)");
    expect(css).toMatch(/\.accountPopover[\s\S]{0,900}overflow-y: auto/);
  });
});
