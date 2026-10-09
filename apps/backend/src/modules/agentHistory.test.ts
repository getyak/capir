import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import { getRelationshipAgentHistory } from "./agentHistory.js";

const auth: AuthContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  accountSlug: "fixture-alpha",
  userId: "22222222-2222-4222-8222-222222222222",
  userEmail: "recruiter@alpha.local",
  userKind: "simulated_human",
  sessionId: "33333333-3333-4333-8333-333333333333",
};
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const CONTEXT_ID = "55555555-5555-4555-8555-555555555555";

function scopeRow() {
  return {
    rows: [
      {
        person_id: PERSON_ID,
        person_label: "Synthetic Recruiter Contact",
        context_id: CONTEXT_ID,
        context_label: "VP Product search",
      },
    ],
  };
}

describe("relationship Agent history", () => {
  it("projects durable identity decisions and correction direction without private source content", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({
        rows: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            sequence: "42",
            actor_user_id: auth.userId,
            event_type: "identity.corrected",
            entity_type: "capture",
            entity_id: "77777777-7777-4777-8777-777777777777",
            metadata: {
              decision_id:
                "88888888-8888-4888-8888-888888888888",
              prior_person_id: PERSON_ID,
              prior_relationship_context_id: CONTEXT_ID,
              person_id:
                "99999999-9999-4999-8999-999999999999",
              relationship_context_id:
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              capture_ids_rebound: [
                "77777777-7777-4777-8777-777777777777",
              ],
            },
            occurred_at: new Date("2026-08-07T01:00:00.000Z"),
            capture_id: "77777777-7777-4777-8777-777777777777",
            source_resource_id: null,
            resource_kind: null,
            resource_display_name: null,
            resource_processing_state: null,
            identity_case_id: null,
            identity_case_status: null,
            identity_decision_reason: null,
            correction_reason:
              "The recruiter verified a different source account.",
            knowledge_snapshot_id: null,
            knowledge_snapshot_status: null,
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            sequence: "41",
            actor_user_id: auth.userId,
            event_type: "identity_resolution.decided",
            entity_type: "identity_resolution_case",
            entity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            metadata: {
              decision: "leave_unresolved",
              person_id: null,
              relationship_context_id: null,
            },
            occurred_at: new Date("2026-08-07T00:00:00.000Z"),
            capture_id: null,
            source_resource_id: null,
            resource_kind: null,
            resource_display_name: null,
            resource_processing_state: null,
            identity_case_id:
              "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            identity_case_status: "resolved",
            identity_decision_reason:
              "A confirmed handle is still missing.",
            correction_reason: null,
            knowledge_snapshot_id: null,
            knowledge_snapshot_status: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(response.next_cursor).toBe(42);
    expect(response.operations).toEqual([
      expect.objectContaining({
        kind: "identity_correction",
        status: "retracted",
        title: "Source moved out of this relationship",
        detail:
          "1 governed capture was moved out; dependent state was retracted or reopened for review.",
      }),
      expect.objectContaining({
        kind: "identity_review",
        status: "superseded",
        title: "Identity left unresolved",
        detail:
          "Review note: A confirmed handle is still missing.",
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("private source text");
  });

  it("authorizes the active person-context pair before reading account-scoped events", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[1]).toEqual([
      auth.accountId,
      PERSON_ID,
      CONTEXT_ID,
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([
      auth.accountId,
      PERSON_ID,
      CONTEXT_ID,
      expect.arrayContaining([
        "resource.capture_submitted",
        "identity.corrected",
        "identity.handle_expired",
        "source.authorization_revoked",
        "source.authorization_restored",
        "capture.deleted",
      ]),
    ]);
    expect(query.mock.calls[1]?.[0]).toContain(
      "events.account_id = $1",
    );
    expect(query.mock.calls[1]?.[0]).toContain(
      "NOT EXISTS",
    );
    expect(query.mock.calls[2]?.[0]).toContain(
      "actions.status IN ('completed', 'executing', 'unknown')",
    );
    expect(query.mock.calls[2]?.[0]).toContain(
      "receipts.authorization_state IN ('revoked', 'expired')",
    );
  });

  it("shows revocation and restore as distinct durable relationship-memory operations", async () => {
    const captureId = "66666666-6666-4666-8666-666666666666";
    const baseRow = {
      actor_user_id: auth.userId,
      entity_type: "capture",
      entity_id: captureId,
      occurred_at: new Date("2026-08-07T02:00:00.000Z"),
      capture_id: captureId,
      source_resource_id: null,
      resource_kind: null,
      resource_display_name: null,
      resource_processing_state: null,
      identity_case_id: null,
      identity_case_status: null,
      identity_decision_reason: null,
      correction_reason: null,
      knowledge_snapshot_id: null,
      knowledge_snapshot_status: null,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            id: "77777777-7777-4777-8777-777777777777",
            sequence: "44",
            event_type: "source.authorization_restored",
            metadata: {
              person_id: PERSON_ID,
              relationship_context_id: CONTEXT_ID,
              affected_capture_ids: [captureId],
              claims_reopened: 2,
              reason: "Renewed purpose-bound permission.",
            },
          },
          {
            ...baseRow,
            id: "88888888-8888-4888-8888-888888888888",
            sequence: "43",
            event_type: "source.authorization_revoked",
            metadata: {
              person_id: PERSON_ID,
              relationship_context_id: CONTEXT_ID,
              affected_capture_ids: [captureId],
              states_retracted: 1,
              reason: "Permission withdrawn.",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(response.operations).toEqual([
      expect.objectContaining({
        kind: "source_authorization",
        status: "completed",
        title: "Source access restored for review",
        detail: expect.stringContaining(
          "No prior conclusion or action was restored automatically.",
        ),
      }),
      expect.objectContaining({
        kind: "source_authorization",
        status: "retracted",
        title: "Source access revoked",
        detail: expect.stringContaining(
          "1 confirmed state was retracted.",
        ),
      }),
    ]);
  });

  it("keeps expired and reconfirmed identity clues distinct in durable history", async () => {
    const handleId = "66666666-6666-4666-8666-666666666666";
    const sourceResourceId =
      "77777777-7777-4777-8777-777777777777";
    const baseRow = {
      actor_user_id: auth.userId,
      entity_type: "identity_handle",
      entity_id: handleId,
      capture_id: null,
      source_resource_id: sourceResourceId,
      resource_kind: "contact_record",
      resource_display_name: "Reviewed contact record",
      resource_processing_state: "ready",
      identity_case_id: null,
      identity_case_status: null,
      identity_decision_reason: null,
      correction_reason: null,
      knowledge_snapshot_id: null,
      knowledge_snapshot_status: null,
      person_merge_operation_status: null,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            id: "88888888-8888-4888-8888-888888888888",
            sequence: "48",
            event_type: "identity.handle_reconfirmed",
            occurred_at: new Date("2026-08-07T04:00:00.000Z"),
            metadata: {
              display_hint: "a***@example.com",
              handle_type: "email",
              person_id: PERSON_ID,
              relationship_context_id: CONTEXT_ID,
              source_resource_id: sourceResourceId,
              valid_until: "2027-08-07T04:00:00.000Z",
              freshness_policy_version:
                "identity-freshness-2026-08-07.v1",
              validity_basis: "human_override",
              validity_override_reason:
                "The issuer rotates this address every six months.",
            },
          },
          {
            ...baseRow,
            actor_user_id: null,
            id: "99999999-9999-4999-8999-999999999999",
            sequence: "47",
            event_type: "identity.handle_expired",
            occurred_at: new Date("2026-08-07T03:00:00.000Z"),
            metadata: {
              display_hint: "a***@example.com",
              handle_type: "email",
              person_id: PERSON_ID,
              relationship_context_id: CONTEXT_ID,
              source_resource_id: sourceResourceId,
              valid_until: "2026-08-07T03:00:00.000Z",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(response.operations).toEqual([
      expect.objectContaining({
        actor_kind: "recruiter",
        kind: "identity_review",
        status: "completed",
        title: "Identity clue reconfirmed",
        detail: expect.stringContaining(
          "source-linked and usable for account-scoped matching until 2027-08-07T04:00:00.000Z",
        ),
      }),
      expect.objectContaining({
        actor_kind: "system",
        kind: "identity_review",
        status: "retracted",
        title: "Identity clue needs fresh confirmation",
        detail: expect.stringContaining(
          "cannot act as a confirmed match",
        ),
      }),
    ]);
    expect(response.operations[0]?.detail).toContain(
      "Policy identity-freshness-2026-08-07.v1; human override: The issuer rotates this address every six months.",
    );
    expect(JSON.stringify(response)).not.toContain(
      "candidate@example.com",
    );
  });

  it("projects applied and reversed person merges as durable recruiter decisions", async () => {
    const baseRow = {
      actor_user_id: auth.userId,
      entity_type: "subject",
      entity_id: PERSON_ID,
      occurred_at: new Date("2026-08-07T03:00:00.000Z"),
      capture_id: null,
      source_resource_id: null,
      resource_kind: null,
      resource_display_name: null,
      resource_processing_state: null,
      identity_case_id: null,
      identity_case_status: null,
      identity_decision_reason: null,
      correction_reason: null,
      knowledge_snapshot_id: null,
      knowledge_snapshot_status: null,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            id: "66666666-6666-4666-8666-666666666666",
            sequence: "46",
            event_type: "identity.people_merge_reversed",
            person_merge_operation_status: "reversed",
            metadata: {
              source_person_id:
                "77777777-7777-4777-8777-777777777777",
              target_person_id: PERSON_ID,
              affected_relationship_context_ids: [CONTEXT_ID],
              reason: "The recruiter confirmed separate identities.",
            },
          },
          {
            ...baseRow,
            id: "88888888-8888-4888-8888-888888888888",
            sequence: "45",
            event_type: "identity.people_merged",
            person_merge_operation_status: "reversed",
            metadata: {
              source_person_id:
                "77777777-7777-4777-8777-777777777777",
              target_person_id: PERSON_ID,
              affected_relationship_context_ids: [CONTEXT_ID],
              captures_rebound: 2,
              reason: "The recruiter confirmed one stable identity.",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(response.operations).toEqual([
      expect.objectContaining({
        kind: "identity_merge",
        status: "retracted",
        title: "Person merge reversed",
      }),
      expect.objectContaining({
        kind: "identity_merge",
        status: "retracted",
        title: "Duplicate person page merged",
        detail: expect.stringContaining("2 governed sources were moved"),
      }),
    ]);
  });

  it("names each preserved external effect and its latest observation after authorization ends", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            action_id: "66666666-6666-4666-8666-666666666666",
            capture_id: "77777777-7777-4777-8777-777777777777",
            action_status: "completed",
            action_type: "prepare_question",
            target_text: "Prepare the agreed follow-up",
            reason_text: "The candidate asked for role scope.",
            destination_key: "candidate-thread:synthetic",
            authorization_state: "expired",
            authorization_decision_id:
              "88888888-8888-4888-8888-888888888888",
            authorization_changed_at: new Date(
              "2026-08-07T03:00:00.000Z",
            ),
            attempt_id: "99999999-9999-4999-8999-999999999999",
            attempt_status: "verified",
            attempt_started_at: new Date(
              "2026-08-07T02:00:00.000Z",
            ),
            attempt_finished_at: new Date(
              "2026-08-07T02:00:01.000Z",
            ),
            observation_id:
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            observation_match_status: "matched",
            observation_observed_at: new Date(
              "2026-08-07T02:00:02.000Z",
            ),
            outcome_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            outcome_status: "verified",
            outcome_summary:
              "The simulated destination matched the approved preview.",
            outcome_created_at: new Date(
              "2026-08-07T02:00:03.000Z",
            ),
          },
        ],
      });

    const response = await getRelationshipAgentHistory(
      { query } as unknown as Pool,
      auth,
      PERSON_ID,
      CONTEXT_ID,
    );

    expect(response.external_effect_follow_ups).toEqual([
      {
        action_id: "66666666-6666-4666-8666-666666666666",
        capture_id: "77777777-7777-4777-8777-777777777777",
        action_status: "completed",
        action_type: "prepare_question",
        target: "Prepare the agreed follow-up",
        reason: "The candidate asked for role scope.",
        destination_key: "candidate-thread:synthetic",
        authorization: {
          state: "expired",
          decision_id:
            "88888888-8888-4888-8888-888888888888",
          changed_at: "2026-08-07T03:00:00.000Z",
        },
        attempt: {
          id: "99999999-9999-4999-8999-999999999999",
          status: "verified",
          started_at: "2026-08-07T02:00:00.000Z",
          finished_at: "2026-08-07T02:00:01.000Z",
        },
        observation: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          match_status: "matched",
          observed_at: "2026-08-07T02:00:02.000Z",
        },
        outcome: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "verified",
          summary:
            "The simulated destination matched the approved preview.",
          created_at: "2026-08-07T02:00:03.000Z",
        },
        requires_recruiter_decision: true,
      },
    ]);
  });
});
