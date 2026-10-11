// Cross-process persistence and admission worker for the agent-host local
// research stores. Tests fork this file so the races are real multi-process
// races against freshly built host modules; IPC messages provide deterministic
// barriers instead of sleep-based timing.
//
// Test-side helpers (build freshness, worker spawning) are exported from the
// same module so no other test scaffolding file is needed.

import { execFileSync } from "node:child_process";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerPath = fileURLToPath(import.meta.url);
const hostRoot = resolve(dirname(workerPath), "..", "..");
const repoRoot = resolve(hostRoot, "..", "..");
const hostDist = join(hostRoot, "dist");

const SOURCE_TREES = [
  join(hostRoot, "src"),
  join(repoRoot, "apps", "agent", "src"),
  join(repoRoot, "packages", "contracts", "src"),
];

async function newestSourceMtime() {
  let newest = 0;
  for (const tree of SOURCE_TREES) {
    const entries = await fs.readdir(tree, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const metadata = await fs.stat(join(entry.parentPath, entry.name));
      if (metadata.mtimeMs > newest) newest = metadata.mtimeMs;
    }
  }
  return newest;
}

async function isFresh() {
  const entry = join(hostDist, "localResearchStore.js");
  try {
    const metadata = await fs.stat(entry);
    return metadata.isFile() && (await newestSourceMtime()) <= metadata.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Serializes concurrent fixture builds with a kernel-owned SQLite
 * BEGIN IMMEDIATE lock in the inherited TMPDIR. Lock ownership is released by
 * the kernel when a process dies, so no age- or PID-based stealing exists; a
 * bounded wait fails closed instead.
 */
async function withBuildLock(action) {
  const key = createHash("sha256").update(hostRoot).digest("hex").slice(0, 16);
  const lockPath = join(
    tmpdir(),
    `talent-signal-agent-host-build-${key}.sqlite`,
  );
  const deadline = Date.now() + 5 * 60_000;
  let database;
  for (;;) {
    database = new DatabaseSync(lockPath, { readOnly: false });
    try {
      await fs.chmod(lockPath, 0o600);
      database.exec("PRAGMA busy_timeout = 0;");
      database.exec("BEGIN IMMEDIATE");
    } catch (error) {
      database.close();
      const busy =
        error &&
        typeof error === "object" &&
        ((error.errcode ?? null) === 5 || (error.errcode ?? null) === 6);
      if (busy && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 250));
        continue;
      }
      if (busy) {
        throw new Error(`Timed out waiting for the host build lock: ${lockPath}`);
      }
      throw error;
    }
    break;
  }
  try {
    return await action();
  } finally {
    try {
      database.exec("COMMIT");
    } finally {
      database.close();
    }
  }
}

/**
 * Ensures `apps/agent-host/dist` holds a fresh build of the host modules (and
 * of the agent package they import). Serialized across test workers with a
 * tmpdir lock; skipped when the existing build is newer than every source.
 * Returns the host dist directory.
 */
export async function ensureFreshHostBuild() {
  if (await isFresh()) return hostDist;
  return withBuildLock(async () => {
    if (await isFresh()) return hostDist;
    const options = { cwd: repoRoot, stdio: "pipe" };
    execFileSync("pnpm", ["--filter", "@talent-signal/agent", "build"], options);
    execFileSync("pnpm", ["--filter", "@talent-signal/agent-host", "build"], options);
    return hostDist;
  });
}

const spawnedWorkers = new Set();

/**
 * Forks this worker and sends one job. Returns IPC helpers so tests can hold
 * deterministic barriers ("ready"/"go", "provider-invoked"/"finish") instead of
 * racing on sleeps. `result` resolves with the worker's final report; pending
 * result and event waiters always settle, and `cleanup` kills only the child
 * this handle owns.
 */
