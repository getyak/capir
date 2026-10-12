import { describe, expect, it } from "vitest";

import { fingerprint } from "./fingerprint.js";
import {
  AgentPersonResearchPolicyError,
  assertPersonResearchAuthorization,
  assertPersonResearchQuery,
} from "./personResearchPolicy.js";
import { runPersonResearchAgent } from "./personResearchRunner.js";
import { ResearchToolBlockedError } from "./researchToolExecution.js";
import { DEFAULT_AGENT_BUDGET } from "./runner.js";
import { ScriptedAgentProvider, type ScriptedOutput } from "./scriptedProvider.js";
import type {
  AgentJournalEvent,
  AgentJournalOutput,
  AgentPersonResearchArtifactCandidate,
  AgentPersonResearchCheckpoint,
  AgentPersonResearchGateway,
  AgentPersonResearchJournal,
  AgentPersonResearchNoActionCandidate,
  AgentPersonResearchScope,
  AgentPersonResearchTerminalReceipt,
  AgentProvider,
  AgentProviderRequest,
  AgentProviderResult,
  AgentToolResult,
  AgentPublicProfileResult,
} from "./types.js";

const imageArtifact = {
  artifactID: "image-1",
  kind: "image" as const,
  mimeType: "image/png",
  byteSize: 128,
  contentHash: "a".repeat(64),
};

const scope: AgentPersonResearchScope = {
  runID: "66666666-6666-4666-8666-666666666666",
  objective: "Find possible public profiles from visible screenshot clues.",
  providerID: "tikhub",
  authorization: {
    purpose: "person_public_profile_research",
    accessMode: "visible_screenshot_identity_clues",
    allowedPlatforms: ["douyin", "tiktok", "weibo", "threads"],
    maximumProviderCalls: 2,
    maximumResultsPerCall: 5,
  },
  inputArtifactManifest: [imageArtifact],
};

const inputParts = [{ ...imageArtifact, dataBase64: "cG5n" }];

function visionProvider(
  steps: ConstructorParameters<typeof ScriptedAgentProvider>[0],
  output: ScriptedOutput,
  inspect?: (request: AgentProviderRequest) => void,
): AgentProvider {
  const scripted = new ScriptedAgentProvider(steps, output);
  return {
    id: scripted.id,
    model: "synthetic-vision-tool-model",
    sdkVersion: scripted.sdkVersion,
    inputCapabilities: {
      text: true,
      image: true,
      imageUnderstanding: true,
    },
    run: async (
      request: AgentProviderRequest,
      invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
      signal: AbortSignal,
    ): Promise<AgentProviderResult> => {
      inspect?.(request);
      return scripted.run(request, invokeTool, signal);
    },
  };
}

