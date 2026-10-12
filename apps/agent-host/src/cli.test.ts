import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ScriptedAgentProvider,
  fingerprint,
  type AgentPublicResearchTerminalReceipt,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { runLocalResearchCommand } from "./cli.js";
import { LocalResearchGateway } from "./localResearchGateway.js";
import { LOCAL_JSON_MALFORMED_MESSAGE } from "./localResearchFiles.js";
import {
  LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE,
  LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE,
  LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE,
} from "./localResearchJournal.js";
import { LocalResearchStore } from "./localResearchStore.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
  type ResearchWorkerHandle,
} from "./test/research-store-worker.mjs";
import type { AgentWebSearchProvider } from "./webSearchProviders.js";

const temporaryDirectories: string[] = [];

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

describe("local Agent host CLI", () => {
  it("persists a cited draft locally without a backend", async () => {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-agent-"));
    temporaryDirectories.push(stateRoot);
    const runID = "33333333-3333-4333-8333-333333333333";
    const resultID = fingerprint({
      runID,
      providerID: "synthetic-search",
      url: "https://example.com/update",
    });
    const searchProvider: AgentWebSearchProvider = {
      id: "synthetic-search",
      async search() {
        return [
          {
            url: "https://example.com/update",
            title: "Company update",
            snippet: "A public update.",
            publishedAt: null,
            providerID: "synthetic-search",
          },
        ];
      },
    };
    const modelProvider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: {
            query: "Example Company public update",
            maximum_results: 5,
            recency_days: 30,
          },
        },
        { tool: "fetch_web", input: { result_id: resultID } },
        {
          tool: "create_research_artifact",
          input: {
            title: "Company update",
            summary: "The company published an update.",
            limitations: "One public source was fetched.",
            claims: [
              {
                statement: "The company published an update.",
                source_refs: [resultID],
              },
            ],
          },
        },
      ],
      (toolResults) => ({
        outcome: "artifact",
        candidate_fingerprint: toolResults.at(-1)?.candidateFingerprint,
      }),
    );
    const store = new LocalResearchStore(stateRoot);
    const gateway = new LocalResearchGateway(searchProvider, store, {
      fetchPage: async (_scope, discovered) => ({
        canonicalUrl: discovered.url,
        title: discovered.title,
        text: "The company published an update.",
        contentHash: "a".repeat(64),
        retrievedAt: "2026-08-30T00:00:00.000Z",
        providerID: discovered.providerID,
      }),
    });

    const result = await runLocalResearchCommand(
      [
        "research",
        "--",
        "--objective",
        "Research Example Company's public update.",
        "--subject",
        "company",
        "--allow-domain",
        "example.com",
        "--anchor",
        "Example Company",
        "--run-id",
        runID,
        "--state-dir",
        stateRoot,
      ],
      {},
      { modelProvider, searchProvider, gateway },
    );

    expect(result.receipt.status).toBe("artifact_created");
    expect(result.artifactFile).not.toBeNull();
    const artifact = JSON.parse(
      await fs.readFile(result.artifactFile!, "utf8"),
    ) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      status: "draft",
      publicationAuthority: "none",
      runID,
    });
    await expect(fs.access(join(stateRoot, "runs", runID, "terminal.json"))).resolves.toBeUndefined();

    const replay = await runLocalResearchCommand(
      [
        "research",
        "--objective",
        "Research Example Company's public update.",
        "--subject",
        "company",
        "--allow-domain",
        "example.com",
        "--anchor",
        "Example Company",
        "--run-id",
        runID,
        "--state-dir",
        stateRoot,
      ],
      {},
      { modelProvider, searchProvider, gateway },
    );
    expect(replay.replayedTerminal).toBe(true);
    expect(replay.receipt).toEqual(result.receipt);

    await expect(
      runLocalResearchCommand(
        [
          "research",
          "--objective",
          "A different objective.",
          "--subject",
          "company",
          "--allow-domain",
          "example.com",
          "--anchor",
          "Example Company",
          "--run-id",
          runID,
          "--state-dir",
          stateRoot,
        ],
        {},
        { modelProvider, searchProvider, gateway },
      ),
    ).rejects.toThrow("different objective or authorization");
  });

  it("requires an explicit open-web or domain authorization", async () => {
    await expect(
      runLocalResearchCommand([
        "research",
        "--objective",
        "Research a market.",
        "--subject",
        "market",
        "--anchor",
        "Example market",
      ]),
    ).rejects.toThrow("Choose exactly one");
  });
});

