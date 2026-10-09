import { describe, expect, it } from "vitest";
import type {
  CandidateMomentumCase,
} from "./candidateMomentum";
import {
  canApproveAction,
  createCaseReview,
  getCaseProgress,
  getReviewedContextLabel,
  getReviewedIdentityLabel,
  hasUnresolvedIdentity,
  hasUnresolvedTime,
  isFactReviewComplete,
} from "./reviewState";

/**
 * Small independent synthetic unit fixtures for review-state behavior. They
 * cover shape, provenance, review, no-action, and ambiguity only; they are not
 * copies of the private evaluation corpus.
 */
function syntheticCase(
  overrides: {
    context?: Partial<CandidateMomentumCase["context"]>;
    expected?: Partial<CandidateMomentumCase["expected"]>;
  } = {},
): CandidateMomentumCase {
  return {
    id: "TS-CORE-01",
    title: "Synthetic unit case",
    context: {
      captured_at: "2026-01-01T09:00:00+08:00",
      source_timezone: "Asia/Singapore",
      candidate: "Synthetic Person",
      assignment: "Synthetic Assignment",
      ...overrides.context,
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
      ...overrides.expected,
    },
  };
}

function syntheticProposeCase() {
  return syntheticCase({
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
        {
          field: "decision_deadline",
          status: "proposed",
          value: "synthetic deadline",
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
  });
}

describe("candidate review state shape and provenance", () => {
  it("creates fact reviews that keep the original proposed values", () => {
    const fixtureCase = syntheticProposeCase();
    const review = createCaseReview(fixtureCase);

    expect(Object.keys(review.factReviews)).toEqual([
      "availability",
      "decision_deadline",
    ]);
    for (const assertion of fixtureCase.expected.assertions) {
      const factReview = review.factReviews[assertion.field];
      expect(factReview.originalValue).toBe(assertion.value);
      expect(factReview.value).toBe(assertion.value);
      expect(factReview.status).toBe(assertion.status);
    }
    expect(review.actionDecision).toBe("pending");
    expect(review.outcome).toBe("pending");
  });
});

describe("candidate review decisions", () => {
  it("locks action approval until every fact is reviewed", () => {
    const fixtureCase = syntheticProposeCase();
    const review = createCaseReview(fixtureCase);

    expect(canApproveAction(fixtureCase, review)).toBe(false);
    review.factReviews.availability.status = "confirmed";
    expect(canApproveAction(fixtureCase, review)).toBe(false);
    review.factReviews.decision_deadline.status = "edited";
    expect(isFactReviewComplete(fixtureCase, review)).toBe(true);
    expect(canApproveAction(fixtureCase, review)).toBe(true);
  });

  it("never enables actions for no-action cases", () => {
    const fixtureCase = syntheticCase({
      expected: {
        disposition: "no_action",
        assertions: [],
        action: null,
        must_not: [],
      },
    });
    const review = createCaseReview(fixtureCase);

    expect(isFactReviewComplete(fixtureCase, review)).toBe(true);
    expect(canApproveAction(fixtureCase, review)).toBe(false);
    expect(getCaseProgress(fixtureCase, review)).toEqual({
      completed: 0,
      total: 0,
    });
  });

  it("never enables actions once an action decision is taken", () => {
    const fixtureCase = syntheticProposeCase();
    const review = createCaseReview(fixtureCase);
    for (const fact of Object.values(review.factReviews)) {
      fact.status = "confirmed";
    }
    review.actionDecision = "declined";
    expect(canApproveAction(fixtureCase, review)).toBe(false);
    review.actionDecision = "approved";
    expect(canApproveAction(fixtureCase, review)).toBe(false);
  });
});

describe("candidate review ambiguity", () => {
  it("requires explicit time resolution for an ambiguous assertion", () => {
    const fixtureCase = syntheticCase({
      context: {
        captured_at: "2026-01-03T09:00:00+08:00",
        source_timezone: null,
        candidate: "Synthetic Person",
        assignment: null,
      },
      expected: {
        disposition: "clarify",
        assertions: [
          {
            field: "availability",
            status: "ambiguous",
            value: "synthetic relative window",
            evidence_message_id: "m1",
            evidence_quote: "Synthetic",
          },
        ],
        action: null,
        must_not: [],
      },
    });
    const review = createCaseReview(fixtureCase);

    expect(hasUnresolvedTime(fixtureCase, review)).toBe(true);
    review.factReviews.availability.status = "confirmed";
    expect(isFactReviewComplete(fixtureCase, review)).toBe(false);
    review.timeResolution = {
      date: "2026-01-10",
      time: "15:00",
      timezone: "Europe/London",
    };
    expect(hasUnresolvedTime(fixtureCase, review)).toBe(false);
    expect(isFactReviewComplete(fixtureCase, review)).toBe(true);
    expect(canApproveAction(fixtureCase, review)).toBe(false);
  });

  it("keeps same-name identity unbound until a human chooses", () => {
    const fixtureCase = syntheticCase({
      context: {
        captured_at: "2026-01-01T09:00:00+08:00",
        source_timezone: "Asia/Singapore",
        candidate: null,
        assignment: null,
        candidate_options: [
          "Synthetic Person — First context",
          "Synthetic Person — Second context",
        ],
      },
      expected: {
        disposition: "clarify",
        assertions: [],
        action: null,
        must_not: [],
      },
    });
    const review = createCaseReview(fixtureCase);

    expect(hasUnresolvedIdentity(fixtureCase, review)).toBe(true);
    expect(getReviewedIdentityLabel(fixtureCase, review)).toBe("身份未解决");
    expect(getReviewedContextLabel(fixtureCase, review)).toBe("项目未解决");
    review.identityResolution = "Synthetic Person — Second context";
    expect(hasUnresolvedIdentity(fixtureCase, review)).toBe(false);
    expect(getReviewedIdentityLabel(fixtureCase, review)).toBe("Synthetic Person");
    expect(getReviewedContextLabel(fixtureCase, review)).toBe("Second context");
  });

  it("counts identity and time decisions in case progress", () => {
    const fixtureCase = syntheticCase({
      context: {
        captured_at: "2026-01-01T09:00:00+08:00",
        source_timezone: null,
        candidate: null,
        assignment: null,
        candidate_options: ["Synthetic Person — First context"],
      },
      expected: {
        disposition: "clarify",
        assertions: [
          {
            field: "availability",
            status: "ambiguous",
            value: "synthetic relative window",
            evidence_message_id: "m1",
            evidence_quote: "Synthetic",
          },
        ],
        action: null,
        must_not: [],
      },
    });
    const review = createCaseReview(fixtureCase);

    expect(getCaseProgress(fixtureCase, review)).toEqual({
      completed: 0,
      total: 3,
    });
    review.identityResolution = "Synthetic Person — First context";
    review.timeResolution = {
      date: "2026-01-10",
      time: "15:00",
      timezone: "Europe/London",
    };
    review.factReviews.availability.status = "dismissed";
    expect(getCaseProgress(fixtureCase, review)).toEqual({
      completed: 3,
      total: 3,
    });
  });
});
