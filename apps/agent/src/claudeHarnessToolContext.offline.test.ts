import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
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
      "./claudeHarness.ts", "./claudeChatProvider.ts", "./claudeToolContextPolicy.ts",
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
