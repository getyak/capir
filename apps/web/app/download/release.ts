import type { MarketingLocale } from "@/lib/marketing-locale";
import { marketingAccessHref } from "@/lib/marketing-copy";

/**
 * Public download/release surface.
 *
 * macOS clients are published through the repository's public GitHub Releases
 * surface (see docs/operations/macos-distribution.md). There is no public iOS
 * install endpoint: iOS ships through an invited preview, so the page states
 * that accurately and falls back to a request-access mail instead of inventing
 * an install link.
 */

export const MACOS_RELEASES_HREF =
  "https://github.com/getyak/talent-signal/releases";
export const MACOS_DISTRIBUTION_DOC_HREF =
  "https://github.com/getyak/talent-signal/blob/main/docs/operations/macos-distribution.md";

export type DownloadSurface = {
  platform: "macos" | "ios";
  title: string;
  /** Whether a public install endpoint exists for this platform. */
  publicInstall: boolean;
  installHref: string | null;
  status: string;
  detail: string;
};

export function downloadSurfaces(locale: MarketingLocale): DownloadSurface[] {
  const en = locale === "en";
  return [
    {
      platform: "macos",
      title: "macOS",
      publicInstall: true,
      installHref: MACOS_RELEASES_HREF,
      status: en ? "Public download" : "公开下载",
      detail: en
        ? "A Universal build (Apple silicon and Intel, macOS 14 or later) published on GitHub Releases with a SHA-256 manifest."
        : "通用版本（Apple 芯片与 Intel，macOS 14 或更高），在 GitHub Releases 发布并附 SHA-256 校验清单。",
    },
    {
      platform: "ios",
      title: "iOS",
      publicInstall: false,
      installHref: null,
      status: en
        ? "Preview · no public install endpoint yet"
        : "预览中 · 尚无公开安装入口",
      detail: en
        ? "iOS ships through an invited TestFlight preview with no public install URL. Request access and we will send an invitation."
        : "当前通过受邀 TestFlight 预览提供，没有公开安装地址。需要在 iPhone 上使用时，先申请使用，我们会发送安装邀请。",
    },
  ];
}

export function requestAccessHref(locale: MarketingLocale): string {
  return marketingAccessHref(locale);
}
