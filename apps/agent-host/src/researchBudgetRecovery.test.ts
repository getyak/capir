import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
  type ResearchWorkerHandle,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];
const researchRunID = "77777777-7777-4777-8777-777777777777";
const personRunID = "88888888-8888-4888-8888-888888888888";

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
  const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-budget-"));
  temporaryDirectories.push(stateRoot);
  return stateRoot;
}

function researchPaths(stateRoot: string, runID: string) {
  const runDirectory = join(stateRoot, "runs", runID);
  return {
    checkpoint: join(runDirectory, "checkpoint.json"),
    events: join(runDirectory, "events.jsonl"),
  };
}

function personPaths(stateRoot: string, runID: string) {
  const runDirectory = join(stateRoot, "person-runs", runID);
  return {
    checkpoint: join(runDirectory, "checkpoint.json"),
    events: join(runDirectory, "events.jsonl"),
  };
}

interface PersistedEvent {
  sequence: number;
  kind: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readEvents(path: string): Promise<PersistedEvent[]> {
  const text = await fs.readFile(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PersistedEvent);
}

async function killAndAwait(handle: ResearchWorkerHandle) {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  const exited = new Promise((done) => handle.child.once("exit", done));
  handle.kill("SIGKILL");
  await exited;
}

it("waits for the real build lock before trusting a fresh entry", async () => {
  const root = await makeStateRoot();
  const hostRoot = join(root, "apps", "agent-host");
  const testRoot = join(hostRoot, "src", "test");
  const dist = join(hostRoot, "dist");
  for (const directory of [testRoot, dist, join(root, "apps", "agent", "src"), join(root, "packages", "contracts", "src")]) {
    await fs.mkdir(directory, { recursive: true });
  }
  const fixture = join(testRoot, "research-store-worker.mjs");
  await fs.copyFile(new URL("./test/research-store-worker.mjs", import.meta.url), fixture);
  await fs.writeFile(join(hostRoot, "src", "fresh.ts"), "export {};\n");
  const entry = join(dist, "localResearchStore.js");
  await fs.writeFile(entry, "export {};\n");
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(entry, future, future);
  const key = createHash("sha256").update(hostRoot).digest("hex").slice(0, 16);
  const lockPath = join(tmpdir(), `talent-signal-agent-host-build-${key}.sqlite`);
  const holder = new DatabaseSync(lockPath);
  holder.exec("BEGIN IMMEDIATE");
  let reportAttempt!: () => void;
  const attempted = new Promise<void>((done) => { reportAttempt = done; });
  const originalExec = DatabaseSync.prototype.exec;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "BEGIN IMMEDIATE") reportAttempt();
    return originalExec.call(this, sql);
  });
  let waiter: Promise<string> | undefined;
  let released = false;
  let resolved = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const copied = await import(pathToFileURL(fixture).href);
    const waiting: Promise<string> = copied.ensureFreshHostBuild().then((path: string) => { resolved = true; return path; });
    waiter = waiting;
    const observed = await Promise.race([
      attempted.then(() => "lock_attempted"),
      waiting.then(() => "premature_return"),
      new Promise<string>((done) => { timer = setTimeout(() => done("timeout"), 5_000); }),
    ]);
    expect(observed).toBe("lock_attempted");
    expect(resolved).toBe(false);
    holder.exec("COMMIT");
    released = true;
    await expect(waiter).resolves.toBe(dist);
  } finally {
    if (timer) clearTimeout(timer);
    spy.mockRestore();
    if (!released) holder.exec("ROLLBACK");
    holder.close();
    await waiter;
    await fs.rm(lockPath, { force: true });
  }
});

