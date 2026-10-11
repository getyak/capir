import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ScriptedAgentProvider,
  fingerprint,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { runLocalResearchCommand } from "./cli.js";
import { LocalResearchGateway } from "./localResearchGateway.js";
import { LOCAL_JSON_MALFORMED_MESSAGE } from "./localResearchFiles.js";
import { LocalResearchStore } from "./localResearchStore.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
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