describe("local Agent host CLI cross-process admission", () => {
  const runID = "66666666-6666-4666-8666-666666666666";

  async function makeStateRoot() {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-cli-"));
    temporaryDirectories.push(stateRoot);
    return stateRoot;
  }

  it("invokes the provider once for a held Run and rejects the busy duplicate", async () => {
    const stateRoot = await makeStateRoot();
    const holder = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: true,
    });
    await holder.waitFor("ready");
    holder.send("go");
    // The holder is mid-Run (provider invoked, admission held).
    await holder.waitFor("provider-invoked");

    const duplicate = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
    });
    await duplicate.waitFor("ready");
    duplicate.send("go");
    const duplicateResult = await duplicate.result;
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.errorName).toBe("LocalRunAdmissionBusyError");
    expect(duplicateResult.error).toContain("already being executed");
    // Rejected before any provider construction or call.
    expect(
      duplicate.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);

    holder.send("finish");
    const heldResult = await holder.result;
    expect(heldResult).toMatchObject({
      ok: true,
      status: "artifact_created",
      replayedTerminal: false,
    });
    expect(
      holder.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(1);
  });

  it("replays a completed Run in a fresh process without any provider call", async () => {
    const stateRoot = await makeStateRoot();
    const first = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
    });
    await first.waitFor("ready");
    first.send("go");
    await expect(first.result).resolves.toMatchObject({
      ok: true,
      status: "artifact_created",
      replayedTerminal: false,
    });

    const replay = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
    });
    await replay.waitFor("ready");
    replay.send("go");
    await expect(replay.result).resolves.toMatchObject({
      ok: true,
      status: "artifact_created",
      replayedTerminal: true,
    });
    expect(
      replay.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
  });

  it("logs only a fixed content-free message for malformed persisted state", async () => {
    const stateRoot = await makeStateRoot();
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const terminalPath = join(runDirectory, "terminal.json");
    const malformed = `{"runID": "${runID}", "status": "${canary}", `;
    await fs.writeFile(terminalPath, malformed, "utf8");

    const cliPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "dist",
      "cli.js",
    );
    const executed = spawnSync(
      process.execPath,
      [
        cliPath,
        "research",
        "--objective",
        "Research Example Company's public update.",
        "--subject",
        "company",
        "--allow-domain",
        "example.com",
        "--anchor",
        "Example Company",
        "--run-id",
        runID,
        "--state-dir",
        stateRoot,
      ],
      { encoding: "utf8" },
    );
    expect(executed.status).toBe(1);
    expect(executed.stderr).toContain(LOCAL_JSON_MALFORMED_MESSAGE);
    expect(executed.stderr).not.toContain(canary);
    expect(executed.stdout).not.toContain(canary);
    expect(await fs.readFile(terminalPath, "utf8")).toBe(malformed);
  });
});

describe("local Agent host CLI interrupted journal publication", () => {
  async function makeStateRoot() {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-cli-"));
    temporaryDirectories.push(stateRoot);
    return stateRoot;
  }

  async function readJson(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
  }

  async function readEvents(
    path: string,
  ): Promise<Array<{ sequence: number; kind: string }>> {
    try {
      const text = await fs.readFile(path, "utf8");
      return text
        .split("\n")
        .filter((line) => line.length > 0)
        .map(
          (line) =>
            JSON.parse(line) as { sequence: number; kind: string },
        );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  async function killAndAwait(handle: ResearchWorkerHandle) {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
    const exited = new Promise((done) => handle.child.once("exit", done));
    handle.kill("SIGKILL");
    await exited;
  }

  it("fails closed when a durable result checkpoint has no journal event instead of resuming with a gap", async () => {
    const stateRoot = await makeStateRoot();
    const runID = "67676767-6767-4767-8767-676767676767";
    const holder = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "search",
      holdJournalAppendKind: "tool_call",
      holdJournalAppendUntil: "kill",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await holder.waitFor("ready");
    holder.send("go");
    const held = await holder.waitFor("journal-append-held");
    expect(held).toMatchObject({ kind: "tool_call", sequence: 1 });
    // The result checkpoint is durable and claims journal event 1 while the
    // append-only journal still holds no record at all.
    const runDirectory = join(stateRoot, "runs", runID);
    await expect(
      readJson(join(runDirectory, "checkpoint.json")),
    ).resolves.toMatchObject({ sequence: 1, searchCalls: 1, toolCalls: 1 });
    expect(await readEvents(join(runDirectory, "events.jsonl"))).toEqual([]);
    await killAndAwait(holder);

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
    const result = await replay.result;
    // A clear fixed failure instead of success with a gapped journal like [2,3].
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE);
    expect(result).not.toHaveProperty("receipt");
    // Zero additional provider or gateway work in the recovering process.
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    expect(
      replay.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
    // No missing history is synthesized by the failed attempt.
    expect(await readEvents(join(runDirectory, "events.jsonl"))).toEqual([]);
  });

  it("fails closed when a durable terminal receipt has no terminal event instead of replaying it", async () => {
    const stateRoot = await makeStateRoot();
    const runID = "68686868-6868-4868-8868-686868686868";
    const holder = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "artifact",
      holdJournalAppendKind: "terminal",
      holdJournalAppendUntil: "kill",
    });
    await holder.waitFor("ready");
    holder.send("go");
    const held = await holder.waitFor("journal-append-held");
    expect(held).toMatchObject({ kind: "terminal" });
    // The terminal receipt is durable while its terminal event is not.
    const runDirectory = join(stateRoot, "runs", runID);
    await expect(
      fs.access(join(runDirectory, "terminal.json")),
    ).resolves.toBeUndefined();
    await killAndAwait(holder);

    const replay = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "artifact",
    });
    await replay.waitFor("ready");
    replay.send("go");
    const result = await replay.result;
    // The unaudited receipt is never returned as successful replay.
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
    expect(result).not.toHaveProperty("receipt");
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    expect(
      replay.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
    // No terminal event is invented over the interrupted publication.
    const journal = await readEvents(join(runDirectory, "events.jsonl"));
    expect(
      journal.filter((event) => event.kind === "terminal"),
    ).toHaveLength(0);
  });
});

