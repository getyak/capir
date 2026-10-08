import { describe, expect, it } from "vitest";
import type { TimeActivity } from "@talent-signal/contracts";
import { revalidateReview, sameSourceMetadata, survivingReviewSources } from "./time-review-continuity";
import { timeFixtureActivity } from "./test/time-fixtures";

const admitted: TimeActivity = {
  ...timeFixtureActivity,
  id: "person_created:b3000000-0000-4000-8000-000000000001",
  kind: "person_created",
  source_id: "b3000000-0000-4000-8000-000000000001",
  source_revision: 3,
  title: "Admitted evidence",
};
const second: TimeActivity = {
  ...admitted,
  id: "person_created:b3000000-0000-4000-8000-000000000002",
  source_id: "b3000000-0000-4000-8000-000000000002",
  title: "Second evidence",
};

describe("review source readback", () => {
  it("confirms only exact full-metadata matches", () => {
    expect(sameSourceMetadata(admitted, { ...admitted })).toBe(true);
    for (const patch of [{ title: "Edited" }, { source_revision: 4 }, { status: "cancelled" as const }, { summary: "new" }, { authority: "system_record" as const }]) {
      expect(sameSourceMetadata(admitted, { ...admitted, ...patch })).toBe(false);
    }
    const continuity = revalidateReview([admitted], [{ ...admitted }], true);
    expect(continuity.confirmed).toEqual([admitted]);
    expect(continuity.cleared).toBe(false);
  });

  it("drops changed sources so an outdated admitted version cannot survive", () => {
    const continuity = revalidateReview([admitted, second], [{ ...admitted, source_revision: 4 }, { ...second }], true);
    expect(continuity.changed).toEqual([admitted]);
    expect(continuity.confirmed).toEqual([second]);
    expect(survivingReviewSources(continuity)).toEqual([second]);
    expect(continuity.cleared).toBe(true);
  });

  it("clears the review when an authoritative complete readback drops a source", () => {
    const continuity = revalidateReview([admitted, second], [{ ...second }], true);
    expect(continuity.absent).toEqual([admitted]);
    expect(continuity.cleared).toBe(true);
  });

  it("never establishes source absence from a partial page", () => {
    const continuity = revalidateReview([admitted], [], false);
    expect(continuity.unverified).toEqual([admitted]);
    expect(continuity.absent).toEqual([]);
    expect(continuity.cleared).toBe(false);
    expect(survivingReviewSources(continuity)).toEqual([admitted]);
  });

  it("distinguishes a changed record from a removed one", () => {
    const changed = revalidateReview([admitted], [{ ...admitted, title: "Renamed" }], true);
    expect(changed.changed).toHaveLength(1);
    expect(changed.absent).toHaveLength(0);
    const removed = revalidateReview([admitted], [], true);
    expect(removed.absent).toHaveLength(1);
    expect(removed.changed).toHaveLength(0);
  });
});
