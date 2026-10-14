import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { locale } = vi.hoisted(() => ({ locale: { current: "zh-CN" as "zh-CN" | "en" } }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => locale.current }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

// Public metadata only. HTTP is the external seam; the Page and resolver remain real.
function published(version: string, build: number) {
  const base = `Talent-Signal-${version}-${build}-macOS-universal-signed`;
  return {
    tag_name: `v${version}`, draft: false, prerelease: true,
    published_at: "2026-10-15T00:00:00Z", author: { login: "github-actions[bot]" },
    assets: [".dmg", "-SHA256SUMS.txt"].map(suffix => ({
      name: base + suffix, size: 12345, state: "uploaded",
      browser_download_url: `https://github.com/getyak/capir/releases/download/v${version}/${base}${suffix}`,
    })),
  };
}
async function renderPage() {
  const { default: DownloadPage } = await import("./page");
  return renderToStaticMarkup(await DownloadPage());
}

beforeEach(() => { vi.resetModules(); locale.current = "zh-CN"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("published Mac download entry", () => {
  it.each(["zh-CN", "en"] as const)("keeps the actual iPhone entry invitation-only in %s", async language => {
    locale.current = language;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([published("0.2.8", 999)])));
    const html = await renderPage();
    const iphone = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g)?.find(article => article.includes("<h2>iPhone</h2>"));
    expect(iphone).toContain('href="mailto:hello@talentsignal.ai?subject=');
    expect(iphone).not.toMatch(/testflight\.apple\.com|apps\.apple\.com/);
  });

  it("follows a complete published preview cohort instead of a hard-coded installer", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([published("0.2.8", 999)])));
    const html = await renderPage();
    expect(html).toContain('href="https://github.com/getyak/capir/releases/download/v0.2.8/Talent-Signal-0.2.8-999-macOS-universal-signed.dmg"');
    expect(html).toContain('href="https://github.com/getyak/capir/releases/download/v0.2.8/Talent-Signal-0.2.8-999-macOS-universal-signed-SHA256SUMS.txt"');
    expect(html).toContain("0.2.8");
    expect(html).toContain("999");
    expect(html).not.toContain("0.1.101");
  });

  it("offers the public release list when lookup fails, without inventing a version or direct installer", async () => {
    vi.stubGlobal("fetch", async () => new Response("rate limited", { status: 429 }));
    const html = await renderPage();
    expect(html).toContain("版本暂时不可读");
    expect(html).toContain('href="https://github.com/getyak/capir/releases"');
    expect(html).not.toMatch(/href="[^"]+macOS-universal-signed\.dmg"/);
    expect(html).not.toContain("0.1.101");
    expect(html).not.toContain("Developer ID");
  });

  it("keeps an incomplete higher build from mixing its installer with another cohort checksum", async () => {
    const incomplete = published("0.3.0", 1001);
    incomplete.assets = incomplete.assets.slice(0, 1);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([incomplete, published("0.2.8", 999)])));
    const html = await renderPage();
    expect(html).toContain("Talent-Signal-0.2.8-999-macOS-universal-signed.dmg");
    expect(html).not.toContain("Talent-Signal-0.3.0-1001");
  });
});
