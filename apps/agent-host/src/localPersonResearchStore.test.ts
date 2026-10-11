import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprint,
  type AgentInputArtifactManifestItem,
  type AgentPersonResearchArtifactCandidate,
  type AgentPersonResearchNoActionCandidate,
  type AgentPersonResearchScope,
  type AgentPersonResearchTerminalReceipt,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_JSON_MALFORMED_MESSAGE } from "./localResearchFiles.js";
import {
  LocalPersonResearchStore,
  type LocalPersonResearchRunRecord,
} from "./localPersonResearchStore.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

const temporaryDirectories: string[] = [];
const runID = "99999999-9999-4999-8999-999999999999";
const otherRunID = "97979797-9797-4979-8979-979797979797";

const imageContentHash = createHash("sha256")
  .update("synthetic screenshot with @zhouyu")
  .digest("hex");
const imageManifest: AgentInputArtifactManifestItem = {
  artifactID: fingerprint({
    kind: "image",
    mimeType: "image/png",
    contentHash: imageContentHash,
  }),
  kind: "image",
  mimeType: "image/png",
  byteSize: 35,
  contentHash: imageContentHash,
};

const scope: AgentPersonResearchScope = {
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
  inputArtifactManifest: [imageManifest],
};

const record: LocalPersonResearchRunRecord = {
  scope,
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
};

const resultID = fingerprint({
  runID,
  providerID: "tikhub",
  platform: "douyin",
  profileID: "42",
  profileUrl: "https://www.douyin.com/user/secure-42",
  contentHash: "b".repeat(64),
});
const artifactCandidate: AgentPersonResearchArtifactCandidate = {
  title: "可能的公开资料",
  summary: "可见账号线索与一个公开资料相符，但身份尚未确认。",
  limitations: "仅比较可见文字线索；未进行人脸识别或人物绑定。",
  identityStatus: "possible_match",
  observedClues: [
    {
      kind: "handle",
      value: "@zhouyu",
      sourceArtifactID: imageManifest.artifactID,
      observationStatus: "unreviewed_screenshot_observation",
    },
  ],
  candidates: [{ resultID, matchBasis: "公开账号名与截图可见账号一致。" }],
  claims: [
    {
      statement: "提供方返回的公开资料账号名为 zhouyu。",
      epistemicStatus: "provider_observation",
      sourceRefs: [resultID],
    },
  ],
  sources: [
    {
      resultID,
      platform: "douyin",
      profileUrl: "https://www.douyin.com/user/secure-42",
      displayName: "周宇",
      handle: "zhouyu",
      biography: null,
      avatarUrl: null,
      verified: null,
      contentHash: "b".repeat(64),
      retrievedAt: "2026-08-30T00:00:00.000Z",
      providerID: "tikhub",
      providerRequestID: null,
    },
  ],
};
const noActionCandidate: AgentPersonResearchNoActionCandidate = {
  reasonCode: "NO_VISIBLE_IDENTITY_CLUE",
  reason: "The screenshot shows no visible identity text.",
};
const artifactFingerprint = fingerprint(artifactCandidate);
const noActionFingerprint = fingerprint(noActionCandidate);

