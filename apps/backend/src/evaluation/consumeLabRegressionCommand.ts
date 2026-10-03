/**
 * Minimal authenticated Lab regression consumer.
 *
 * Replaces the removed eval-runner `lab-regression` CLI path. It consumes a
 * completed product rerun from reviewed local files or from an authenticated
 * Lab backend readback and writes the canonical
 * `lab-regression-consumption.v1` report. Reports have no execution or CI
 * authority; any unknown, missing, or failed integrity check fails the command.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { consumeLabRegression, digestCanonicalJson, type Sha256Digest } from "@talent-signal/evaluation";

import { readLabRegressionFromBackend } from "./labRegressionReadback.js";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 512_000;

export interface LabRegressionRunnerIdentity {
  git_sha: string;
  source_digest: Sha256Digest;
}

export interface LabRegressionConsumptionSummary {
  output: string;
  regression_id: string;
  job_id: string;
  new_model_calls: number;
  integrity: Array<"pass" | "fail" | "not_run" | "needs_review" | undefined>;
  quality: "needs_review";
  release_authority: "none";
  ci_verification: "not_verified";
}

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
    }
  }
  return out.sort();
}

/** Product source identity only; the private evaluation harness is not part of it. */
export function productSourceDigest(sourceRoot: string): Sha256Digest {
  const roots = [
    "packages/evaluation/src",
    "packages/contracts/src",
    "apps/backend/src/evaluation",
  ];
  const files: Array<{ path: string; digest: string }> = [];
  for (const root of roots) {
    for (const path of walkSourceFiles(resolve(sourceRoot, root))) {
      files.push({
        path: relative(sourceRoot, path).split(sep).join("/"),
        digest: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    }
  }
  if (files.length === 0) throw new Error("LAB_CONSUMER_SOURCE_UNAVAILABLE");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return digestCanonicalJson({ files });
}

export async function labRegressionRunnerIdentity(
  sourceRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LabRegressionRunnerIdentity> {
  let git_sha = environment.GIT_SHA;
  if (!git_sha) {
    try {
      git_sha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })).stdout.trim();
    } catch {
      git_sha = "unknown-git-sha";
    }
  }
  return { git_sha, source_digest: productSourceDigest(sourceRoot) };
}

async function readBoundedJson(path: string): Promise<unknown> {
  const file = await open(path, "r");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > MAX_INPUT_BYTES) throw new Error("LAB_INPUT_FILE_TOO_LARGE");
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    throw new Error("LAB_INPUT_INVALID_JSON");
  }
}

export interface LabRegressionCommandArguments {
  backend?: string;
  regressionId?: string;
  runId?: string;
  bundle?: string;
  run?: string;
  output: string;
}

export function parseLabRegressionArguments(argv: readonly string[]): LabRegressionCommandArguments {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("LAB_CONSUMER_ARGUMENTS_INVALID");
    options.set(flag, value);
  }
  const output = options.get("--output");
  if (!output) throw new Error("LAB_CONSUMER_OUTPUT_REQUIRED");
  const result: LabRegressionCommandArguments = { output };
  const backend = options.get("--backend");
  if (backend !== undefined) result.backend = backend;
  const regressionId = options.get("--regression-id");
  if (regressionId !== undefined) result.regressionId = regressionId;
  const runId = options.get("--run-id");
  if (runId !== undefined) result.runId = runId;
  const bundle = options.get("--bundle");
  if (bundle !== undefined) result.bundle = bundle;
  const run = options.get("--run");
  if (run !== undefined) result.run = run;
  return result;
}

export async function runLabRegressionConsumption(
  argv: readonly string[],
  options: {
    environment?: NodeJS.ProcessEnv;
    sourceRoot?: string;
    now?: () => string;
    fetcher?: typeof fetch;
  } = {},
): Promise<{ summary: LabRegressionConsumptionSummary; exitCode: number }> {
  const environment = options.environment ?? process.env;
  const sourceRoot = options.sourceRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const args = parseLabRegressionArguments(argv);
  let records: { bundle: unknown; job: unknown };
  let transport: "authenticated_backend_readback" | "reviewed_local_files";
  if (args.backend) {
    if (args.bundle || args.run) throw new Error("Choose backend readback or reviewed files, not both.");
    transport = "authenticated_backend_readback";
    records = options.fetcher
      ? await readLabRegressionFromBackend({
        baseURL: args.backend, token: environment.TS_LAB_EVALUATION_TOKEN ?? "",
        regressionID: args.regressionId ?? "", runID: args.runId ?? "",
      }, options.fetcher)
      : await readLabRegressionFromBackend({
        baseURL: args.backend, token: environment.TS_LAB_EVALUATION_TOKEN ?? "",
        regressionID: args.regressionId ?? "", runID: args.runId ?? "",
      });
  } else {
    if (!args.bundle || !args.run) throw new Error("Choose backend readback or reviewed files, not both.");
    transport = "reviewed_local_files";
    records = { bundle: await readBoundedJson(args.bundle), job: await readBoundedJson(args.run) };
  }
  const runner = await labRegressionRunnerIdentity(sourceRoot, environment);
  const report = consumeLabRegression({
    ...records,
    now: options.now ? options.now() : new Date().toISOString(),
    runner,
    transport,
  });
  const outputPath = resolve(args.output);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  // Reports have no execution or CI authority. Any unknown, missing or failed
  // integrity check fails this command.
  const integrity = report.results.map((result) =>
    result.gate.capabilities.find((gate) => gate.capability === "integrity")?.status,
  );
  const exitCode = report.results.some((result) =>
    result.gate.capabilities.some((gate) => gate.capability === "integrity" && gate.status !== "pass"),
  ) ? 1 : 0;
  const summary: LabRegressionConsumptionSummary = {
    output: outputPath,
    regression_id: report.regression_id,
    job_id: report.job_id,
    new_model_calls: 0,
    integrity,
    quality: "needs_review",
    release_authority: "none",
    ci_verification: "not_verified",
  };
  return { summary, exitCode };
}

async function main(): Promise<void> {
  try {
    const { summary, exitCode } = await runLabRegressionConsumption(process.argv.slice(2));
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