describe("local Agent host CLI orphaned Run evidence", () => {
  async function makeStateRoot() {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-cli-"));
    temporaryDirectories.push(stateRoot);
    return stateRoot;
  }

  function noActionReceipt(runID: string): AgentPublicResearchTerminalReceipt {
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
        toolCalls: 1,
        durationMs: 100,
      },
      permissionDenials: [],
      providerSessionID: null,
      completedAt: "2026-08-30T00:02:00.000Z",
    };
  }

  it("fails closed on orphaned reserved evidence instead of attaching it to a changed objective", async () => {
    const stateRoot = await makeStateRoot();
    const runID = "69696969-6969-4669-8669-696969696969";
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    // Valid reservation checkpoint at sequence 0 with consumed allowance and
    // no run.json: the confirmed orphaned-metadata state.
    const checkpointBytes = `${JSON.stringify(
      {
        searchResults: [],
        fetchedPages: [],
        searchCalls: 1,
        fetchCalls: 0,
        toolCalls: 1,
        sequence: 0,
      },
      null,
      2,
    )}\n`;
    const checkpointPath = join(runDirectory, "checkpoint.json");
    await fs.writeFile(checkpointPath, checkpointBytes, "utf8");

    const attempt = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "search",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await attempt.waitFor("ready");
    attempt.send("go");
    const result = await attempt.result;
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE);
    expect(result).not.toHaveProperty("receipt");
    // Zero additional provider or gateway work before the fixed failure.
    expect(
      attempt.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
    expect(
      attempt.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    // The orphaned evidence keeps its bytes and gains no replacement run.json
    // that would attach it to a new objective or authorization.
    expect(await fs.readFile(checkpointPath, "utf8")).toBe(checkpointBytes);
    await expect(fs.access(join(runDirectory, "run.json"))).rejects.toThrow();
  });

  it("fails closed on orphaned terminal evidence instead of replaying it under new metadata", async () => {
    const stateRoot = await makeStateRoot();
    const runID = "6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a";
    const runDirectory = join(stateRoot, "runs", runID);
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const receipt = noActionReceipt(runID);
    const terminalBytes = `${JSON.stringify(receipt, null, 2)}\n`;
    const eventBytes = `${JSON.stringify({
      runID,
      sequence: 1,
      kind: "terminal",
      occurredAt: receipt.completedAt,
      status: receipt.status,
      outputFingerprint: fingerprint(receipt),
      metadata: { reason_code: receipt.reasonCode, external_effect_count: 0 },
    })}\n`;
    const terminalPath = join(runDirectory, "terminal.json");
    const eventsPath = join(runDirectory, "events.jsonl");
    await fs.writeFile(terminalPath, terminalBytes, "utf8");
    await fs.writeFile(eventsPath, eventBytes, "utf8");

    const attempt = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID,
      holdProvider: false,
      plan: "artifact",
    });
    await attempt.waitFor("ready");
    attempt.send("go");
    const result = await attempt.result;
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE);
    expect(result).not.toHaveProperty("receipt");
    expect(
      attempt.log.filter((event) => event.event === "provider-invoked"),
    ).toHaveLength(0);
    expect(
      attempt.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    // The complete-looking evidence is never replayed without its original
    // immutable metadata and never rewritten.
    expect(await fs.readFile(terminalPath, "utf8")).toBe(terminalBytes);
    expect(await fs.readFile(eventsPath, "utf8")).toBe(eventBytes);
    await expect(fs.access(join(runDirectory, "run.json"))).rejects.toThrow();
  });
});
