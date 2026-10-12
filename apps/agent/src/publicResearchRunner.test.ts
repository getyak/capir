import { describe, expect, it } from "vitest";

import { fingerprint } from "./fingerprint.js";
import {
  AgentPublicResearchPolicyError,
  assertPublicResearchAuthorization,
  assertPublicResearchQuery,
} from "./publicResearchPolicy.js";
import { ResearchToolBlockedError } from "./researchToolExecution.js";
import { runPublicResearchAgent } from "./publicResearchRunner.js";
import { DEFAULT_AGENT_BUDGET } from "./runner.js";
import { ScriptedAgentProvider } from "./scriptedProvider.js";
import type {
  AgentJournalEvent,
  AgentJournalOutput,
  AgentPublicResearchNoActionCandidate,
  AgentPublicResearchCheckpoint,
  AgentPublicResearchGateway,
  AgentPublicResearchJournal,
  AgentPublicResearchScope,
  AgentPublicResearchTerminalReceipt,
  AgentProvider,
  AgentProviderResult,
  AgentResearchArtifactCandidate,
  AgentToolResult,
} from "./types.js";

const scope: AgentPublicResearchScope = {
  runID: "33333333-3333-4333-8333-333333333333",
  objective: "Research Example Company's public market update.",
  providerID: "synthetic-search",
  authorization: {
    purpose: "company_market_research",
    subjectKind: "company",
    accessMode: "domain_allowlist",
    allowedDomains: ["example.com"],
    queryAnchors: ["Example Company"],
    maximumSearchCount: 2,
    maximumFetchCount: 2,
  },
};

class MemoryResearchHost
  implements AgentPublicResearchGateway, AgentPublicResearchJournal
{
  checkpoint: AgentPublicResearchCheckpoint | null = null;
  readonly checkpointHistory: AgentPublicResearchCheckpoint[] = [];
  readonly events: AgentJournalEvent[] = [];
  readonly outputs: AgentJournalOutput[] = [];
  readonly artifacts: AgentResearchArtifactCandidate[] = [];
  terminal: AgentPublicResearchTerminalReceipt | null = null;
  searchDispatches = 0;
  fetchDispatches = 0;
  readonly searchDispatchCheckpoints: (AgentPublicResearchCheckpoint | null)[] = [];
  readonly fetchDispatchCheckpoints: (AgentPublicResearchCheckpoint | null)[] = [];
  /** Fails the nth saveCheckpoint call (1-based); null keeps every write. */
  failSaveCall: number | null = null;
  /** Holds the first synthetic search dispatch until the promise resolves. */
  holdFirstSearchDispatch: Promise<void> | null = null;
  onSearchDispatch: (() => void) | null = null;
  private saveCalls = 0;

  async start() {}

  async loadCheckpoint() {
    return this.checkpoint;
  }

  async saveCheckpoint(_runID: string, value: AgentPublicResearchCheckpoint) {
    this.saveCalls += 1;
    if (this.failSaveCall !== null && this.saveCalls === this.failSaveCall) {
      throw new Error("Synthetic checkpoint write failure.");
    }
    this.checkpoint = structuredClone(value);
    this.checkpointHistory.push(structuredClone(value));
  }

  async append(event: AgentJournalEvent) {
    this.events.push(event);
  }

  async recordOutput(output: AgentJournalOutput) {
    this.outputs.push(output);
  }

  async complete(receipt: AgentPublicResearchTerminalReceipt) {
    this.terminal = receipt;
    return receipt;
  }

  async searchWeb() {
    this.searchDispatches += 1;
    this.searchDispatchCheckpoints.push(
      this.checkpoint ? structuredClone(this.checkpoint) : null,
    );
    this.onSearchDispatch?.();
    if (this.holdFirstSearchDispatch && this.searchDispatches === 1) {
      await this.holdFirstSearchDispatch;
    }
    return [
      {
        url: "https://example.com/market-update",
        title: "Market update",
        snippet: "A public company update.",
        publishedAt: "2026-08-29T00:00:00.000Z",
        providerID: "synthetic-search",
      },
    ];
  }

  async fetchWeb(
    _runScope: AgentPublicResearchScope,
    result: { url: string; title: string; providerID: string },
  ) {
    this.fetchDispatches += 1;
    this.fetchDispatchCheckpoints.push(
      this.checkpoint ? structuredClone(this.checkpoint) : null,
    );
    return {
      canonicalUrl: result.url,
      title: result.title,
      text: "The company published a public market update.",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-08-30T00:00:00.000Z",
      providerID: result.providerID,
    };
  }

  async commitResearchArtifact(
    _runScope: AgentPublicResearchScope,
    candidate: AgentResearchArtifactCandidate,
  ) {
    this.artifacts.push(candidate);
    return {
      artifactID: "44444444-4444-4444-8444-444444444444",
      status: "draft" as const,
      replayed: false,
    };
  }

  async commitNoAction(
    _runScope: AgentPublicResearchScope,
    _candidate: AgentPublicResearchNoActionCandidate,
  ) {
    return {
      noActionID: "55555555-5555-4555-8555-555555555555",
      replayed: false,
    };
  }
}