class MemoryPersonResearchHost
  implements AgentPersonResearchGateway, AgentPersonResearchJournal
{
  checkpoint: AgentPersonResearchCheckpoint | null = null;
  readonly checkpointHistory: AgentPersonResearchCheckpoint[] = [];
  readonly events: AgentJournalEvent[] = [];
  readonly outputs: AgentJournalOutput[] = [];
  readonly artifacts: AgentPersonResearchArtifactCandidate[] = [];
  readonly noActions: AgentPersonResearchNoActionCandidate[] = [];
  terminal: AgentPersonResearchTerminalReceipt | null = null;
  profileDispatches = 0;
  readonly profileDispatchCheckpoints: (AgentPersonResearchCheckpoint | null)[] = [];
  /** Fails the nth saveCheckpoint call (1-based); null keeps every write. */
  failSaveCall: number | null = null;
  /** Holds the first synthetic profile dispatch until the promise resolves. */
  holdFirstProfileDispatch: Promise<void> | null = null;
  onProfileDispatch: (() => void) | null = null;
  private saveCalls = 0;

  async start() {}

  async loadCheckpoint() {
    return this.checkpoint;
  }

  async saveCheckpoint(_runID: string, value: AgentPersonResearchCheckpoint) {
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

  async complete(receipt: AgentPersonResearchTerminalReceipt) {
    this.terminal = receipt;
    return receipt;
  }

  async searchProfiles(
    _runScope: AgentPersonResearchScope,
    input: { platform: AgentPublicProfileResult["platform"] },
  ) {
    this.profileDispatches += 1;
    this.profileDispatchCheckpoints.push(
      this.checkpoint ? structuredClone(this.checkpoint) : null,
    );
    this.onProfileDispatch?.();
    if (this.holdFirstProfileDispatch && this.profileDispatches === 1) {
      await this.holdFirstProfileDispatch;
    }
    return [
      {
        platform: input.platform,
        providerID: "tikhub",
        providerRequestID: "provider-request-1",
        profileID: "profile-42",
        displayName: "周宇",
        handle: "zhouyu",
        biography: "公开简介",
        profileUrl:
          input.platform === "douyin"
            ? "https://www.douyin.com/user/profile-42"
            : "https://www.tiktok.com/@zhouyu",
        avatarUrl: null,
        verified: null,
        contentHash: "b".repeat(64),
        retrievedAt: "2026-08-31T00:00:00.000Z",
      },
    ];
  }

  async commitPersonResearchArtifact(
    _runScope: AgentPersonResearchScope,
    candidate: AgentPersonResearchArtifactCandidate,
  ) {
    this.artifacts.push(candidate);
    return {
      artifactID: "77777777-7777-4777-8777-777777777777",
      status: "draft" as const,
      replayed: false,
    };
  }

  async commitNoAction(
    _runScope: AgentPersonResearchScope,
    candidate: AgentPersonResearchNoActionCandidate,
  ) {
    this.noActions.push(candidate);
    return {
      noActionID: "88888888-8888-4888-8888-888888888888",
      replayed: false,
    };
  }
}

function expectedResultID(platform: "douyin" | "tiktok") {
  return fingerprint({
    runID: scope.runID,
    providerID: scope.providerID,
    platform,
    profileID: "profile-42",
    profileUrl:
      platform === "douyin"
        ? "https://www.douyin.com/user/profile-42"
        : "https://www.tiktok.com/@zhouyu",
    contentHash: "b".repeat(64),
  });
}

function artifactStep(platform: "douyin" | "tiktok") {
  const resultID = expectedResultID(platform);
  return {
    tool: "create_person_research_artifact",
    input: {
      title: "可能的公开资料",
      summary: "截图中的可见账号线索与一个公开资料相符，但身份尚未确认。",
      limitations: "仅比较可见文字线索；未进行人脸识别，也未绑定人物。",
      identity_status: "possible_match",
      observed_clues: [
        {
          kind: "handle",
          value: "@zhouyu",
          source_artifact_id: imageArtifact.artifactID,
          observation_status: "unreviewed_screenshot_observation",
        },
      ],
      candidates: [
        {
          result_id: resultID,
          match_basis: "公开账号名与截图中可见的 @zhouyu 一致。",
        },
      ],
      claims: [
        {
          statement: "TikHub 返回的公开资料显示账号名为 zhouyu。",
          epistemic_status: "provider_observation",
          source_refs: [resultID],
        },
      ],
    },
  } as const;
}

describe("screenshot-driven person research Agent", () => {
  it("keeps unreported provider usage unknown after a transport failure", async () => {
    const host = new MemoryPersonResearchHost();
    const provider = visionProvider([], {});
    provider.run = async () => { throw new Error("Synthetic transport interruption"); };
    const receipt = await runPersonResearchAgent({scope,budget:{...DEFAULT_AGENT_BUDGET},provider,gateway:host,journal:host,providerInputParts:inputParts});
    expect(receipt.usage).toMatchObject({inputTokens:null,outputTokens:null,totalTokens:null,estimatedUsd:null,turns:null});
    expect(host.artifacts).toEqual([]);
  });
  it.each(["douyin", "tiktok"] as const)(
    "lets the vision Agent select the %s tool and creates a cited draft",
    async (platform) => {
      const host = new MemoryPersonResearchHost();
      const searchTool =
        platform === "douyin"
          ? "search_douyin_profiles"
          : "search_tiktok_profiles";
      const provider = visionProvider(
        [
          {
            tool: searchTool,
            input: {
              visible_identity_clue: "@zhouyu",
              source_artifact_id: imageArtifact.artifactID,
              maximum_results: 5,
            },
          },
          artifactStep(platform),
        ],
        (results) => ({
          outcome: "person_research_artifact",
          candidate_fingerprint: results.at(-1)?.candidateFingerprint,
        }),
        (request) => {
          expect(request.inputParts).toEqual(inputParts);
          expect(request.scopeSummary.kind).toBe(
            "person_public_profile_research",
          );
        },
      );

      const receipt = await runPersonResearchAgent({
        scope,
        budget: { ...DEFAULT_AGENT_BUDGET },
        provider,
        gateway: host,
        journal: host,
        providerInputParts: inputParts,
      });

      expect(receipt.status).toBe("artifact_created");
      expect(receipt.externalEffects).toEqual([]);
      expect(host.artifacts[0]).toMatchObject({
        identityStatus: "possible_match",
        sources: [{ resultID: expectedResultID(platform), platform }],
      });
      expect(host.artifacts[0]).not.toHaveProperty("confirmedIdentity");
      expect(host.checkpoint).toMatchObject({ providerCalls: 1, toolCalls: 2 });
    },
  );

  it("keeps same-name provider results ambiguous instead of selecting an identity", async () => {
    const host = new MemoryPersonResearchHost();
    host.searchProfiles = async (_runScope, input) =>
      ["profile-42", "profile-43"].map((profileID, index) => ({
        platform: input.platform,
        providerID: "tikhub",
        providerRequestID: "provider-request-ambiguous",
        profileID,
        displayName: "周宇",
        handle: index === 0 ? "zhouyu_one" : "zhouyu_two",
        biography: "公开简介",
        profileUrl: `https://www.douyin.com/user/${profileID}`,
        avatarUrl: null,
        verified: null,
        contentHash: index === 0 ? "c".repeat(64) : "d".repeat(64),
        retrievedAt: "2026-08-31T00:00:00.000Z",
      }));
    const resultIDs = [
      fingerprint({
        runID: scope.runID,
        providerID: scope.providerID,
        platform: "douyin",
        profileID: "profile-42",
        profileUrl: "https://www.douyin.com/user/profile-42",
        contentHash: "c".repeat(64),
      }),
      fingerprint({
        runID: scope.runID,
        providerID: scope.providerID,
        platform: "douyin",
        profileID: "profile-43",
        profileUrl: "https://www.douyin.com/user/profile-43",
        contentHash: "d".repeat(64),
      }),
    ];
    const provider = visionProvider(
      [
        {
          tool: "search_douyin_profiles",
          input: {
            visible_identity_clue: "周宇",
            source_artifact_id: imageArtifact.artifactID,
            maximum_results: 5,
          },
        },
        {
          tool: "create_person_research_artifact",
          input: {
            title: "多个可能的公开资料",
            summary: "同一可见姓名返回两个公开资料，无法安全区分。",
            limitations: "需要更多非生物特征身份线索；当前没有确认或绑定人物。",
            identity_status: "ambiguous",
            observed_clues: [
              {
                kind: "display_name",
                value: "周宇",
                source_artifact_id: imageArtifact.artifactID,
                observation_status: "unreviewed_screenshot_observation",
              },
            ],
            candidates: resultIDs.map((resultID) => ({
              result_id: resultID,
              match_basis: "公开资料显示与截图相同的姓名，但账号线索不同。",
            })),
            claims: resultIDs.map((resultID) => ({
              statement: "提供方返回一个同名公开资料。",
              epistemic_status: "provider_observation",
              source_refs: [resultID],
            })),
          },
        },
      ],
      (results) => ({
        outcome: "person_research_artifact",
        candidate_fingerprint: results.at(-1)?.candidateFingerprint,
      }),
    );

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("artifact_created");
    expect(host.artifacts[0]).toMatchObject({
      identityStatus: "ambiguous",
      candidates: [{ resultID: resultIDs[0] }, { resultID: resultIDs[1] }],
    });
  });

  it("records photo-only abstention without calling TikHub", async () => {
    const host = new MemoryPersonResearchHost();
    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider: visionProvider([], {
        outcome: "no_action",
        reason_code: "NO_VISIBLE_IDENTITY_CLUE",
        reason: "The screenshot contains no visible name, handle, profile URL, or platform clue.",
        missing_evidence_refs: [],
      }),
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("no_action");
    expect(host.checkpoint).toMatchObject({ providerCalls: 0, toolCalls: 0 });
    expect(host.noActions[0]?.reasonCode).toBe("NO_VISIBLE_IDENTITY_CLUE");
  });

  it("quarantines sensitive or appearance-based queries from hostile screenshots", async () => {
    for (const query of [
      "zhouyu personal email",
      "identify them by face",
      "zhouyu candidate score",
    ]) {
      const host = new MemoryPersonResearchHost();
      const receipt = await runPersonResearchAgent({
        scope,
        budget: { ...DEFAULT_AGENT_BUDGET },
        provider: visionProvider(
          [
            {
              tool: "search_douyin_profiles",
              input: {
                visible_identity_clue: query,
                source_artifact_id: imageArtifact.artifactID,
                maximum_results: 5,
              },
            },
          ],
          {
            outcome: "no_action",
            reason_code: "UNTRUSTED_INSTRUCTION",
            reason: "The screenshot instruction is not an identity clue.",
            missing_evidence_refs: [],
          },
        ),
        gateway: host,
        journal: host,
        providerInputParts: inputParts,
      });

      expect(receipt.status).toBe("quarantined");
      expect(receipt.permissionDenials[0]).toMatch(/^search_douyin_profiles:/u);
      expect(host.artifacts).toHaveLength(0);
    }
  });

  it("requires an image-understanding provider and a matching immutable image", async () => {
    const host = new MemoryPersonResearchHost();
    await expect(
      runPersonResearchAgent({
        scope,
        budget: { ...DEFAULT_AGENT_BUDGET },
        provider: new ScriptedAgentProvider([], {
          outcome: "no_action",
          reason_code: "NO_VISIBLE_IDENTITY_CLUE",
          reason: "No clue.",
          missing_evidence_refs: [],
        }),
        gateway: host,
        journal: host,
        providerInputParts: inputParts,
      }),
    ).rejects.toMatchObject({ code: "PERSON_RESEARCH_VISION_PROVIDER_REQUIRED" });

    await expect(
      runPersonResearchAgent({
        scope,
        budget: { ...DEFAULT_AGENT_BUDGET },
        provider: visionProvider([], {
          outcome: "no_action",
          reason_code: "NO_VISIBLE_IDENTITY_CLUE",
          reason: "No clue.",
          missing_evidence_refs: [],
        }),
        gateway: host,
        journal: host,
        providerInputParts: [{ ...inputParts[0]!, contentHash: "c".repeat(64) }],
      }),
    ).rejects.toMatchObject({ code: "PERSON_RESEARCH_IMAGE_INVALID" });
  });

  it("keeps the company/market prohibition separate from person authorization", () => {
    expect(() => assertPersonResearchQuery("@zhouyu")).not.toThrow();
    expect(() => assertPersonResearchQuery("zhouyu phone")).toThrow(
      AgentPersonResearchPolicyError,
    );
    expect(() =>
      assertPersonResearchAuthorization({
        ...scope.authorization,
        allowedPlatforms: [],
      }),
    ).toThrow("1-4 supported public platforms");
  });

  it("returns only the fixed generic fallback to the model tool callback for untyped gateway failures", async () => {
    const host = new MemoryPersonResearchHost();
    host.searchProfiles = async () => {
      host.profileDispatches += 1;
      throw Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
        name: "SECRET_NAME_CANARY",
        stack: "Error: SECRET_STACK_CANARY\n    at SECRET_FRAME_CANARY",
        cause: new Error("SECRET_CAUSE_CANARY"),
      });
    };
    let toolResults: readonly AgentToolResult[] = [];
    const provider = visionProvider(
      [
        {
          tool: "search_douyin_profiles",
          input: {
            visible_identity_clue: "@zhouyu",
            source_artifact_id: imageArtifact.artifactID,
            maximum_results: 5,
          },
        },
      ],
      (results) => {
        toolResults = results;
        return {
          outcome: "no_action",
          reason_code: "NO_VISIBLE_IDENTITY_CLUE",
          reason: "The tool call failed.",
          missing_evidence_refs: [],
        };
      },
    );

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
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
    expect(host.profileDispatches).toBe(1);
    // The possibly dispatched operation stays conservatively consumed.
    expect(host.checkpoint).toMatchObject({ providerCalls: 1 });
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

  it("requires a valid run scope before any journal or provider work", async () => {
    const host = new MemoryPersonResearchHost();
    await expect(
      runPersonResearchAgent({
        scope: { ...scope, runID: "  " },
        budget: { ...DEFAULT_AGENT_BUDGET },
        provider: visionProvider([], {
          outcome: "no_action",
          reason_code: "NO_VISIBLE_IDENTITY_CLUE",
          reason: "No clue.",
          missing_evidence_refs: [],
        }),
        gateway: host,
        journal: host,
        providerInputParts: inputParts,
      }),
    ).rejects.toMatchObject({ code: "PERSON_RESEARCH_SCOPE_INVALID" });
    expect(host.events).toEqual([]);
    expect(host.terminal).toBeNull();
  });
});

describe("person research Run durability", () => {
  const searchInput = {
    visible_identity_clue: "@zhouyu",
    source_artifact_id: imageArtifact.artifactID,
    maximum_results: 5,
  } as const;
  const noActionOutput = {
    outcome: "no_action",
    reason_code: "NO_PUBLIC_PROFILE_MATCH",
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

  function concurrentProvider(
    tools: readonly [string, string],
  ): {
    provider: AgentProvider;
    settlements: PromiseSettledResult<AgentToolResult>[];
  } {
    const settlements: PromiseSettledResult<AgentToolResult>[] = [];
    const provider: AgentProvider = {
      id: "concurrent-synthetic",
      model: "synthetic-vision-tool-model",
      sdkVersion: "concurrent-provider.v1",
      inputCapabilities: {
        text: true,
        image: true,
        imageUnderstanding: true,
      },
      async run(_request, invokeTool) {
        const first = invokeTool(tools[0], searchInput);
        const second = invokeTool(tools[1], searchInput);
        settlements.push(...(await Promise.allSettled([first, second])));
        return providerResult();
      },
    };
    return { provider, settlements };
  }

  it("persists the consumed provider-call counter inside the gateway callback", async () => {
    const host = new MemoryPersonResearchHost();
    const provider = visionProvider(
      [{ tool: "search_douyin_profiles", input: searchInput }],
      noActionOutput,
    );

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("no_action");
    expect(host.profileDispatchCheckpoints[0]).toMatchObject({
      providerCalls: 1,
      toolCalls: 1,
    });
    expect(host.checkpoint?.providerCalls).toBe(1);
  });

  it("denies a profile search after a restored consumed budget without dispatching", async () => {
    const host = new MemoryPersonResearchHost();
    host.checkpoint = {
      profileResults: [],
      queryObservations: [],
      providerCalls: 2,
      toolCalls: 2,
      sequence: 2,
    };
    const provider = visionProvider(
      [{ tool: "search_douyin_profiles", input: searchInput }],
      noActionOutput,
    );

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("quarantined");
    expect(receipt.reasonCode).toBe("MAX_PERSON_PROFILE_CALLS_EXCEEDED");
    expect(receipt.permissionDenials).toContain(
      "search_douyin_profiles:MAX_PERSON_PROFILE_CALLS_EXCEEDED",
    );
    expect(host.profileDispatches).toBe(0);
  });

  it("fails closed without a gateway dispatch when the pre-dispatch checkpoint write fails", async () => {
    const host = new MemoryPersonResearchHost();
    host.failSaveCall = 1;
    const provider = visionProvider(
      [{ tool: "search_douyin_profiles", input: searchInput }],
      noActionOutput,
    );

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.reasonCode).toBe("PROVIDER_OR_COMMIT_FAILED");
    expect(host.profileDispatches).toBe(0);
  });

  it("serializes concurrent profile callbacks with contiguous journal sequences", async () => {
    const host = new MemoryPersonResearchHost();
    const started = deferred();
    const release = deferred();
    host.holdFirstProfileDispatch = release.promise;
    host.onProfileDispatch = () => started.resolve();
    const { provider, settlements } = concurrentProvider([
      "search_douyin_profiles",
      "search_tiktok_profiles",
    ]);

    const run = runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });
    run.catch(() => {});
    try {
      await started.promise;
      // A broken serializer would dispatch the second gateway call while the
      // first is still held.
      await new Promise((done) => setTimeout(done, 100));
      expect(host.profileDispatches).toBe(1);
    } finally {
      release.resolve();
    }
    const receipt = await run;

    expect(receipt.status).toBe("no_action");
    expect(settlements.every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(host.profileDispatches).toBe(2);
    expect(
      host.profileDispatchCheckpoints.map((entry) => entry?.providerCalls),
    ).toEqual([1, 2]);
    expect(host.checkpoint?.providerCalls).toBe(2);
    expect(host.checkpoint?.toolCalls).toBe(2);
    for (const values of [
      host.checkpointHistory.map((entry) => entry.providerCalls),
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
    const host = new MemoryPersonResearchHost();
    // Call 1 is the first tool's pre-dispatch save; call 2 is its result save.
    host.failSaveCall = 2;
    const { provider, settlements } = concurrentProvider([
      "search_douyin_profiles",
      "search_tiktok_profiles",
    ]);

    const receipt = await runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.reasonCode).toBe("PROVIDER_OR_COMMIT_FAILED");
    expect(host.profileDispatches).toBe(1);
    const blocked = settlements[1];
    expect(blocked?.status).toBe("rejected");
    if (blocked?.status === "rejected") {
      expect(blocked.reason).toBeInstanceOf(ResearchToolBlockedError);
    }
    expect(host.events.map((event) => event.kind)).toEqual(["terminal"]);
    expect(host.terminal?.status).toBe("failed");
  });

  it("checks aborted queued work at actual execution and dispatches no second gateway", async () => {
    const host = new MemoryPersonResearchHost();
    const started = deferred();
    const release = deferred();
    host.holdFirstProfileDispatch = release.promise;
    host.onProfileDispatch = () => started.resolve();
    const settlements: PromiseSettledResult<AgentToolResult>[] = [];
    const controller = new AbortController();
    const provider: AgentProvider = {
      id: "concurrent-synthetic",
      model: "synthetic-vision-tool-model",
      sdkVersion: "concurrent-provider.v1",
      inputCapabilities: {
        text: true,
        image: true,
        imageUnderstanding: true,
      },
      async run(_request, invokeTool) {
        const first = invokeTool("search_douyin_profiles", searchInput);
        await started.promise;
        const second = invokeTool("search_tiktok_profiles", searchInput);
        // The second execution is queued behind the held first execution when
        // the Run is cancelled.
        controller.abort();
        release.resolve();
        settlements.push(...(await Promise.allSettled([first, second])));
        return providerResult();
      },
    };

    const run = runPersonResearchAgent({
      scope,
      budget: { ...DEFAULT_AGENT_BUDGET },
      provider,
      gateway: host,
      journal: host,
      providerInputParts: inputParts,
      signal: controller.signal,
    });
    run.catch(() => {});
    const receipt = await run;

    expect(receipt.status).toBe("cancelled");
    expect(receipt.reasonCode).toBe("CANCELLED_BY_REQUESTER");
    expect(host.profileDispatches).toBe(1);
    const second = settlements[1];
    expect(second?.status).toBe("fulfilled");
    if (second?.status === "fulfilled") {
      expect(second.value.ok).toBe(false);
      expect(second.value.error?.code).toBe("RUN_CANCELLED");
    }
    expect(host.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(host.events[1]?.metadata.error_code).toBe("RUN_CANCELLED");
    expect(host.events.at(-1)?.kind).toBe("terminal");
  });
});
