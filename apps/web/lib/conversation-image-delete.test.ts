// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createIndexedDbConversationImageStore, removeConversationImagesConfirmed, setConversationImageStoreForTest } from "./conversation-image-store";

afterEach(() => setConversationImageStoreForTest(undefined));

it("does not confirm unavailable storage or a legacy best-effort adapter", async () => {
  setConversationImageStoreForTest(null);
  await expect(removeConversationImagesConfirmed("owner", "session", "message")).resolves.toBe(false);
  const adapter = createIndexedDbConversationImageStore({} as IDBFactory);
  delete adapter.deleteConfirmed;
  setConversationImageStoreForTest(adapter);
  await expect(removeConversationImagesConfirmed("owner", "session", "message")).resolves.toBe(false);
});

it("does not confirm an IndexedDB open failure", async () => {
  const request = { onerror: null as null | (() => void), error: new Error("denied") };
  const adapter = createIndexedDbConversationImageStore({ open: () => { queueMicrotask(() => request.onerror?.()); return request; } } as unknown as IDBFactory);
  await expect(adapter.deleteConfirmed!("exact-key")).resolves.toBe(false);
});

it.each(["complete", "abort", "error"] as const)("confirms only a completed IndexedDB transaction (%s)", async outcome => {
  const remove = vi.fn();
  const transaction = { oncomplete: null as null | (() => void), onabort: null as null | (() => void), onerror: null as null | (() => void), objectStore: () => ({ delete: remove }) };
  const request = { onsuccess: null as null | (() => void), result: { transaction: vi.fn(() => { setTimeout(() => transaction[`on${outcome}`]?.(), 0); return transaction; }) } };
  const adapter = createIndexedDbConversationImageStore({ open: () => { queueMicrotask(() => request.onsuccess?.()); return request; } } as unknown as IDBFactory);
  await expect(adapter.deleteConfirmed!("exact-key")).resolves.toBe(outcome === "complete");
  expect(remove).toHaveBeenCalledExactlyOnceWith("exact-key");
  expect(request.result.transaction).toHaveBeenCalledWith("images", "readwrite");
});
