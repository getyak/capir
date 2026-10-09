import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { LabJob, LabRegressionExport } from "@talent-signal/contracts";
import { consumeLabRegression, digestCanonicalJson, sha256Bytes } from "@talent-signal/evaluation";
import { readLabCIArchive } from "./labCIArchive.js";
import { GitHubLabCIVerifier, environmentLabCIVerifier } from "./labCIVerifier.js";

const now = "2026-09-04T12:00:00.000Z", revision = "a".repeat(40), repositoryId = 1322192683;
// Self-contained synthetic Lab records. The historical native proof this test
// once read lives in the private capir-evals evidence archive; public tests do
// not depend on private evaluation data.
const hash = (value: unknown) => digestCanonicalJson(value).slice(7);
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function syntheticRecords(): { export_bundle: LabRegressionExport; rerun: LabJob } {
  const reference = "2026-09-04T10:00:00.000Z";
  const input = { objective: "Synthetic question", context_blocks: [], allowed_citation_ids: ["source-1"] };
  const sample = { id: "synthetic-conflict", title: "Synthetic conflict", revision: "1", partition: "held_out" as const,
    input_json: JSON.stringify(input), input_hash: hash(input), expected: "Original expectation." };
  const definition: LabJob["definition"] = { task: "relationship_text", cases: [sample],
    configurations: [{ model: "fixture-model", prompt_preset: "baseline", prompt_revision: "prompt-1" }, { model: "fixture-model", prompt_preset: "concise", prompt_revision: "prompt-2" }],
    comparison: "prompt", repetitions: 1, call_limit: 2, max_output_tokens_per_call: 1600, reference_time: reference,
    backend_revision: "fixture-backend-revision", instrument_revision: "lab-relationship-answer-job/1", tool_access: [], business_write_count: 0, cost_status: "unavailable" };
  const attempts: LabJob["attempts"] = [0, 1].map((i) => ({ id: uuid(i + 20), ordinal: i, case_id: sample.id, configuration_index: i, repetition: 1,
    status: "completed", started_at: reference, finished_at: reference, requested_model: "fixture-model", actual_model: "fixture-model",
    prompt_revision: `prompt-${i + 1}`, actual_prompt_revision: `prompt-${i + 1}`, provider_request_id: `fixture-${i}`, duration_ms: 10,
    input_tokens: 20, output_tokens: 5, title: "Synthetic result", answer: "Model output marker; inspect the evidence.", citation_ids: ["source-1"], error_code: null,
    checks: [{ id: "output_contract", verdict: "pass", summary: "Fixture output shape" }] }));
  const snapshot: LabRegressionExport["snapshot"] = { schema_version: "lab-regression.v1", data_class: "registered_synthetic",
    source_job_id: uuid(1), source_definition_hash: hash(definition), source_attempt: { ...attempts[0]!, id: uuid(10) }, case: sample,
    configurations: definition.configurations, reference_time: reference, backend_revision: definition.backend_revision, instrument_revision: definition.instrument_revision,
    failure_categories: ["missed_uncertainty"], expected_behavior: "Expected behavior marker", review_note: "Review note marker", reviewer_id: uuid(3), reviewed_at: reference };
  const export_bundle: LabRegressionExport = { schema_version: "lab-regression-bundle.v1", execution_authority: "none", id: uuid(2), content_hash: hash(snapshot),
    snapshot, created_at: reference, expires_at: "2026-12-01T10:00:00.000Z" };
  definition.regression_source = { id: export_bundle.id, content_hash: export_bundle.content_hash };
  const rerun: LabJob = { id: uuid(4), definition_hash: hash(definition), definition, status: "completed", attempts, calls_reserved: 2,
    created_at: reference, expires_at: "2026-09-11T10:00:00.000Z", cancel_requested_at: null, review: "b", failure_categories: [], quality: "needs_review" };
  return { export_bundle, rerun };
}
const stored = syntheticRecords();
function archive(value: unknown, name = "lab-regression-report.json", method = 8) {
  const payload = Buffer.from(JSON.stringify(value)), filename = Buffer.from(name), compressed = method === 8 ? deflateRawSync(payload) : payload;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(payload), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(payload), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(payload.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
function fixture() {
  const bundle = structuredClone(stored.export_bundle), job = structuredClone(stored.rerun);
  const report = consumeLabRegression({ bundle, job, now, runner: { git_sha: revision, source_digest: digestCanonicalJson({ fixture: true }) }, transport: "authenticated_backend_readback" });
  const workflow = "name: pinned fixture workflow\n";
  const run = { id: 123, repository: { id: repositoryId, full_name: "getyak/talent-signal" }, head_repository: { id: repositoryId },
    head_sha: revision, head_branch: "main", status: "completed", conclusion: "success", event: "workflow_dispatch", run_attempt: 2, path: ".github/workflows/ci.yml" };
  const ciJob = { id: 456, run_id: 123, head_sha: revision, status: "completed", conclusion: "success", name: "Backend quality",
    steps: [{ name: "Consume the selected Lab regression", status: "completed", conclusion: "success", started_at: "2026-09-04T11:59:59.000Z", completed_at: "2026-09-04T12:00:01.000Z" }] };
  let bytes = archive(report);
  const artifact = { id: 789, name: "lab-regression-consumption-123-2", expired: false, expires_at: "2026-09-05T00:00:00.000Z",
    created_at: "2026-09-04T12:00:02.000Z", size_in_bytes: bytes.length, digest: sha256Bytes(bytes),
    workflow_run: { id: 123, head_sha: revision, repository_id: repositoryId, head_repository_id: repositoryId } };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const changes = { workflow, currentAttempt: 2, blobURL: "https://fixture.blob.core.windows.net/report?signature=fixture-only", expiredOnReadback: false };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push({ url, ...(init ? { init } : {}) });
    if (new URL(url).hostname === "fixture.blob.core.windows.net") return new Response(bytes);
    if (url.endsWith("/actions/artifacts/789/zip")) return new Response(null, { status: 302, headers: { location: changes.blobURL } });
    if (url.endsWith("/actions/runs/123")) return Response.json({ ...run, run_attempt: requests.length > 1 ? changes.currentAttempt : run.run_attempt });
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from(changes.workflow).toString("base64") });
    if (url.includes("/jobs?")) return Response.json({ total_count: 1, jobs: [ciJob] });
    if (url.includes("/artifacts?")) return Response.json({ total_count: 1, artifacts: [artifact] });
    if (url.endsWith("/actions/artifacts/789")) return Response.json({ ...artifact, expired: changes.expiredOnReadback });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const verifier = new GitHubLabCIVerifier({ repository: "getyak/talent-signal", repositoryId, workflowSha256: sha256Bytes(workflow).slice(7), token: "fixture-token", branches: ["main"] }, fetcher, () => Date.parse(now));
  const setArchive = (value: unknown) => { bytes = archive(value); artifact.digest = sha256Bytes(bytes); artifact.size_in_bytes = bytes.length; };
  return { bundle, job, report, run, ciJob, artifact, requests, changes, verifier, setArchive };
}