describe("local public-research Agent", () => {
  it("keeps unreported provider usage unknown after a transport failure", async () => {
    const host = new MemoryResearchHost();
    const provider = new ScriptedAgentProvider([], {});
    provider.run = async () => { throw new Error("Synthetic transport interruption"); };
    const receipt = await runPublicResearchAgent({scope,budget:{...DEFAULT_AGENT_BUDGET},provider,gateway:host,journal:host});
    expect(receipt.usage).toMatchObject({inputTokens:null,outputTokens:null,totalTokens:null,estimatedUsd:null,turns:null});
    expect(host.artifacts).toEqual([]);
  });
  it("searches, fetches, checkpoints, and creates a cited local draft", async () => {
    const host = new MemoryResearchHost();
    const resultID = fingerprint({
      runID: scope.runID,
      providerID: scope.providerID,
      url: "https://example.com/market-update",
    });
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: {
            query: "Example Company public market update",
            maximum_results: 5,
            recency_days: 30,
          },
        },
        { tool: "fetch_web", input: { result_id: resultID } },
        {
          tool: "create_research_artifact",
          input: {
            title: "Market update",
            summary: "The public source reports a market update.",
            limitations: "One source was available.",
            claims: [
              {
                statement: "The public source reports a market update.",
                source_refs: [resultID],
              },
            ],
          },
        },
      ],
      (results) => ({
        outcome: "artifact",
        candidate_fingerprint: results.at(-1)?.candidateFingerprint,
      }),
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("artifact_created");
    expect(receipt.artifactID).toBe("44444444-4444-4444-8444-444444444444");
    expect(host.checkpoint).toMatchObject({ searchCalls: 1, fetchCalls: 1 });
    expect(host.artifacts[0]?.sources[0]).toMatchObject({
      resultID,
      url: "https://example.com/market-update",
      contentHash: "a".repeat(64),
    });
    expect(host.artifacts[0]?.claims[0]).toEqual({
      statement: "The public source reports a market update.",
      sourceRefs: [resultID],
    });
  });

  it("restores same-run observations before accepting a fetch", async () => {
    const host = new MemoryResearchHost();
    const resultID = "b".repeat(64);
    host.checkpoint = {
      searchResults: [
        {
          resultID,
          url: "https://example.com/recovered",
          title: "Recovered result",
          snippet: "Recovered after a host restart.",
          publishedAt: null,
          providerID: scope.providerID,
        },
      ],
      fetchedPages: [],
      searchCalls: 1,
      fetchCalls: 0,
      toolCalls: 1,
      sequence: 1,
    };
    const provider = new ScriptedAgentProvider(
      [{ tool: "fetch_web", input: { result_id: resultID } }],
      {
        outcome: "no_action",
        reason_code: "NO_MATERIAL_CHANGE",
        reason: "The recovered page does not support a useful draft.",
        missing_evidence_refs: [],
      },
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("no_action");
    expect(host.checkpoint?.fetchCalls).toBe(1);
    expect(host.checkpoint?.fetchedPages[0]?.resultID).toBe(resultID);
  });

  it("fails closed for a result absent from the restored local run", async () => {
    const host = new MemoryResearchHost();
    const provider = new ScriptedAgentProvider(
      [{ tool: "fetch_web", input: { result_id: "b".repeat(64) } }],
      {
        outcome: "no_action",
        reason_code: "PUBLIC_RESEARCH_UNAVAILABLE",
        reason: "The source was not discovered in this run.",
        missing_evidence_refs: [],
      },
    );
    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("WEB_RESULT_OUT_OF_SCOPE");
  });

  it("quarantines a claim that cites a page not fetched in this run", async () => {
    const host = new MemoryResearchHost();
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "create_research_artifact",
          input: {
            title: "Unsupported draft",
            summary: "A claim lacks a fetched source.",
            limitations: "",
            claims: [
              {
                statement: "An unsupported claim.",
                source_refs: ["c".repeat(64)],
              },
            ],
          },
        },
      ],
      { outcome: "artifact", candidate_fingerprint: "d".repeat(64) },
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("ARTIFACT_SOURCE_NOT_FETCHED");
    expect(host.artifacts).toHaveLength(0);
  });

  it("rejects a Pursuit-only no_action reason in a research run", async () => {
    const host = new MemoryResearchHost();
    const provider = new ScriptedAgentProvider([], {
      outcome: "no_action",
      reason_code: "AMBIGUOUS_TIME",
      reason: "A relationship date was ambiguous.",
      missing_evidence_refs: [],
    });
    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("STRUCTURED_OUTPUT_INVALID");
  });

  it("rejects person/contact queries and implicit unrestricted access", () => {
    expect(() => assertPublicResearchQuery("candidate alice@example.com"))
      .toThrow(AgentPublicResearchPolicyError);
    expect(() =>
      assertPublicResearchQuery("Unrelated Company market update", scope.authorization),
    ).toThrow("explicitly authorized company or market anchor");
    expect(() =>
      assertPublicResearchAuthorization({
        ...scope.authorization,
        allowedDomains: [],
      }),
    ).toThrow("requires at least one explicit public domain");
    expect(() =>
      assertPublicResearchAuthorization({
        ...scope.authorization,
        accessMode: "open_web",
        allowedDomains: [],
      }),
    ).not.toThrow();
  });
});

