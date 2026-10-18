import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprint,
  type AgentPublicResearchTerminalReceipt,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  LOCAL_JSONL_TRUNCATED_MESSAGE,
  LOCAL_RECORD_NOT_REGULAR_MESSAGE,
} from "./localResearchFiles.js";
import {
  LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE,
  LOCAL_JOURNAL_CORRUPT_MESSAGE,
  LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE,
  LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
  readLocalResearchJournal,
  requireLocalRunMetadataForEvidence,
  validateLocalResearchJournalAgreement,
} from "./localResearchJournal.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];
const runID = "11111111-1111-4111-8111-111111111111";
const otherRunID = "12121212-1212-4212-8212-121212121212";

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

async function makeDirectory() {
  const directory = await fs.mkdtemp(join(tmpdir(), "talent-signal-journal-"));
  temporaryDirectories.push(directory);
  return directory;
}

function event(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    runID,
    sequence,
    kind: "tool_call",
    occurredAt: "2026-08-30T00:00:00.000Z",
    toolName: "search_web",
    status: "allowed",
    metadata: {},
    ...overrides,
  };
}

function terminalEvent(
  sequence: number,
  receipt: AgentPublicResearchTerminalReceipt,
  overrides: Record<string, unknown> = {},
) {
  return {
    runID,
    sequence,
    kind: "terminal",
    occurredAt: receipt.completedAt,
    status: receipt.status,
    outputFingerprint: fingerprint(receipt),
    metadata: { reason_code: receipt.reasonCode, external_effect_count: 0 },
    ...overrides,
  };
}

function receipt(): AgentPublicResearchTerminalReceipt {
  return {
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
  };
}

const record = {
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
};

describe("local research journal reading", () => {
  it("accepts an absent, empty, and newline-terminated journal", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    await expect(readLocalResearchJournal(runID, path)).resolves.toEqual({
      lastSequence: 0,
      terminal: null,
    });
    await fs.writeFile(path, "", "utf8");
    await expect(readLocalResearchJournal(runID, path)).resolves.toEqual({
      lastSequence: 0,
      terminal: null,
    });
    await fs.writeFile(path, `${JSON.stringify(event(1))}\n`, "utf8");
    await expect(readLocalResearchJournal(runID, path)).resolves.toEqual({
      lastSequence: 1,
      terminal: null,
    });
  });

  it("fails closed on a torn final record even when its JSON would parse", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    const torn = JSON.stringify(event(2));
    await fs.writeFile(path, `${JSON.stringify(event(1))}\n${torn}`, "utf8");

    const failure = await readLocalResearchJournal(runID, path).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(LOCAL_JSONL_TRUNCATED_MESSAGE);
    expect(failure).not.toHaveProperty("cause");
    // The torn record is never rewritten, truncated, or appended to.
    expect(await fs.readFile(path, "utf8")).toBe(
      `${JSON.stringify(event(1))}\n${torn}`,
    );
  });

  it("rejects malformed, gapped, duplicated, foreign-Run, and unsupported records content-free", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const cases: Array<{ name: string; content: string }> = [
      {
        name: "malformed line with private content",
        content: `${JSON.stringify(event(1))}\n{"objective": "${canary}", \n`,
      },
      {
        name: "blank record line",
        content: `${JSON.stringify(event(1))}\n\n`,
      },
      {
        name: "array envelope",
        content: `${JSON.stringify([event(1)])}\n`,
      },
      {
        name: "sequence gap",
        content: `${JSON.stringify(event(1))}\n${JSON.stringify(event(3))}\n`,
      },
      {
        name: "duplicate sequence",
        content: `${JSON.stringify(event(1))}\n${JSON.stringify(event(1))}\n`,
      },
      {
        name: "sequence not starting at 1",
        content: `${JSON.stringify(event(2))}\n`,
      },
      {
        name: "foreign Run",
        content: `${JSON.stringify(event(1, { runID: otherRunID }))}\n`,
      },
      {
        name: "unsupported event kind",
        content: `${JSON.stringify(event(1, { kind: "invented_kind" }))}\n`,
      },
      {
        name: "missing tool name",
        content: `${JSON.stringify(event(1, { toolName: undefined }))}\n`,
      },
      {
        name: "invalid timestamp",
        content: `${JSON.stringify(event(1, { occurredAt: "not-a-time" }))}\n`,
      },
      {
        name: "missing metadata",
        content: `${JSON.stringify(event(1, { metadata: undefined }))}\n`,
      },
    ];
    for (const testCase of cases) {
      await fs.writeFile(path, testCase.content, "utf8");
      const failure = await readLocalResearchJournal(runID, path).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure?.message, testCase.name).toBe(LOCAL_JOURNAL_CORRUPT_MESSAGE);
      expect(String(failure), testCase.name).not.toContain(canary);
      expect(failure, testCase.name).not.toHaveProperty("cause");
      expect(await fs.readFile(path, "utf8"), testCase.name).toBe(
        testCase.content,
      );
    }
  });

  it("rejects duplicate and nonfinal terminal events", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "events.jsonl");
    const done = receipt();
    for (const content of [
      `${JSON.stringify(terminalEvent(1, done))}\n${JSON.stringify(terminalEvent(2, done))}\n`,
      `${JSON.stringify(terminalEvent(1, done))}\n${JSON.stringify(event(2))}\n`,
    ]) {
      await fs.writeFile(path, content, "utf8");
      await expect(readLocalResearchJournal(runID, path)).rejects.toThrow(
        LOCAL_JOURNAL_CORRUPT_MESSAGE,
      );
      expect(await fs.readFile(path, "utf8")).toBe(content);
    }
    // A final single terminal event is complete journal evidence.
    await fs.writeFile(
      path,
      `${JSON.stringify(event(1))}\n${JSON.stringify(terminalEvent(2, done))}\n`,
      "utf8",
    );
    await expect(readLocalResearchJournal(runID, path)).resolves.toEqual({
      lastSequence: 2,
      terminal: {
        sequence: 2,
        status: "no_action",
        outputFingerprint: fingerprint(done),
      },
    });
  });

  it("rejects symlinked and non-regular journals without following them", async () => {
    const directory = await makeDirectory();
    const target = join(directory, "elsewhere-events.jsonl");
    await fs.writeFile(target, `${JSON.stringify(event(1))}\n`, "utf8");
    const path = join(directory, "events.jsonl");
    await fs.symlink(target, path);
    await expect(readLocalResearchJournal(runID, path)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);

    await fs.unlink(path);
    await fs.mkdir(path);
    await expect(readLocalResearchJournal(runID, path)).rejects.toThrow(
      LOCAL_RECORD_NOT_REGULAR_MESSAGE,
    );
  });
});

