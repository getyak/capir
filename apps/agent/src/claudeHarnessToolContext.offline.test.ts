import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import { claudeHarnessConfiguration } from "./claudeHarnessConfiguration.js";
import { runMemoryCoreProtocolCase } from "./testing/claudeMemoryCoreFixture.mjs";
import * as runtime from "./claudeHarness.js";
import { CLAUDE_SDK_VERSION } from "./claudeSdkVersion.js";
import { resolveProductPrompt } from "./promptRegistry.js";
import { WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES } from "./types.js";

// GET-128 bounded tool context: real pinned SDK/native CLI, deterministic
// loopback SSE peer, synthetic credentials and public prompt text only. No
// remote model, store, or provider call. Run explicitly with
// TALENT_SIGNAL_CLAUDE_OFFLINE_TEST=true and an absolute
// TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR (a registered test artifact
// locally). Select '-t eager' for the legacy footprint and '-t discovery' for
// the bounded multi-step discovery regression.
const enabled = process.env.TALENT_SIGNAL_CLAUDE_OFFLINE_TEST === "true";
const originalTmpdir = process.env.TMPDIR;
type ToolContextReceipt = Record<string, any>;
type ToolContextRunner = (input: {
  mode: "natural" | "json" | "answer"; expect: "eager" | "discovery";
  runtime: typeof runtime; sdkQuery: typeof query; schema: typeof z;
  ChatProvider: typeof ClaudeChatProvider; systemPrompt: string; toolManifest?: string[];
  authorityFault?: "source" | "lease";
}) => Promise<ToolContextReceipt>;
let evidenceDirectory: string;
let sourceHashes: Record<string, string>;
let systemPrompt: string;
let runToolContextCase: ToolContextRunner;
const cases: Array<{ mode: "natural" | "json" | "answer"; expect: "eager" | "discovery"; title: string; timeout: number }> = [
  { mode: "answer", expect: "eager", title: "eager relationship answers keep the legacy full tool context", timeout: 120_000 },
  { mode: "json", expect: "eager", title: "eager JSON adapter keeps the legacy full tool context", timeout: 120_000 },
  { mode: "natural", expect: "discovery", title: "discovery bounded multi-step SSE governs ToolSearch through genuine completion", timeout: 180_000 },
];