describe("public research Run durability", () => {
  const marketResultID = fingerprint({
    runID: scope.runID,
    providerID: scope.providerID,
    url: "https://example.com/market-update",
  });
  const noActionOutput = {
    outcome: "no_action",
    reason_code: "NO_MATERIAL_CHANGE",
    reason: "The synthetic durable run produced no new draft.",
    missing_evidence_refs: [],
  } as const;

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function delay(ms: number) {
    return new Promise((done) => setTimeout(done, ms));
  }

  function searchInput(query: string) {
    return { query, maximum_results: 5, recency_days: 30 };
  }

  function providerResult(): AgentProviderResult {
    return {
      structuredOutput: noActionOutput,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
      turns: 1,
      permissionDenials: [],
    };
  }

  it("persists consumed search and fetch counters inside the gateway callback", async () => {
    const host = new MemoryResearchHost();
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: searchInput("Example Company public market update"),
        },
        { tool: "fetch_web", input: { result_id: marketResultID } },
      ],
      noActionOutput,
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("no_action");
    // The allowance is durable before any dispatch: the synthetic gateway
    // callback observes the already-incremented counters.
    expect(host.searchDispatchCheckpoints[0]).toMatchObject({
      searchCalls: 1,
      toolCalls: 1,
    });
    expect(host.fetchDispatchCheckpoints[0]).toMatchObject({
      searchCalls: 1,
      fetchCalls: 1,
      toolCalls: 2,
    });
    expect(host.checkpoint).toMatchObject({ searchCalls: 1, fetchCalls: 1 });
  });

  it("denies search and fetch after a restored consumed budget without dispatching", async () => {
    const host = new MemoryResearchHost();
    host.checkpoint = {
      searchResults: [
        {
          resultID: marketResultID,
          url: "https://example.com/market-update",
          title: "Market update",
          snippet: "A public company update.",
          publishedAt: null,
          providerID: scope.providerID,
        },
      ],
      fetchedPages: [],
      searchCalls: 2,
      fetchCalls: 2,
      toolCalls: 2,
      sequence: 2,
    };
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: searchInput("Example Company public market update"),
        },
        { tool: "fetch_web", input: { result_id: marketResultID } },
      ],
      noActionOutput,
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("MAX_WEB_SEARCH_CALLS_EXCEEDED");
    expect(receipt.permissionDenials).toEqual(
      expect.arrayContaining([
        "search_web:MAX_WEB_SEARCH_CALLS_EXCEEDED",
        "fetch_web:MAX_WEB_FETCH_CALLS_EXCEEDED",
      ]),
    );
    expect(host.searchDispatches).toBe(0);
    expect(host.fetchDispatches).toBe(0);
  });

  it("fails closed without a gateway dispatch when the pre-dispatch checkpoint write fails", async () => {
    const host = new MemoryResearchHost();
    host.failSaveCall = 1;
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: searchInput("Example Company public market update"),
        },
      ],
      noActionOutput,
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.reasonCode).toBe("PROVIDER_OR_COMMIT_FAILED");
    expect(host.searchDispatches).toBe(0);
  });

  it("serializes concurrent tool callbacks with contiguous journal sequences", async () => {
    const host = new MemoryResearchHost();
    const started = deferred();
    const release = deferred();
    const enqueued = deferred();
    host.holdFirstSearchDispatch = release.promise;
    host.onSearchDispatch = () => started.resolve();
    const settlements: PromiseSettledResult<AgentToolResult>[] = [];
    const provider: AgentProvider = {
      id: "concurrent-synthetic",
      model: "synthetic-concurrent-v1",
      sdkVersion: "concurrent-provider.v1",
      inputCapabilities: { text: true, image: false, imageUnderstanding: false },
      async run(_request, invokeTool) {
        const first = invokeTool(
          "search_web",
          searchInput("Example Company first update"),
        );
        const second = invokeTool(
          "search_web",
          searchInput("Example Company second update"),
        );
        enqueued.resolve();
        settlements.push(...(await Promise.allSettled([first, second])));
        return providerResult();
      },
    };

    const run = runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });
    run.catch(() => {});
    try {
      await started.promise;
      await enqueued.promise;
      // Both callbacks are live; a broken serializer would dispatch the second
      // gateway call while the first is still held.
      await delay(100);
      expect(host.searchDispatches).toBe(1);
    } finally {
      release.resolve();
    }
    const receipt = await run;

    expect(receipt.status).toBe("no_action");
    expect(settlements.every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(host.searchDispatches).toBe(2);
    expect(
      host.searchDispatchCheckpoints.map((entry) => entry?.searchCalls),
    ).toEqual([1, 2]);
    expect(host.checkpoint?.searchCalls).toBe(2);
    expect(host.checkpoint?.toolCalls).toBe(2);
    for (const values of [
      host.checkpointHistory.map((entry) => entry.searchCalls),
      host.checkpointHistory.map((entry) => entry.toolCalls),
    ]) {
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
    expect(host.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(host.events.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_call",
      "provider_result",
      "terminal",
    ]);
  });

  it("blocks the queued execution after a fatal checkpoint write failure", async () => {
    const host = new MemoryResearchHost();
    // Call 1 is the first tool's pre-dispatch save; call 2 is its result save.
    host.failSaveCall = 2;
    const enqueued = deferred();
    const settlements: PromiseSettledResult<AgentToolResult>[] = [];
    const provider: AgentProvider = {
      id: "concurrent-synthetic",
      model: "synthetic-concurrent-v1",
      sdkVersion: "concurrent-provider.v1",
      inputCapabilities: { text: true, image: false, imageUnderstanding: false },
      async run(_request, invokeTool) {
        const first = invokeTool(
          "search_web",
          searchInput("Example Company first update"),
        );
        const second = invokeTool(
          "search_web",
          searchInput("Example Company second update"),
        );
        enqueued.resolve();
        settlements.push(...(await Promise.allSettled([first, second])));
        return providerResult();
      },
    };

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.reasonCode).toBe("PROVIDER_OR_COMMIT_FAILED");
    // The fatal write rejected the first execution; the queued sibling was
    // blocked and never reached its gateway.
    expect(host.searchDispatches).toBe(1);
    const blocked = settlements[1];
    expect(blocked?.status).toBe("rejected");
    if (blocked?.status === "rejected") {
      expect(blocked.reason).toBeInstanceOf(ResearchToolBlockedError);
    }
    // Terminal settlement ran only after every tool promise settled.
    expect(host.events.map((event) => event.kind)).toEqual(["terminal"]);
    expect(host.terminal?.status).toBe("failed");
  });

  it("checks aborted queued work at actual execution and dispatches no second gateway", async () => {
    const host = new MemoryResearchHost();
    const started = deferred();
    const release = deferred();
    host.holdFirstSearchDispatch = release.promise;
    host.onSearchDispatch = () => started.resolve();
    const settlements: PromiseSettledResult<AgentToolResult>[] = [];
    const queuedController = new AbortController();
    const provider: AgentProvider = {
      id: "concurrent-synthetic",
      model: "synthetic-concurrent-v1",
      sdkVersion: "concurrent-provider.v1",
      inputCapabilities: { text: true, image: false, imageUnderstanding: false },
      async run(_request, invokeTool) {
        const first = invokeTool(
          "search_web",
          searchInput("Example Company first update"),
        );
        await started.promise;
        const second = invokeTool(
          "search_web",
          searchInput("Example Company second update"),
          queuedController.signal,
        );
        // The second execution is queued behind the held first execution when
        // its own execution signal is aborted.
        queuedController.abort();
        release.resolve();
        settlements.push(...(await Promise.allSettled([first, second])));
        return providerResult();
      },
    };

    const run = runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });
    run.catch(() => {});
    const receipt = await run;

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("RUN_CANCELLED");
    expect(receipt.permissionDenials).toContain("search_web:RUN_CANCELLED");
    expect(host.searchDispatches).toBe(1);
    const second = settlements[1];
    expect(second?.status).toBe("fulfilled");
    if (second?.status === "fulfilled") {
      expect(second.value.ok).toBe(false);
      expect(second.value.error?.code).toBe("RUN_CANCELLED");
    }
    expect(host.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(host.events.map((event) => event.kind)).toEqual([
      "tool_call",
      "tool_call",
      "provider_result",
      "terminal",
    ]);
    expect(host.events[1]?.metadata.error_code).toBe("RUN_CANCELLED");
    expect(host.events.at(-1)?.kind).toBe("terminal");
  });

  it("returns only the fixed generic fallback to the model tool callback for untyped gateway failures", async () => {
    const host = new MemoryResearchHost();
    host.searchWeb = async () => {
      host.searchDispatches += 1;
      throw Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
        name: "SECRET_NAME_CANARY",
        stack: "Error: SECRET_STACK_CANARY\n    at SECRET_FRAME_CANARY",
        cause: new Error("SECRET_CAUSE_CANARY"),
      });
    };
    let toolResults: readonly AgentToolResult[] = [];
    const provider = new ScriptedAgentProvider(
      [
        {
          tool: "search_web",
          input: searchInput("Example Company public market update"),
        },
      ],
      (results) => {
        toolResults = results;
        return noActionOutput;
      },
    );

    const receipt = await runPublicResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
    });

    expect(toolResults[0]).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_INPUT_INVALID",
        message:
          "The tool input is invalid. Repair the call against the declared tool schema and retry.",
      },
    });
    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("TOOL_INPUT_INVALID");
    expect(host.searchDispatches).toBe(1);
    // The possibly dispatched operation stays conservatively consumed.
    expect(host.checkpoint).toMatchObject({ searchCalls: 1 });
    // No message, name, stack, or cause canary may reach the model tool result,
    // the terminal receipt, or any durable journal state, and the journal keeps
    // its bounded content-free behavior: not even the generic tool error text
    // is retained there by default.
    const serialized = JSON.stringify({
      toolResults,
      receipt,
      events: host.events,
      outputs: host.outputs,
      terminal: host.terminal,
    });
    for (const canary of [
      "SECRET_MESSAGE_CANARY",
      "SECRET_NAME_CANARY",
      "SECRET_STACK_CANARY",
      "SECRET_FRAME_CANARY",
      "SECRET_CAUSE_CANARY",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(JSON.stringify({ events: host.events, outputs: host.outputs })).not.toContain(
      "Repair the call against the declared tool schema",
    );
  });
});
