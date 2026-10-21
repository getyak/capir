// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { listConversationImageKeys, readConversationMessages, readConversationWithdrawnIds, writeConversationMessage, writeConversationWithdrawal } from "./conversation-local";
const session = "11111111-1111-4111-8111-111111111111", first = "22222222-2222-4222-8222-222222222222", second = "33333333-3333-4333-8333-333333333333";
const operation = "44444444-4444-4444-8444-444444444444";
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("keeps a durable explicit tombstone across reads and no longer claims its local image bytes", () => {
  localStorage.clear();
  writeConversationMessage("owner", session, { id: first, objective: "Synthetic", delivery: "accepted", createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600000, images: [{ attachment_id: second, file_name: "synthetic.png", media_type: "image/png", byte_size: 4, content_hash: "a".repeat(64) }] });
  expect(listConversationImageKeys("owner")).toEqual([`owner:${session}:${first}`]);
  expect(writeConversationWithdrawal("owner", session, operation, [first], Date.now() + 3600000)).toBe(true);
  // Simulate the crash between receipt storage and deleting the old metadata/blob.
  expect(readConversationMessages("owner", session)).toEqual([]);
  expect(listConversationImageKeys("owner")).toEqual([]);
});

it("isolates expiring receipt IDs by account and Session without accepting malformed or unbounded records", () => {
  localStorage.clear(); const now = Date.now();
  expect(writeConversationWithdrawal("owner", session, operation, [first], now + 1000)).toBe(true);
  expect(readConversationWithdrawnIds("other", session).size).toBe(0);
  expect(readConversationWithdrawnIds("owner", second).size).toBe(0);
  for (const ids of [[], [first, first], Array(52).fill(first), ["bad-id"]]) expect(writeConversationWithdrawal("owner", session, second, ids, now + 1000)).toBe(false);
  expect(writeConversationWithdrawal("owner", session, second, [first], now - 1)).toBe(false);
  expect(writeConversationWithdrawal("owner", session, second, [first], now + 86460000)).toBe(false);
  expect([...readConversationWithdrawnIds("owner", session)]).toEqual([first]);
  vi.spyOn(Date, "now").mockReturnValue(now + 1001);
  expect(readConversationWithdrawnIds("owner", session).size).toBe(0);
});
