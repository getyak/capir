import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";

const directory = vi.hoisted(() => ({ data: null as unknown, loading: true, failed: false, retry: vi.fn() }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => directory }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn() }),
}));

import { WorkspaceRecentSessions } from "./workspace-recent-sessions";

function render(locale: "en" | "zh-CN") {
  return renderToStaticMarkup(<LocaleProvider locale={locale}>
    <WorkspaceRecentSessions binding="current" />
  </LocaleProvider>);
}

beforeEach(() => {
  directory.data = null;
  directory.loading = true;
  directory.failed = false;
});

it("localizes recent-conversation loading and recovery controls in the selected display language", () => {
  expect(render("en")).toContain('aria-label="Reading conversations"');
  expect(render("zh-CN")).toContain('aria-label="正在读取对话"');
  directory.loading = false;
  directory.failed = true;
  const html = render("en");
  expect(html).toContain("Cannot read right now");
  expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  expect(html).toContain('href="/workspace/sessions"');
  expect(html).not.toContain("暂时读不到");
});

it("preserves stored titles and person initials while localizing row and surrounding controls", () => {
  directory.loading = false;
  directory.data = { sessions: { session_version: "current", sessions: [{
    session_id: "00000000-0000-4000-8000-000000000001",
    state: "active", expires_at: "2030-01-01T00:00:00Z",
    title: "客户原话：下周再联系", person_label: "林晓", person_id: "person-1", is_unread: true,
  }] } };
  const html = render("en");
  expect(html).toContain("客户原话：下周再联系");
  expect(html).toContain("Unread");
  expect(html).toContain('aria-label="Recent conversations"');
  expect(html).toContain("View all conversations");
  expect(html).toContain('aria-label="Start a new conversation"');
  expect(html).toContain('aria-label="More actions: 客户原话：下周再联系"');
  expect(html).toContain('aria-label="Pin: 客户原话：下周再联系"');
  // Portalled menu content renders only after opening; its locale is covered
  // by the interaction test in workspace-session-row.test.tsx.
  expect(html).not.toContain("Organized on this device");
  expect(html).toContain(">晓</span>");
  expect(html).not.toContain("更多操作");
  expect(html).not.toContain("新建对话");
});

it("keeps the authorized history visible alongside a failed refresh and discards it when the directory clears", () => {
  directory.loading = false;
  directory.data = { sessions: { session_version: "current", sessions: [{
    session_id: "00000000-0000-4000-8000-000000000002",
    state: "active", expires_at: "2030-01-01T00:00:00Z",
    title: "Synthetic cached conversation", person_label: "", person_id: null, is_unread: false,
  }] } };
  expect(render("zh-CN")).toContain("Synthetic cached conversation");

  directory.failed = true;
  const failed = render("zh-CN");
  expect(failed).toContain("Synthetic cached conversation");
  expect(failed).toContain("暂时无法读取");
  expect(failed).toMatch(/<button[^>]*>重试<\/button>/);

  // The directory owner clears its data on expiry, 401 or a changed binding.
  // Rendering a refresh failure must never resurrect that cleared projection.
  directory.data = null;
  expect(render("zh-CN")).not.toContain("Synthetic cached conversation");
});
