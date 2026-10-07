import type { TimeActivity } from "@talent-signal/contracts";

/**
 * Truthful range-review continuity.
 *
 * A generated review is temporary, unconfirmed prose backed by exact admitted
 * source records. The review response carries full source metadata, so every
 * admitted source can be checked against the currently authorized projection
 * without trusting the generated text.
 *
 * Standing per admitted source:
 * - `confirmed`: the exact admitted record (full metadata) is still authorized.
 * - `changed`: the same record exists but its metadata now differs, so the
 *   admitted version no longer exists and must not survive readback.
 * - `absent`: an authoritative, complete read of the same scope no longer
 *   contains the record (deleted, revoked or expired).
 * - `unverified`: the current read is paginated and did not reach the record.
 *   A partial page can never establish source absence.
 */
export type ReviewSourceStanding = "confirmed" | "changed" | "unverified" | "absent";

/** Every field the contract admits for a source; validation is full metadata. */
const METADATA_FIELDS = [
  "id", "kind", "source_id", "source_revision", "title", "summary", "occurred_at",
  "recorded_at", "ends_at", "local_day", "time_zone", "all_day", "person_id",
  "person_label", "relationship_context_id", "context_label", "session_id",
  "status", "authority", "external_effect",
] as const satisfies readonly (keyof TimeActivity)[];

export function sameSourceMetadata(a: TimeActivity, b: TimeActivity): boolean {
  return METADATA_FIELDS.every((field) => a[field] === b[field]);
}

export type ReviewSourceCheck = { source: TimeActivity; standing: ReviewSourceStanding };
export type ReviewContinuity = {
  checks: ReviewSourceCheck[];
  confirmed: TimeActivity[];
  changed: TimeActivity[];
  unverified: TimeActivity[];
  absent: TimeActivity[];
  /** A removed or changed source invalidates prose generated from its old version. */
  cleared: boolean;
};

export function revalidateReview(sources: TimeActivity[], activities: TimeActivity[], complete: boolean): ReviewContinuity {
  const current = new Map(activities.map((activity) => [activity.id, activity]));
  const continuity: ReviewContinuity = { checks: [], confirmed: [], changed: [], unverified: [], absent: [], cleared: false };
  for (const source of sources) {
    const found = current.get(source.id);
    const standing: ReviewSourceStanding = found ? sameSourceMetadata(found, source) ? "confirmed" : "changed" : complete ? "absent" : "unverified";
    continuity.checks.push({ source, standing });
    continuity[standing].push(source);
  }
  continuity.cleared = continuity.absent.length > 0 || continuity.changed.length > 0;
  return continuity;
}

/** Sources that may still be presented as evidence after readback. */
export function survivingReviewSources(continuity: ReviewContinuity): TimeActivity[] {
  return continuity.checks.filter((check) => check.standing === "confirmed" || check.standing === "unverified").map((check) => check.source);
}
