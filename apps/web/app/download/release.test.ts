import { describe, expect, it } from "vitest";
import { CLI_SOURCE_INSTALL, MACOS_DOWNLOAD_HREF, MACOS_CHECKSUM_HREF, MACOS_VERSION, downloadSurfaces, mcpConfiguration, requestAccessHref } from "./release";

describe("public download and configuration boundaries", () => {
  it("binds the Mac download and checksum to the same published Universal cohort", () => {
    expect(downloadSurfaces("zh-CN")[0].installHref).toBe(MACOS_DOWNLOAD_HREF);
    for (const url of [MACOS_DOWNLOAD_HREF, MACOS_CHECKSUM_HREF]) {
      expect(url).toContain(`/v${MACOS_VERSION}/`);
      expect(new URL(url).hostname).toBe("github.com");
      expect(url).toContain("macOS-universal-signed");
    }
  });
  it("keeps iPhone invitation-only in both languages", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const ios = downloadSurfaces(locale)[1];
      expect(ios.publicInstall).toBe(false);
      expect(ios.installHref).toBeNull();
      expect(requestAccessHref(locale)).toMatch(/^mailto:hello@talentsignal\.ai/);
    }
  });
  it("does not offer an unpublished installer or npm package", () => {
    expect(CLI_SOURCE_INSTALL).toContain("pnpm --filter @talent-signal/cli build");
    expect(CLI_SOURCE_INSTALL).not.toMatch(/curl|^npm install|capir-stable/m);
  });
  it("keeps credentials and endpoint as explicit placeholders for each client", () => {
    for (const client of ["cursor", "claude", "other"] as const) {
      const config = mcpConfiguration(client);
      expect(config).toContain("https://YOUR_WORKSPACE/api/mcp");
      expect(config).toContain("Bearer YOUR_MCP_TOKEN");
      expect(config).not.toContain("tsmcp_");
      if (client !== "other") {
        const server = JSON.parse(config).mcpServers.capri;
        expect(server.headers.Authorization).toBe("Bearer YOUR_MCP_TOKEN");
        if (client === "claude") expect(server.type).toBe("http");
      }
    }
  });
});
