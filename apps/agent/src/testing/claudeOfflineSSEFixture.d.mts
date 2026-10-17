import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import type { ClaudeChatProvider } from "../claudeChatProvider.js";
import type * as runtime from "../claudeHarness.js";

export type OfflineSSEMode = "complete" | "fixed-provider" | "fixed-continuous-stall" | "fixed-cancel"
  | "fixed-terminal-open" | "fixed-keepalive" | "fixed-max-turns" | "fixed-header-silence";
export const OFFLINE_SSE_MODES: readonly OfflineSSEMode[];
export interface OfflineSSEReceipt {
  mode: OfflineSSEMode;
  passed: boolean;
  assertionFailure: { name: string; message: string } | null;
  elapsedMs: number;
  requestCount: number;
  workspaceRemoved: boolean;
  toolCalls: { read_relationship_memory: number; cite_evidence: number };
  [key: string]: unknown;
}
export function runOfflineSSECase(input: {
  mode: OfflineSSEMode;
  deadlineMs?: number;
  maxTurns?: number;
  runtime: Pick<typeof runtime, "runClaudeHarness" | "ClaudeHarnessInterruption" | "ClaudeHarnessFailure">;
  sdkQuery: typeof query;
  schema: typeof z;
  ChatProvider: typeof ClaudeChatProvider;
}): Promise<OfflineSSEReceipt>;