describe("GitHub Lab CI evidence verification", () => {
  it("verifies the exact artifact and re-evaluates its bound product rerun without forwarding the credential", async () => {
    const f = fixture(); const proof = await f.verifier.verify(f.bundle, f.job, 123);
    expect(proof.integrity).toBe("pass"); expect(proof.runAttempt).toBe(2); expect(proof.reportDigest).toBe(f.report.contentDigest);
    const download = f.requests.find((value) => new URL(value.url).hostname === "fixture.blob.core.windows.net")!;
    expect(download.init?.headers).toBeUndefined(); expect(download.init?.redirect).toBe("error");
    expect(f.requests.filter((value) => value.url.startsWith("https://api.github.com/")).every((value) =>
      (value.init?.headers as Record<string, string>).authorization === "Bearer fixture-token")).toBe(true);
  });
  it("rejects an unrelated repository, unapproved branch, changed workflow or skipped check", async () => {
    for (const [change, code] of [
      [(f: ReturnType<typeof fixture>) => { f.run.head_repository.id = 5; }, "LAB_CI_REPOSITORY_MISMATCH"],
      [(f: ReturnType<typeof fixture>) => { f.run.head_branch = "unapproved"; }, "LAB_CI_WORKFLOW_NOT_TRUSTED"],
      [(f: ReturnType<typeof fixture>) => { f.changes.workflow = "different workflow"; }, "LAB_CI_WORKFLOW_CHANGED"],
      [(f: ReturnType<typeof fixture>) => { f.ciJob.steps[0]!.conclusion = "skipped"; }, "LAB_CI_STEP_NOT_EXECUTED"],
    ] as const) {
      const f = fixture(); change(f); await expect(f.verifier.verify(f.bundle, f.job, 123)).rejects.toMatchObject({ code });
    }
  });
  it("rejects incomplete runs, mismatched revisions and an artifact from an earlier run attempt", async () => {
    const unfinished = fixture(); unfinished.run.status = "in_progress";
    await expect(unfinished.verifier.verify(unfinished.bundle, unfinished.job, 123)).rejects.toMatchObject({ code: "LAB_CI_RUN_INCOMPLETE" });
    const old = fixture(); old.artifact.name = "lab-regression-consumption-123-1";
    await expect(old.verifier.verify(old.bundle, old.job, 123)).rejects.toMatchObject({ code: "LAB_CI_ARTIFACT_NOT_FOUND" });
    const other = fixture(); other.report.runner.git_sha = "b".repeat(40); other.setArchive(other.report);
    await expect(other.verifier.verify(other.bundle, other.job, 123)).rejects.toMatchObject({ code: "LAB_CI_REPORT_REVISION_MISMATCH" });
  });
  it("rejects a hash-valid archive whose report invents success or identifies another case", async () => {
    const fake = fixture(); fake.report.results[0]!.gate.status = "pass";
    const { contentDigest: _ignored, ...content } = fake.report; fake.report.contentDigest = digestCanonicalJson(content); fake.setArchive(fake.report);
    await expect(fake.verifier.verify(fake.bundle, fake.job, 123)).rejects.toMatchObject({ code: "LAB_CI_REPORT_CONTENT_MISMATCH" });
    const other = fixture(); other.bundle.id = "10000000-0000-4000-8000-000000000001";
    await expect(other.verifier.verify(other.bundle, other.job, 123)).rejects.toMatchObject({ code: "LAB_CI_VERIFICATION_UNAVAILABLE" });
  });
  it("rejects a mismatched download digest and denies a non-artifact redirect origin", async () => {
    const f = fixture(); f.artifact.digest = `sha256:${"0".repeat(64)}`;
    await expect(f.verifier.verify(f.bundle, f.job, 123)).rejects.toMatchObject({ code: "LAB_CI_ARTIFACT_HASH_MISMATCH" });
    const external = fixture(); external.changes.blobURL = "https://untrusted.example/report";
    await expect(external.verifier.verify(external.bundle, external.job, 123)).rejects.toMatchObject({ code: "LAB_CI_DOWNLOAD_ORIGIN_DENIED" });
    expect(external.requests.some((value) => value.url.includes("untrusted.example"))).toBe(false);
  });
  it("invalidates evidence if CI reruns or the artifact expires during download", async () => {
    const f = fixture(); f.changes.currentAttempt = 3;
    await expect(f.verifier.verify(f.bundle, f.job, 123)).rejects.toMatchObject({ code: "LAB_CI_EVIDENCE_CHANGED" });
    const expired = fixture(); expired.changes.expiredOnReadback = true;
    await expect(expired.verifier.verify(expired.bundle, expired.job, 123)).rejects.toMatchObject({ code: "LAB_CI_EVIDENCE_CHANGED" });
  });
  it("records an honestly failed integrity check without upgrading semantic quality", async () => {
    const f = fixture(); f.job.attempts[0]!.citation_ids = ["unauthorized-citation"];
    f.setArchive(consumeLabRegression({ bundle: f.bundle, job: f.job, now, runner: f.report.runner, transport: "authenticated_backend_readback" }));
    f.run.conclusion = "failure"; f.ciJob.conclusion = "failure"; f.ciJob.steps[0]!.conclusion = "failure";
    expect((await f.verifier.verify(f.bundle, f.job, 123)).integrity).toBe("fail");
  });
  it("requires explicit operator trust and remains disabled without a server credential", () => {
    expect(environmentLabCIVerifier({})).toBeNull();
    expect(() => environmentLabCIVerifier({ TALENT_SIGNAL_LAB_CI_GITHUB_TOKEN: "fixture-token" })).toThrow("LAB_CI_TRUST_INVALID");
  });
});
describe("bounded CI archive", () => {
  it("accepts stored or deflated single reports", () => {
    for (const method of [0, 8]) expect(readLabCIArchive(archive({ fixture: true }, "lab-regression-report.json", method))).toEqual({ fixture: true });
  });
  it("rejects unexpected paths, invalid CRC, multiple files and expansion bombs", () => {
    expect(() => readLabCIArchive(archive({}, "../lab-regression-report.json"))).toThrow("LAB_CI_ARCHIVE_INVALID");
    const brokenCRC = archive({ fixture: true }); const central = brokenCRC.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); brokenCRC.writeUInt32LE(0, central + 16);
    expect(() => readLabCIArchive(brokenCRC)).toThrow("LAB_CI_ARCHIVE_INVALID");
    const many = archive({}); many.writeUInt16LE(2, many.length - 12); expect(() => readLabCIArchive(many)).toThrow("LAB_CI_ARCHIVE_INVALID");
    expect(() => readLabCIArchive(archive("x".repeat(512_001)))).toThrow("LAB_CI_ARCHIVE_INVALID");
  });
});
