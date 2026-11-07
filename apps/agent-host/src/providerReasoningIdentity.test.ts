import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint, runPublicResearchAgent, runPersonResearchAgent } from "@talent-signal/agent";
import { runLocalResearchCommand } from "./cli.js";
import { runLocalPersonResearchImage } from "./personResearchCommand.js";
import { LocalResearchStore } from "./localResearchStore.js";
import { LocalPersonResearchStore } from "./localPersonResearchStore.js";

const known = (effort?: string) => ({ version: "agent-run-reasoning.v1", reasoning: effort ? { mode: "explicit", effort } : { mode: "omitted" } });
const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const imageHash = createHash("sha256").update(imageBytes).digest("hex");
const imageManifest = { artifactID: fingerprint({ kind: "image", mimeType: "image/png", contentHash: imageHash }),
  kind: "image", mimeType: "image/png", byteSize: imageBytes.length, contentHash: imageHash };
const unknown = { version: "agent-run-reasoning.v1", reasoning: { mode: "unknown" } };

for (const kind of ["public", "person"] as const) describe(`${kind} immutable provider reasoning admission`, () => {
  async function fixture(operation: (store: any, record: any, path: string) => Promise<void>) {
    const root = await fs.mkdtemp(join(tmpdir(), "provider-reasoning-"));
    const runID = randomUUID();
    const shared = { runID, objective: "Synthetic research", providerID: kind === "person" ? "tikhub" : "synthetic-search" };
    const scope = kind === "public" ? { ...shared, authorization: {
      purpose: "company_market_research", subjectKind: "company", accessMode: "domain_allowlist", allowedDomains: ["example.com"],
      queryAnchors: ["example"], maximumSearchCount: 1, maximumFetchCount: 1,
    } } : { ...shared, authorization: { purpose: "person_public_profile_research", accessMode: "visible_screenshot_identity_clues",
      allowedPlatforms: ["douyin"], maximumProviderCalls: 1, maximumResultsPerCall: 1 },
      inputArtifactManifest: [imageManifest] };
    const record = { scope, budget: { maxTurns: 2, maxToolCalls: 2, maxDurationMs: 5000, maxTaskTokens: 1000, maxEstimatedUsd: 1 },
      modelProviderID: "synthetic", model: "synthetic-model", sdkVersion: "synthetic.v1", startedAt: "2026-11-08T00:00:00.000Z" };
    const store = kind === "public" ? new LocalResearchStore(root) : new LocalPersonResearchStore(root);
    const path = join(root, kind === "public" ? "runs" : "person-runs", runID, "run.json");
    try { await operation(store, record, path); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  }

  it("persists fresh unknown explicitly and cannot admit that same unknown twice", async () => fixture(async (store, record, path) => {
    await store.start(record);
    expect(JSON.parse(await fs.readFile(path, "utf8")).providerConfiguration).toEqual(unknown);
    const original = await fs.readFile(path);
    await expect(store.start(record)).rejects.toThrow();
    expect(await fs.readFile(path)).toEqual(original);
  }));

  it("lets only one concurrent unknown publisher win", async () => fixture(async (store, record) => {
    const results = await Promise.allSettled([store.start(record), store.start(record)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  }));

  it("retains known intent and admits only the same immutable reasoning identity", async () => fixture(async (store, record, path) => {
    await store.start({ ...record, providerConfiguration: known() });
    expect((await store.readRun(record.scope.runID)).providerConfiguration).toEqual(known());
    await store.start({ ...record, providerConfiguration: known(), startedAt: "2026-11-08T01:00:00.000Z" });
    const original = await fs.readFile(path);
    for (const config of [known("high"), unknown, undefined]) {
      await expect(store.start({ ...record, providerConfiguration: config })).rejects.toThrow();
      expect(await fs.readFile(path)).toEqual(original);
    }
  }));

  it("keeps legacy metadata readable but refuses to invent a recovery configuration", async () => fixture(async (store, record, path) => {
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, JSON.stringify(record));
    expect(await store.readRun(record.scope.runID)).toMatchObject({ model: record.model });
    const original = await fs.readFile(path);
    for (const config of [known(), unknown, undefined]) {
      await expect(store.start({ ...record, providerConfiguration: config })).rejects.toThrow();
      expect(await fs.readFile(path)).toEqual(original);
    }
  }));

  it("denies changed reasoning before actual runner provider or gateway dispatch", async () => fixture(async (store, record, path) => {
    await store.start({ ...record, providerConfiguration: known() });
    const original = await fs.readFile(path);
    let modelCalls = 0, gatewayCalls = 0;
    const provider = { id: record.modelProviderID, model: record.model, sdkVersion: record.sdkVersion,
      runConfiguration: known("high"), inputCapabilities: { text: true, image: true, imageUnderstanding: true },
      async run() { modelCalls += 1; throw new Error("Unexpected model dispatch"); } };
    const gateway = new Proxy({}, { get() { return async () => { gatewayCalls += 1; throw new Error("Unexpected gateway dispatch"); }; } });
    const request = { scope: record.scope, budget: record.budget, provider, journal: store, gateway,
      providerInputParts: [{ ...imageManifest, dataBase64: imageBytes.toString("base64") }] } as any;
    await expect(kind === "public" ? runPublicResearchAgent(request) : runPersonResearchAgent(request)).rejects.toThrow();
    expect(modelCalls).toBe(0); expect(gatewayCalls).toBe(0);
    expect(await fs.readFile(path)).toEqual(original);
  }));

  it.each([false, true])("replays completed unknown/legacy configuration without constructing providers: legacy=%s", async legacy => fixture(async (store, record, path) => {
    let modelCalls = 0, dependencyReads = 0;
    const provider = { id: record.modelProviderID, model: record.model, sdkVersion: record.sdkVersion,
      inputCapabilities: { text: true, image: true, imageUnderstanding: true },
      async run() { modelCalls += 1; return { structuredOutput: { outcome: "no_action", reason_code: kind === "public" ? "NO_MATERIAL_CHANGE" : "NO_VISIBLE_IDENTITY_CLUE",
        reason: "Synthetic evidence supports no action.", missing_evidence_refs: [] }, inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] }; } };
    const gateway = { commitNoAction: store.commitNoAction.bind(store) };
    const request = { scope: record.scope, budget: record.budget, provider, journal: store, gateway,
      providerInputParts: [{ ...imageManifest, dataBase64: imageBytes.toString("base64") }] } as any;
    const completed = kind === "public" ? await runPublicResearchAgent(request) : await runPersonResearchAgent(request);
    expect(completed.status).toBe("no_action");
    if (legacy) { const old = JSON.parse(await fs.readFile(path, "utf8")); delete old.providerConfiguration; await fs.writeFile(path, JSON.stringify(old)); }
    const original = await fs.readFile(path);
    const dependencies = new Proxy({}, { get() { dependencyReads += 1; throw new Error("Completed replay must not construct a provider"); } });
    const replay = kind === "public" ? await runLocalResearchCommand(["research", "--objective", record.scope.objective,
      "--subject", "company", "--anchor", "Example", "--allow-domain", "example.com", "--max-search", "1", "--max-fetch", "1", "--run-id", record.scope.runID, "--state-dir", store.stateRoot],
      { TALENT_SIGNAL_AGENT_REASONING_EFFORT: "invalid-current-config" }, dependencies)
      : await runLocalPersonResearchImage({ bytes: imageBytes, objective: record.scope.objective,
        allowedPlatforms: ["douyin"], maximumProviderCalls: 1, maximumResultsPerCall: 1, runID: record.scope.runID, stateRoot: store.stateRoot },
        { TALENT_SIGNAL_AGENT_REASONING_EFFORT: "invalid-current-config" }, dependencies);
    expect(replay.replayedTerminal).toBe(true); expect(replay.receipt).toEqual(completed);
    expect(modelCalls).toBe(1); expect(dependencyReads).toBe(0); expect(await fs.readFile(path)).toEqual(original);
  }));

  it.each([null, { version: "other", reasoning: { mode: "omitted" } },
    { ...known(), extra: "private-data-must-not-escape" },
    { version: "agent-run-reasoning.v1", reasoning: { mode: "explicit", effort: "invalid" } },
    { version: "agent-run-reasoning.v1", reasoning: { mode: "omitted", effort: "high" } },
  ])("rejects malformed persisted and incoming descriptions without rewriting them %#", async config => fixture(async (store, record, path) => {
    await expect(store.start({ ...record, providerConfiguration: config })).rejects.toThrow();
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ ...record, providerConfiguration: config }));
    const original = await fs.readFile(path);
    await expect(store.readRun(record.scope.runID)).rejects.toThrow();
    expect(await fs.readFile(path)).toEqual(original);
  }));
});
