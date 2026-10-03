import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type LabJob, type LabRegressionExport } from "@talent-signal/contracts";
import { consumeLabRegression, contentDigestMatches, digestCanonicalJson } from "@talent-signal/evaluation";

import {
  parseLabRegressionArguments,
  productSourceDigest,
  runLabRegressionConsumption,
} from "./consumeLabRegressionCommand.js";
import { labReadbackURL, readLabRegressionFromBackend } from "./labRegressionReadback.js";

const now = "2026-09-04T10:00:00.000Z", hash = (value: unknown) => digestCanonicalJson(value).slice(7);
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const input = { objective: "Synthetic question", context_blocks: [], allowed_citation_ids: ["source-1"] };
  const sample = { id: "synthetic-conflict", title: "Synthetic conflict", revision: "1", partition: "held_out" as const,
    input_json: JSON.stringify(input), input_hash: hash(input), expected: "Original expectation." };
  const definition: LabJob["definition"] = { task: "relationship_text", cases: [sample],
    configurations: [{ model: "fixture-model", prompt_preset: "baseline", prompt_revision: "prompt-1" }, { model: "fixture-model", prompt_preset: "concise", prompt_revision: "prompt-2" }],
    comparison: "prompt", repetitions: 1, call_limit: 2, max_output_tokens_per_call: 1600, reference_time: now,
    backend_revision: "fixture-backend-revision", instrument_revision: "lab-relationship-answer-job/1", tool_access: [], business_write_count: 0, cost_status: "unavailable" };
  const attempts: LabJob["attempts"] = [0, 1].map((i) => ({ id: uuid(i + 20), ordinal: i, case_id: sample.id, configuration_index: i, repetition: 1,
    status: "completed", started_at: now, finished_at: now, requested_model: "fixture-model", actual_model: "fixture-model",
    prompt_revision: `prompt-${i + 1}`, actual_prompt_revision: `prompt-${i + 1}`, provider_request_id: `fixture-${i}`, duration_ms: 10,
    input_tokens: 20, output_tokens: 5, title: "Synthetic result", answer: "Model output marker; inspect the evidence.", citation_ids: ["source-1"], error_code: null,
    checks: [{ id: "output_contract", verdict: "pass", summary: "Fixture output shape" }] }));
  const snapshot: LabRegressionExport["snapshot"] = { schema_version: "lab-regression.v1", data_class: "registered_synthetic",
    source_job_id: uuid(1), source_definition_hash: hash(definition), source_attempt: { ...attempts[0]!, id: uuid(10) }, case: sample,
    configurations: definition.configurations, reference_time: now, backend_revision: definition.backend_revision, instrument_revision: definition.instrument_revision,
    failure_categories: ["missed_uncertainty"], expected_behavior: "Expected behavior marker", review_note: "Private review marker", reviewer_id: uuid(3), reviewed_at: now };
  const bundle: LabRegressionExport = { schema_version: "lab-regression-bundle.v1", execution_authority: "none", id: uuid(2), content_hash: hash(snapshot),
    snapshot, created_at: now, expires_at: "2026-12-01T10:00:00.000Z" };
  definition.regression_source = { id: bundle.id, content_hash: bundle.content_hash };
  const job: LabJob = { id: uuid(4), definition_hash: hash(definition), definition, status: "completed", attempts, calls_reserved: 2,
    created_at: now, expires_at: "2026-09-11T10:00:00.000Z", cancel_requested_at: null, review: "b", failure_categories: [], quality: "needs_review" };
  return { bundle: structuredClone(bundle), job: structuredClone(job) };
}
function consume(records = fixture()) {
  return consumeLabRegression({ ...records, now, runner: { git_sha: "consumer-only-revision", source_digest: digestCanonicalJson({ fixture: true }) }, transport: "reviewed_local_files" });
}
describe("Lab regression consumption", () => {
  it("reuses atomic gates, exports no content, and never promotes preference or reviewed held-out failures", () => {
    const report = consume();
    expect(contentDigestMatches(report)).toBe(true);
    expect(report.backend_revision).toBe("fixture-backend-revision");
    expect(report.runner.git_sha).toBe("consumer-only-revision");
    expect(report.evaluation_partition).toBe("dev"); expect(report.source_partition).toBe("held_out");
    expect(report.release_authority).toBe("none"); expect(report.ci_verification).toBe("not_verified"); expect(report.new_model_calls).toBe(0);
    expect(report.results.map((value) => value.gate.status)).toEqual(["needs_review", "needs_review"]);
    expect(report.results.every((value) => value.gate.capabilities.find((gate) => gate.capability === "integrity")?.status === "pass")).toBe(true);
    for (const secret of ["Private review marker", "Expected behavior marker", "Model output marker", "Synthetic question"]) expect(JSON.stringify(report)).not.toContain(secret);
  });
  it("rejects tampered snapshots and a different run's source binding", () => {
    const records = fixture(); records.bundle.snapshot.review_note = "changed";
    expect(() => consume(records)).toThrow("LAB_RECORD_HASH_MISMATCH");
    const other = fixture(); other.job.definition.regression_source!.id = uuid(100); other.job.definition_hash = hash(other.job.definition);
    expect(() => consume(other)).toThrow("LAB_RUN_LINEAGE_MISMATCH");
  });
  it("rejects changed frozen inputs and clocks even after the new run is rehashed", () => {
    for (const change of ["input", "clock"]) {
      const records = structuredClone(fixture());
      if (change === "input") records.job.definition.cases[0]!.input_json = "{}";
      else records.job.definition.reference_time = "2026-09-05T10:00:00.000Z";
      records.job.definition_hash = hash(records.job.definition);
      expect(() => consume(records)).toThrow("LAB_FROZEN_CASE_CHANGED");
    }
  });
  it("requires a complete, unique matrix of attempts", () => {
    const records = fixture(); records.job.attempts[1] = records.job.attempts[0]!;
    expect(() => consume(records)).toThrow("LAB_DUPLICATE_ATTEMPT");
    records.job.attempts.pop(); expect(() => consume(records)).toThrow("LAB_ATTEMPT_COUNT_INVALID");
  });
  it("fails hard checks for an unapproved citation or actual configuration despite recorded preference", () => {
    const records = fixture(); records.job.attempts[0]!.citation_ids = ["unauthorized"];
    records.job.attempts[1]!.actual_prompt_revision = "silent-fallback";
    expect(consume(records).results.map((value) => value.gate.status)).toEqual(["fail", "fail"]);
  });
  it("does not convert an unknown attempt or missing output into a passing run", () => {
    const records = fixture(); records.job.status = "partial"; records.job.attempts[0]!.status = "unknown"; records.job.attempts[1]!.answer = null;
    expect(consume(records).results.map((value) => value.gate.status)).toEqual(["not_run", "fail"]);
  });
  it("rejects expired or still running records", () => {
    const records = fixture(); records.job.status = "running"; expect(() => consume(records)).toThrow("LAB_RUN_NOT_TERMINAL");
    records.job.status = "completed"; records.bundle.expires_at = now; expect(() => consume(records)).toThrow("LAB_RECORD_EXPIRED");
  });
});

