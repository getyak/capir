import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/sessions/10000000-0000-4000-8000-000000000001",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/relationship-workspace/use-workspace-chat", () => ({
  useWorkspaceChat: () => ({ ask: vi.fn() }),
}));
vi.mock("@/components/workspace-session-request", () => ({
  workspaceSessionFetch: vi.fn(),
}));

import { SessionWorkbench } from "./session-workbench";
import type { SessionDetail } from "./session-detail-state";

type SessionTurn = SessionDetail["turns"][number];

const SESSION_ID = "10000000-0000-4000-8000-000000000001";

const turn: SessionTurn = {
  createdAt: "2026-09-16T00:00:00.000Z",
  id: "20000000-0000-4000-8000-000000000001",
  objective: "帮我准备与陈曦的沟通",
  response: {
    contextManifestID: "context",
    contractVersion: "1.0.0",
    createdAt: "2026-09-16T00:00:05.000Z",
    disposition: "answer",
    knowledgeSnapshotID: "snapshot",
    savedBlocks: [
      {
        body: "这是回复正文，必须原样保留。",
        citation_dependency_ids: [],
        id: "30000000-0000-4000-8000-000000000001",
        kind: "answer",
        requires_user_decision: false,
        status: "ready",
        title: "回复",
      },
    ],
    taskID: "task-1",
  },
};

function detail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    composer_draft: null,
    composer_draft_updated_at: null,
    context_label: "产品负责人寻访",
    deleted_at: null,
    display_authority: "stale_unconfirmed",
    expires_at: "2099-01-01T00:00:00.000Z",
    is_unread: false,
    person_id: null,
    person_label: "",
    relationship_context_id: null,
    revision: 2,
    scope_kind: "relationship",
    session_id: SESSION_ID,
    state: "active",
    title: "与陈曦沟通的准备",
    turn_count: 1,
    turns: [turn],
    updated_at: "2026-09-16T00:00:05.000Z",
    ...overrides,
  };
}

function render(overrides: Partial<SessionDetail> = {}) {
  return renderToStaticMarkup(
    createElement(SessionWorkbench, {
      accountId: "account-1",
      chatSessionVersion: "chat-version",
      initialDetail: detail(overrides),
      initialError: null,
      sessionRecoveryHref: null,
      sessionVersion: "binding",
      storageScope: "a".repeat(64),
    }),
  );
}

describe("Session workbench conversation canvas", () => {
  it("places the observed send time before its user message without losing response content", () => {
    const html = render();
    expect(html).toContain(`dateTime="${turn.createdAt}"`);
    expect(html.indexOf("<time ")).toBeLessThan(html.indexOf(turn.objective));
    expect(html.match(/<time /g)).toHaveLength(1);
    expect(html).toContain("这是回复正文，必须原样保留。");
  });

  it("keeps compact header controls named and the assistant identity accessible", () => {
    const html = render({ person_id: "10000000-0000-4000-8000-000000000002", person_label: "陈曦", relationship_context_id: "10000000-0000-4000-8000-000000000003" });
    expect(html).toContain('aria-label="查看 陈曦 的人物背景"');
    expect(html).toContain('aria-label="对话详情"');
    expect(html).toContain('role="img" aria-label="capri"');
    expect(html).toContain("产品负责人寻访");
  });

  it("recomposes one canvas root with a named details disclosure and transcript", () => {
    const html = render();
    expect(html).toContain('data-conversation-canvas="session"');
    expect(html).toContain("对话详情");
    expect(html).toContain('aria-label="对话历史"');
    // The permanent draft menu and bottom scope block are gone.
    expect(html).not.toContain("草稿选项");
    expect(html).not.toContain("对话范围 ·");
  });

  it("shows the assistant identity once and hides a generic reply heading", () => {
    const html = render();
    expect(html).toContain("capri");
    expect(html).toContain("帮我准备与陈曦的沟通");
    // The generic "回复" heading is hidden; the body is not.
    expect(html).not.toContain("<h3>回复</h3>");
    expect(html).toContain("这是回复正文，必须原样保留。");
  });

  it("preserves scope controls while refusing an unsupported send", () => {
    const relationship = render({
      person_id: "40000000-0000-4000-8000-000000000001",
      person_label: "陈曦",
      relationship_context_id: "50000000-0000-4000-8000-000000000001",
      scope_kind: "relationship",
    });
    expect(relationship).toContain("回到 陈曦 的关系工作台");
    expect(relationship).toContain("session=" + SESSION_ID);
    expect(relationship).not.toContain('aria-label="发送"');
    // Save, copy and the two-step delete confirmation stay available.
    expect(relationship).toContain("立即保存");
    expect(relationship).toContain("复制草稿");
    expect(relationship).toContain("删除对话");

    const identityReview = render({ scope_kind: "identity_review" });
    expect(identityReview).toContain("继续处理身份核对");
    expect(identityReview).not.toContain('aria-label="发送"');
  });

  it("waits for client recovery selection before exposing an unbound composer", () => {
    const unbound = render({ scope_kind: "unresolved_intent" });
    expect(unbound).toContain("正在加载对话");
    expect(unbound).not.toContain("<textarea");

    const deleted = render({ state: "deleted" });
    expect(deleted).not.toContain('aria-label="发送"');
  });
});
