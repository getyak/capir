import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ScriptedAgentProvider,
  fingerprint,
  type AgentProvider,
  type AgentProviderRequest,
  type AgentToolResult,
} from "@talent-signal/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { runLocalPersonResearchCommand } from "./personResearchCommand.js";
import { TikHubProvider } from "./tikHubProvider.js";
import {
  cleanupResearchWorkers,
  ensureFreshHostBuild,
  spawnResearchWorker,
} from "./test/research-store-worker.mjs";

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

function visionProvider(
  steps: ConstructorParameters<typeof ScriptedAgentProvider>[0],
  output: ConstructorParameters<typeof ScriptedAgentProvider>[1],
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
    run(
      request: AgentProviderRequest,
      invokeTool: (name: string, input: unknown) => Promise<AgentToolResult>,
      signal: AbortSignal,
    ) {
      return scripted.run(request, invokeTool, signal);
    },
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("local screenshot person-research command", () => {
  it("accepts only an image, lets the Agent choose TikHub, and persists no image bytes or secret", async () => {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-person-agent-"));
    temporaryDirectories.push(stateRoot);
    const imagePath = join(stateRoot, "synthetic.png");
    const imageBytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("synthetic screenshot with @zhouyu"),
    ]);
    await fs.writeFile(imagePath, imageBytes);
    const contentHash = createHash("sha256").update(imageBytes).digest("hex");
    const artifactID = fingerprint({
      kind: "image",
      mimeType: "image/png",
      contentHash,
    });
    const runID = "99999999-9999-4999-8999-999999999999";
    const profileContentHash = createHash("sha256")
      .update(
        JSON.stringify({
          platform: "douyin",
          providerID: "tikhub",
          providerRequestID: null,
          profileID: "42",
          displayName: "周宇",
          handle: "zhouyu",
          biography: null,
          profileUrl: "https://www.douyin.com/user/secure-42",
          avatarUrl: null,
          verified: null,
        }),
      )
      .digest("hex");
    const resultID = fingerprint({
      runID,
      providerID: "tikhub",
      platform: "douyin",
      profileID: "42",
      profileUrl: "https://www.douyin.com/user/secure-42",
      contentHash: profileContentHash,
    });
    const profileProvider = new TikHubProvider({
      apiKey: "provider-secret-must-not-persist",
      fetcher: (async () =>
        response({
          code: 200,
          request_id: "provider-request-1",
          data: {
            user_list: [
              {
                user_info: {
                  uid: "42",
                  sec_uid: "secure-42",
                  unique_id: "zhouyu",
                  nickname: "周宇",
                  follower_count: 1200,
                },
              },
            ],
          },
        })) as typeof fetch,
    });
    const modelProvider = visionProvider(
      [
        {
          tool: "search_douyin_profiles",
          input: {
            visible_identity_clue: "@zhouyu",
            source_artifact_id: artifactID,
            maximum_results: 5,
          },
        },
        {
          tool: "create_person_research_artifact",
          input: {
            title: "可能的公开资料",
            summary: "可见账号线索与一个公开资料相符，但身份尚未确认。",
            limitations: "仅比较可见文字线索；未进行人脸识别或人物绑定。",
            identity_status: "possible_match",
            observed_clues: [
              {
                kind: "handle",
                value: "@zhouyu",
                source_artifact_id: artifactID,
                observation_status: "unreviewed_screenshot_observation",
              },
            ],
            candidates: [
              {
                result_id: resultID,
                match_basis: "公开账号名与截图可见账号一致。",
              },
            ],
            claims: [
              {
                statement: "提供方返回的公开资料账号名为 zhouyu。",
                epistemic_status: "provider_observation",
                source_refs: [resultID],
              },
            ],
          },
        },
      ],
      (results) => ({
        outcome: "person_research_artifact",
        candidate_fingerprint: results.at(-1)?.candidateFingerprint,
      }),
    );
    const args = [
      "person-research",
      "--",
      "--image",
      imagePath,
      "--run-id",
      runID,
      "--state-dir",
      stateRoot,
    ];

    const result = await runLocalPersonResearchCommand(args, {}, {
      modelProvider,
      profileProvider,
    });

    expect(result.receipt.status).toBe("artifact_created");
    expect(result.artifactFile).not.toBeNull();
    const runDirectory = join(stateRoot, "person-runs", runID);
    const persisted = (
      await Promise.all(
        ["run.json", "checkpoint.json", "events.jsonl", "outputs.jsonl", "terminal.json", result.artifactFile!]
          .map(async (path) => fs.readFile(path.startsWith("/") ? path : join(runDirectory, path), "utf8")),
      )
    ).join("\n");
    expect(persisted).not.toContain(imageBytes.toString("base64"));
    expect(persisted).not.toContain("provider-secret-must-not-persist");
    const artifact = JSON.parse(await fs.readFile(result.artifactFile!, "utf8"));
    expect(artifact).toMatchObject({
      status: "draft",
      identityAuthority: "unconfirmed",
      publicationAuthority: "none",
      externalEffectAuthority: "none",
    });
    expect((await fs.stat(result.artifactFile!)).mode & 0o777).toBe(0o600);

    const replay = await runLocalPersonResearchCommand(args, {}, {
      modelProvider,
      profileProvider,
    });
    expect(replay.replayedTerminal).toBe(true);
    expect(replay.receipt).toEqual(result.receipt);
  });

  it("rejects a non-image before configuring providers or creating a Run", async () => {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-person-agent-"));
    temporaryDirectories.push(stateRoot);
    const imagePath = join(stateRoot, "not-an-image.png");
    await fs.writeFile(imagePath, "plain text");

    await expect(
      runLocalPersonResearchCommand([
        "person-research",
        "--image",
        imagePath,
        "--state-dir",
        stateRoot,
      ]),
    ).rejects.toThrow("must contain PNG, JPEG, or WebP bytes");
    await expect(fs.access(join(stateRoot, "person-runs"))).rejects.toThrow();
  });
});

describe("local person-research cross-process admission", () => {
  const runID = "77777777-7777-4777-8777-777777777777";

  async function makeStateRoot() {
    const stateRoot = await fs.mkdtemp(join(tmpdir(), "talent-signal-person-agent-"));
    temporaryDirectories.push(stateRoot);
    return stateRoot;
  }

  it("invokes the vision provider once for a held Run and rejects the busy duplicate", async () => {
    const stateRoot = await makeStateRoot();
    const holder = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID,
      holdProvider: true,
    });
    await holder.waitFor("ready");
    holder.send("go");
    await holder.waitFor("provider-invoked");

    const duplicate = spawnResearchWorker({
      kind: "person-command",
      stateRoot,
      runID,
      holdProvider: false,
    });
    await duplicate.waitFor("ready");
    duplicate.send("go");
    const duplicateResult = await duplicate.result;
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.errorName).toBe("LocalRunAdmissionBusyError");
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

  it("replays a completed person Run in a fresh process without any provider call", async () => {
    const stateRoot = await makeStateRoot();
    const first = spawnResearchWorker({
      kind: "person-command",
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
      kind: "person-command",
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
});