describe("local research journal agreement", () => {
  const done = receipt();
  const matchingFingerprint = fingerprint(done);

  it("accepts only a checkpoint that agrees with the journal on nonterminal recovery", () => {
    const journal = { lastSequence: 2, terminal: null };
    expect(() =>
      validateLocalResearchJournalAgreement({
        journal: { lastSequence: 0, terminal: null },
        checkpointSequence: 0,
        receipt: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateLocalResearchJournalAgreement({
        journal,
        checkpointSequence: 2,
        receipt: null,
      }),
    ).not.toThrow();
    for (const checkpointSequence of [1, 3, null]) {
      expect(
        () =>
          validateLocalResearchJournalAgreement({
            journal,
            checkpointSequence,
            receipt: null,
          }),
        `checkpoint ${String(checkpointSequence)}`,
      ).toThrow(LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE);
    }
  });

  it("rejects a terminal receipt without its matching final terminal event", () => {
    expect(() =>
      validateLocalResearchJournalAgreement({
        journal: { lastSequence: 2, terminal: null },
        checkpointSequence: null,
        receipt: { status: "no_action", outputFingerprint: matchingFingerprint },
      }),
    ).toThrow(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
    // A dangling terminal event without its receipt is equally rejected.
    expect(() =>
      validateLocalResearchJournalAgreement({
        journal: {
          lastSequence: 2,
          terminal: {
            sequence: 2,
            status: "no_action",
            outputFingerprint: matchingFingerprint,
          },
        },
        checkpointSequence: 2,
        receipt: null,
      }),
    ).toThrow(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
  });

  it("rejects a conflicting terminal status or receipt fingerprint", () => {
    const terminal = {
      sequence: 2,
      status: "no_action",
      outputFingerprint: matchingFingerprint,
    };
    for (const receiptSummary of [
      { status: "failed", outputFingerprint: matchingFingerprint },
      { status: "no_action", outputFingerprint: "b".repeat(64) },
    ]) {
      expect(
        () =>
          validateLocalResearchJournalAgreement({
            journal: { lastSequence: 2, terminal },
            checkpointSequence: null,
            receipt: receiptSummary,
          }),
        JSON.stringify(receiptSummary),
      ).toThrow(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
    }
    // Matching identity, status, and fingerprint accept the legitimate
    // producer terminal/checkpoint offsets without consulting the checkpoint.
    expect(() =>
      validateLocalResearchJournalAgreement({
        journal: { lastSequence: 2, terminal },
        checkpointSequence: null,
        receipt: { status: "no_action", outputFingerprint: matchingFingerprint },
      }),
    ).not.toThrow();
  });
});

describe("local research journal secure child reads", () => {
  async function startJobOnJournal(content: string | null) {
    const stateRoot = await makeDirectory();
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const events = join(runDirectory, "events.jsonl");
    if (content === null) execFileSync("mkfifo", [events]);
    else await fs.writeFile(events, content, "utf8");
    const worker = spawnResearchWorker({
      kind: "store-start",
      store: "public",
      stateRoot,
      record,
    });
    await worker.waitFor("ready");
    worker.send("go");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A bounded child: a FIFO or corrupted journal must fail closed instead
      // of blocking the reader or leaking record content.
      const result = await Promise.race([
        worker.result,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("journal validation blocked in the child")),
            10_000,
          );
        }),
      ]);
      return { result, events };
    } finally {
      if (timer) clearTimeout(timer);
      await worker.cleanup();
    }
  }

  it("rejects a FIFO journal in a bounded real child without blocking", async () => {
    const { result, events } = await startJobOnJournal(null);
    expect(result.ok).toBe(false);
    // Fixed nonregular rejection: the FIFO is neither followed nor read nor
    // treated as an absent journal.
    expect(result.error).toBe(LOCAL_RECORD_NOT_REGULAR_MESSAGE);
    expect((await fs.lstat(events)).isFIFO()).toBe(true);
  });

  it("reports a fixed content-free failure for a corrupted journal in a bounded real child", async () => {
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const { result, events } = await startJobOnJournal(
      `{"objective": "${canary}", \n`,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOCAL_JOURNAL_CORRUPT_MESSAGE);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result).not.toHaveProperty("cause");
    // The corrupted journal is never rewritten.
    expect(await fs.readFile(events, "utf8")).toBe(
      `{"objective": "${canary}", \n`,
    );
  });
});

