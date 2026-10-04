import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CandidateMomentumCase } from "../candidateMomentum";
import { loadCandidateWorkspace } from "./candidateWorkspace";

const CASE_IDS = [
  "TS-CORE-01",
  "TS-CORE-02",
  "TS-CORE-03",
  "TS-CORE-04",
  "TS-ID-01",
  "TS-ID-03",
  "TS-ACT-01",
  "TS-BOUND-01",
] as const;

/** Tiny synthetic unit corpus: shape only, never the private benchmark. */
function syntheticCorpusPayload() {
  return {
    suite_id: "talent-signal-candidate-momentum-v1",
    version: "2026-08-05.1",
    purpose: "Synthetic unit corpus",
    cases: CASE_IDS.map((id) => ({
      id,
      title: `Synthetic unit case ${id}`,
      context: {
        captured_at: "2026-01-01T09:00:00+08:00",
        source_timezone: "Asia/Singapore",
        candidate: "Synthetic Person",
        assignment: "Synthetic Assignment",
      },
      messages: [
        { id: "m1", speaker: "candidate", text: "Synthetic unit message." },
      ],
      expected: {
        disposition: "propose_action",
        assertions: [
          {
            field: "availability",
            status: "proposed",
            value: "synthetic window",
            evidence_message_id: "m1",
            evidence_quote: "Synthetic",
          },
        ],
        action: {
          type: "prepare_question",
          owner: "recruiter",
          target: "synthetic dependency",
          reason: "Synthetic bounded reason.",
          due: "synthetic due window",
          evidence_message_ids: ["m1"],
        },
        must_not: [],
      },
    })),
  };
}

async function writeEvaluationRepository(
  options: {
    marker?: unknown;
    corpus?: unknown;
    omitMarker?: boolean;
    omitCorpus?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "capir-eval-repo-"));
  await mkdir(join(root, "evals"), { recursive: true });
  if (!options.omitMarker) {
    await writeFile(
      join(root, ".capir-evaluation.json"),
      JSON.stringify(
        options.marker ?? {
          schemaVersion: "capir-private-evaluation.v1",
          repository: "getyak/capir-evals",
        },
      ),
    );
  }
  if (!options.omitCorpus) {
    await writeFile(
      join(root, "evals", "candidate-momentum-v1.json"),
      JSON.stringify(options.corpus ?? syntheticCorpusPayload()),
    );
  }
  return root;
}

