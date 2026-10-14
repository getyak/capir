export const MACOS_RELEASES_HREF = "https://github.com/getyak/capir/releases";
export const MACOS_DISTRIBUTION_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/macos-distribution.md";
export const CLI_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/capir-cli.md";
export const MCP_DOC_HREF = "https://github.com/getyak/capir/blob/main/docs/operations/mcp-extensions.md";
export const CLI_SOURCE_INSTALL = [
  "git clone https://github.com/getyak/capir.git",
  "cd capir",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @talent-signal/cli build",
  "pnpm --filter @talent-signal/cli exec node dist/cli.js --help",
].join("\n");

export type McpClient = "cursor" | "claude" | "other";
export function mcpConfiguration(client: McpClient): string {
  if (client === "other") return "Transport: Streamable HTTP\nURL: https://YOUR_WORKSPACE/api/mcp\nAuthorization: Bearer YOUR_MCP_TOKEN";
  return JSON.stringify({ mcpServers: { capri: {
    ...(client === "claude" ? { type: "http" } : {}),
    url: "https://YOUR_WORKSPACE/api/mcp",
    headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
  } } }, null, 2);
}
