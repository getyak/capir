// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createListOrderStore, projectListOrder, type OrderLock } from "./workspace-list-order";

const scope = "a".repeat(64);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const rows = () => [A, B, C];
function locks(): OrderLock {
  let tail = Promise.resolve();
  return async (_key, task) => {
    const result = tail.then(task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
beforeEach(() => window.localStorage.clear());

describe("owner-controlled local list order", () => {
  it("survives reopening, keeps independent list and workspace scopes, and stores IDs only", async () => {
    const lock = locks();
    const store = createListOrderStore(scope, "sessions", () => localStorage, lock);
    expect(await store.move(rows, C, A, "before")).toBe(true);
    const reopened = createListOrderStore(scope, "sessions", () => localStorage, lock);
    expect(projectListOrder(rows(), reopened.getSnapshot().ids)).toEqual([C, A, B]);
    expect(createListOrderStore(scope, "people", () => localStorage, lock).getSnapshot().ids).toEqual([]);
    expect(createListOrderStore("b".repeat(64), "sessions", () => localStorage, lock).getSnapshot().ids).toEqual([]);
    expect(Object.keys(JSON.parse(localStorage.getItem(store.key)!)).sort()).toEqual(["ids", "kind", "revision", "scope", "updatedAt", "v"]);
  });

  it("serializes rapid moves from separate tabs against current storage", async () => {
    const lock = locks();
    const one = createListOrderStore(scope, "people", () => localStorage, lock);
    const two = createListOrderStore(scope, "people", () => localStorage, lock);
    await Promise.all([one.move(rows, C, A, "before"), two.move(rows, B, C, "before")]);
    const reopened = createListOrderStore(scope, "people", () => localStorage, lock);
    expect(projectListOrder(rows(), reopened.getSnapshot().ids)).toEqual([B, C, A]);
    expect(JSON.parse(localStorage.getItem(one.key)!).revision).toBe(2);
  });

  it("preserves unloaded IDs and surviving order through deletion, additions and pagination", async () => {
    const store = createListOrderStore(scope, "people", () => localStorage, locks());
    await store.move(() => [A, B, C, D], D, A, "before");
    await store.move(() => [A, B], B, A, "before");
    expect(store.getSnapshot().ids).toEqual([D, B, A, C]);
    expect(projectListOrder([A, B, C], store.getSnapshot().ids)).toEqual([B, A, C]);
    expect(projectListOrder([A, B, C, D], store.getSnapshot().ids)).toEqual([D, B, A, C]);
  });

  it("rolls back a failed save and permits a deliberate retry without false success", async () => {
    let blocked = true;
    const storage = { getItem: localStorage.getItem.bind(localStorage), setItem: (key: string, value: string) => {
      if (blocked) throw new Error("quota");
      localStorage.setItem(key, value);
    } };
    const store = createListOrderStore(scope, "sessions", () => storage, locks());
    expect(await store.move(rows, C, A, "before")).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ ids: [], status: "error" });
    expect(localStorage.getItem(store.key)).toBeNull();
    blocked = false;
    expect(await store.move(rows, C, A, "before")).toBe(true);
    expect(projectListOrder(rows(), store.getSnapshot().ids)).toEqual([C, A, B]);
  });

  it("revalidates visible IDs after a delayed lock and cancels queued writes at logout", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock: OrderLock = async (_key, task) => { await gate; return task(); };
    const store = createListOrderStore(scope, "sessions", () => localStorage, lock);
    let visible = rows();
    const moving = store.move(() => visible, C, A, "before");
    visible = [A, B]; release();
    expect(await moving).toBe(false);
    expect(localStorage.getItem(store.key)).toBeNull();
    let releaseAgain!: () => void;
    const nextGate = new Promise<void>(resolve => { releaseAgain = resolve; });
    const second = createListOrderStore(scope, "sessions", () => localStorage,
      async (_key, task) => { await nextGate; return task(); });
    const queued = second.move(rows, C, A, "before");
    second.retire(); releaseAgain();
    expect(await queued).toBe(false);
    expect(localStorage.getItem(store.key)).toBeNull();
  });

  it("reads current storage for a stale notification and never resurrects event payloads", async () => {
    const lock = locks();
    const one = createListOrderStore(scope, "sessions", () => localStorage, lock);
    const stop = one.subscribe(() => {});
    const two = createListOrderStore(scope, "sessions", () => localStorage, lock);
    await one.move(rows, C, A, "before");
    const old = localStorage.getItem(one.key);
    await two.move(rows, B, C, "before");
    window.dispatchEvent(new StorageEvent("storage", { key: one.key, newValue: old }));
    expect(projectListOrder(rows(), one.getSnapshot().ids)).toEqual([B, C, A]);
    stop();
  });

  it("refuses unbound, invalid and unavailable destinations", async () => {
    const store = createListOrderStore(null, "sessions", () => localStorage, locks());
    expect(await store.move(rows, C, A, "before")).toBe(false);
    const bound = createListOrderStore(scope, "people", () => localStorage, locks());
    expect(await bound.move(rows, D, A, "before")).toBe(false);
    expect(await bound.move(rows, C, "private-title", "before")).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("recovers a full or corrupt preference only through explicit scoped reset", async () => {
    const lock = locks();
    const other = createListOrderStore(scope, "sessions", () => localStorage, lock);
    await other.move(rows, C, A, "before");
    const store = createListOrderStore(scope, "people", () => localStorage, lock);
    const ids = Array.from({ length: 1000 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`);
    localStorage.setItem(store.key, JSON.stringify({ v: 1, scope, kind: "people", revision: 1, updatedAt: new Date().toISOString(), ids }));
    expect(await store.move(rows, B, A, "before")).toBe(false);
    expect(await store.reset()).toBe(true);
    expect(await store.move(rows, B, A, "before")).toBe(true);
    localStorage.setItem(store.key, "invalid");
    expect(await store.reset()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ ids: [], status: "idle" });
    expect(createListOrderStore(scope, "sessions", () => localStorage, lock).getSnapshot().ids).toEqual([C, A, B]);
  });

  it("reads back an uncertain reset without repeating it or showing stale order", async () => {
    let uncertain = false;
    const target = { getItem: localStorage.getItem.bind(localStorage), setItem: (key: string, value: string) => {
      localStorage.setItem(key, value);
      if (uncertain) throw new Error("interrupted after commit");
    } };
    const store = createListOrderStore(scope, "people", () => target, locks());
    await store.move(rows, C, A, "before");
    uncertain = true;
    expect(await store.reset()).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ ids: [], status: "error" });
    expect(JSON.parse(localStorage.getItem(store.key)!).revision).toBe(2);
  });
});
