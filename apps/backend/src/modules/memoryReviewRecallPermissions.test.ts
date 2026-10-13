import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";
import { recallMemories } from "./memoryReviewRecall.js";
import type { MemoryItemRow, EvidenceRow } from "./memoryReviewStore.js";

const auth: AuthContext = {
  accountId: "11111111-1111-4111-8111-111111111111", accountSlug: "permission-fixture",
  userId: "22222222-2222-4222-8222-222222222222", userEmail: "owner@synthetic.local",
  userKind: "simulated_human", sessionId: "33333333-3333-4333-8333-333333333333",
};
const personId = "44444444-4444-4444-8444-444444444444";

function row(id: string, ownerId: string): MemoryItemRow & { cursor_time: string } {
  return {
    id, account_id: auth.accountId, owner_user_id: ownerId, scope: "person", subject_id: personId,
    relationship_context_id: null, display_text: "Reviewed shared person statement", original_display_text: null,
    statement_kind: "source_statement", speaker: "Contact", reporter: null, valid_time: null,
    observed_time: null, time_status: "unknown", sensitivity: "normal", version: 1, status: "active",
    supersedes_id: null, superseded_by_id: null, conflict_group_id: null,
    created_at: new Date("2026-10-13T06:00:00Z"), cursor_time: "2026-10-13T06:00:00.000000Z",
  };
}

function source(id: string): EvidenceRow {
  return {
    id, memory_item_id: id, capture_id: null, source_resource_id: null, evidence_fragment_id: null,
    source_session_id: null, source_message_id: null, source_artifact_id: null,
    locator: { kind: "message", session_id: null, message_id: null }, excerpt: "Reviewed shared person statement", status: "active",
  };
}

describe("reader-specific Memory edit permission", () => {
  it("keeps account-readable person Memory visible and exposes only an exact-owner boolean", async () => {
    const ownedId = "55555555-5555-4555-8555-555555555555";
    const sharedId = "66666666-6666-4666-8666-666666666666";
    const query = vi.fn().mockResolvedValueOnce({ rows: [
      row(ownedId, auth.userId), row(sharedId, "77777777-7777-4777-8777-777777777777"),
    ] }).mockResolvedValueOnce({ rows: [source(ownedId), source(sharedId)] });
    const recall = await recallMemories({ query } as unknown as Pool, auth, { surface: "people", person_id: personId });
    expect(recall.items.map(item => ({ id: item.id, can_edit: item.can_edit }))).toEqual([
      { id: ownedId, can_edit: true }, { id: sharedId, can_edit: false },
    ]);
    for (const item of recall.items) {
      expect(item).not.toHaveProperty("owner_user_id");
      expect(item).not.toHaveProperty("account_id");
      expect(item).not.toHaveProperty("created_by_user_id");
    }
    expect(query.mock.calls[0]?.[1]).toEqual([auth.accountId, auth.userId, personId, 51]);
  });
});
