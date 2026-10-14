import { describe, expect, it } from "vitest";
import { CLI_SOURCE_INSTALL, mcpConfiguration } from "./release";

describe("public download and configuration boundaries", () => {
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