describe("candidate workspace private corpus loader", () => {
  let originalEvalRepo: string | undefined;
  let originalBackendUrl: string | undefined;
  const cleanup: string[] = [];

  beforeEach(() => {
    originalEvalRepo = process.env.CAPIR_EVAL_REPO;
    originalBackendUrl = process.env.TALENT_SIGNAL_BACKEND_URL;
    delete process.env.CAPIR_EVAL_REPO;
    delete process.env.TALENT_SIGNAL_BACKEND_URL;
  });

  afterEach(async () => {
    if (originalEvalRepo === undefined) {
      delete process.env.CAPIR_EVAL_REPO;
    } else {
      process.env.CAPIR_EVAL_REPO = originalEvalRepo;
    }
    if (originalBackendUrl === undefined) {
      delete process.env.TALENT_SIGNAL_BACKEND_URL;
    } else {
      process.env.TALENT_SIGNAL_BACKEND_URL = originalBackendUrl;
    }
    await Promise.all(
      cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("shows a clear unavailable state when no private repository is configured", async () => {
    const result = await loadCandidateWorkspace();

    expect(result.dataset).toBeNull();
    expect(result.source.kind).toBe("unavailable");
    expect(result.source.detail).toContain("CAPIR_EVAL_REPO");
  });

  it("rejects a relative evaluation repository path", async () => {
    process.env.CAPIR_EVAL_REPO = "evals/relative";

    const result = await loadCandidateWorkspace();

    expect(result.dataset).toBeNull();
    expect(result.source.kind).toBe("unavailable");
    expect(result.source.detail).toContain("absolute");
  });

  it("rejects an evaluation repository inside the product checkout", async () => {
    const insideCheckout = await mkdtemp(
      join(process.cwd(), "tmp-eval-inside-"),
    );
    cleanup.push(insideCheckout);
    process.env.CAPIR_EVAL_REPO = insideCheckout;

    const result = await loadCandidateWorkspace();

    expect(result.dataset).toBeNull();
    expect(result.source.kind).toBe("unavailable");
    expect(result.source.detail).toContain("outside the product checkout");
  });

  it("rejects a symlink that smuggles the evaluation repository into the checkout", async () => {
    const external = await writeEvaluationRepository();
    cleanup.push(external);
    const smuggled = await mkdtemp(join(process.cwd(), "tmp-eval-link-"));
    cleanup.push(smuggled);
    const linkPath = join(smuggled, "capir-evals");
    await symlink(external, linkPath);
    process.env.CAPIR_EVAL_REPO = linkPath;

    const result = await loadCandidateWorkspace();

    expect(result.dataset).toBeNull();
    expect(result.source.kind).toBe("unavailable");
    expect(result.source.detail).toContain("outside the product checkout");
  });

  it("requires the capir-evals marker with the frozen schema", async () => {
    const missingMarker = await writeEvaluationRepository({ omitMarker: true });
    cleanup.push(missingMarker);
    process.env.CAPIR_EVAL_REPO = missingMarker;
    let result = await loadCandidateWorkspace();
    expect(result.dataset).toBeNull();
    expect(result.source.detail).toContain("marker");

    const wrongMarker = await writeEvaluationRepository({
      marker: { schemaVersion: "other.v0", repository: "someone/else" },
    });
    cleanup.push(wrongMarker);
    process.env.CAPIR_EVAL_REPO = wrongMarker;
    result = await loadCandidateWorkspace();
    expect(result.dataset).toBeNull();
    expect(result.source.detail).toContain("getyak/capir-evals");
  });

  it("rejects a corpus that deviates from the frozen contract", async () => {
    const tampered = await writeEvaluationRepository({
      corpus: {
        ...syntheticCorpusPayload(),
        cases: syntheticCorpusPayload().cases.map((item, index) =>
          index === 0
            ? {
                ...item,
                expected: {
                  ...item.expected,
                  disposition: "no_action",
                },
              }
            : item,
        ),
      },
    });
    cleanup.push(tampered);
    process.env.CAPIR_EVAL_REPO = tampered;

    const result = await loadCandidateWorkspace();

    expect(result.dataset).toBeNull();
    expect(result.source.kind).toBe("unavailable");
    expect(result.source.detail).toContain("frozen candidate-momentum contract");
  });

  it("loads the configured private corpus without any backend", async () => {
    const repository = await writeEvaluationRepository();
    cleanup.push(repository);
    process.env.CAPIR_EVAL_REPO = repository;

    const result = await loadCandidateWorkspace();

    expect(result.source.kind).toBe("fixture-local");
    expect(result.dataset?.suite_id).toBe("talent-signal-candidate-momentum-v1");
    expect(result.dataset?.cases.map((item: CandidateMomentumCase) => item.id)).toEqual([
      ...CASE_IDS,
    ]);
  });

  it("keeps private files as fixture input even if they claim synchronization", async () => {
    const repository = await writeEvaluationRepository({corpus:{...syntheticCorpusPayload(),data_mode:"synchronized"}});
    cleanup.push(repository);
    process.env.CAPIR_EVAL_REPO = repository;
    const result = await loadCandidateWorkspace();
    expect(result.source.kind).toBe("fixture-local");
    expect(result.dataset?.data_mode).toBe("fixture");
  });

  it("rejects a corpus symlink escaping the configured private repository", async () => {
    const repository = await writeEvaluationRepository({omitCorpus:true});
    const other = await writeEvaluationRepository();
    cleanup.push(repository, other);
    await symlink(join(other,"evals","candidate-momentum-v1.json"),join(repository,"evals","candidate-momentum-v1.json"));
    process.env.CAPIR_EVAL_REPO = repository;
    const result = await loadCandidateWorkspace();
    expect(result.dataset).toBeNull();
    expect(result.source.detail).toContain("inside the configured");
  });

  it("falls back to the private corpus when the localhost backend is unreachable", async () => {
    const repository = await writeEvaluationRepository();
    cleanup.push(repository);
    process.env.CAPIR_EVAL_REPO = repository;
    process.env.TALENT_SIGNAL_BACKEND_URL = "http://127.0.0.1:1";

    const result = await loadCandidateWorkspace();

    expect(result.dataset?.cases).toHaveLength(CASE_IDS.length);
    expect(result.source.kind).toBe("fixture-local");
    expect(result.source.detail).toContain("本地主机后端无法核验");
  });
});
