import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeChatProvider } from "./claudeChatProvider.js";
import * as runtime from "./claudeHarness.js";
import { CLAUDE_SDK_VERSION } from "./claudeSdkVersion.js";
import { runOfflineSSECase, type OfflineSSEMode } from "./testing/claudeOfflineSSEFixture.mjs";

// Real pinned SDK/native CLI, synthetic credentials, no remote model or database.
// Run explicitly with TALENT_SIGNAL_CLAUDE_OFFLINE_TEST=true and an absolute
// TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR (a registered test artifact locally).
// Select -t 'complete protocol' for the quick case; the full matrix is sequential.
// A loopback-only OS network sandbox can additionally enclose the Vitest process.
const enabled = process.env.TALENT_SIGNAL_CLAUDE_OFFLINE_TEST === "true";
const originalTmpdir = process.env.TMPDIR;
let evidenceDirectory: string;
let sourceHashes: Record<string, string>;
const cases: Array<{ mode: OfflineSSEMode; title: string; timeout: number }> = [
  { mode: "complete", title: "complete protocol returns a genuine final result after read/cite", timeout: 10_000 },
  { mode: "fixed-provider", title: "real provider recovers once at 20s inside its original 60s budget", timeout: 75_000 },
  { mode: "fixed-continuous-stall", title: "continued stalls do not renew the original host deadline", timeout: 20_000 },
  { mode: "fixed-cancel", title: "caller cancellation prevents another model request", timeout: 15_000 },
  { mode: "fixed-terminal-open", title: "terminal protocol without EOF needs no extra model request", timeout: 22_000 },
  { mode: "fixed-keepalive", title: "keepalive bytes cannot extend the overall deadline", timeout: 20_000 },
  { mode: "fixed-max-turns", title: "native recovery cannot bypass the original turn cap", timeout: 35_000 },
  { mode: "fixed-header-silence", title: "silence before headers remains inside the host deadline", timeout: 20_000 },
];

describe("Claude harness offline SDK integration", { skip: !enabled, concurrent: false }, () => {
  beforeAll(async () => {
    const artifactDirectory = process.env.TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR;
    if (!artifactDirectory || !isAbsolute(artifactDirectory)) {
      throw new Error("Set TALENT_SIGNAL_CLAUDE_OFFLINE_ARTIFACT_DIR to an absolute owned test-artifact directory.");
    }
    await mkdir(artifactDirectory, { recursive: true });
    evidenceDirectory = await mkdtemp(join(artifactDirectory, "offline-sse-"));
    const temporaryDirectory = join(evidenceDirectory, "tmp");
    await mkdir(temporaryDirectory);
    // Keep SDK workspace creation/sweeping inside this run's owned artifact.
    process.env.TMPDIR = temporaryDirectory;
    sourceHashes = Object.fromEntries(await Promise.all([
      "./claudeHarness.ts", "./claudeChatProvider.ts", "./testing/claudeOfflineSSEFixture.mjs",
    ].map(async path => [path, createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex")])));
    console.info(`Offline SDK evidence: ${evidenceDirectory}`);
  });

  afterAll(() => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
  });

  for (const { mode, title, timeout } of cases) {
    it(title, async () => {
      const receipt = await runOfflineSSECase({ mode, runtime, sdkQuery: query, schema: z, ChatProvider: ClaudeChatProvider });
      // Preserve failed receipts too; protocol output is evidence, never a
      // synthesized host completion. All fixture content is synthetic.
      await writeFile(join(evidenceDirectory, `${mode}.json`), JSON.stringify({ ...receipt,
        sdkVersion: CLAUDE_SDK_VERSION, nodeVersion: process.version, sourceHashes,
        scope: "Loopback protocol regression, not historical gateway causation or model-quality acceptance.",
      }, null, 2) + "\n");
      expect(receipt.assertionFailure).toBeNull();
      expect(receipt.passed).toBe(true);
    }, timeout);
  }
});
