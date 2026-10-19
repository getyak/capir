import type { ClaudeChatProvider } from "../claudeChatProvider.js";
import type { claudeHarnessConfiguration } from "../claudeHarnessConfiguration.js";
import type * as runtime from "../claudeHarness.js";

interface MemoryCoreReceipt {
  invalidCommit: boolean;
  invalidKind: string | null; calendarMode: string | null;
  calendarDraft: import("@talent-signal/contracts").CalendarDraft | null;
  requests: Array<{ model: string; stream: boolean; memoryPresent: boolean;
    memoryDeferred: boolean; contactSchemaPresent: boolean;
    calendarInCatalog: boolean; calendarSchemaPresent: boolean; references: string[];
    definitions: Array<{ name: string; type: string | null; deferred: boolean; required: string[]; properties: string[]; itemRequired: string[] }> }>;
  hostCalls: Array<{ name: string; input: unknown }>;
  receipt: Pick<runtime.ClaudeHarnessResult, "toolCalls" | "toolCompletions" | "terminalReason" | "permissionDenials" | "apiRetries"> | null;
  completed: boolean;
  failure: { name: string; message: string } | null;
  scope: string;
}
export function runMemoryCoreProtocolCase(input: {
  runtime: Pick<typeof runtime, "runClaudeHarness">;
  ChatProvider: typeof ClaudeChatProvider;
  configurationFactory: typeof claudeHarnessConfiguration;
  invalidCommit?: boolean;
  invalidKind?: "missing_scope" | "missing_contact" | "top_scope" | "empty";
  calendarMode?: "enabled" | "unavailable";
}): Promise<MemoryCoreReceipt>;
