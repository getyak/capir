import { readFileSync } from "node:fs";

/**
 * Single owner of the reported Claude Agent SDK version.
 *
 * Provider identity and the harness continuation fingerprint must describe the
 * SDK the agent package actually pins. Reading that exact dependency pin here
 * keeps the reported provenance and the continuation fingerprint invalidation
 * synchronized with every SDK upgrade, instead of trusting parallel
 * hand-maintained version literals that drift apart.
 */
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies?: Record<string, string> };
const pinned = manifest.dependencies?.["@anthropic-ai/claude-agent-sdk"];
if (!pinned) throw new Error("CLAUDE_AGENT_SDK_PIN_MISSING");
export const CLAUDE_SDK_VERSION: string = pinned;