export function spawnResearchWorker(job) {
  const child = fork(workerPath, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const events = [];
  const log = [];
  const waiters = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  let resolveResult;
  let rejectResult;
  let resultSettled = false;
  const result = new Promise((done, fail) => {
    resolveResult = done;
    rejectResult = fail;
  });
  // Marked as handled immediately: cleanup may reject a result nobody awaits.
  result.catch(() => {});
  const finish = (error, value) => {
    if (resultSettled) return;
    resultSettled = true;
    if (error) rejectResult(error);
    else resolveResult(value);
  };
  const settleWaiters = (error) => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.fail(error);
    }
  };
  child.on("message", (message) => {
    if (message?.event === "result") {
      finish(null, message);
      return;
    }
    log.push(message);
    const index = waiters.findIndex(
      (waiter) => waiter.name === message?.event,
    );
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.done(message);
    } else {
      events.push(message);
    }
  });
  child.on("exit", (code) => {
    settleWaiters(
      new Error(
        `research-store-worker exited (code ${code}) while an event waiter was pending`,
      ),
    );
    finish(
      new Error(
        `research-store-worker exited before a result (code ${code}): ${stderr}`,
      ),
    );
  });
  child.send({ job });
  const handle = {
    child,
    log,
    result,
    send(commandName) {
      child.send({ command: commandName });
    },
    waitFor(name, timeoutMs = 30_000) {
      const buffered = events.findIndex((event) => event.event === name);
      if (buffered >= 0) {
        return Promise.resolve(events.splice(buffered, 1)[0]);
      }
      const pending = new Promise((done, fail) => {
        const waiter = { name, done, fail, timer: 0 };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          fail(
            new Error(
              `Timed out waiting for worker event ${name}; received ${JSON.stringify(events)}`,
            ),
          );
        }, timeoutMs);
        waiters.push(waiter);
      });
      // Marked as handled: an abandoned waiter must not surface as an
      // unhandled rejection when cleanup settles it.
      pending.catch(() => {});
      return pending;
    },
    kill(signal = "SIGKILL") {
      child.kill(signal);
    },
    async cleanup() {
      settleWaiters(
        new Error("research-store-worker was cleaned up while an event waiter was pending"),
      );
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        child.kill("SIGKILL");
        await exited;
      }
      finish(new Error("research-store-worker was cleaned up before a result"));
      spawnedWorkers.delete(handle);
    },
  };
  spawnedWorkers.add(handle);
  return handle;
}

/**
 * Terminates and settles every worker spawned by this module instance (and
 * only those). Tests must await this in `afterEach`/`finally` before removing
 * their temporary state directories.
 */
export async function cleanupResearchWorkers() {
  await Promise.all([...spawnedWorkers].map((handle) => handle.cleanup()));
}

// ---------------------------------------------------------------------------
// Child-side protocol
// ---------------------------------------------------------------------------

function notify(event, payload = {}) {
  process.send?.({ event, ...payload });
}

function waitForCommand(name) {
  return new Promise((done) => {
    const onMessage = (message) => {
      if (message?.command === name) {
        process.off("message", onMessage);
        done(message);
      }
    };
    process.on("message", onMessage);
  });
}

function holdForever() {
  return new Promise(() => {});
}

function reported(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "Unknown",
  };
}

function moduleUrl(relative) {
  return new URL(`../../dist/${relative}`, import.meta.url).href;
}

function publicScopeFixture(runID) {
  return {
    runID,
    objective: "Research Example Company's public update.",
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
  };
}

async function runStoreJob(job) {
  const { LocalResearchStore } = await import(moduleUrl("localResearchStore.js"));
  const { LocalPersonResearchStore } = await import(
    moduleUrl("localPersonResearchStore.js")
  );
  const store =
    job.store === "person"
      ? new LocalPersonResearchStore(job.stateRoot)
      : new LocalResearchStore(job.stateRoot);
  notify("ready");
  await waitForCommand("go");
  try {
    switch (job.kind) {
      case "store-start": {
        await store.start(job.record);
        return { ok: true };
      }
      case "store-complete": {
        const receipt = await store.complete(job.receipt);
        return { ok: true, receipt };
      }
      case "store-commit-artifact": {
        const committed =
          job.store === "person"
            ? await store.commitPersonResearchArtifact(
                job.scope,
                job.candidate,
                job.candidateFingerprint,
              )
            : await store.commitResearchArtifact(
                job.scope,
                job.candidate,
                job.candidateFingerprint,
              );
        return { ok: true, committed };
      }
      case "store-commit-no-action": {
        const committed = await store.commitNoAction(
          job.scope,
          job.candidate,
          job.candidateFingerprint,
        );
        return { ok: true, committed };
      }
      default:
        return reported(new Error(`Unknown store job: ${job.kind}`));
    }
  } catch (error) {
    return reported(error);
  }
}

async function runReadRecordJob(job) {
  const { readPersistedJsonRecord } = await import(
    moduleUrl("localResearchFiles.js")
  );
  notify("ready");
  await waitForCommand("go");
  try {
    const record = await readPersistedJsonRecord(job.path, (value) => value);
    return { ok: true, present: record !== null };
  } catch (error) {
    return reported(error);
  }
}

async function runHoldAdmissionJob(job) {
  const { withLocalRunAdmission } = await import(
    moduleUrl("localRunAdmission.js")
  );
  notify("ready");
  await waitForCommand("go");
  try {
    await withLocalRunAdmission(
      { runDirectory: job.runDirectory, runID: job.runID },
      async () => {
        notify("acquired");
        if (job.holdUntil === "kill") await holdForever();
        await waitForCommand("release");
      },
    );
    return { ok: true };
  } catch (error) {
    return reported(error);
  }
}