describe("Claude harness bounded tool context", { skip: !enabled, concurrent: false }, () => {
  beforeAll(async () => {
    const artifactDirectory = process.env.TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR;
    if (!artifactDirectory || !isAbsolute(artifactDirectory)) {
      throw new Error("Set TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR to an absolute owned test-artifact directory.");
    }
    await mkdir(artifactDirectory, { recursive: true });
    evidenceDirectory = await mkdtemp(join(artifactDirectory, "tool-context-"));
    const temporaryDirectory = join(evidenceDirectory, "tmp");
    await mkdir(temporaryDirectory);
    process.env.TMPDIR = temporaryDirectory;
    sourceHashes = Object.fromEntries(await Promise.all([
      "./claudeHarness.ts", "./claudeChatProvider.ts", "./claudeToolContextPolicy.ts", "./memoryContext.ts", "./memorySchemas.ts",
      "./testing/claudeMemoryCoreFixture.mjs",
      "./testing/claudeToolContextSSEFixture.mjs",
    ].map(async path => [path, createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex")])));
    // Loaded through a computed specifier: the .mjs fixture is typed inline.
    const fixtureURL = new URL("./testing/claudeToolContextSSEFixture.mjs", import.meta.url).href;
    ({ runToolContextCase } = await import(fixtureURL) as { runToolContextCase: ToolContextRunner });
    // Public bundled prompt text only; no live prompt store or private data.
    systemPrompt = (await resolveProductPrompt("assistant/conversation")).text;
    console.info(`Tool context SDK evidence: ${evidenceDirectory}`);
  });

  afterAll(() => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
  });

  it.each([false, true])("core Memory is upfront and commit remains forbidden (invalid=%s)", async invalidCommit => {
    const result = await runMemoryCoreProtocolCase({ runtime, ChatProvider: ClaudeChatProvider,
      configurationFactory: claudeHarnessConfiguration, invalidCommit });
    await writeFile(join(evidenceDirectory, `memory-core-${invalidCommit ? "denied" : "propose"}.json`), JSON.stringify({
      ...result, sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes,
    }, null, 2) + "\n");
    expect(result.failure).toBeNull();
    expect(result.completed).toBe(true);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]).toMatchObject({ memoryPresent: true, memoryDeferred: false });
    expect(result.requests[0]!.contactSchemaPresent).toBe(false);
    expect(result.requests[0]!.calendarSchemaPresent).toBe(false);
    expect(result.requests[0]!.calendarInCatalog).toBe(true);
    const proposal = result.requests[0]!.definitions.find(tool => tool.name === "mcp__talent_signal__memory_review_propose")!;
    expect(proposal.required).toEqual(expect.arrayContaining(["contact_decision", "items"]));
    expect(proposal.properties).not.toEqual(expect.arrayContaining(["operation"]));
    expect(proposal.properties).not.toEqual(expect.arrayContaining(["scope"]));
    expect(proposal.itemRequired).toContain("scope");
    if (invalidCommit) {
      expect(result.hostCalls).toEqual([]);
      expect(result.receipt?.permissionDenials).toContain("TOOL_INPUT_INVALID");
    } else {
      expect(result.hostCalls).toHaveLength(1);
      expect(result.hostCalls[0]).toMatchObject({ name: "memory_review", input: { operation: "propose", contact_decision: "none" } });
      expect(result.receipt?.permissionDenials).toEqual([]);
    }
    expect(result.receipt?.apiRetries).toEqual([]);
  }, 55_000);

  it.each(["missing_scope", "missing_contact", "top_scope", "empty"] as const)("Memory invalid %s never reaches the host", async invalidKind => {
    const result = await runMemoryCoreProtocolCase({ runtime, ChatProvider: ClaudeChatProvider,
      configurationFactory: claudeHarnessConfiguration, invalidKind });
    await writeFile(join(evidenceDirectory, `memory-denied-${invalidKind}.json`), JSON.stringify({ ...result,
      sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes }, null, 2) + "\n");
    expect(result.failure).toBeNull(); expect(result.completed).toBe(true);
    expect(result.hostCalls).toEqual([]);
    expect(result.receipt?.permissionDenials).toContain("TOOL_INPUT_INVALID");
    expect(result.receipt?.toolCompletions).toEqual([]);
  }, 55_000);

  it.each(["enabled", "unavailable"] as const)("calendar discovery preserves %s host context", async calendarMode => {
    const result = await runMemoryCoreProtocolCase({ runtime, ChatProvider: ClaudeChatProvider,
      configurationFactory: claudeHarnessConfiguration, calendarMode });
    await writeFile(join(evidenceDirectory, `memory-calendar-${calendarMode}.json`), JSON.stringify({ ...result,
      sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes }, null, 2) + "\n");
    expect(result.failure).toBeNull(); expect(result.completed).toBe(true);
    expect(result.hostCalls).toEqual([]); expect(result.requests).toHaveLength(2);
    expect(result.requests[0]!.calendarSchemaPresent).toBe(false);
    expect(result.requests[0]!.calendarInCatalog).toBe(calendarMode === "enabled");
    const references = result.requests.flatMap(request => request.references);
    if (calendarMode === "enabled") {
      expect(references).toContain("mcp__talent_signal__stage_calendar_draft");
      expect(result.requests[1]!.calendarSchemaPresent).toBe(true);
      expect(result.calendarDraft).toMatchObject({ status: "needs_review", external_effect: "none",
        starts_at: "2026-10-20T09:00:00.000Z", ends_at: "2026-10-20T10:00:00.000Z" });
      expect(result.receipt?.terminalReason).toBe("hook_stopped");
      expect(result.receipt?.toolCompletions?.map(tool => tool.name)).toEqual(["stage_calendar_draft"]);
    } else {
      expect(references).not.toContain("mcp__talent_signal__stage_calendar_draft");
      expect(result.calendarDraft).toBeNull(); expect(result.receipt?.toolCompletions).toEqual([]);
    }
    expect(result.receipt?.apiRetries).toEqual([]);
  }, 55_000);

  for (const { mode, expect: expected, title, timeout } of cases) {
    it(title, async () => {
      const receipt = await runToolContextCase({ mode, expect: expected, runtime, sdkQuery: query, schema: z,
        ChatProvider: ClaudeChatProvider, systemPrompt,
        toolManifest: [...WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES] });
      await writeFile(join(evidenceDirectory, `${mode}-${expected}.json`), JSON.stringify({ ...receipt,
        sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes,
        scope: "Loopback tool-context wire measurement and discovery regression. Byte counts are not token, billing or semantic proof; remote proxy compatibility stays parent-owned.",
      }, null, 2) + "\n");
      expect(receipt.assertionFailure).toBeNull();
      expect(receipt.passed).toBe(true);
    }, timeout);
  }

  for (const authorityFault of ["source", "lease"] as const) {
    it(`aborts genuine discovery immediately after ${authorityFault} authority is revoked`, async () => {
      const receipt = await runToolContextCase({ mode: "natural", expect: "discovery", authorityFault,
        runtime, sdkQuery: query, schema: z, ChatProvider: ClaudeChatProvider, systemPrompt,
        toolManifest: [...WORKSPACE_CONVERSATION_AGENT_TOOL_NAMES] });
      await writeFile(join(evidenceDirectory, `revoked-${authorityFault}.json`), JSON.stringify({ ...receipt,
        sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes,
        scope: "Actual pinned SDK source/lease discovery fences over a loopback peer; no remote model.",
      }, null, 2) + "\n");
      expect(receipt.assertionFailure).toBeNull();
      expect(receipt.passed).toBe(true);
    }, 120_000);
  }
});
