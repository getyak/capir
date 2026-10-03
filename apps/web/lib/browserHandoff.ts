export const FROZEN_SYNTHETIC_SOURCE =
  "Could you send the project details before we arrange a conversation?";

const SYNTHETIC_HANDOFF_IDEMPOTENCY_KEY = "web-local-synthetic-capture-v1";

type SyntheticBrowserHandoffInput = {
  approvedAt: string;
  origin: string;
  requestId: string;
};

export function createSyntheticBrowserHandoff({
  approvedAt,
  origin,
  requestId,
}: SyntheticBrowserHandoffInput) {
  const normalizedOrigin = new URL(origin).origin;

  return {
    body: {
      schema_version: "browser-capture-handoff.v1",
      request_id: requestId,
      idempotency_key: SYNTHETIC_HANDOFF_IDEMPOTENCY_KEY,
      purpose: "candidate_conversation_evidence_review",
      retention_mode: "evidence_crop",
      handoff_target: `${normalizedOrigin}/api/browser-extension/captures`,
      session: {
        version: null,
        credential_transport: "browser_managed",
      },
      source: {
        capture_kind: "selected_text",
        title: "Synthetic browser handoff",
        url: `${normalizedOrigin}/`,
        captured_at: "2026-08-03T02:00:00.000Z",
      },
      review: {
        type: "reviewed_text",
        text: FROZEN_SYNTHETIC_SOURCE,
        edited_from_selection: false,
      },
      authorization: {
        decision: "submit_reviewed_capture",
        approved_at: approvedAt,
        statement:
          "Submit this reviewed synthetic capture to the localhost backend.",
      },
    },
    headers: {
      "content-type": "application/json",
      "idempotency-key": SYNTHETIC_HANDOFF_IDEMPOTENCY_KEY,
    },
  } as const;
}

export function reuseSyntheticBrowserHandoff(
  existing: ReturnType<typeof createSyntheticBrowserHandoff> | null,
  input: SyntheticBrowserHandoffInput,
) {
  return existing ?? createSyntheticBrowserHandoff(input);
}
