import type { McpDirectoryEntry } from "@talent-signal/contracts";

import { loadNangoConfig } from "./nango.js";

/**
 * The curated Extensions directory: real official remote MCP endpoints with
 * their exact verified domain. Entries describe usefulness and the
 * authentication state only; staging a directory entry goes through the same
 * human approval path as any other connection. An OAuth entry shows OAuth as
 * unavailable until the deployment configures Nango; nothing is faked.
 */

export interface McpDirectoryCatalogEntry extends McpDirectoryEntry {
  /** Nango integration id when this entry is OAuth-mediated. */
  nango_provider: string | null;
}

const CATALOG: readonly Omit<McpDirectoryCatalogEntry, "oauth_available">[] =
  Object.freeze([
    {
      auth_mode: "anonymous",
      id: "context7",
      name: "Context7",
      nango_provider: null,
      server_url: "https://mcp.context7.com/mcp",
      summary:
        "Up-to-date library documentation and code examples for accurate, version-aware answers.",
      verified_domain: "mcp.context7.com",
    },
    {
      auth_mode: "anonymous",
      id: "deepwiki",
      name: "DeepWiki",
      nango_provider: null,
      server_url: "https://mcp.deepwiki.com/mcp",
      summary:
        "Searchable wiki-style documentation generated from public GitHub repositories.",
      verified_domain: "mcp.deepwiki.com",
    },
    {
      auth_mode: "oauth",
      id: "notion",
      name: "Notion",
      nango_provider: "notion-mcp",
      server_url: "https://mcp.notion.com/mcp",
      summary:
        "Search and read your Notion workspace pages through the official Notion MCP server.",
      verified_domain: "mcp.notion.com",
    },
    {
      auth_mode: "oauth",
      id: "linear",
      name: "Linear",
      nango_provider: "linear-mcp",
      server_url: "https://mcp.linear.app/mcp",
      summary:
        "Read your Linear issues, projects and cycles through the official Linear MCP server.",
      verified_domain: "mcp.linear.app",
    },
  ]);

export function mcpDirectoryCatalog(
  oauthConfigured: boolean | null = loadNangoConfig() !== null,
): McpDirectoryCatalogEntry[] {
  return CATALOG.map((entry) => ({
    auth_mode: entry.auth_mode,
    id: entry.id,
    name: entry.name,
    nango_provider: entry.nango_provider,
    oauth_available: entry.nango_provider !== null && oauthConfigured === true,
    server_url: entry.server_url,
    summary: entry.summary,
    verified_domain: entry.verified_domain,
  }));
}

export function mcpDirectoryEntry(
  id: string | undefined,
  oauthConfigured: boolean | null = loadNangoConfig() !== null,
): McpDirectoryCatalogEntry | null {
  if (!id) return null;
  return mcpDirectoryCatalog(oauthConfigured).find((entry) => entry.id === id) ?? null;
}