function terminalReceipt(
  overrides: Partial<AgentPersonResearchTerminalReceipt> = {},
): AgentPersonResearchTerminalReceipt {
  return {
    runID,
    status: "artifact_created",
    reasonCode: "PERSON_RESEARCH_COMPLETE",
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

async function makeStateRoot() {
  const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-person-store-"));
  temporaryDirectories.push(stateRoot);
  return stateRoot;
}

describe("local person-research journal", () => {
  it("converges duplicate artifact commits and preserves authority fields", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);

    const workers = [1, 2, 3].map(() =>
      spawnResearchWorker({
        kind: "store-commit-artifact",
        store: "person",
        stateRoot,
        scope,
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
    expect(
      new Set(results.map((result) => result.committed?.createdAt)).size,
    ).toBe(1);
    expect(
      results.filter((result) => result.committed?.replayed === false),
    ).toHaveLength(1);

    const persisted = await store.readArtifact(runID, artifactFingerprint);
    expect(persisted?.artifactID).toBe([...ids][0]);
    expect(persisted).toMatchObject({
      status: "draft",
      identityAuthority: "unconfirmed",
      publicationAuthority: "none",
      externalEffectAuthority: "none",
      objective: scope.objective,
      candidateFingerprint: artifactFingerprint,
    });
    expect(persisted?.inputArtifactManifest).toEqual([imageManifest]);
  });

  it("converges duplicate no-action commits on one persisted ID", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);

    const workers = [1, 2].map(() =>
      spawnResearchWorker({
        kind: "store-commit-no-action",
        store: "person",
        stateRoot,
        scope,
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
    expect(
      results.filter((result) => result.committed?.replayed === false),
    ).toHaveLength(1);
  });

  it("allows one semantic winner when conflicting person terminal receipts race across processes", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    const receiptA = terminalReceipt();
    const receiptB = terminalReceipt({
      status: "no_action",
      reasonCode: "NO_VISIBLE_IDENTITY_CLUE",
      artifactID: null,
      noActionID: "55555555-5555-4555-8555-555555555555",
      candidateFingerprint: noActionFingerprint,
    });

    const first = spawnResearchWorker({
      kind: "store-complete",
      store: "person",
      stateRoot,
      receipt: receiptA,
    });
    const second = spawnResearchWorker({
      kind: "store-complete",
      store: "person",
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

  it("returns the original artifact ID and createdAt on equivalent replay", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);

    const first = await store.commitPersonResearchArtifact(
      scope,
      artifactCandidate,
      artifactFingerprint,
    );
    expect(first.replayed).toBe(false);
    const second = await store.commitPersonResearchArtifact(
      scope,
      artifactCandidate,
      artifactFingerprint,
    );
    expect(second.replayed).toBe(true);
    expect(second.artifactID).toBe(first.artifactID);
    expect(second.createdAt).toBe(first.createdAt);

    // A conflicting candidate under the same externally supplied fingerprint
    // is a conflict, never an overwrite.
    await expect(
      store.commitPersonResearchArtifact(
        scope,
        { ...artifactCandidate, title: "另一个标题" },
        artifactFingerprint,
      ),
    ).rejects.toThrow("conflicts with the requested candidate");
    const persisted = await store.readArtifact(runID, artifactFingerprint);
    expect(persisted?.artifactID).toBe(first.artifactID);
    expect(persisted?.candidate).toEqual(artifactCandidate);
  });

  it("fails closed on foreign-Run, invalid, and malformed person records", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    await store.commitPersonResearchArtifact(
      scope,
      artifactCandidate,
      artifactFingerprint,
    );
    const path = store.artifactPath(runID, artifactFingerprint);
    const valid = JSON.parse(await fs.readFile(path, "utf8")) as Record<
      string,
      unknown
    >;

    const cases: Array<{ name: string; content: string }> = [
      { name: "null envelope", content: "null" },
      { name: "array envelope", content: "[]" },
      {
        name: "foreign-Run envelope",
        content: JSON.stringify({ ...valid, runID: otherRunID }),
      },
      {
        name: "invalid artifact ID",
        content: JSON.stringify({ ...valid, artifactID: "not-a-uuid" }),
      },
    ];
    for (const testCase of cases) {
      await fs.writeFile(path, testCase.content, "utf8");
      await expect(
        store.readArtifact(runID, artifactFingerprint),
        testCase.name,
      ).rejects.toThrow("corrupt");
      await expect(
        store.commitPersonResearchArtifact(
          scope,
          artifactCandidate,
          artifactFingerprint,
        ),
        testCase.name,
      ).rejects.toThrow("corrupt");
      expect(await fs.readFile(path, "utf8"), testCase.name).toBe(
        testCase.content,
      );
    }

    // Malformed person/provider payload must never reach the failure surface.
    const canary = "PRIVATE-CANARY-7f3a9c-person-provider-payload";
    const malformedContent = `{"candidate": {"title": "${canary}", `;
    await fs.writeFile(path, malformedContent, "utf8");
    const failure = await store
      .commitPersonResearchArtifact(
        scope,
        artifactCandidate,
        artifactFingerprint,
      )
      .then(
        () => null,
        (error: unknown) => error as Error,
      );
    expect(failure?.message).toBe(LOCAL_JSON_MALFORMED_MESSAGE);
    expect(String(failure)).not.toContain(canary);
    expect(failure).not.toHaveProperty("cause");
    expect(await fs.readFile(path, "utf8")).toBe(malformedContent);
  });

  it("keeps owner-only modes for person-Run directories and files", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    await store.complete(terminalReceipt());
    await store.commitPersonResearchArtifact(
      scope,
      artifactCandidate,
      artifactFingerprint,
    );
    await store.commitNoAction(scope, noActionCandidate, noActionFingerprint);

    const files = [
      join("person-runs", runID, "run.json"),
      join("person-runs", runID, "terminal.json"),
      join("person-runs", runID, "artifacts", `${artifactFingerprint}.json`),
      join("person-runs", runID, "no-actions", `${noActionFingerprint}.json`),
    ];
    for (const file of files) {
      expect(
        (await fs.stat(join(stateRoot, file))).mode & 0o777,
        file,
      ).toBe(0o600);
    }
    const directories = [
      join(stateRoot, "person-runs"),
      join(stateRoot, "person-runs", runID),
    ];
    for (const directory of directories) {
      expect((await fs.stat(directory)).mode & 0o777, directory).toBe(0o700);
    }
  });

  it("rejects the reviewed nested corruption probes with fixed content-free errors", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    await store.commitPersonResearchArtifact(
      scope,
      artifactCandidate,
      artifactFingerprint,
    );
    const path = store.artifactPath(runID, artifactFingerprint);
    const valid = JSON.parse(await fs.readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    const firstClue = {
      kind: "handle" as const,
      value: "@zhouyu",
      sourceArtifactID: imageManifest.artifactID,
      observationStatus: "unreviewed_screenshot_observation" as const,
    };
    const cases: Array<{ name: string; content: string }> = [
      {
        name: "null manifest member",
        content: JSON.stringify({ ...valid, inputArtifactManifest: [null] }),
      },
      {
        name: "confirmed identity status",
        content: JSON.stringify({
          ...valid,
          candidate: { ...artifactCandidate, identityStatus: "confirmed" },
        }),
      },
      {
        name: "observation status outside the screenshot vocabulary",
        content: JSON.stringify({
          ...valid,
          candidate: {
            ...artifactCandidate,
            observedClues: [{ ...firstClue, observationStatus: "reviewed" }],
          },
        }),
      },
      {
        name: "claim epistemic status outside the existing vocabulary",
        content: JSON.stringify({
          ...valid,
          candidate: {
            ...artifactCandidate,
            claims: [
              {
                statement: "claim",
                epistemicStatus: "confirmed_fact",
                sourceRefs: [resultID],
              },
            ],
          },
        }),
      },
    ];
    for (const testCase of cases) {
      await fs.writeFile(path, testCase.content, "utf8");
      const readFailure = await store
        .readArtifact(runID, artifactFingerprint)
        .then(
          () => null,
          (error: unknown) => error as Error,
        );
      expect(readFailure?.message, testCase.name).toBe(
        "The persisted local artifact record is corrupt.",
      );
      expect(String(readFailure), testCase.name).not.toContain("周宇");
      await expect(
        store.commitPersonResearchArtifact(
          scope,
          artifactCandidate,
          artifactFingerprint,
        ),
        testCase.name,
      ).rejects.toThrow("The persisted local artifact record is corrupt.");
      expect(await fs.readFile(path, "utf8"), testCase.name).toBe(
        testCase.content,
      );
    }

    // The no-action vocabulary is equally closed.
    const noActionPath = store.noActionPath(runID, noActionFingerprint);
    await store.commitNoAction(scope, noActionCandidate, noActionFingerprint);
    const validNoAction = await fs.readFile(noActionPath, "utf8");
    const corruptNoAction = JSON.stringify({
      ...(JSON.parse(validNoAction) as Record<string, unknown>),
      candidate: { reasonCode: "CONFIRMED_IDENTITY", reason: "x" },
    });
    await fs.writeFile(noActionPath, corruptNoAction, "utf8");
    await expect(
      store.readNoAction(runID, noActionFingerprint),
    ).rejects.toThrow("The persisted local no-action record is corrupt.");
    expect(await fs.readFile(noActionPath, "utf8")).toBe(corruptNoAction);
  });

  it("rejects an artifact_created terminal with all-null IDs in both directions", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    const terminalPath = join(stateRoot, "person-runs", runID, "terminal.json");
    const allNull = terminalReceipt({
      artifactID: null,
      candidateFingerprint: null,
    });
    const content = JSON.stringify(allNull);

    // Incoming success-shaped corrupt terminal: rejected before publication.
    await expect(store.complete(allNull)).rejects.toThrow(
      "The persisted local terminal record is corrupt.",
    );
    await expect(fs.access(terminalPath)).rejects.toThrow();

    // Existing corrupt terminal: rejected on read and on replay, bytes kept.
    await fs.writeFile(terminalPath, content, "utf8");
    await expect(store.readTerminal(runID)).rejects.toThrow(
      "The persisted local terminal record is corrupt.",
    );
    await expect(store.complete(terminalReceipt())).rejects.toThrow(
      "The persisted local terminal record is corrupt.",
    );
    expect(await fs.readFile(terminalPath, "utf8")).toBe(content);

    // Checkpoint members are validated at deserialization too.
    const checkpointPath = join(
      stateRoot,
      "person-runs",
      runID,
      "checkpoint.json",
    );
    const corruptCheckpoint = JSON.stringify({
      profileResults: [null],
      queryObservations: [],
      providerCalls: 1,
      toolCalls: 1,
      sequence: 1,
    });
    await fs.writeFile(checkpointPath, corruptCheckpoint, "utf8");
    await expect(store.loadCheckpoint(runID)).rejects.toThrow(
      "The persisted local checkpoint record is corrupt.",
    );
    expect(await fs.readFile(checkpointPath, "utf8")).toBe(corruptCheckpoint);
  });
});

  it("rejects corrupt call counters and journal positions without rewriting evidence", async () => {
    const stateRoot = await makeStateRoot();
    const store = new LocalPersonResearchStore(stateRoot);
    await store.start(record);
    const path = join(stateRoot, "person-runs", runID, "checkpoint.json");
    const checkpoint = {"profileResults": [], "queryObservations": [], "providerCalls": 0, "toolCalls": 0, "sequence": 0};
    await store.saveCheckpoint(runID, checkpoint);
    await expect(store.loadCheckpoint(runID)).resolves.toEqual(checkpoint);
    for (const field of ["providerCalls", "toolCalls", "sequence"]) {
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
