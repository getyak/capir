import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationProvenance, ConversationResponse } from "./conversation-response";

describe("conversation reading boundary", () => {
  it("renders paragraphs, emphasis, lists and bounded tables semantically", () => {
    const html = renderToStaticMarkup(createElement(ConversationResponse, null, "## 沟通提纲\n\n先确认 **时间**。\n\n1. 明确目标\n2. 约定回复\n\n| 项目 | 状态 |\n| --- | --- |\n| 时间 | 待确认 |"));
    expect(html).toContain("<h3>沟通提纲</h3>");
    expect(html).toContain("<strong>时间</strong>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<table>");
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("<h1>");
  });

  it("never executes HTML, loads remote images, or promotes model links to citations", () => {
    const html = renderToStaticMarkup(createElement(ConversationResponse, null, '<script>alert(1)</script>\n\n![追踪](https://example.com/pixel)\n\n[来源](https://example.com/report)\n\n[运行](javascript:alert%281%29)'));
    expect(html).not.toMatch(/<(script|img|a)\b/);
    expect(html).not.toContain('src="');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("追踪");
    expect(html).toContain("https://example.com/report");
  });

  it("marks the response lead only when asked and shows real provenance honestly", () => {
    const lead = renderToStaticMarkup(createElement(ConversationResponse, { lead: true }, "先把一页方案整理清楚。"));
    const plain = renderToStaticMarkup(createElement(ConversationResponse, null, "先把一页方案整理清楚。"));
    expect(lead).toContain('data-lead="true"');
    expect(plain).toContain('data-lead="false"');
    const withSources = renderToStaticMarkup(createElement(ConversationProvenance, { sources: [{ display_name: "试点合作讨论" }, { display_name: "陈夏主页" }] }));
    expect(withSources).toContain("依据 · 试点合作讨论 · 陈夏主页");
    const withoutSources = renderToStaticMarkup(createElement(ConversationProvenance, null));
    expect(withoutSources).toContain("依据 · 未附引用来源");
  });

  it("preserves literal user-visible code instead of interpreting it as markup", () => {
    const html = renderToStaticMarkup(createElement(ConversationResponse, null, "```html\n<button>确认</button>\n```"));
    expect(html).toContain("&lt;button&gt;确认&lt;/button&gt;");
    expect(html).toContain("<pre");
    expect(html).not.toContain("<button>");
  });
});
