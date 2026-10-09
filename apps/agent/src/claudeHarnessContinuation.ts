import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import { CLAUDE_SDK_VERSION } from "./claudeSdkVersion.js";
import type { ClaudeHarnessRequest } from "./claudeHarness.js";

/** Host-issued lease. No client/model-selected SDK identity or store is admitted. */
export interface HarnessContinuation {
  sessionID: string;
  resume: boolean;
  store: SessionStore;
  assertCurrent(): Promise<void>;
  /** Called after SDK shutdown and physical local cleanup, including failed runs. */
  finish(completed: boolean): Promise<void>;
}
export type HarnessContinuationFactory = (configurationFingerprint: string) => Promise<HarnessContinuation>;

export function harnessContinuationFingerprint(configuration: ClaudeHarnessConfiguration, request: ClaudeHarnessRequest): string {
  return createHash("sha256").update(JSON.stringify({ version: "get9-v1", sdk: CLAUDE_SDK_VERSION,
    endpoint: configuration.baseUrl, model: configuration.model, effort: request.effort ?? "high",
    transport_digest: createHash("sha256").update(configuration.httpsProxy ?? "direct").digest("hex"),
    credential_digest: createHash("sha256").update(configuration.credential.value).digest("hex"),
    system_prompt: request.systemPrompt, tools: request.tools.map(entry => ({ name: entry.name,
      description: entry.description, read_only: entry.readOnly, schema: z.toJSONSchema(entry.schema) })),
    skills: request.skills ?? [], subagents: request.subagents ?? [], output_schema: request.outputSchema ?? null,
  })).digest("hex");
}
