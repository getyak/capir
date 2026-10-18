import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { MarketingHome } from "./marketing-home";

function render(locale: MarketingLocale = "zh-CN") {
  return renderToStaticMarkup(<MarketingHome locale={locale} />);
}

describe("marketing home relationship-dossier composition", () => {
  it("presents one promise, one primary demo action, and exactly one interactive demo", () => {
    const html = render();
    expect(html).toContain("不用从头聊起。");
    expect(html).toContain("体验这段对话");
    expect(html).toContain("macOS 公开下载 · iOS 受邀预览");
    expect(html.match(/id="personal-agent-demo"/g)).toHaveLength(1);
    expect(html.match(/记下这件事 · 仅演示/g)).toHaveLength(1);
    expect(html).toContain("待你确认");
  });

  it("keeps availability and the synthetic disclosure beside the visible proof", () => {
    const html = render();
    expect(html).toContain("不连接微信，不保存真实资料，不发送外部消息");
    expect(html).toContain("微信直接连接尚未开放");
    expect(html).toContain("合成对话");
    expect(html).not.toContain("已发送消息");
  });

  it("shows continuity as a temporal update tied to the demo vocabulary", () => {
    const html = render();
    expect(html).toContain("跟着来往一起更新。");
    expect(html).toContain("等你整理");
    expect(html).toContain("等对方");
  });

  it("renders the English promise on the same composition", () => {
    const html = render("en");
    expect(html).toContain("Pick up where you left off.");
    expect(html).toContain("Try this conversation");
    expect(html).toContain("For your review");
  });
});
