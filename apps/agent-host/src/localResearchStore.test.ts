import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprint,
  PublicResearchNoActionOutputSchema,
  type AgentJournalEvent,
  type AgentPublicResearchCheckpoint,
  type AgentPublicResearchNoActionCandidate,
  type AgentPublicResearchTerminalReceipt,
  type AgentResearchArtifactCandidate,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_JSON_MALFORMED_MESSAGE } from "./localResearchFiles.js";
import {
  LocalResearchStore,
  type LocalRunRecord,
} from "./localResearchStore.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];
const runID = "33333333-3333-4333-8333-333333333333";
const otherRunID = "34343434-3434-4434-8434-343434343434";
const record: LocalRunRecord = {
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

const resultID = fingerprint({
  runID,
  providerID: "synthetic-search",
  url: "https://example.com/update",
});
const artifactCandidate: AgentResearchArtifactCandidate = {
  title: "Company update",
  summary: "The company published an update.",
  limitations: "One public source was fetched.",
  claims: [
    {
      statement: "The company published an update.",
      sourceRefs: [resultID],
    },
  ],
  sources: [
    {
      resultID,
      url: "https://example.com/update",
      title: "Company update",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-08-30T00:00:00.000Z",
    },
  ],
};
const noActionCandidate: AgentPublicResearchNoActionCandidate = {
  reasonCode: "NO_MATERIAL_CHANGE",
  reason: "No new public material appeared.",
  missingEvidenceRefs: [],
};
const artifactFingerprint = fingerprint(artifactCandidate);
const noActionFingerprint = fingerprint(noActionCandidate);

function terminalReceipt(
  overrides: Partial<AgentPublicResearchTerminalReceipt> = {},
): AgentPublicResearchTerminalReceipt {
  return {
    runID,
    status: "artifact_created",
    reasonCode: "RESEARCH_COMPLETE",
    artifactID: "44444444-4444-4444-8444-444444444444",
    noActionID: null,
    candidateFingerprint: artifactFingerprint,
    externalEffects: [],
    usage: {
      inputTokens: 128,
      outputTokens: 64,
      totalTokens: 192,
      estimatedUsd: 0,
      turns: 1,
      toolCalls: 2,
      durationMs: 250,
    },
    permissionDenials: [],
    providerSessionID: null,
    completedAt: "2026-08-30T00:02:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureFreshHostBuild();
}, 180_000);

afterEach(async () => {
  // Terminate and settle owned workers before removing their state
  // directories, even when a barrier failed while a holder is blocked.
  await cleanupResearchWorkers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeStateRoot(prefix: string) {
  const stateRoot = await fs.mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(stateRoot);
  return stateRoot;
}

describe("local public-research journal", () => {
  it("restores a checkpoint and sequence in a new host process", async () => {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-store-"));
    temporaryDirectories.push(stateRoot);
    const first = new LocalResearchStore(stateRoot);
    await first.start(record);
    const event = (sequence: number): AgentJournalEvent => ({
      runID,
      sequence,
      kind: "tool_call",
      occurredAt: "2026-08-30T00:00:00.000Z",
      toolName: "search_web",
      status: "allowed",
      metadata: {},
    });
    const checkpoint: AgentPublicResearchCheckpoint = {
      searchResults: [],
      fetchedPages: [],
      searchCalls: 1,
      fetchCalls: 0,
      toolCalls: 1,
      sequence: 1,
    };
    await first.append(event(1));
    await first.saveCheckpoint(runID, checkpoint);

    const restarted = new LocalResearchStore(stateRoot);
    await restarted.start({ ...record, startedAt: "2026-08-30T00:01:00.000Z" });
    await expect(restarted.loadCheckpoint(runID)).resolves.toEqual(checkpoint);
    await expect(restarted.append(event(2))).resolves.toBeUndefined();

    const directoryMode = (
      await fs.stat(join(stateRoot, "runs", runID))
    ).mode & 0o777;
    const fileMode = (
      await fs.stat(join(stateRoot, "runs", runID, "checkpoint.json"))
    ).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("rejects reuse of a run ID with a different authorization", async () => {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-store-"));
    temporaryDirectories.push(stateRoot);
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);

    await expect(
      new LocalResearchStore(stateRoot).start({
        ...record,
        scope: {
          ...record.scope,
          authorization: {
            ...record.scope.authorization,
            allowedDomains: ["other.example"],
          },
        },
      }),
    ).rejects.toThrow("already belongs to a different");
  });

  it("allows one semantic winner when conflicting run starts race across processes", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const conflicting: LocalRunRecord = {
      ...record,
      scope: {
        ...record.scope,
        authorization: {
          ...record.scope.authorization,
          allowedDomains: ["other.example"],
        },
      },
      startedAt: "2026-08-30T00:01:00.000Z",
    };
    const first = spawnResearchWorker({
      kind: "store-start",
      store: "public",
      stateRoot,
      record,
    });
    const second = spawnResearchWorker({
      kind: "store-start",
      store: "public",
      stateRoot,
      record: conflicting,
    });
    await Promise.all([first.waitFor("ready"), second.waitFor("ready")]);
    first.send("go");
    second.send("go");
    const results = await Promise.all([first.result, second.result]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rejected = results.filter((result) => !result.ok);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toContain("already belongs to a different");

    // The persisted record is exactly one of the two requested records.
    const persisted = await new LocalResearchStore(stateRoot).readRun(runID);
    expect(persisted).not.toBeNull();
    expect(
      [record.startedAt, conflicting.startedAt].includes(persisted!.startedAt),
    ).toBe(true);
  });

  it("keeps the original startedAt when an equivalent start replays across processes", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const first = spawnResearchWorker({
      kind: "store-start",
      store: "public",
      stateRoot,
      record,
    });
    await first.waitFor("ready");
    first.send("go");
    await expect(first.result).resolves.toMatchObject({ ok: true });

    const second = spawnResearchWorker({
      kind: "store-start",
      store: "public",
      stateRoot,
      record: { ...record, startedAt: "2026-08-30T00:05:00.000Z" },
    });
    await second.waitFor("ready");
    second.send("go");
    await expect(second.result).resolves.toMatchObject({ ok: true });

    const persisted = await new LocalResearchStore(stateRoot).readRun(runID);
    expect(persisted?.startedAt).toBe(record.startedAt);
  });

  it("allows one semantic winner when conflicting terminal receipts race across processes", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const receiptA = terminalReceipt();
    const receiptB = terminalReceipt({
      status: "no_action",
      reasonCode: "NO_MATERIAL_CHANGE",
      artifactID: null,
      noActionID: "55555555-5555-4555-8555-555555555555",
      candidateFingerprint: noActionFingerprint,
    });

    const first = spawnResearchWorker({
      kind: "store-complete",
      store: "public",
      stateRoot,
      receipt: receiptA,
    });
    const second = spawnResearchWorker({
      kind: "store-complete",
      store: "public",
      stateRoot,
      receipt: receiptB,
    });
    await Promise.all([first.waitFor("ready"), second.waitFor("ready")]);
    first.send("go");
    second.send("go");
    const results = await Promise.all([first.result, second.result]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results.find((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toContain("different terminal receipt");
    await expect(store.readTerminal(runID)).resolves.toEqual(winner?.receipt);
  });

  it("replays an equivalent terminal receipt unchanged across processes", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const receipt = terminalReceipt();

    const first = spawnResearchWorker({
      kind: "store-complete",
      store: "public",
      stateRoot,
      receipt,
    });
    await first.waitFor("ready");
    first.send("go");
    await expect(first.result).resolves.toMatchObject({ ok: true });
    const published = await fs.readFile(
      join(stateRoot, "runs", runID, "terminal.json"),
      "utf8",
    );

    const second = spawnResearchWorker({
      kind: "store-complete",
      store: "public",
      stateRoot,
      receipt,
    });
    await second.waitFor("ready");
    second.send("go");
    const replay = await second.result;
    expect(replay.ok).toBe(true);
    expect(replay.receipt).toEqual(receipt);
    expect(
      await fs.readFile(join(stateRoot, "runs", runID, "terminal.json"), "utf8"),
    ).toBe(published);
  });

  it("converges duplicate artifact commits on one persisted ID and timestamp", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);

    const workers = [1, 2, 3].map(() =>
      spawnResearchWorker({
        kind: "store-commit-artifact",
        store: "public",
        stateRoot,
        scope: record.scope,
        candidate: artifactCandidate,
        candidateFingerprint: artifactFingerprint,
      }),
    );
    await Promise.all(workers.map((worker) => worker.waitFor("ready")));
    workers.forEach((worker) => worker.send("go"));
    const results = await Promise.all(workers.map((worker) => worker.result));
    for (const result of results) expect(result.ok).toBe(true);

    const ids = new Set(results.map((result) => result.committed?.artifactID));
    expect(ids.size).toBe(1);
    const timestamps = new Set(
      results.map((result) => result.committed?.createdAt),
    );
    expect(timestamps.size).toBe(1);
    expect(
      results.filter((result) => result.committed?.replayed === false),
    ).toHaveLength(1);

    const raw = JSON.parse(
      await fs.readFile(
        store.artifactPath(runID, artifactFingerprint),
        "utf8",
      ),
    ) as { artifactID: string; createdAt: string };
    expect(raw.artifactID).toBe([...ids][0]);
    expect(raw.createdAt).toBe([...timestamps][0]);
  });

  it("converges duplicate no-action commits on one persisted ID and timestamp", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);

    const workers = [1, 2, 3].map(() =>
      spawnResearchWorker({
        kind: "store-commit-no-action",
        store: "public",
        stateRoot,
        scope: record.scope,
        candidate: noActionCandidate,
        candidateFingerprint: noActionFingerprint,
      }),
    );
    await Promise.all(workers.map((worker) => worker.waitFor("ready")));
    workers.forEach((worker) => worker.send("go"));
    const results = await Promise.all(workers.map((worker) => worker.result));
    for (const result of results) expect(result.ok).toBe(true);

    const ids = new Set(results.map((result) => result.committed?.noActionID));
    expect(ids.size).toBe(1);
    const timestamps = new Set(
      results.map((result) => result.committed?.createdAt),
    );
    expect(timestamps.size).toBe(1);
    expect(
      results.filter((result) => result.committed?.replayed === false),
    ).toHaveLength(1);
  });

  it("returns the original artifact ID and createdAt on equivalent replay", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);

    const first = await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );
    expect(first.replayed).toBe(false);
    const second = await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );
    expect(second.replayed).toBe(true);
    expect(second.artifactID).toBe(first.artifactID);
    expect(second.createdAt).toBe(first.createdAt);

    const raw = JSON.parse(
      await fs.readFile(
        store.artifactPath(runID, artifactFingerprint),
        "utf8",
      ),
    ) as { artifactID: string; createdAt: string };
    expect(raw.artifactID).toBe(first.artifactID);
    expect(raw.createdAt).toBe(first.createdAt);
  });

  it("rejects a conflicting candidate that reuses an externally supplied fingerprint", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const first = await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );

    const conflictingCandidate: AgentResearchArtifactCandidate = {
      ...artifactCandidate,
      summary: "A different summary under the same supplied fingerprint.",
    };
    await expect(
      store.commitResearchArtifact(
        record.scope,
        conflictingCandidate,
        artifactFingerprint,
      ),
    ).rejects.toThrow("conflicts with the requested candidate");

    const raw = JSON.parse(
      await fs.readFile(
        store.artifactPath(runID, artifactFingerprint),
        "utf8",
      ),
    ) as { artifactID: string; candidate: unknown };
    expect(raw.artifactID).toBe(first.artifactID);
    expect(raw.candidate).toEqual(artifactCandidate);

    const firstNoAction = await store.commitNoAction(
      record.scope,
      noActionCandidate,
      noActionFingerprint,
    );
    await expect(
      store.commitNoAction(
        record.scope,
        { ...noActionCandidate, reason: "A different reason." },
        noActionFingerprint,
      ),
    ).rejects.toThrow("conflicts with the requested candidate");
    const rawNoAction = JSON.parse(
      await fs.readFile(
        store.noActionPath(runID, noActionFingerprint),
        "utf8",
      ),
    ) as { noActionID: string; candidate: unknown };
    expect(rawNoAction.noActionID).toBe(firstNoAction.noActionID);
    expect(rawNoAction.candidate).toEqual(noActionCandidate);
  });

  it("fails closed on corrupt or invalid persisted records without overwriting", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );
    const path = store.artifactPath(runID, artifactFingerprint);
    const valid = (await fs.readFile(path, "utf8")).trimEnd();
    const validRecord = JSON.parse(valid) as Record<string, unknown>;
    const cases: Array<{ name: string; content: string }> = [
      { name: "null envelope", content: "null" },
      { name: "array envelope", content: "[]" },
      {
        name: "foreign-Run envelope",
        content: JSON.stringify({ ...validRecord, runID: otherRunID }),
      },
      {
        name: "invalid artifact ID",
        content: JSON.stringify({ ...validRecord, artifactID: "not-a-uuid" }),
      },
      {
        name: "invalid timestamp",
        content: JSON.stringify({ ...validRecord, createdAt: "not-a-time" }),
      },
      {
        name: "missing authority",
        content: JSON.stringify({
          ...validRecord,
          publicationAuthority: "confirmed",
        }),
      },
    ];
    for (const testCase of cases) {
      await fs.writeFile(path, testCase.content, "utf8");
      const failure = await store
        .commitResearchArtifact(
          record.scope,
          artifactCandidate,
          artifactFingerprint,
        )
        .then(
          () => null,
          (error: unknown) => error as Error,
        );
      expect(failure, testCase.name).toBeInstanceOf(Error);
      expect(failure?.message, testCase.name).toContain("corrupt");
      expect(await fs.readFile(path, "utf8"), testCase.name).toBe(
        testCase.content,
      );
    }
  });

  it("validates run and terminal envelopes against the requested Run directory", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const runPath = join(stateRoot, "runs", runID, "run.json");
    const validRun = JSON.parse(await fs.readFile(runPath, "utf8")) as {
      scope: Record<string, unknown>;
    };
    const foreignRun = JSON.stringify({
      ...validRun,
      scope: { ...validRun.scope, runID: otherRunID },
    });
    await fs.writeFile(runPath, foreignRun, "utf8");
    await expect(store.readRun(runID)).rejects.toThrow("corrupt");
    await expect(store.start(record)).rejects.toThrow("corrupt");
    expect(await fs.readFile(runPath, "utf8")).toBe(foreignRun);
    await fs.writeFile(runPath, JSON.stringify(validRun), "utf8");

    const receipt = terminalReceipt();
    await store.complete(receipt);
    const terminalPath = join(stateRoot, "runs", runID, "terminal.json");
    const validTerminal = JSON.parse(
      await fs.readFile(terminalPath, "utf8"),
    ) as Record<string, unknown>;
    const foreignTerminal = JSON.stringify({
      ...validTerminal,
      runID: otherRunID,
    });
    await fs.writeFile(terminalPath, foreignTerminal, "utf8");
    await expect(store.readTerminal(runID)).rejects.toThrow("corrupt");
    expect(await fs.readFile(terminalPath, "utf8")).toBe(foreignTerminal);
  });

  it("propagates a fixed content-free failure for malformed persisted run JSON", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const runPath = join(runDirectory, "run.json");
    const malformed = `{"scope": {"objective": "${canary}", `;
    await fs.writeFile(runPath, malformed, "utf8");

    const failure = await store.start(record).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(LOCAL_JSON_MALFORMED_MESSAGE);
    expect(String(failure)).not.toContain(canary);
    expect(failure).not.toHaveProperty("cause");
    expect(await fs.readFile(runPath, "utf8")).toBe(malformed);
  });

  it("rejects symlinked and non-regular records without following or overwriting them", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });

    // A symlinked run.json whose target is even a valid equivalent record must
    // still be rejected without being followed.
    const target = join(stateRoot, "elsewhere-run.json");
    await fs.writeFile(target, JSON.stringify(record), "utf8");
    const runPath = join(runDirectory, "run.json");
    await fs.symlink(target, runPath);
    await expect(store.start(record)).rejects.toThrow("regular file");
    expect((await fs.lstat(runPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toMatchObject({
      startedAt: record.startedAt,
    });
    expect(
      (await fs.readdir(runDirectory)).filter((entry) =>
        entry.endsWith(".tmp"),
      ),
    ).toEqual([]);

    // Non-regular terminal target: reject without overwrite.
    await fs.unlink(runPath);
    await store.start(record);
    await fs.mkdir(join(runDirectory, "terminal.json"));
    await expect(store.complete(terminalReceipt())).rejects.toThrow(
      "regular file",
    );
    expect(
      await fs.readdir(join(runDirectory, "terminal.json")),
    ).toEqual([]);

    // A helper I/O failure on an artifact leaves no temporary file behind.
    await fs.mkdir(join(runDirectory, "artifacts"), { recursive: true, mode: 0o700 });
    await fs.mkdir(store.artifactPath(runID, artifactFingerprint));
    await expect(
      store.commitResearchArtifact(
        record.scope,
        artifactCandidate,
        artifactFingerprint,
      ),
    ).rejects.toThrow("regular file");
    expect(
      (await fs.readdir(join(runDirectory, "artifacts"))).filter((entry) =>
        entry.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("keeps owner-only modes for run, terminal, artifact, and no-action files", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    await store.complete(terminalReceipt());
    await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );
    await store.commitNoAction(
      record.scope,
      noActionCandidate,
      noActionFingerprint,
    );

    const files = [
      join(runID, "run.json"),
      join(runID, "terminal.json"),
      join(runID, "artifacts", `${artifactFingerprint}.json`),
      join(runID, "no-actions", `${noActionFingerprint}.json`),
    ];
    for (const file of files) {
      expect(
        (await fs.stat(join(stateRoot, "runs", file))).mode & 0o777,
        file,
      ).toBe(0o600);
    }
    const directories = [
      join(stateRoot, "runs"),
      join(stateRoot, "runs", runID),
      join(stateRoot, "runs", runID, "artifacts"),
      join(stateRoot, "runs", runID, "no-actions"),
    ];
    for (const directory of directories) {
      expect(
        (await fs.stat(directory)).mode & 0o777,
        directory,
      ).toBe(0o700);
    }
  });

  it("rejects success-shaped corrupt terminal receipts without changing on-disk bytes", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const terminalPath = join(stateRoot, "runs", runID, "terminal.json");
    const cases: Array<{
      name: string;
      receipt: AgentPublicResearchTerminalReceipt;
    }> = [
      {
        name: "artifact_created without its artifact ID or candidate fingerprint",
        receipt: terminalReceipt({
          artifactID: null,
          candidateFingerprint: null,
        }),
      },
      {
        name: "no_action with a competing artifact ID",
        receipt: terminalReceipt({
          status: "no_action",
          reasonCode: "NO_MATERIAL_CHANGE",
          artifactID: "44444444-4444-4444-8444-444444444444",
          noActionID: "55555555-5555-4555-8555-555555555555",
          candidateFingerprint: noActionFingerprint,
        }),
      },
      {
        name: "failed claiming a committed artifact ID",
        receipt: terminalReceipt({
          status: "failed",
          reasonCode: "PROVIDER_OR_COMMIT_FAILED",
        }),
      },
      {
        name: "quarantined claiming a no-action ID",
        receipt: terminalReceipt({
          status: "quarantined",
          reasonCode: "STRUCTURED_OUTPUT_INVALID",
          artifactID: null,
          noActionID: "55555555-5555-4555-8555-555555555555",
          candidateFingerprint: noActionFingerprint,
        }),
      },
    ];
    for (const testCase of cases) {
      const content = JSON.stringify(testCase.receipt);
      await fs.writeFile(terminalPath, content, "utf8");
      await expect(
        store.complete(testCase.receipt),
        testCase.name,
      ).rejects.toThrow("The persisted local terminal record is corrupt.");
      await expect(
        store.readTerminal(runID),
        testCase.name,
      ).rejects.toThrow("The persisted local terminal record is corrupt.");
      expect(await fs.readFile(terminalPath, "utf8"), testCase.name).toBe(
        content,
      );
    }

    // A corrupt existing terminal also rejects a VALID completion without any
    // overwrite or regenerated success.
    const corruptOnDisk = JSON.stringify(
      terminalReceipt({ artifactID: null, candidateFingerprint: null }),
    );
    await fs.writeFile(terminalPath, corruptOnDisk, "utf8");
    await expect(store.complete(terminalReceipt())).rejects.toThrow(
      "The persisted local terminal record is corrupt.",
    );
    expect(await fs.readFile(terminalPath, "utf8")).toBe(corruptOnDisk);
  });

  it("rejects corrupt nested candidate and checkpoint members without overwriting", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    await store.commitResearchArtifact(
      record.scope,
      artifactCandidate,
      artifactFingerprint,
    );
    const path = store.artifactPath(runID, artifactFingerprint);
    const valid = JSON.parse(await fs.readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    const firstSource = {
      resultID,
      url: "https://example.com/update",
      title: "Company update",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-08-30T00:00:00.000Z",
    };
    const cases: Array<{ name: string; content: string }> = [
      {
        name: "non-object claim member",
        content: JSON.stringify({
          ...valid,
          candidate: { ...artifactCandidate, claims: [null] },
        }),
      },
      {
        name: "claim source refs outside the digest contract",
        content: JSON.stringify({
          ...valid,
          candidate: {
            ...artifactCandidate,
            claims: [{ statement: "x", sourceRefs: ["not-a-digest"] }],
          },
        }),
      },
      {
        name: "source member with a non-canonical content hash",
        content: JSON.stringify({
          ...valid,
          candidate: {
            ...artifactCandidate,
            sources: [{ ...firstSource, contentHash: "A".repeat(64) }],
          },
        }),
      },
    ];
    for (const testCase of cases) {
      await fs.writeFile(path, testCase.content, "utf8");
      const failure = await store
        .commitResearchArtifact(
          record.scope,
          artifactCandidate,
          artifactFingerprint,
        )
        .then(
          () => null,
          (error: unknown) => error as Error,
        );
      expect(failure?.message, testCase.name).toBe(
        "The persisted local artifact record is corrupt.",
      );
      expect(await fs.readFile(path, "utf8"), testCase.name).toBe(
        testCase.content,
      );
    }

    // Checkpoint members are validated at deserialization as well.
    const checkpointPath = join(stateRoot, "runs", runID, "checkpoint.json");
    const corruptCheckpoint = JSON.stringify({
      searchResults: [null],
      fetchedPages: [],
      searchCalls: 1,
      fetchCalls: 0,
      toolCalls: 1,
      sequence: 1,
    });
    await fs.writeFile(checkpointPath, corruptCheckpoint, "utf8");
    await expect(store.loadCheckpoint(runID)).rejects.toThrow(
      "The persisted local checkpoint record is corrupt.",
    );
    expect(await fs.readFile(checkpointPath, "utf8")).toBe(corruptCheckpoint);
  });

  it("rejects non-canonical uppercase digests instead of forking candidate identities", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    await expect(
      store.commitResearchArtifact(
        record.scope,
        artifactCandidate,
        artifactFingerprint.toUpperCase(),
      ),
    ).rejects.toThrow("The artifact fingerprint is invalid.");
    await expect(
      store.commitNoAction(
        record.scope,
        noActionCandidate,
        noActionFingerprint.toUpperCase(),
      ),
    ).rejects.toThrow("The no-action fingerprint is invalid.");
  });
});

  it("rejects corrupt call counters and journal positions without rewriting evidence", async () => {
    const stateRoot = await makeStateRoot("talent-signal-store-");
    const store = new LocalResearchStore(stateRoot);
    await store.start(record);
    const path = join(stateRoot, "runs", runID, "checkpoint.json");
    const checkpoint = {"searchResults": [], "fetchedPages": [], "searchCalls": 0, "fetchCalls": 0, "toolCalls": 0, "sequence": 0};
    await store.saveCheckpoint(runID, checkpoint);
    await expect(store.loadCheckpoint(runID)).resolves.toEqual(checkpoint);
    for (const field of ["searchCalls", "fetchCalls", "toolCalls", "sequence"]) {
      for (const invalid of ["-1", "0.5", "1e309", "9007199254740992"]) {
        const bytes = JSON.stringify(checkpoint).replace(`"${field}":0`, `"${field}":${invalid}`);
        await fs.writeFile(path, bytes, "utf8");
        const failure = await store.loadCheckpoint(runID).then(() => null, (error: unknown) => error as Error);
        expect(failure?.message).toBe("The persisted local checkpoint record is corrupt.");
        expect(failure).not.toHaveProperty("cause");
        expect(await fs.readFile(path, "utf8")).toBe(bytes);
      }
    }
  });

  it.each(["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"])(
    "replays no-action evidence references accepted by the canonical UUID schema: %s",
    async (evidenceRef) => {
      const stateRoot = await makeStateRoot("talent-signal-store-");
      const store = new LocalResearchStore(stateRoot);
      await store.start(record);
      const candidate = { ...noActionCandidate, missingEvidenceRefs: [evidenceRef] };
      expect(PublicResearchNoActionOutputSchema.shape.missing_evidence_refs.safeParse(candidate.missingEvidenceRefs).success).toBe(true);
      const digest = fingerprint(candidate);
      const first = await store.commitNoAction(record.scope, candidate, digest);
      const path = store.noActionPath(runID, digest);
      const bytes = await fs.readFile(path, "utf8");
      const replay = await new LocalResearchStore(stateRoot).commitNoAction(record.scope, candidate, digest);
      expect(replay.noActionID).toBe(first.noActionID);
      expect(await fs.readFile(path, "utf8")).toBe(bytes);
    },
  );
