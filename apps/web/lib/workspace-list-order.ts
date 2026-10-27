/** Local display preferences, with the same account/workspace/user partition
 * as Session pin/archive. No names, content, remote writes or person scores.
 * Web Locks serialize read-modify-write across tabs. The UI only publishes a
 * new order after storage readback; partial lists never prune unseen IDs. */
import { useSyncExternalStore } from "react";

export type ListOrderKind = "people" | "sessions";
type Edge = "before" | "after";
type OrderStorage = Pick<Storage, "getItem" | "setItem">;
export type OrderLock = (key: string, task: () => boolean) => Promise<boolean>;
export type ListOrderSnapshot = {
  readonly ids: readonly string[];
  readonly status: "idle" | "saving" | "error";
};
export const LIST_ORDER_PREFIX = "talent-signal:workspace-list-order:v1:";
const MAX_IDS = 1000;
const MAX_BYTES = 48 * 1024;
const SCOPE = /^[a-f0-9]{64}$/u;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const EMPTY: ListOrderSnapshot = { ids: [], status: "idle" };
type Payload = { v: 1; scope: string; kind: ListOrderKind; revision: number; updatedAt: string; ids: string[] };
const storage = () => window.localStorage;
const lock: OrderLock = async (key, task) => {
  // An unavailable/denied API is an honest save failure, never an unsafe
  // unlocked write. Secure browser and hosted WebKit origins support it.
  if (!navigator.locks) throw new Error("Lock unavailable");
  return navigator.locks.request(key, { signal: AbortSignal.timeout(5000) }, task);
};

function read(target: OrderStorage, key: string, scope: string, kind: ListOrderKind): Payload {
  const empty: Payload = { v: 1, scope, kind, revision: 0, updatedAt: "", ids: [] };
  const raw = target.getItem(key);
  if (raw === null) return empty;
  if (raw.length > MAX_BYTES) throw new Error("Oversized preference");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid preference");
  const item = value as Payload;
  if (item.v !== 1 || item.scope !== scope || item.kind !== kind ||
    !Number.isSafeInteger(item.revision) || item.revision < 0 ||
    typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt)) ||
    !Array.isArray(item.ids) || item.ids.length > MAX_IDS ||
    item.ids.some(id => typeof id !== "string" || !ID.test(id)) ||
    new Set(item.ids).size !== item.ids.length) throw new Error("Invalid preference");
  // Expire the bounded hint without ever needing a complete private inventory.
  if (Date.now() - Date.parse(item.updatedAt) > 180 * 86400_000) return empty;
  return item;
}

export function projectListOrder<T>(rows: readonly T[], ids: readonly string[], getId: (row: T) => string = row => String(row)): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (rank.get(getId(a)) ?? Infinity) - (rank.get(getId(b)) ?? Infinity));
}

