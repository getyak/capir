import { describe, expect, it } from "vitest";
import {
  CANDIDATE_MOMENTUM_CASE_IDS,
  CANDIDATE_MOMENTUM_SUITE_ID,
  CANDIDATE_MOMENTUM_VERSION,
  getActionOwnerLabel,
  getActionTypeLabel,
  getCaseEvidence,
  getDispositionLabel,
  getFieldLabel,
  getSpeakerLabel,
  isCandidateMomentumDataset,
  localizeGeneratedCopy,
  parseCandidateMomentumDataset,
  type CandidateMomentumCase,
  type CandidateMomentumDataset,
} from "./candidateMomentum";

/**
 * Small independent synthetic unit fixtures. They exercise contract shape and
 * comparison logic only; they are not, and must never become, the private
 * eight-case evaluation corpus.
 */
function syntheticCase(
  id: CandidateMomentumCase["id"],
  overrides: Partial<CandidateMomentumCase> = {},
): CandidateMomentumCase {
  return {
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
    ...overrides,
  };
}

function syntheticDataset(): CandidateMomentumDataset {
  return {
    suite_id: CANDIDATE_MOMENTUM_SUITE_ID,
    version: CANDIDATE_MOMENTUM_VERSION,
    data_mode: "fixture",
    purpose: "Synthetic unit dataset",
    cases: CANDIDATE_MOMENTUM_CASE_IDS.map((id) => syntheticCase(id)),
  };
}

describe("candidate momentum contract registry", () => {
  it("keeps only the frozen identity registry in the public source", () => {
    expect([...CANDIDATE_MOMENTUM_CASE_IDS]).toEqual([
      "TS-CORE-01",
      "TS-CORE-02",
      "TS-CORE-03",
      "TS-CORE-04",
      "TS-ID-01",
      "TS-ID-03",
      "TS-ACT-01",
      "TS-BOUND-01",
    ]);
  });
});

describe("candidate momentum dataset shape", () => {
  it("rejects malformed optional context and broken evidence references", () => {
    for (const patch of [{notes:{}}, {requested_output:[]}, {prior_state:{availability:17}}]) {
      const value = syntheticDataset();
      Object.assign(value.cases[0].context, patch);
      expect(parseCandidateMomentumDataset(value)).toBeNull();
    }
    const missingMessage = syntheticDataset();
    missingMessage.cases[0].expected.assertions[0].evidence_message_id = "missing";
    expect(parseCandidateMomentumDataset(missingMessage)).toBeNull();
    const changedQuotation = syntheticDataset();
    changedQuotation.cases[0].expected.assertions[0].evidence_quote = "not in the source";
    expect(parseCandidateMomentumDataset(changedQuotation)).toBeNull();
  });
  it("accepts a complete explicitly labeled synthetic dataset", () => {
    const parsed = parseCandidateMomentumDataset(syntheticDataset());
    expect(parsed).not.toBeNull();
    expect(parsed?.cases.map((item) => item.id)).toEqual([
      ...CANDIDATE_MOMENTUM_CASE_IDS,
    ]);
  });

  it("treats a missing data_mode label as fixture and never as synchronized", () => {
    const unlabeled = { ...syntheticDataset() } as Record<string, unknown>;
    delete unlabeled.data_mode;
    expect(parseCandidateMomentumDataset(unlabeled)?.data_mode).toBe("fixture");
  });

  it("rejects wrong suite identity, wrong version, and unknown case ids", () => {
    expect(
      parseCandidateMomentumDataset({
        ...syntheticDataset(),
        suite_id: "some-other-suite",
      }),
    ).toBeNull();
    expect(
      parseCandidateMomentumDataset({
        ...syntheticDataset(),
        version: "1999-01-01.1",
      }),
    ).toBeNull();
    const unknownId = syntheticDataset();
    unknownId.cases[0] = syntheticCase("TS-CORE-01", { id: "TS-UNKNOWN-9" as CandidateMomentumCase["id"] });
    expect(parseCandidateMomentumDataset(unknownId)).toBeNull();
  });

  it("rejects incomplete or malformed case payloads", () => {
    expect(
      parseCandidateMomentumDataset({
        ...syntheticDataset(),
        cases: syntheticDataset().cases.slice(1),
      }),
    ).toBeNull();

    const malformed = syntheticDataset();
    malformed.cases[1] = syntheticCase("TS-CORE-02", {
      messages: [],
    });
    expect(parseCandidateMomentumDataset(malformed)).toBeNull();

    const brokenAction = syntheticDataset();
    brokenAction.cases[2] = syntheticCase("TS-CORE-03", {
      expected: {
        disposition: "propose_action",
        assertions: [],
        action: {
          type: "prepare_question",
          owner: "recruiter",
          target: "synthetic dependency",
          reason: "Synthetic bounded reason.",
          due: "synthetic due window",
          evidence_message_ids: "m1",
        } as unknown as CandidateMomentumCase["expected"]["action"],
        must_not: [],
      },
    });
    expect(parseCandidateMomentumDataset(brokenAction)).toBeNull();
  });
});

