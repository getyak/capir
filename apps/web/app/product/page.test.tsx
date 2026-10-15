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

describe("product relationship story", () => {
  it.each(["zh-CN", "en"] as const)("keeps the reviewed synthetic relationship separate from actual account state in %s", async language => {
    const document = await rendered(language);
    const caseStudy = document.querySelector("aside");
    expect(caseStudy?.textContent).toContain(language === "en" ? "Synthetic case" : "合成案例");
    expect(caseStudy?.textContent).toContain(language === "en" ? "after review" : "审阅后的示例");
    expect(caseStudy?.querySelectorAll("dl > div").length).toBe(2);
    expect(caseStudy?.textContent).toContain(language === "en" ? "How you met is not in this source" : "认识的经过，这份来源没有提到");
  });

  it.each(["zh-CN", "en"] as const)("keeps the readable heading consistent with its metadata in %s", async language => {
    const document = await rendered(language);
    const { generateMetadata } = await import("./page");
    const metadata = await generateMetadata();
    expect(document.querySelector("h1")?.textContent).toBe(metadata.title);
  });

  it.each(["zh-CN", "en"] as const)("retains speakers and uncertainty at the actual source disclosure in %s", async language => {
    const document = await rendered(language);
    const source = document.querySelector("aside details");
    expect(source?.querySelector("summary")?.textContent).toBeTruthy();
    expect(source?.textContent).toContain(language === "en" ? "You" : "你");
    expect(source?.textContent).toContain(language === "en" ? "Chen Xia" : "陈夏");
    expect(source?.textContent).toContain(language === "en" ? "not a meeting time" : "不是见面时间");
    expect(document.body.textContent).toContain(language === "en" ? "does not save records or send messages" : "不保存记录、不发送消息");
  });

  it.each(["zh-CN", "en"] as const)("offers the real demo and availability without a simulated save or send in %s", async language => {
    const document = await rendered(language);
    const hrefs = [...document.querySelectorAll("main a")].map(link => link.getAttribute("href"));
    expect(hrefs).toContain("/#personal-agent-demo");
    expect(hrefs).toContain("/download");
    expect(document.querySelectorAll("form, input, button").length).toBe(0);
    expect(document.querySelectorAll('main[id="main-content"]').length).toBe(1);
  });
});