describe("research interrupted-call allowance recovery", () => {
  it("consumes one authorized search call on disk before dispatch and denies the replay after process death", async () => {
    const stateRoot = await makeStateRoot();
    const holder = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search",
      holdGatewayOperation: "search",
      holdGatewayUntil: "kill",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await holder.waitFor("ready");
    holder.send("go");
    const dispatch = await holder.waitFor("gateway-dispatch");
    expect(dispatch.operation).toBe("search");
    // The dispatched call's allowance is durable while its dispatch is still
    // pending inside the process that is about to die.
    const { checkpoint, events } = researchPaths(stateRoot, researchRunID);
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      searchCalls: 1,
      fetchCalls: 0,
      toolCalls: 1,
    });
    await killAndAwait(holder);

    const replay = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await replay.waitFor("ready");
    replay.send("go");
    await expect(replay.result).resolves.toMatchObject({
      ok: true,
      status: "quarantined",
      reasonCode: "MAX_WEB_SEARCH_CALLS_EXCEEDED",
    });
    // The interrupted call is never refunded or replayed: no second provider
    // operation ran in the recovering process.
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    const journal = await readEvents(events);
    expect(journal.at(-1)?.kind).toBe("terminal");
  });

  it("persists one discovered result and recovers a fetch interruption with a fetch step", async () => {
    const stateRoot = await makeStateRoot();
    const holder = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search-fetch",
      holdGatewayOperation: "fetch",
      holdGatewayUntil: "kill",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await holder.waitFor("ready");
    holder.send("go");
    const searchDispatch = await holder.waitFor("gateway-dispatch");
    expect(searchDispatch.operation).toBe("search");
    const fetchDispatch = await holder.waitFor("gateway-dispatch");
    expect(fetchDispatch.operation).toBe("fetch");
    const { checkpoint } = researchPaths(stateRoot, researchRunID);
    const consumed = await readJson(checkpoint);
    expect(consumed).toMatchObject({
      searchCalls: 1,
      fetchCalls: 1,
      toolCalls: 2,
    });
    // The one discovered authorized result is durable before the fetch dies.
    expect(consumed.searchResults).toHaveLength(1);
    await killAndAwait(holder);

    // Recovery runs the interrupted fetch step, not an unrelated search.
    const replay = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "fetch",
      maximumSearchCount: 1,
      maximumFetchCount: 1,
    });
    await replay.waitFor("ready");
    replay.send("go");
    await expect(replay.result).resolves.toMatchObject({
      ok: true,
      status: "quarantined",
      reasonCode: "MAX_WEB_FETCH_CALLS_EXCEEDED",
    });
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
  });

  it("consumes one authorized profile call on disk before dispatch and denies the replay after process death", async () => {
    const stateRoot = await makeStateRoot();
    const holder = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID: personRunID,
      holdProvider: false,
      plan: "profile",
      holdGatewayOperation: "profiles",
      holdGatewayUntil: "kill",
      maximumProviderCalls: 1,
    });
    await holder.waitFor("ready");
    holder.send("go");
    const dispatch = await holder.waitFor("gateway-dispatch");
    expect(dispatch.operation).toBe("profiles");
    const { checkpoint, events } = personPaths(stateRoot, personRunID);
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      providerCalls: 1,
      toolCalls: 1,
    });
    await killAndAwait(holder);

    const replay = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID: personRunID,
      holdProvider: false,
      plan: "profile",
      maximumProviderCalls: 1,
    });
    await replay.waitFor("ready");
    replay.send("go");
    await expect(replay.result).resolves.toMatchObject({
      ok: true,
      status: "quarantined",
      reasonCode: "MAX_PERSON_PROFILE_CALLS_EXCEEDED",
    });
    expect(
      replay.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(0);
    const journal = await readEvents(events);
    expect(journal.at(-1)?.kind).toBe("terminal");
  });
});

