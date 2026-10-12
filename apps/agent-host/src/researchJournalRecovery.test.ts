import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprint,
  type AgentJournalEvent,
  type AgentPublicResearchTerminalReceipt,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_JSONL_TRUNCATED_MESSAGE } from "./localResearchFiles.js";
import {
  LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE,
  LOCAL_JOURNAL_CORRUPT_MESSAGE,
  LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE,
  LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
} from "./localResearchJournal.js";
import {
  LocalResearchStore,
  type LocalRunRecord,
} from "./localResearchStore.js";
import {
  LocalPersonResearchStore,
  type LocalPersonResearchRunRecord,
} from "./localPersonResearchStore.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
  type ResearchWorkerHandle,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];

beforeAll(async () => {
  await ensureFreshHostBuild();
}, 180_000);

afterEach(async () => {
  // Terminate and settle owned workers before removing their state
  // directories, even when a barrier failed while a child is held.
  await cleanupResearchWorkers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeStateRoot() {
  const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-recovery-"));
  temporaryDirectories.push(stateRoot);
  return stateRoot;
}

interface RecoveryStore {
  start(record: unknown): Promise<void>;
  loadCheckpoint(runID: string): Promise<unknown>;
  readTerminal(runID: string): Promise<unknown>;
  saveCheckpoint(runID: string, checkpoint: unknown): Promise<void>;
  append(event: AgentJournalEvent): Promise<void>;
  complete(receipt: unknown): Promise<unknown>;
}

interface RecoveryHarness {
  label: string;
  runID: string;
  runDirectory(stateRoot: string): string;
  record(runID: string): unknown;
  store(stateRoot: string): RecoveryStore;
  checkpoint(sequence: number): unknown;
  receipt(runID: string): AgentPublicResearchTerminalReceipt;
}

function publicHarness(): RecoveryHarness {
  return {
    label: "public research store",
    runID: "21212121-2121-4212-8212-212121212121",
    runDirectory: (stateRoot) => join(stateRoot, "runs", "21212121-2121-4212-8212-212121212121"),
    record: (runID): LocalRunRecord => ({
      scope: {
        runID,
        objective: "Research Example Company.",
        providerID: "synthetic-search",
        authorization: {
          purpose: "company_market_research",
          subjectKind: "company",
          accessMode: "domain_allowlist",
          allowedDomains: ["example.com"],
          queryAnchors: ["Example Company"],
          maximumSearchCount: 1,
          maximumFetchCount: 1,
        },
      },
      budget: {
        maxTurns: 4,
        maxToolCalls: 3,
        maxDurationMs: 30_000,
        maxTaskTokens: 4_000,
        maxEstimatedUsd: 1,
      },
      modelProviderID: "scripted",
      model: "scripted-model",
      sdkVersion: "scripted.v1",
      startedAt: "2026-08-30T00:00:00.000Z",
    }),
    store: (stateRoot) => new LocalResearchStore(stateRoot),
    checkpoint: (sequence) => ({
      searchResults: [],
      fetchedPages: [],
      searchCalls: 1,
      fetchCalls: 0,
      toolCalls: 1,
      sequence,
    }),
    receipt: (runID) => ({
      runID,
      status: "no_action",
      reasonCode: "NO_MATERIAL_CHANGE",
      artifactID: null,
      noActionID: "55555555-5555-4555-8555-555555555555",
      candidateFingerprint: "a".repeat(64),
      externalEffects: [],
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedUsd: null,
        turns: null,
        toolCalls: 2,
        durationMs: 250,
      },
      permissionDenials: [],
      providerSessionID: null,
      completedAt: "2026-08-30T00:02:00.000Z",
    }),
  };
}

function personHarness(): RecoveryHarness {
  return {
    label: "person research store",
    runID: "22222222-2222-4222-8222-222222222222",
    runDirectory: (stateRoot) =>
      join(stateRoot, "person-runs", "22222222-2222-4222-8222-222222222222"),
    record: (runID): LocalPersonResearchRunRecord => ({
      scope: {
        runID,
        objective:
          "Find possible public profile matches using only identity text visibly present in this screenshot.",
        providerID: "tikhub",
        authorization: {
          purpose: "person_public_profile_research",
          accessMode: "visible_screenshot_identity_clues",
          allowedPlatforms: ["douyin"],
          maximumProviderCalls: 2,
          maximumResultsPerCall: 5,
        },
        inputArtifactManifest: [
          {
            artifactID: "33333333-3333-4333-8333-333333333333",
            kind: "image",
            mimeType: "image/png",
            byteSize: 35,
            contentHash: "b".repeat(64),
          },
        ],
      },
      budget: {
        maxTurns: 4,
        maxToolCalls: 3,
        maxDurationMs: 30_000,
        maxTaskTokens: 4_000,
        maxEstimatedUsd: 1,
      },
      modelProviderID: "scripted",
      model: "synthetic-vision-tool-model",
      sdkVersion: "scripted.v1",
      startedAt: "2026-08-30T00:00:00.000Z",
    }),
    store: (stateRoot) => new LocalPersonResearchStore(stateRoot),
    checkpoint: (sequence) => ({
      profileResults: [],
      queryObservations: [],
      providerCalls: 1,
      toolCalls: 1,
      sequence,
    }),
    receipt: (runID) => publicHarness().receipt(runID),
  };
}

function terminalEvent(
  runID: string,
  sequence: number,
  receipt: AgentPublicResearchTerminalReceipt,
  outputFingerprint = fingerprint(receipt),
): AgentJournalEvent {
  return {
    runID,
    sequence,
    kind: "terminal",
    occurredAt: receipt.completedAt,
    status: receipt.status,
    outputFingerprint,
    metadata: { reason_code: receipt.reasonCode, external_effect_count: 0 },
  };
}

function toolEvent(runID: string, sequence: number): AgentJournalEvent {
  return {
    runID,
    sequence,
    kind: "tool_call",
    occurredAt: "2026-08-30T00:00:00.000Z",
    toolName: "search_web",
    status: "allowed",
    metadata: {},
  };
}

async function killAndAwait(handle: ResearchWorkerHandle) {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  const exited = new Promise((done) => handle.child.once("exit", done));
  handle.kill("SIGKILL");
  await exited;
}

describe.each([publicHarness(), personHarness()])(
  "research journal recovery on the $label",
  (harness: RecoveryHarness) => {
    it("recovers fresh and reserved-but-undispatched state and keeps consumed allowance", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);

      // Fresh state recovers with no evidence at all.
      await store.start(record);
      await expect(store.loadCheckpoint(harness.runID)).resolves.toBeNull();

      // A consistent reservation checkpoint at sequence 0 with an empty
      // journal stays recoverable and its consumed allowance is authoritative.
      await store.saveCheckpoint(harness.runID, harness.checkpoint(0));
      const checkpointPath = join(
        harness.runDirectory(stateRoot),
        "checkpoint.json",
      );
      const reserved = await fs.readFile(checkpointPath, "utf8");
      const restarted = harness.store(stateRoot);
      await restarted.start(record);
      await expect(restarted.readTerminal(harness.runID)).resolves.toBeNull();
      await expect(
        restarted.loadCheckpoint(harness.runID),
      ).resolves.toMatchObject({ sequence: 0 });
      expect(await fs.readFile(checkpointPath, "utf8")).toBe(reserved);

      // The next journal event continues contiguously from 1.
      await restarted.append(toolEvent(harness.runID, 1));
    });

    it("rejects a checkpoint that claims an absent journal event before any execution", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);
      await store.start(record);
      // The interrupted-publication state: the result checkpoint is durable
      // while its journal event was never appended.
      await store.saveCheckpoint(harness.runID, harness.checkpoint(1));
      const runDirectory = harness.runDirectory(stateRoot);
      const checkpointBytes = await fs.readFile(
        join(runDirectory, "checkpoint.json"),
        "utf8",
      );

      for (const attempt of [
        () => harness.store(stateRoot).start(record),
        () => harness.store(stateRoot).loadCheckpoint(harness.runID),
        () => harness.store(stateRoot).readTerminal(harness.runID),
      ]) {
        const failure = await attempt().then(
          () => null,
          (error: unknown) => error as Error,
        );
        expect(failure?.message).toBe(LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE);
        expect(failure).not.toHaveProperty("cause");
      }

      // The inconsistent evidence is never rewritten or completed.
      expect(
        await fs.readFile(join(runDirectory, "checkpoint.json"), "utf8"),
      ).toBe(checkpointBytes);
      await expect(
        fs.readFile(join(runDirectory, "events.jsonl"), "utf8"),
      ).rejects.toThrow();
    });

    it("fails closed on malformed, torn, gapped, duplicated, foreign-Run, and unknown-kind journals", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);
      await store.start(record);
      const runDirectory = harness.runDirectory(stateRoot);
      const eventsPath = join(runDirectory, "events.jsonl");
      const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
      const foreignRunID = "23232323-2323-4323-8323-232323232323";
      const torn = JSON.stringify(toolEvent(harness.runID, 2));
      const cases: Array<{
        name: string;
        content: string;
        message: string;
      }> = [
        {
          name: "malformed line with private content",
          content: `${JSON.stringify(toolEvent(harness.runID, 1))}\n{"objective": "${canary}", \n`,
          message: LOCAL_JOURNAL_CORRUPT_MESSAGE,
        },
        {
          name: "torn final record that would parse as JSON",
          content: `${JSON.stringify(toolEvent(harness.runID, 1))}\n${torn}`,
          message: LOCAL_JSONL_TRUNCATED_MESSAGE,
        },
        {
          name: "sequence gap",
          content: `${JSON.stringify(toolEvent(harness.runID, 1))}\n${JSON.stringify(toolEvent(harness.runID, 3))}\n`,
          message: LOCAL_JOURNAL_CORRUPT_MESSAGE,
        },
        {
          name: "duplicate sequence",
          content: `${JSON.stringify(toolEvent(harness.runID, 1))}\n${JSON.stringify(toolEvent(harness.runID, 1))}\n`,
          message: LOCAL_JOURNAL_CORRUPT_MESSAGE,
        },
        {
          name: "foreign Run",
          content: `${JSON.stringify(toolEvent(foreignRunID, 1))}\n`,
          message: LOCAL_JOURNAL_CORRUPT_MESSAGE,
        },
        {
          name: "unsupported event kind",
          content: `${JSON.stringify({ ...toolEvent(harness.runID, 1), kind: "invented_kind" })}\n`,
          message: LOCAL_JOURNAL_CORRUPT_MESSAGE,
        },
      ];
      for (const testCase of cases) {
        await fs.writeFile(eventsPath, testCase.content, "utf8");
        for (const attempt of [
          () => harness.store(stateRoot).readTerminal(harness.runID),
          () => harness.store(stateRoot).loadCheckpoint(harness.runID),
          () => harness.store(stateRoot).start(record),
        ]) {
          const failure = await attempt().then(
            () => null,
            (error: unknown) => error as Error,
          );
          expect(failure?.message, testCase.name).toBe(testCase.message);
          expect(String(failure), testCase.name).not.toContain(canary);
          expect(failure, testCase.name).not.toHaveProperty("cause");
        }
        // The malformed journal is never rewritten.
        expect(await fs.readFile(eventsPath, "utf8"), testCase.name).toBe(
          testCase.content,
        );
      }
    });

    it("cannot replay a terminal receipt without its matching terminal event", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);
      await store.start(record);
      const receipt = harness.receipt(harness.runID);

      // Terminal receipt published before its terminal-event append, then the
      // writer died: the unaudited receipt must not be returned or replayed.
      await store.complete(receipt);
      await expect(store.readTerminal(harness.runID)).rejects.toThrow(
        LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
      );
      await expect(store.loadCheckpoint(harness.runID)).rejects.toThrow(
        LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
      );

      // With the matching terminal event appended the Run is complete; the
      // missing checkpoint is not required by terminal evidence.
      await store.append(terminalEvent(harness.runID, 1, receipt));
      await expect(store.readTerminal(harness.runID)).resolves.toEqual(receipt);
      await expect(store.loadCheckpoint(harness.runID)).resolves.toBeNull();
    });

    it("cannot replay a dangling, conflicting, duplicated, or nonfinal terminal event", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);
      const receipt = harness.receipt(harness.runID);
      const eventsPath = join(
        harness.runDirectory(stateRoot),
        "events.jsonl",
      );

      // A terminal event without its receipt is dangling evidence.
      await store.start(record);
      await store.append(terminalEvent(harness.runID, 1, receipt));
      await expect(store.readTerminal(harness.runID)).rejects.toThrow(
        LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
      );

      // A terminal event conflicting with the stored receipt fingerprint or
      // status is never successful replay.
      await store.complete(receipt);
      await expect(store.readTerminal(harness.runID)).resolves.toEqual(receipt);
      const conflictContent = `${JSON.stringify(
        terminalEvent(
          harness.runID,
          1,
          receipt,
          "b".repeat(64),
        ),
      )}\n`;
      await fs.writeFile(eventsPath, conflictContent, "utf8");
      await expect(store.readTerminal(harness.runID)).rejects.toThrow(
        LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
      );

      // Duplicate and nonfinal terminal events corrupt the journal.
      await fs.writeFile(
        eventsPath,
        `${JSON.stringify(terminalEvent(harness.runID, 1, receipt))}\n${JSON.stringify(
          terminalEvent(harness.runID, 2, receipt),
        )}\n`,
        "utf8",
      );
      await expect(store.readTerminal(harness.runID)).rejects.toThrow(
        LOCAL_JOURNAL_CORRUPT_MESSAGE,
      );
      await fs.writeFile(
        eventsPath,
        `${JSON.stringify(terminalEvent(harness.runID, 1, receipt))}\n${JSON.stringify(
          toolEvent(harness.runID, 2),
        )}\n`,
        "utf8",
      );
      await expect(store.readTerminal(harness.runID)).rejects.toThrow(
        LOCAL_JOURNAL_CORRUPT_MESSAGE,
      );
    });

    it("replays a completed Run from its receipt matching the final terminal event", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      const record = harness.record(harness.runID);
      await store.start(record);
      const receipt = harness.receipt(harness.runID);
      await store.append(toolEvent(harness.runID, 1));
      await store.saveCheckpoint(harness.runID, harness.checkpoint(1));
      await store.complete(receipt);
      await store.append(terminalEvent(harness.runID, 2, receipt));

      // Established producer offsets both read: the terminal checkpoint may
      // trail the terminal event by one (public) or sit at it (person).
      await expect(store.loadCheckpoint(harness.runID)).resolves.toMatchObject({
        sequence: 1,
      });
      await expect(store.readTerminal(harness.runID)).resolves.toEqual(receipt);
      await store.saveCheckpoint(harness.runID, harness.checkpoint(2));
      await expect(store.loadCheckpoint(harness.runID)).resolves.toMatchObject({
        sequence: 2,
      });
      await expect(store.readTerminal(harness.runID)).resolves.toEqual(receipt);
      const restarted = harness.store(stateRoot);
      await expect(restarted.readTerminal(harness.runID)).resolves.toEqual(
        receipt,
      );
    });

    it("still creates a fresh Run with no recorded evidence", async () => {
      const stateRoot = await makeStateRoot();
      const store = harness.store(stateRoot);
      await store.start(harness.record(harness.runID));
      await expect(store.readTerminal(harness.runID)).resolves.toBeNull();
      await expect(
        fs.access(join(harness.runDirectory(stateRoot), "run.json")),
      ).resolves.toBeUndefined();
    });

    it("rejects orphaned evidence that lost its immutable Run record", async () => {
      const stateRoot = await makeStateRoot();
      const runDirectory = harness.runDirectory(stateRoot);
      const record = harness.record(harness.runID);
      await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
      const receipt = harness.receipt(harness.runID);
      // Internally consistent orphan evidence: only the missing immutable Run
      // record may trigger the failure.
      const cases: Array<{ name: string; files: Record<string, string> }> = [
        {
          name: "reserved checkpoint at sequence 0",
          files: {
            "checkpoint.json": `${JSON.stringify(harness.checkpoint(0), null, 2)}\n`,
          },
        },
        {
          name: "nonterminal journal with its checkpoint",
          files: {
            "checkpoint.json": `${JSON.stringify(harness.checkpoint(1), null, 2)}\n`,
            "events.jsonl": `${JSON.stringify(toolEvent(harness.runID, 1))}\n`,
          },
        },
        {
          name: "terminal receipt with its terminal event",
          files: {
            "terminal.json": `${JSON.stringify(receipt, null, 2)}\n`,
            "events.jsonl": `${JSON.stringify(terminalEvent(harness.runID, 1, receipt))}\n`,
          },
        },
      ];
      for (const orphanCase of cases) {
        for (const [name, content] of Object.entries(orphanCase.files)) {
          await fs.writeFile(join(runDirectory, name), content, "utf8");
        }
        for (const attempt of [
          () => harness.store(stateRoot).start(record),
          () => harness.store(stateRoot).loadCheckpoint(harness.runID),
          () => harness.store(stateRoot).readTerminal(harness.runID),
        ]) {
          const failure = await attempt().then(
            () => null,
            (error: unknown) => error as Error,
          );
          expect(failure?.message, orphanCase.name).toBe(
            LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE,
          );
          expect(failure, orphanCase.name).not.toHaveProperty("cause");
        }
        // The orphaned evidence keeps its bytes and never receives new run
        // metadata published from an incoming request.
        for (const [name, content] of Object.entries(orphanCase.files)) {
          expect(
            await fs.readFile(join(runDirectory, name), "utf8"),
            `${orphanCase.name} ${name}`,
          ).toBe(content);
        }
        await expect(fs.access(join(runDirectory, "run.json"))).rejects.toThrow();
        for (const name of Object.keys(orphanCase.files)) {
          await fs.rm(join(runDirectory, name), { force: true });
        }
      }
    });
  },
);

describe("completed no-action Run replay", () => {
  const runID = "24242424-2424-4424-8424-242424242424";

  it("replays a completed no_action Run in a fresh process without any provider call", async () => {
    const stateRoot = await makeStateRoot();
    const first = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "search",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await first.waitFor("ready");
    first.send("go");
    await expect(first.result).resolves.toMatchObject({
      ok: true,
      status: "no_action",
      replayedTerminal: false,
    });

    const replay = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "search",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await replay.waitFor("ready");
    replay.send("go");
    await expect(replay.result).resolves.toMatchObject({
      ok: true,
      status: "no_action",
      replayedTerminal: true,
    });
    expect(
      replay.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
  });
});
