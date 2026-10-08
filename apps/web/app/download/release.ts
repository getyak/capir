import type { MarketingLocale } from "@/lib/marketing-locale";
import { marketingAccessHref } from "@/lib/marketing-copy";

export const MACOS_RELEASES_HREF = "https://github.com/getyak/capir/releases";
export const MACOS_DISTRIBUTION_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/macos-distribution.md";
// This is a specific published cohort, not an inferred latest/stable release.
export const MACOS_VERSION = "0.1.101";
export const MACOS_DOWNLOAD_HREF = "https://github.com/getyak/capir/releases/download/v0.1.101/Talent-Signal-0.1.101-77-macOS-universal-signed.dmg";
export const MACOS_CHECKSUM_HREF = "https://github.com/getyak/capir/releases/download/v0.1.101/Talent-Signal-0.1.101-77-macOS-universal-signed-SHA256SUMS.txt";
export const CLI_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/capir-cli.md";
export const MCP_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/mcp-extensions.md";
export const CLI_SOURCE_INSTALL = [
  "git clone https://github.com/getyak/capir.git",
  "cd capir",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @talent-signal/cli build",
  "pnpm --filter @talent-signal/cli exec node dist/cli.js --help",
].join("\n");

export type DownloadSurface = {
  platform: "macos" | "ios";
  title: string;
  publicInstall: boolean;
  installHref: string | null;
  status: string;
  detail: string;
};
export function downloadSurfaces(locale: MarketingLocale): DownloadSurface[] {
  const en = locale === "en";
  return [
    { platform: "macos", title: "macOS", publicInstall: true,
      installHref: MACOS_DOWNLOAD_HREF,
      status: en ? `Preview ${MACOS_VERSION}` : `预览版 ${MACOS_VERSION}`,
      detail: en ? "Apple silicon + Intel · macOS 14+" : "Apple 芯片与 Intel · macOS 14+" },
    { platform: "ios", title: "iPhone", publicInstall: false, installHref: null,
      status: en ? "Invited TestFlight preview" : "TestFlight 受邀预览",
      detail: en ? "Request an invitation; there is no public install link yet." : "先申请邀请 · 尚无公开安装入口" },
  ];
}
export function requestAccessHref(locale: MarketingLocale): string {
  return marketingAccessHref(locale);
}

export type McpClient = "cursor" | "claude" | "other";
export function mcpConfiguration(client: McpClient): string {
  if (client === "other") return "Transport: Streamable HTTP\nURL: https://YOUR_WORKSPACE/api/mcp\nAuthorization: Bearer YOUR_MCP_TOKEN";
  return JSON.stringify({ mcpServers: { capri: {
    ...(client === "claude" ? { type: "http" } : {}),
    url: "https://YOUR_WORKSPACE/api/mcp",
    headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
  } } }, null, 2);
}
