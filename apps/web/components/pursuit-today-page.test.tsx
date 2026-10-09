import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import type {
  PursuitTodayItem,
  PursuitTodayProjection,
} from "@/lib/pursuitToday";
import { PursuitTodayPage } from "./pursuit-today-page";

function item(overrides: Partial<PursuitTodayItem> = {}): PursuitTodayItem {
  return {
    pursuitId: "pursuit-a",
    title: "秋季合作推进",
    targetOutcome: "accepted_offer",
    targetDate: "2026-10-05",
    milestone: "final_conversation",
    revision: 7,
    personLabel: "陈曦",
    attentionKind: "action",
    attentionTitle: "整理下一次沟通提纲",
    attentionDetail: "负责人：陈工 · 截止 2026-09-30。",
    proposalId: null,
    proposalStatus: null,
    proposalItemCount: 0,
    action: {
      id: "action-a",
      title: "整理下一次沟通提纲",
      owner: "陈工",
      dueAt: "2026-09-30T09:00:00Z",
      status: "in_progress",
    },
    gap: null,
    evidenceState: "available",
    agentContext: null,
    ...overrides,
  };
}

function renderPage(
  items: PursuitTodayItem[],
  overrides: Partial<ComponentProps<typeof PursuitTodayPage>> = {},
): string {
  const projection: PursuitTodayProjection = {
    workspaceId: "workspace-a",
    items,
    attentionCount: items.length,
    noActionCount: 0,
    totalPursuits: items.length,
  };
  return renderToStaticMarkup(
    createElement(PursuitTodayPage, {
      error: null,
      expanded: false,
      projection,
      providerMode: "safe_deterministic",
      sessionRecoveryHref: null,
      ...overrides,
    }),
  );
}

describe("today focus authority and details", () => {
  it("keeps owner and target date readable and folds revision and no-write copy into named details", () => {
    const html = renderPage([
      item({
        agentContext: { captureId: "capture-a", evidenceRefs: ["ev-1", "ev-2"] },
      }),
    ]);
    expect(html).toContain("负责人：陈工");
    expect(html).toMatch(/目标 2026 年 \d+ 月 \d+ 日/);
    const detailsAt = html.indexOf("<details");
    expect(detailsAt).toBeGreaterThan(-1);
    const before = html.slice(0, detailsAt);
    const details = html.slice(detailsAt, html.indexOf("</details>"));
    // The routine no-write reassurance and revision number are inspectable
    // behind one named native disclosure, not ordinary card copy.
    expect(before).not.toContain("修订版本");
    expect(before).not.toContain("打开此视图不会改变任何状态。");
    expect(details).toContain("来源与记录");
    expect(details).toContain("修订版本 7");
    expect(details).toContain("打开此视图不会改变任何状态。");
    // Evidence origin stays inspectable inside the same disclosure.
    expect(details).toContain("已审阅且获授权的采集内容 · 2 条准确证据片段。");
  });

  it("replaces the disabled Ask section with one concise no-evidence explanation", () => {
    const html = renderPage([item()]);
    expect(html).not.toContain("在本次目标范围内询问");
    expect(html).not.toContain("运行有边界的智能助理");
    expect(html).toContain("该目标尚未关联经过审阅且获得授权的采集内容。");
    // The existing meaningful link to the Pursuit remains the one next step.
    expect(html).toContain("打开目标工作区");
    expect(html).toContain('href="/workspace/pursuits/pursuit-a"');
  });

  it("preserves the explicit evidence warning and the exact authority distinction", () => {
    const unavailable = renderPage([item({ evidenceState: "unavailable" })]);
    expect(unavailable).toContain("证据不可用");
    expect(unavailable).toContain("来源权限不可用，因此新的运行无法引用它。");
    const partial = renderPage([item({ evidenceState: "partial" })]);
    expect(partial).toContain("部分证据可用");
    expect(partial).toContain("该目标尚未关联经过审阅且获得授权的采集内容。");
    const notRequired = renderPage([item({ evidenceState: "not_required" })]);
    expect(notRequired).toContain("由你记录");
    // The warning sits on the visible canvas, never only inside the details.
    expect(unavailable.slice(0, unavailable.indexOf("<details"))).toContain(
      "证据不可用",
    );
    expect(partial.slice(0, partial.indexOf("<details"))).toContain(
      "部分证据可用",
    );
  });

  it("never offers a composer behind a review-ready proposal", () => {
    const html = renderPage([
      item({
        attentionKind: "review",
        proposalId: "proposal-a",
        proposalStatus: "needs_review",
        agentContext: { captureId: "capture-a", evidenceRefs: ["ev-1"] },
      }),
    ]);
    expect(html).not.toContain("在本次目标范围内询问");
    expect(html).not.toContain("运行有边界的智能助理");
    expect(html).toContain("审阅提案");
  });

  it("keeps the provider and data-processing disclosure before Send on an eligible run", () => {
    const html = renderPage(
      [
        item({
          agentContext: {
            captureId: "capture-a",
            evidenceRefs: ["ev-1", "ev-2"],
          },
        }),
      ],
      { providerMode: "live_remote" },
    );
    expect(html).toContain("固定远程模型 · 仅处理合成内容 · 四项受治理工具");
    expect(html).toContain("仅供审阅；无外部效果");
    expect(html).toContain("读取 2 条准确证据片段。输出只会是提案或无需行动。");
    const disclosureAt = html.indexOf("固定远程模型");
    const sendAt = html.indexOf("运行有边界的智能助理");
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(disclosureAt);
  });
});