describe("candidate momentum frozen-contract comparison", () => {
  it("accepts only a dataset matching the explicit reference exactly", () => {
    const reference = syntheticDataset();
    const clone = syntheticDataset();
    expect(isCandidateMomentumDataset(clone, reference)).toBe(true);
  });

  it("rejects tampered oracles even when the shape still parses", () => {
    const reference = syntheticDataset();
    const tampered = syntheticDataset();
    tampered.cases[0] = {
      ...tampered.cases[0],
      expected: {
        ...tampered.cases[0].expected,
        assertions: [
          {
            ...tampered.cases[0].expected.assertions[0],
            value: "tampered synthetic value",
          },
        ],
      },
    };
    expect(parseCandidateMomentumDataset(tampered)).not.toBeNull();
    expect(isCandidateMomentumDataset(tampered, reference)).toBe(false);
  });

  it("rejects an action that contradicts the disposition registry", () => {
    const contradictory = syntheticDataset();
    contradictory.cases[1] = syntheticCase("TS-CORE-02", {
      expected: {
        disposition: "no_action",
        assertions: [],
        action: contradictory.cases[0].expected.action,
        must_not: [],
      },
    });
    expect(parseCandidateMomentumDataset(contradictory)).toBeNull();
  });

  it("rejects missing cases, missing labels, and an empty reference", () => {
    const reference = syntheticDataset();
    expect(
      isCandidateMomentumDataset(
        { ...syntheticDataset(), cases: syntheticDataset().cases.slice(2) },
        reference,
      ),
    ).toBe(false);
    expect(
      isCandidateMomentumDataset(
        { ...syntheticDataset(), data_mode: undefined },
        reference,
      ),
    ).toBe(false);
    expect(
      isCandidateMomentumDataset(syntheticDataset(), {
        ...reference,
        cases: [],
      }),
    ).toBe(false);
  });
});

describe("candidate momentum presentation helpers", () => {
  it("keeps case evidence and label registries generic", () => {
    const fixtureCase = syntheticCase("TS-CORE-04");
    expect(getCaseEvidence(fixtureCase, "m1")?.text).toBe(
      "Synthetic unit message.",
    );
    expect(getCaseEvidence(fixtureCase, "missing")).toBeUndefined();
    expect(getSpeakerLabel("candidate")).toBe("候选人");
    expect(getSpeakerLabel("hiring_manager")).toBe("用人经理");
    expect(getActionTypeLabel("prepare_question")).toBe("准备问题");
    expect(getActionOwnerLabel("recruiter")).toBe("招聘顾问");
    expect(getDispositionLabel("clarify")).toBe("需要澄清");
    expect(getFieldLabel("decision_deadline")).toBe("决定截止时间");
    expect(getFieldLabel("custom_field")).toBe("custom field");
  });

  it("renders generated copy verbatim without rewriting evidence", () => {
    expect(localizeGeneratedCopy("Synthetic bounded reason.")).toBe(
      "Synthetic bounded reason.",
    );
    expect(localizeGeneratedCopy("Exact source quotation.")).toBe(
      "Exact source quotation.",
    );
  });

  it("keeps synthetic action proposals singular and evidence linked", () => {
    for (const fixtureCase of syntheticDataset().cases) {
      const action = fixtureCase.expected.action;
      if (!action) {
        continue;
      }

      expect(action.type).toBe("prepare_question");
      expect(action.evidence_message_ids.length).toBeGreaterThan(0);
      expect(
        action.evidence_message_ids.every((id) =>
          fixtureCase.messages.some((message) => message.id === id),
        ),
      ).toBe(true);
    }
  });
});