describe("Authenticated Lab readback", () => {
  it("uses only the selected origin, never follows redirects, and rechecks deletion after run readback", async () => {
    const records = fixture(); const requests: Array<{ url: string; options: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      requests.push({ url: String(url), options });
      return Response.json(requests.length === 2 ? { contract_version: CONTRACT_VERSION, job: records.job } : records.bundle);
    });
    const result = await readLabRegressionFromBackend({ baseURL: "https://test.example", token: "scoped-token", regressionID: records.bundle.id, runID: records.job.id }, fetcher);
    expect(result).toEqual(records); expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.url.startsWith("https://test.example/v1/") && request.options?.redirect === "error")).toBe(true);
    const deleted = vi.fn().mockResolvedValueOnce(Response.json(records.bundle))
      .mockResolvedValueOnce(Response.json({ contract_version: CONTRACT_VERSION, job: records.job })).mockResolvedValueOnce(new Response(null, { status: 410 }));
    await expect(readLabRegressionFromBackend({ baseURL: "http://127.0.0.1:4329", token: "scoped-token", regressionID: records.bundle.id, runID: records.job.id }, deleted)).rejects.toThrow("LAB_READBACK_HTTP_410");
  });
  it("rejects credentialed URLs, non-TLS remote origins, oversized bodies and swapped identities", async () => {
    for (const value of ["http://test.example", "https://user:pass@test.example", "https://test.example/path", "https://test.example?token=hidden"]) expect(() => labReadbackURL(value)).toThrow();
    const records = fixture(), input = { baseURL: "https://test.example", token: "scoped-token", regressionID: records.bundle.id, runID: records.job.id };
    await expect(readLabRegressionFromBackend(input, vi.fn().mockResolvedValue(new Response("x".repeat(512_001))))).rejects.toThrow("LAB_READBACK_TOO_LARGE");
    const wrong = { ...records.bundle, id: uuid(100) };
    await expect(readLabRegressionFromBackend(input, vi.fn().mockResolvedValueOnce(Response.json(wrong))
      .mockResolvedValueOnce(Response.json({ contract_version: CONTRACT_VERSION, job: records.job })))).rejects.toThrow("LAB_READBACK_BINDING_MISMATCH");
  });
});

