// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as local from "./conversation-local";
const SCOPE = "synthetic-owner";
const SESSION = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const OP = "44444444-4444-4444-8444-444444444444";
const DAY = 86_400_000;
const prefix = `talent-signal:conversation:v1:${SCOPE}:${SESSION}:`;
let target: Storage;
function pending() { return { version: 1 as const, operation: OP, queueEntryId: TARGET, targetMessageId: TARGET, expectedRevision: 7,
  createdAt: Date.now(), protectUntil: Date.now() + DAY, state: "pending" as const }; }
function message(id = TARGET): local.LocalMessage { return { id, objective: "synthetic", delivery: "pending", createdAt: new Date().toISOString(), expiresAt: Date.now() + 60000,
  images: [{ attachment_id: OTHER, file_name: "synthetic.png", media_type: "image/png", byte_size: 1, content_hash: "a".repeat(64) }] }; }
function seedConfirmed(extra = {}) { target.setItem(`${prefix}withdrawal:${OP}`, JSON.stringify({ ...pending(), state: "confirmed", messageIds: [TARGET], cleanup: "pending", ...extra })); }
beforeEach(() => { target = new Storage(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

// Break: persisted positive proof is ignored after a crash before metadata cleanup.
it("filters exact confirmed IDs from reloads and image claims without deleting a neighbour", () => {
  local.writeConversationMessage(SCOPE, SESSION, message(), target); local.writeConversationMessage(SCOPE, SESSION, message(OTHER), target); seedConfirmed();
  expect(local.readConversationMessages(SCOPE, SESSION, target).map(row => row.id)).toEqual([OTHER]);
  expect(local.listConversationImageKeys(SCOPE, target)).toEqual([`${SCOPE}:${SESSION}:${OTHER}`]);
});
it("refuses a stale writer recreating a positively retired ID", () => {
  seedConfirmed(); expect(local.writeConversationMessage(SCOPE, SESSION, message(), target)).toBe(false);
  expect(target.getItem(`${prefix}message:${TARGET}`)).toBeNull();
});
it("does not renew the original message expiry or accept an expired capture", () => {
  const original = message(); local.writeConversationMessage(SCOPE, SESSION, original, target);
  expect(local.writeConversationMessage(SCOPE, SESSION, { ...original, expiresAt: original.expiresAt + 1000 }, target)).toBe(true);
  expect(local.readConversationMessages(SCOPE, SESSION, target)[0].expiresAt).toBe(original.expiresAt);
  vi.advanceTimersByTime(60001); expect(local.writeConversationMessage(SCOPE, SESSION, original, target)).toBe(false);
});
it.each(["clear", "prune"] as const)("%s retains unresolved proof even after its protection horizon", operation => {
  seedConfirmed(); const proof = target.getItem(`${prefix}withdrawal:${OP}`); vi.advanceTimersByTime(DAY + 1);
  if (operation === "clear") local.clearConversationLocal(SCOPE, SESSION, target); else local.pruneConversationLocal(SCOPE, target);
  expect(target.getItem(`${prefix}withdrawal:${OP}`)).toBe(proof);
});

it("reserves without payload and preserves immutable identity through confirmation and replay", () => {
  const record = pending(); expect(local.reserveConversationWithdrawal(SCOPE, SESSION, record, target)).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(local.reserveConversationWithdrawal(SCOPE, SESSION, { ...record, protectUntil: record.protectUntil + 1000 }, target)).toBe(false);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "known", records: [record] });
  expect(local.confirmConversationWithdrawal(SCOPE, SESSION, OP, [TARGET, OTHER], target)).toBe(true);
  expect(local.reserveConversationWithdrawal(SCOPE, SESSION, record, target)).toBe(false);
  expect(local.confirmConversationWithdrawal(SCOPE, SESSION, OP, [TARGET], target)).toBe(false);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "known", records: [{ ...record, state: "confirmed", messageIds: [TARGET, OTHER], cleanup: "pending" }] });
});
it("pending pauses delivery without granting deletion authority", () => {
  local.writeConversationMessage(SCOPE, SESSION, message(), target);
  expect(local.reserveConversationWithdrawal(SCOPE, SESSION, pending(), target)).toBe(true);
  expect(local.readConversationMessages(SCOPE, SESSION, target)[0]).toMatchObject({ id: TARGET, delivery: "unknown", receiptUncertain: true });
  expect(local.listConversationImageKeys(SCOPE, target)).toEqual([`${SCOPE}:${SESSION}:${TARGET}`]);
});
it.each([[], [TARGET, TARGET], [OTHER], ["composer-draft"], Array.from({ length: 52 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)].map(ids => ({ ids })))("does not promote invalid or target-free IDs $ids", ({ ids }) => {
  local.reserveConversationWithdrawal(SCOPE, SESSION, pending(), target);
  expect(local.confirmConversationWithdrawal(SCOPE, SESSION, OP, ids, target)).toBe(false);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "known", records: [pending()] });
});
it.each([{ messageIds: [TARGET, TARGET] }, { messageIds: ["draft"] }, { objective: "x".repeat(4100) }, { operation: OTHER }, { protectUntil: 1 }])("malformed records preserve content as unknown instead of authorizing cleanup %j", extra => {
  local.writeConversationMessage(SCOPE, SESSION, message(), target); seedConfirmed(extra);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "unknown" });
  expect(local.readConversationMessages(SCOPE, SESSION, target)[0]).toMatchObject({ id: TARGET, delivery: "unknown" });
});
it("denied or incomplete inventory is unknown, not empty", () => {
  const denied = { get length() { throw new Error("denied"); } } as unknown as Storage;
  expect(local.readConversationWithdrawals(SCOPE, SESSION, denied)).toEqual({ status: "unknown" });
  expect(local.readConversationWithdrawals(SCOPE, SESSION, null)).toEqual({ status: "unknown" });
  const incomplete = { length: 1, key: () => null } as unknown as Storage;
  expect(local.readConversationWithdrawals(SCOPE, SESSION, incomplete)).toEqual({ status: "unknown" });
});
it("failed reservation or promotion does not evict older proof", () => {
  seedConfirmed(); const old = target.getItem(`${prefix}withdrawal:${OP}`);
  const set = target.setItem.bind(target); vi.spyOn(target, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(local.reserveConversationWithdrawal(SCOPE, SESSION, { ...pending(), operation: OTHER }, target)).toBe(false);
  expect(local.completeConversationWithdrawalCleanup(SCOPE, SESSION, OP, target)).toBe(false);
  expect(target.getItem(`${prefix}withdrawal:${OP}`)).toBe(old);
  vi.mocked(target.setItem).mockImplementation(set);
});
it("only collects checked cleanup after the fixed protection horizon", () => {
  seedConfirmed();
  expect(local.removeRejectedConversationWithdrawal(SCOPE, SESSION, OP, target)).toBe(false);
  expect(local.removeConversationWithdrawalIfSafe(SCOPE, SESSION, OP, Date.now() + DAY, target)).toBe(false);
  expect(local.completeConversationWithdrawalCleanup(SCOPE, SESSION, OP, target)).toBe(true);
  expect(local.removeConversationWithdrawalIfSafe(SCOPE, SESSION, OP, Date.now(), target)).toBe(false);
  vi.advanceTimersByTime(DAY);
  expect(local.removeConversationWithdrawalIfSafe(SCOPE, SESSION, OP, Date.now(), target)).toBe(true);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "known", records: [] });
});
it("removes only a pending rejected operation and checks absent metadata readback", () => {
  local.reserveConversationWithdrawal(SCOPE, SESSION, pending(), target); local.writeConversationMessage(SCOPE, SESSION, message(), target);
  const remove = target.removeItem.bind(target); vi.spyOn(target, "removeItem").mockImplementation(() => {});
  expect(local.removeRejectedConversationWithdrawal(SCOPE, SESSION, OP, target)).toBe(false);
  expect(local.removeConversationMessageConfirmed(SCOPE, SESSION, TARGET, target)).toBe(false);
  vi.mocked(target.removeItem).mockImplementation(remove);
  expect(local.removeConversationMessageConfirmed(SCOPE, SESSION, "composer-draft", target)).toBe(false);
  expect(local.removeRejectedConversationWithdrawal(SCOPE, SESSION, OP, target)).toBe(true);
  expect(local.removeConversationMessageConfirmed(SCOPE, SESSION, TARGET, target)).toBe(true);
});

it("does not accept an overbound serialized record hidden behind JSON whitespace", () => {
  target.setItem(`${prefix}withdrawal:${OP}`, " ".repeat(4096) + JSON.stringify({ ...pending(), state: "confirmed", messageIds: [TARGET], cleanup: "pending" }));
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "unknown" });
});
it("requires exact reservation readback and keeps pending proof when promotion is silently denied", () => {
  const set = target.setItem.bind(target); vi.spyOn(target, "setItem").mockImplementation(() => {});
  expect(local.reserveConversationWithdrawal(SCOPE, SESSION, pending(), target)).toBe(false);
  vi.mocked(target.setItem).mockImplementation(set); expect(local.reserveConversationWithdrawal(SCOPE, SESSION, pending(), target)).toBe(true);
  vi.mocked(target.setItem).mockImplementation(() => {});
  expect(local.confirmConversationWithdrawal(SCOPE, SESSION, OP, [TARGET], target)).toBe(false);
  expect(local.readConversationWithdrawals(SCOPE, SESSION, target)).toEqual({ status: "known", records: [pending()] });
});
