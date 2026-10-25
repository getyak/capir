import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import type { LocaleTag } from "@talent-signal/contracts";

const directory = vi.hoisted(() => ({ data: null as unknown, loading: false, failed: false, retry: vi.fn() }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => directory }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useSearchParams: () => new URLSearchParams() }));
vi.mock("./workspace-navigation-continuity", () => ({ useRememberWorkspaceNavigationHref: () => vi.fn() }));
vi.mock("./workspace-browse", () => ({ useWorkspaceBrowse: () => null }));
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";

function render(locale: LocaleTag, binding: string | null = "current") {
  return renderToStaticMarkup(<LocaleProvider locale={locale}><WorkspaceSidebarPeople binding={binding} /></LocaleProvider>);
}
beforeEach(() => { directory.data = null; directory.loading = false; directory.failed = false; });

it.each([
  ["en", "People directory", "View all people", "Search people…"],
  ["zh-CN", "人物目录", "查看全部人物", "搜索人物…"],
  ["zh-TW", "人物目錄", "查看所有人物", "搜尋人物…"],
  ["ja", "人物一覧", "すべての人物を表示", "人物を検索…"],
  ["ko", "인물 목록", "모든 인물 보기", "인물 검색…"],
] as const)("localizes People sidebar chrome in %s and preserves authored labels", (locale, title, all, search) => {
  directory.data = { people: { people: [{ id: "person-one", display_label: "陈知远", contexts: [{ id: "context-one", display_label: "读书会认识" }] }] } };
  const html = render(locale);
  expect(html).toContain(`aria-label="${title}"`);
  expect(html).toContain(all); expect(html).toContain(`placeholder="${search}"`);
  expect(html).toContain("陈知远"); expect(html).toContain("读书会认识");
  expect(html).toContain('href="/workspace/people/person-one"');
  if (locale === "en") { expect(html).toContain('aria-label="Search the People directory"'); expect(html).not.toContain("查看全部人物"); }
});

it("keeps loading, failure, empty and signed-out states distinct in English", () => {
  directory.loading = true;
  expect(render("en")).toContain("Reading people directory…");
  directory.loading = false; directory.failed = true;
  expect(render("en")).toContain("The people directory is unavailable right now.");
  expect(render("en")).toMatch(/<button[^>]*>Reload<\/button>/);
  expect(render("en")).not.toContain("No people yet.");
  directory.failed = false;
  expect(render("en")).toContain("No people yet.");
  expect(render("en", null)).toContain("Sign in again to read the people directory.");
});

it("localizes only the code-owned contextless-person fallback", () => {
  directory.data = { people: { people: [{ id: "no-context", display_label: "没有情境的人名原文", contexts: [] }] } };
  const html = render("en");
  expect(html).toContain("没有情境的人名原文");
  expect(html).toContain(">Contact</small>");
  expect(html).not.toContain(">联系人</small>");
  // Authored text matching a catalog key is still original content.
  directory.data = { people: { people: [{ id: "authored-context", display_label: "保留原文", contexts: [{ id: "context", display_label: "联系人" }] }] } };
  expect(render("en")).toContain(">联系人</small>");
});
