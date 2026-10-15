import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

const { locale } = vi.hoisted(() => ({ locale: { current: "zh-CN" as "zh-CN" | "en" } }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => locale.current }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

async function rendered(language: "zh-CN" | "en") {
  locale.current = language;
  const { default: Page } = await import("./page");
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(await Page());
  return window.document;
}

describe("trust reading and authority", () => {
  it.each(["zh-CN", "en"] as const)("makes the synthetic source, speaker and limits inspectable in %s", async language => {
    const document = await rendered(language);
    const source = document.querySelector("aside");
    expect(source?.textContent).toContain(language === "en" ? "Synthetic reading example" : "合成阅读示例");
    expect([...source!.querySelectorAll("cite")].map(e => e.textContent)).toEqual(language === "en" ? ["Chen Xia", "You"] : ["陈夏", "你"]);
    expect(source?.textContent).toContain(language === "en" ? "September 28" : "9 月 28 日");
    expect(source?.querySelectorAll("blockquote").length).toBe(2);
    expect(source?.textContent).toContain(language === "en" ? "No agreed deadline" : "没有约定截止日期");
  });

  it.each(["zh-CN", "en"] as const)("keeps the removed-source illustration distinct from an actual deletion or recovered quote in %s", async language => {
    const document = await rendered(language);
    const removal = [...document.querySelectorAll("article")].find(e => e.textContent?.includes(language === "en" ? "Source removed" : "来源已移除"));
    expect(removal?.textContent).toContain(language === "en" ? "Original words unavailable" : "原文不可再查看");
    expect(removal?.textContent).toContain(language === "en" ? "lose their support" : "失去支持");
    expect(removal?.querySelector("blockquote")).toBeNull();
    expect(document.body.textContent).toContain(language === "en" ? "Two separate illustrations" : "两个独立示意");
  });

  it.each(["zh-CN", "en"] as const)("offers real reading destinations without simulated confirmation or external authority in %s", async language => {
    const document = await rendered(language);
    const hrefs = [...document.querySelectorAll("main a")].map(link => link.getAttribute("href"));
    expect(hrefs).toContain("/#personal-agent-demo");
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/download");
    expect(document.querySelectorAll("form, input, button").length).toBe(0);
    expect(document.body.textContent).toContain(language === "en" ? "does not save records or send messages" : "不保存记录、不发送消息");
    expect(document.body.textContent).not.toContain(language === "en" ? "demo's confirmation button" : "本页的确认按钮");
  });

  it.each(["zh-CN", "en"] as const)("keeps the readable title and privacy disclosures available without scripting in %s", async language => {
    const document = await rendered(language);
    const { generateMetadata } = await import("./page");
    expect(document.querySelector("h1")?.textContent).toBe((await generateMetadata()).title);
    expect(document.querySelectorAll("main details summary").length).toBe(2);
    expect(document.body.textContent).toContain(language === "en" ? "processing location" : "处理位置");
    expect(document.querySelector('main[id="main-content"][tabindex="-1"]')).not.toBeNull();
  });
});