export function createListOrderStore(scope: string | null, kind: ListOrderKind,
  getStorage: () => OrderStorage = storage, withLock: OrderLock = lock) {
  const key = LIST_ORDER_PREFIX + scope + ":" + kind;
  const bound = typeof scope === "string" && SCOPE.test(scope);
  const listeners = new Set<() => void>();
  let snapshot = EMPTY;
  let retired = false;
  let pending = 0;
  let failures = 0;
  function publish(ids: readonly string[], status: ListOrderSnapshot["status"]) {
    snapshot = { ids, status };
    listeners.forEach(fn => fn());
  }
  function refresh() {
    if (!bound || retired) return;
    try { publish(read(getStorage(), key, scope!, kind).ids, pending ? "saving" : failures ? "error" : "idle"); }
    catch { publish(snapshot.ids, "error"); }
  }
  if (bound) {
    try { snapshot = { ids: read(getStorage(), key, scope!, kind).ids, status: "idle" }; }
    catch { snapshot = { ids: [], status: "error" }; }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) refresh();
  };
  return {
    key,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!listeners.size) {
        window.addEventListener("storage", onStorage);
        window.addEventListener("focus", refresh);
        window.addEventListener("pageshow", refresh);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener("storage", onStorage);
          window.removeEventListener("focus", refresh);
          window.removeEventListener("pageshow", refresh);
        }
      };
    },
    retire() { retired = true; publish([], "idle"); },
    async reset(isCurrent: () => boolean = () => true): Promise<boolean> {
      if (!bound || retired) return false;
      pending += 1; publish(snapshot.ids, "saving");
      let succeeded = false;
      try {
        succeeded = await withLock(key, () => {
          if (retired || !isCurrent()) return false;
          const target = getStorage();
          // Deliberate scoped recovery must also work for a corrupt/full
          // preference. It never clears pin/archive or another list/account.
          let revision = 0;
          try { revision = read(target, key, scope!, kind).revision; } catch { /* explicitly reset */ }
          const body = JSON.stringify({ v: 1, scope, kind, revision: revision + 1, updatedAt: new Date().toISOString(), ids: [] });
          target.setItem(key, body);
          if (target.getItem(key) !== body) throw new Error("Readback mismatch");
          failures = 0; publish([], "saving");
          return true;
        });
      } catch {
        failures += 1;
        try { publish(read(getStorage(), key, scope!, kind).ids, "error"); } catch { /* retain confirmed state */ }
      }
      finally {
        pending -= 1;
        if (!retired) publish(snapshot.ids, pending ? "saving" : failures ? "error" : "idle");
      }
      return succeeded;
    },
    async move(visibleIds: () => readonly string[], id: string, targetId: string, edge: Edge): Promise<boolean> {
      if (!bound || retired || !ID.test(id) || !ID.test(targetId) || id === targetId || (edge !== "before" && edge !== "after")) return false;
      pending += 1;
      publish(snapshot.ids, "saving");
      let succeeded = false;
      try {
        succeeded = await withLock(key, () => {
          if (retired) return false;
          // Called under the lock: scope, deletion, pin and filter transitions
          // during a queued save must not authorize a stale movement.
          const visible = [...new Set(visibleIds())];
          if (!visible.includes(id) || !visible.includes(targetId) || visible.some(value => !ID.test(value))) return false;
          const target = getStorage();
          const latest = read(target, key, scope!, kind);
          const ids = [...latest.ids, ...visible.filter(value => !latest.ids.includes(value))].filter(value => value !== id);
          ids.splice(ids.indexOf(targetId) + (edge === "after" ? 1 : 0), 0, id);
          if (ids.length > MAX_IDS) throw new Error("Preference full");
          const body = JSON.stringify({ ...latest, revision: latest.revision + 1, updatedAt: new Date().toISOString(), ids });
          if (body.length > MAX_BYTES) throw new Error("Preference full");
          target.setItem(key, body);
          // Includes uncertain setItem implementations: inspect the destination
          // before reporting completion; do not repeat a potentially saved move.
          if (target.getItem(key) !== body) throw new Error("Readback mismatch");
          publish(ids, "saving");
          return true;
        });
        if (succeeded) failures = 0;
      } catch {
        failures += 1;
        // setItem may have committed before throwing. Read back authoritative
        // state without retrying; uncertainty remains visibly unsuccessful.
        try { publish(read(getStorage(), key, scope!, kind).ids, "error"); } catch { /* last confirmed snapshot */ }
      } finally {
        pending -= 1;
        if (!retired) publish(snapshot.ids, pending ? "saving" : failures ? "error" : "idle");
      }
      return succeeded;
    },
  };
}

type ListOrderStore = ReturnType<typeof createListOrderStore>;
const stores = new Map<string, ListOrderStore>();
const detached = { ...EMPTY };
const noSubscribe = () => () => {};
export function useListOrder(scope: string | null, kind: ListOrderKind) {
  const key = scope + ":" + kind;
  let store: ListOrderStore | null = null;
  if (typeof window !== "undefined" && scope && SCOPE.test(scope)) {
    store = stores.get(key) ?? createListOrderStore(scope, kind);
    stores.set(key, store);
  }
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? (() => detached), () => EMPTY);
  return { store, snapshot, ready: store !== null && snapshot !== EMPTY };
}

/** Existing sign-out/unbound Session boundary also retires queued preferences. */
export function clearAllListOrder() {
  stores.forEach(store => store.retire());
  stores.clear();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(LIST_ORDER_PREFIX)) localStorage.removeItem(key);
  } catch { /* unavailable storage cannot be claimed as cleared */ }
}
