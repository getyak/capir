import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SessionDirectory, type SessionSummary } from "./session-directory";
import styles from "./session-directory.module.css";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    updated_at: "2026-09-24T10:00:00.000Z",
    expires_at: "2026-09-25T10:00:00.000Z",
    state: "active",
    title: "准备与陈曦的下一次沟通",
    turn_count: 2,
    is_unread: false,
    scope_kind: "unresolved_intent",
    person_label: "",
    context_label: "",
    scope: { kind: "unresolved_intent" },
    ...overrides,
  };
}

function renderDirectory(
  sessions: SessionSummary[],
  overrides: Partial<ComponentProps<typeof SessionDirectory>> = {},
): string {
  return renderToStaticMarkup(
    createElement(SessionDirectory, {
      renderedAt: "2026-09-24T10:30:00.000Z",
      initialSessions: sessions,
      initialComplete: true,
      initialNextCursor: null,
      sessionVersion: "synthetic",
      initialError: null,
      sessionRecoveryHref: null,
      ...overrides,
    }),
  );
}

describe("session directory rows", () => {
  it("names an unscoped session 独立对话 while keeping scope-kind semantics", () => {
    const html = renderDirectory([
      session({
        session_id: "11111111-1111-4111-8111-111111111111",
        scope_kind: "relationship",
        scope: { kind: "relationship" },
        person_label: "陈曦",
        context_label: "项目沟通",
      }),
      session({
        session_id: "22222222-2222-4222-8222-222222222222",
        scope_kind: "identity_review",
        scope: { kind: "identity_review" },
        title: "核对同名联系人的身份线索",
      }),
      session({
        session_id: "33333333-3333-4333-8333-333333333333",
        title: "整理合作提案要点",
      }),
    ]);
    expect(html).not.toContain("未绑定范围");
    expect(html).toContain("独立对话");
    // The relabel is display-only: each scope_kind keeps its own semantics.
    expect(html).toContain("陈曦 · 项目沟通");
    expect(html).toContain("身份核对");
    expect(html).toContain("2 轮");
  });

  it("keeps a long unread title inside its row", () => {
    const longTitle = "准备与陈曦关于秋季合作框架和报价条款的下一次沟通提纲";
    const html = renderDirectory([
      session({ title: longTitle, is_unread: true }),
    ]);
    expect(html).toContain(longTitle);
    expect(html).toContain("未读");
    // The title truncates in its own box; the badge sits beside it, never
    // inside, so a long title cannot be pushed past the row.
    expect(html).toContain(
      `<span class="${styles.rowTitleText}">${longTitle}</span><span class="${styles.unread}">未读</span>`,
    );
  });

  it("keeps empty, incomplete and create-failure states truthful", () => {
    const empty = renderDirectory([]);
    expect(empty).toContain("每段思路，都可以从这里继续");
    expect(empty).toContain("开始一段新对话，它会留在这里。");
    const incomplete = renderDirectory([], { initialComplete: false });
    expect(incomplete).toContain("对话还未读取完整");
    expect(incomplete).toContain("加载更多");
    expect(incomplete).not.toContain("开始一段新对话，它会留在这里。");
    const failed = renderDirectory([], {
      initialError: "无法新建对话。",
      sessionRecoveryHref: "/login",
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("无法新建对话。");
    expect(failed).toContain('href="/login"');
    expect(failed).toContain("重新登录");
    // The failed create keeps a real retry instead of an empty invitation.
    expect(failed).toContain("新建对话");
    expect(failed).not.toContain("每段思路");
  });
});