describe("concurrent research tool serialization on real stores", () => {
  it("keeps concurrent public tool callbacks serialized with contiguous journal sequences", async () => {
    const stateRoot = await makeStateRoot();
    const worker = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search-pair",
      holdGatewayOperation: "search",
      holdGatewayUntil: "release",
      maximumSearchCount: 2,
      maximumFetchCount: 1,
    });
    await worker.waitFor("ready");
    worker.send("go");
    const first = await worker.waitFor("gateway-dispatch");
    expect(first.dispatch).toBe(0);
    await worker.waitFor("tools-enqueued");
    const { checkpoint, events } = researchPaths(stateRoot, researchRunID);
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      searchCalls: 1,
      toolCalls: 1,
    });
    // The second callback is live but must not reach its gateway while the
    // first execution is held at its dispatch barrier.
    await expect(worker.waitFor("gateway-dispatch", 1_000)).rejects.toThrow(
      /Timed out/,
    );
    worker.send("release");
    const second = await worker.waitFor("gateway-dispatch");
    expect(second.dispatch).toBe(1);
    await expect(worker.result).resolves.toMatchObject({
      ok: true,
      status: "no_action",
    });
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      searchCalls: 2,
      toolCalls: 2,
    });
    const journal = await readEvents(events);
    expect(journal.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(journal.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_call",
      "provider_result",
      "terminal",
    ]);
  });

  it("keeps concurrent person profile callbacks serialized with contiguous journal sequences", async () => {
    const stateRoot = await makeStateRoot();
    const worker = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID: personRunID,
      holdProvider: false,
      plan: "profile-pair",
      holdGatewayOperation: "profiles",
      holdGatewayUntil: "release",
      maximumProviderCalls: 2,
    });
    await worker.waitFor("ready");
    worker.send("go");
    const first = await worker.waitFor("gateway-dispatch");
    expect(first.dispatch).toBe(0);
    await worker.waitFor("tools-enqueued");
    const { checkpoint, events } = personPaths(stateRoot, personRunID);
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      providerCalls: 1,
      toolCalls: 1,
    });
    await expect(worker.waitFor("gateway-dispatch", 1_000)).rejects.toThrow(
      /Timed out/,
    );
    worker.send("release");
    const second = await worker.waitFor("gateway-dispatch");
    expect(second.dispatch).toBe(1);
    await expect(worker.result).resolves.toMatchObject({
      ok: true,
      status: "no_action",
    });
    await expect(readJson(checkpoint)).resolves.toMatchObject({
      providerCalls: 2,
      toolCalls: 2,
    });
    const journal = await readEvents(events);
    expect(journal.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(journal.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_call",
      "provider_result",
      "terminal",
    ]);
  });

  it("dispatches no later public gateway after a fatal checkpoint write failure", async () => {
    const stateRoot = await makeStateRoot();
    const worker = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search-pair",
      holdGatewayOperation: "search",
      holdGatewayUntil: "release",
      maximumSearchCount: 2,
      maximumFetchCount: 1,
    });
    await worker.waitFor("ready");
    worker.send("go");
    const first = await worker.waitFor("gateway-dispatch");
    expect(first.dispatch).toBe(0);
    await worker.waitFor("tools-enqueued");
    // Break the mutable checkpoint record while the first execution is held:
    // its result checkpoint write must fail fatally and block the queue.
    const { checkpoint, events } = researchPaths(stateRoot, researchRunID);
    await fs.rm(checkpoint, { force: true });
    await fs.mkdir(checkpoint);
    worker.send("release");
    await expect(worker.result).resolves.toMatchObject({
      ok: true,
      status: "failed",
      reasonCode: "PROVIDER_OR_COMMIT_FAILED",
    });
    expect(
      worker.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(1);
    const journal = await readEvents(events);
    // Terminal settlement happened after every tool promise settled and never
    // raced an in-flight tool write.
    expect(journal.at(-1)?.kind).toBe("terminal");
    expect(journal.filter((event) => event.kind === "tool_call")).toHaveLength(0);
  });

  it("dispatches no later person gateway after a fatal checkpoint write failure", async () => {
    const stateRoot = await makeStateRoot();
    const worker = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID: personRunID,
      holdProvider: false,
      plan: "profile-pair",
      holdGatewayOperation: "profiles",
      holdGatewayUntil: "release",
      maximumProviderCalls: 2,
    });
    await worker.waitFor("ready");
    worker.send("go");
    const first = await worker.waitFor("gateway-dispatch");
    expect(first.dispatch).toBe(0);
    await worker.waitFor("tools-enqueued");
    const { checkpoint } = personPaths(stateRoot, personRunID);
    await fs.rm(checkpoint, { force: true });
    await fs.mkdir(checkpoint);
    worker.send("release");
    // The terminal checkpoint write cannot complete either: the command fails
    // closed instead of reporting any success.
    const result = await worker.result;
    expect(result.ok).toBe(false);
    expect(
      worker.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(1);
  });

  it("cancels queued public work at execution without a second gateway dispatch", async () => {
    const stateRoot = await makeStateRoot();
    const worker = spawnResearchWorker({
      kind: "research-command",
      stateRoot,
      runID: researchRunID,
      holdProvider: false,
      plan: "search-pair",
      holdGatewayOperation: "search",
      holdGatewayUntil: "release",
      abortQueuedExecution: true,
      maximumSearchCount: 2,
      maximumFetchCount: 1,
    });
    await worker.waitFor("ready");
    worker.send("go");
    const first = await worker.waitFor("gateway-dispatch");
    expect(first.dispatch).toBe(0);
    await worker.waitFor("tools-enqueued");
    worker.send("release");
    await expect(worker.result).resolves.toMatchObject({
      ok: true,
      status: "quarantined",
      reasonCode: "RUN_CANCELLED",
    });
    expect(
      worker.log.filter((event) => event.event === "gateway-dispatch"),
    ).toHaveLength(1);
    const { events } = researchPaths(stateRoot, researchRunID);
    const journal = await readEvents(events);
    expect(journal.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(journal[1]).toMatchObject({
      kind: "tool_call",
      status: "denied",
      metadata: { error_code: "RUN_CANCELLED" },
    });
    expect(journal.at(-1)?.kind).toBe("terminal");
  });
});
