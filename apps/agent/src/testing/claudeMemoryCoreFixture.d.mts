import type { ClaudeChatProvider } from "../claudeChatProvider.js";
import type { claudeHarnessConfiguration } from "../claudeHarnessConfiguration.js";
import type * as runtime from "../claudeHarness.js";

interface MemoryCoreReceipt {
  invalidCommit: boolean;
  requests: Array<{ model: string; stream: boolean; memoryPresent: boolean;
    memoryDeferred: boolean; contactSchemaPresent: boolean;
    definitions: Array<{ name: string; type: string | null; deferred: boolean }> }>;
  hostCalls: Array<{ name: string; input: unknown }>;
  receipt: Pick<runtime.ClaudeHarnessResult, "toolCalls" | "terminalReason" | "permissionDenials" | "apiRetries"> | null;
  completed: boolean;
  failure: { name: string; message: string } | null;
  scope: string;
}
export function runMemoryCoreProtocolCase(input: {
  runtime: Pick<typeof runtime, "runClaudeHarness">;
  ChatProvider: typeof ClaudeChatProvider;
  configurationFactory: typeof claudeHarnessConfiguration;
  invalidCommit?: boolean;
}): Promise<MemoryCoreReceipt>;
