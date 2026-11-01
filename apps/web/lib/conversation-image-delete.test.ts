import { afterEach, expect, it } from "vitest";
import * as images from "./conversation-image-store";
// Controlled IDB boundary: exercise the production adapter, with request success
// and transaction completion independently controlled (no external database).
function idb() {
  const removed: string[] = [];
  const transaction = { objectStore: () => ({ delete: (key: string) => { removed.push(key); return {}; } }) } as unknown as IDBTransaction;
  const request = {} as IDBOpenDBRequest;
  const factory = { open: () => { queueMicrotask(() => {
    Object.assign(request, { result: { transaction: () => transaction } }); request.onsuccess?.({} as Event);
  }); return request; } } as unknown as IDBFactory;
  return { store: images.createIndexedDbConversationImageStore(factory), transaction, removed };
}
afterEach(() => images.setConversationImageStoreForTest(undefined));
it("only confirms byte deletion when its readwrite transaction completes", async () => {
  const { store, transaction, removed } = idb(); let settled = false;
  const result = store.deleteConfirmed?.("owner:session:message").then(value => { settled = true; return value; });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  expect(removed).toEqual(["owner:session:message"]); expect(settled).toBe(false);
  transaction.oncomplete?.({} as Event); await expect(result).resolves.toBe(true);
});
it.each(["onabort", "onerror"] as const)("keeps cleanup unconfirmed on IDB %s", async event => {
  const { store, transaction } = idb(); const result = store.deleteConfirmed?.("owner:session:message");
  for (let i = 0; i < 4; i++) await Promise.resolve();
  transaction[event]?.({} as Event); await expect(result).resolves.toBe(false);
});
it("reports unavailable/open-denied/legacy adapters as unknown instead of successful cleanup", async () => {
  const store = images.createIndexedDbConversationImageStore({ open: () => { throw new Error("denied"); } } as unknown as IDBFactory);
  await expect(store.deleteConfirmed?.("key")).resolves.toBe(false);
  images.setConversationImageStoreForTest(null);
  await expect(images.removeConversationImagesConfirmed("owner", "session", "22222222-2222-4222-8222-222222222222")).resolves.toBe(false);
  images.setConversationImageStoreForTest({ async put() { return false; }, async get() { return []; }, async delete() {}, async deletePrefix() {}, async inventory() { return []; } });
  await expect(images.removeConversationImagesConfirmed("owner", "session", "22222222-2222-4222-8222-222222222222")).resolves.toBe(false);
});
it("checked deletion refuses draft and forwards only the exact scoped UUID key", async () => {
  const removed: string[] = [];
  images.setConversationImageStoreForTest({ async put() { return false; }, async get() { return []; }, async delete() {}, async deletePrefix() {}, async inventory() { return []; }, deleteConfirmed: async key => { removed.push(key); return true; } });
  await expect(images.removeConversationImagesConfirmed("owner", "session", "composer-draft")).resolves.toBe(false);
  await expect(images.removeConversationImagesConfirmed("owner", "session", "22222222-2222-4222-8222-222222222222")).resolves.toBe(true);
  expect(removed).toEqual(["owner:session:22222222-2222-4222-8222-222222222222"]);
});