describe("local Run evidence metadata", () => {
  function pathsFor(directory: string) {
    return {
      runID,
      runRecordPath: join(directory, "run.json"),
      checkpointPath: join(directory, "checkpoint.json"),
      journalPath: join(directory, "events.jsonl"),
      terminalPath: join(directory, "terminal.json"),
      parseRunRecord: (value: Record<string, unknown>) => value,
    };
  }

  it("rejects recorded evidence without its immutable Run record and never fabricates one", async () => {
    const directory = await makeDirectory();
    const checkpointBytes = '{"sequence":0}\n';
    await fs.writeFile(
      join(directory, "checkpoint.json"),
      checkpointBytes,
      "utf8",
    );

    const failure = await requireLocalRunMetadataForEvidence(
      pathsFor(directory),
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE);
    expect(failure).not.toHaveProperty("cause");
    // Nothing publishes replacement metadata over orphaned evidence.
    await expect(fs.access(join(directory, "run.json"))).rejects.toThrow();
    expect(await fs.readFile(join(directory, "checkpoint.json"), "utf8")).toBe(
      checkpointBytes,
    );
  });

  it("accepts fresh state with no recorded evidence", async () => {
    const directory = await makeDirectory();
    await expect(
      requireLocalRunMetadataForEvidence(pathsFor(directory)),
    ).resolves.toBeUndefined();
    await expect(fs.access(join(directory, "run.json"))).rejects.toThrow();
  });

  it("accepts a Run record published by a concurrent first writer during evidence inspection", async () => {
    const directory = await makeDirectory();
    const paths = pathsFor(directory);
    await fs.writeFile(paths.checkpointPath, '{"sequence":0}\n', "utf8");
    // The concurrent first writer publishes real immutable metadata after the
    // first lookup observed absence and while evidence is inspected: its
    // record must never be misclassified as orphaned.
    let published = false;
    const originalOpen = fs.open;
    const spy = vi
      .spyOn(fs, "open")
      .mockImplementation(async (path, flags, mode) => {
        if (!published && String(path).endsWith("checkpoint.json")) {
          published = true;
          await fs.writeFile(paths.runRecordPath, '{"scope":{}}\n', "utf8");
        }
        return originalOpen(path, flags, mode);
      });
    try {
      await expect(
        requireLocalRunMetadataForEvidence(paths),
      ).resolves.toBeUndefined();
      expect(published).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