async function runResearchCommandJob(job) {
  const { fingerprint, ScriptedAgentProvider } = await import(
    "@talent-signal/agent"
  );
  const { runLocalResearchCommand } = await import(moduleUrl("cli.js"));
  const { LocalResearchGateway } = await import(
    moduleUrl("localResearchGateway.js")
  );
  const { LocalResearchStore } = await import(
    moduleUrl("localResearchStore.js")
  );
  const resultID = fingerprint({
    runID: job.runID,
    providerID: "synthetic-search",
    url: "https://example.com/update",
  });
  const searchProvider = {
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
  const fetchPage = async (_scope, discovered) => ({
    canonicalUrl: discovered.url,
    title: discovered.title,
    text: "The company published an update.",
    contentHash: "a".repeat(64),
    retrievedAt: "2026-08-30T00:00:00.000Z",
    providerID: discovered.providerID,
  });
  const scripted = new ScriptedAgentProvider(
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
  const modelProvider = {
    id: scripted.id,
    model: scripted.model,
    sdkVersion: scripted.sdkVersion,
    inputCapabilities: scripted.inputCapabilities,
    async run(request, invokeTool, signal) {
      notify("provider-invoked");
      if (job.holdProvider) await waitForCommand("finish");
      return scripted.run(request, invokeTool, signal);
    },
  };
  const gateway = new LocalResearchGateway(searchProvider, new LocalResearchStore(job.stateRoot), {
    fetchPage,
  });
  notify("ready");
  await waitForCommand("go");
  try {
    const result = await runLocalResearchCommand(
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
        job.runID,
        "--state-dir",
        job.stateRoot,
      ],
      {},
      {
        modelProvider,
        searchProvider,
        gateway,
      },
    );
    return {
      ok: true,
      status: result.receipt.status,
      replayedTerminal: result.replayedTerminal,
      artifactFile: result.artifactFile,
    };
  } catch (error) {
    return reported(error);
  }
}

async function runPersonCommandJob(job) {
  const { fingerprint, ScriptedAgentProvider } = await import(
    "@talent-signal/agent"
  );
  const { runLocalPersonResearchImage } = await import(
    moduleUrl("personResearchCommand.js")
  );
  const { TikHubProvider } = await import(moduleUrl("tikHubProvider.js"));
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from("synthetic screenshot with @zhouyu"),
  ]);
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
    runID: job.runID,
    providerID: "tikhub",
    platform: "douyin",
    profileID: "42",
    profileUrl: "https://www.douyin.com/user/secure-42",
    contentHash: profileContentHash,
  });
  const artifactID = fingerprint({
    kind: "image",
    mimeType: "image/png",
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  });
  const profileProvider = new TikHubProvider({
    apiKey: "provider-secret-must-not-persist",
    fetcher: async () =>
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const scripted = new ScriptedAgentProvider(
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
  const modelProvider = {
    id: scripted.id,
    model: "synthetic-vision-tool-model",
    sdkVersion: scripted.sdkVersion,
    inputCapabilities: {
      text: true,
      image: true,
      imageUnderstanding: true,
    },
    async run(request, invokeTool, signal) {
      notify("provider-invoked");
      if (job.holdProvider) await waitForCommand("finish");
      return scripted.run(request, invokeTool, signal);
    },
  };
  notify("ready");
  await waitForCommand("go");
  try {
    const result = await runLocalPersonResearchImage(
      {
        bytes,
        mediaType: "image/png",
        objective:
          "Find possible public profile matches using only identity text visibly present in this screenshot.",
        allowedPlatforms: ["douyin"],
        maximumProviderCalls: 2,
        maximumResultsPerCall: 5,
        runID: job.runID,
        stateRoot: job.stateRoot,
      },
      {},
      { modelProvider, profileProvider },
    );
    return {
      ok: true,
      status: result.receipt.status,
      replayedTerminal: result.replayedTerminal,
      artifactFile: result.artifactFile,
    };
  } catch (error) {
    return reported(error);
  }
}

async function main() {
  const job = await new Promise((done) => {
    process.once("message", (message) => done(message?.job));
  });
  if (!job) throw new Error("research-store-worker requires a job message.");
  let result;
  switch (job.kind) {
    case "store-start":
    case "store-complete":
    case "store-commit-artifact":
    case "store-commit-no-action":
      result = await runStoreJob(job);
      break;
    case "hold-admission":
      result = await runHoldAdmissionJob(job);
      break;
    case "read-record":
      result = await runReadRecordJob(job);
      break;
    case "research-command":
      result = await runResearchCommandJob(job);
      break;
    case "person-command":
      result = await runPersonCommandJob(job);
      break;
    default:
      result = reported(new Error(`Unknown worker job: ${job.kind}`));
  }
  notify("result", result);
  process.disconnect?.();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    notify("result", reported(error));
    process.disconnect?.();
    process.exitCode = 1;
  });
}