describe("Consumer command", () => {
  const temporary: string[] = [];
  afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
  function workspace() {
    const directory = mkdtempSync(join(tmpdir(), "lab-consumer-")); temporary.push(directory); return directory;
  }
  const sourceRoot = resolve(import.meta.dirname, "../../../..");

  it("requires exactly one transport and an explicit output", async () => {
    expect(() => parseLabRegressionArguments(["--bundle", "a", "--output", "o"])).not.toThrow();
    expect(() => parseLabRegressionArguments(["--bundle", "a"])).toThrow("LAB_CONSUMER_OUTPUT_REQUIRED");
    expect(() => parseLabRegressionArguments(["--bundle", "a", "--output"])).toThrow("LAB_CONSUMER_ARGUMENTS_INVALID");
    await expect(runLabRegressionConsumption(["--backend", "https://test.example", "--bundle", "a", "--run", "b", "--output", "o"],
      { sourceRoot, environment: { GIT_SHA: "consumer-only-revision" } })).rejects.toThrow("Choose backend readback or reviewed files, not both.");
  });

  it("writes the canonical report from reviewed files and passes only for intact integrity gates", async () => {
    const directory = workspace();
    const records = fixture();
    const bundlePath = join(directory, "bundle.json"), runPath = join(directory, "run.json");
    writeFileSync(bundlePath, JSON.stringify(records.bundle)); writeFileSync(runPath, JSON.stringify(records.job));
    const output = join(directory, "report", "lab-regression-report.json");
    const passed = await runLabRegressionConsumption(
      ["--bundle", bundlePath, "--run", runPath, "--output", output],
      { sourceRoot, environment: { GIT_SHA: "consumer-only-revision" }, now: () => now },
    );
    expect(passed.exitCode).toBe(0);
    expect(passed.summary.integrity).toEqual(["pass", "pass"]);
    expect(passed.summary.release_authority).toBe("none");
    const report = JSON.parse(readFileSync(output, "utf8")) as Record<string, any> & { contentDigest: `sha256:${string}` };
    expect(report.schemaVersion).toBe("lab-regression-consumption.v1");
    expect(report.transport).toBe("reviewed_local_files");
    expect(report.runner.git_sha).toBe("consumer-only-revision");
    expect(report.runner.source_digest).toBe(productSourceDigest(sourceRoot));
    expect(contentDigestMatches(report)).toBe(true);

    const failed = fixture(); failed.job.attempts[0]!.citation_ids = ["unauthorized"];
    const failedDirectory = workspace();
    const failedBundle = join(failedDirectory, "bundle.json"), failedRun = join(failedDirectory, "run.json");
    writeFileSync(failedBundle, JSON.stringify(failed.bundle)); writeFileSync(failedRun, JSON.stringify(failed.job));
    const failedOutput = join(failedDirectory, "lab-regression-report.json");
    const rejected = await runLabRegressionConsumption(
      ["--bundle", failedBundle, "--run", failedRun, "--output", failedOutput],
      { sourceRoot, environment: { GIT_SHA: "consumer-only-revision" }, now: () => now },
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.summary.integrity).toEqual(["fail", "pass"]);
  });

  it("consumes an authenticated backend readback with the same trust semantics", async () => {
    const directory = workspace();
    const records = fixture();
    const requests: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      requests.push(String(url));
      return Response.json(requests.length === 2 ? { contract_version: CONTRACT_VERSION, job: records.job } : records.bundle);
    });
    const output = join(directory, "lab-regression-report.json");
    const result = await runLabRegressionConsumption(
      ["--backend", "https://test.example", "--regression-id", records.bundle.id, "--run-id", records.job.id, "--output", output],
      { sourceRoot, environment: { GIT_SHA: "consumer-only-revision", TS_LAB_EVALUATION_TOKEN: "scoped-token" }, now: () => now, fetcher },
    );
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(readFileSync(output, "utf8")) as Record<string, any> & { contentDigest: `sha256:${string}` };
    expect(report.transport).toBe("authenticated_backend_readback");
    expect(report.regression_id).toBe(records.bundle.id);
    expect(report.job_id).toBe(records.job.id);
    expect(requests).toHaveLength(3);
  });
});
