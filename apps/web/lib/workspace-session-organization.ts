/**
 * Reversible local list organization (Archive / Pin) for workspace Session
 * rows.
 *
 * This is display-only local organization. It never mutates the backend, never
 * stops an Agent run and never changes or deletes evidence: archiving only
 * moves a row into a clearly labeled local archive view, and every archived
 * conversation stays openable and restorable.
 *
 * Storage contract:
 * - partitioned by the account/user-stable `sessionDraftScope` (64-hex HMAC
 *   computed server-side), so one account can never project its organization
 *   onto another;
 * - stores session IDs and booleans only — never titles, messages, screenshots
 *   or any conversation content;
 * - bounded and validated on read and write, with expiry metadata so stale
 *   entries disappear without needing any session list to be complete;
 * - when browser storage is unavailable or fails, flags stay truthful in
 *   memory for the current page and the snapshot reports `persistence:
 *   "memory"` plus `pendingInMemory`, so the UI can say so instead of silently
 *   claiming persistence.
 *
 * Pruning note: recent lists cap at eight rows and the directory paginates, so
 * neither projection is an authoritative inventory. `pruneComplete` therefore
 * requires an explicitly complete inventory; expiry metadata is the bounded
 * cleanup that works without one.
 */

import { isSessionId } from "@/components/session-workbench/session-view";
import { useSyncExternalStore } from "react";

export type SessionOrganizationFlag = "archived" | "pinned";

export type SessionOrganizationEntry = {
  readonly archived: boolean;
  readonly pinned: boolean;
  /** Last local change, canonical ISO timestamp. */
  readonly updatedAt: string;
};

export type SessionOrganizationSnapshot = {
  readonly scope: string | null;
  readonly entries: Readonly<Record<string, SessionOrganizationEntry>>;
  /** "local" only after real local storage was read or written successfully. */
  readonly persistence: "local" | "memory";
  /** True after a flag change that could not be persisted. */
  readonly pendingInMemory: boolean;
};

export const SESSION_ORGANIZATION_PREFIX =
  "talent-signal:workspace-session-organization:v1:";

/** Same shape as the server-computed workspace session draft scope. */
const STORAGE_SCOPE = /^[0-9a-f]{64}$/u;
export const MAX_ENTRIES = 300;
const MAX_STORED_BYTES = 64 * 1024;
/** Entries older than six months expire without needing any session list. */
const MAX_ENTRY_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validEntry(value: unknown): value is SessionOrganizationEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SessionOrganizationEntry>;
  return typeof item.archived === "boolean" &&
    typeof item.pinned === "boolean" &&
    canonicalTimestamp(item.updatedAt);
}

function isFlag(value: unknown): value is SessionOrganizationFlag {
  return value === "archived" || value === "pinned";
}

type StoredPayload = {
  v: 1;
  scope: string;
  entries: Record<string, SessionOrganizationEntry>;
};

/** The one snapshot SSR and hydration share before local storage is read. */
const EMPTY_SNAPSHOT: SessionOrganizationSnapshot = {
  scope: null,
  entries: {},
  persistence: "memory",
  pendingInMemory: false,
};

/** Validate, bound and expire a stored payload; unknown shapes are discarded. */
export function parseSessionOrganizationPayload(
  value: unknown,
  scope: string,
  now = Date.now(),
): Record<string, SessionOrganizationEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = value as Partial<StoredPayload>;
  if (payload.v !== 1 || payload.scope !== scope || !payload.entries ||
      typeof payload.entries !== "object" || Array.isArray(payload.entries)) {
    return {};
  }
  const entries: Record<string, SessionOrganizationEntry> = {};
  let count = 0;
  for (const [id, entry] of Object.entries(payload.entries)) {
    if (count >= MAX_ENTRIES) break;
    if (!isSessionId(id) || !validEntry(entry)) continue;
    if (!entry.archived && !entry.pinned) continue;
    if (now - Date.parse(entry.updatedAt) > MAX_ENTRY_AGE_MS) continue;
    entries[id] = { archived: entry.archived, pinned: entry.pinned, updatedAt: entry.updatedAt };
    count += 1;
  }
  return entries;
}

function serialize(scope: string, entries: Record<string, SessionOrganizationEntry>): string {
  return JSON.stringify({ v: 1, scope, entries } satisfies StoredPayload);
}

export type SessionOrganizationStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionOrganizationSnapshot;
  setFlag(
    sessionId: string,
    flag: SessionOrganizationFlag,
    value: boolean,
  ): SessionOrganizationSnapshot;
  /**
   * Drop entries for session IDs the account can no longer see. Callers must
   * pass a *complete* authoritative inventory (every surviving session ID);
   * partial projections (recent cap, pagination) must never call this or
   * archived/pinned rows would be silently lost.
   */
  pruneComplete(keepIds: Iterable<string>): void;
  clear(): void;
  forget(sessionId: string): void;
};

/**
 * One store per scope. Two surfaces (recent sidebar and the Sessions
 * directory) may be mounted at once and must show one consistent local state.
 */
const stores = new Map<string, SessionOrganizationStore>();

export function sessionOrganizationStore(
  scope: string | null,
  getStorage: () => Storage | null = defaultStorage,
): SessionOrganizationStore {
  if (typeof window === "undefined" || typeof scope !== "string" || !STORAGE_SCOPE.test(scope)) return detachedStore();
  const existing = stores.get(scope);
  if (existing) return existing;
  const store = createSessionOrganizationStore(scope, getStorage);
  if (stores.size >= 8) stores.delete(stores.keys().next().value!);
  stores.set(scope, store);
  return store;
}

/** Test/scope-transition helper: forget cached stores. */
export function resetSessionOrganizationStores(): void {
  stores.clear();
}

/** Unbound workspaces get one inert store: no writes, no persistence claims. */
const detached: SessionOrganizationStore = (() => {
  return {
    subscribe: () => () => {},
    getSnapshot: () => EMPTY_SNAPSHOT,
    setFlag: () => EMPTY_SNAPSHOT,
    pruneComplete: () => {},
    clear: () => {},
    forget: () => {},
  };
})();

function detachedStore(): SessionOrganizationStore {
  return detached;
}

export function createSessionOrganizationStore(
  scope: string | null,
  getStorage: () => Storage | null = defaultStorage,
): SessionOrganizationStore {
  // Invalid or missing scopes can never record or reveal organization state.
  if (typeof scope !== "string" || !STORAGE_SCOPE.test(scope)) return detachedStore();
  const partition = scope;
  const storageKey = SESSION_ORGANIZATION_PREFIX + partition;
  const listeners = new Set<() => void>();
  let persistence: "local" | "memory" = "memory";
  let pendingInMemory = false;
  let entries: Record<string, SessionOrganizationEntry> = {};
  let snapshot: SessionOrganizationSnapshot = { scope, entries, persistence, pendingInMemory };

  try {
    const target = getStorage();
    if (!target) throw new Error("Storage unavailable");
    const raw = target.getItem(storageKey);
    if (raw !== null && raw.length <= MAX_STORED_BYTES) {
      entries = parseSessionOrganizationPayload(JSON.parse(raw), partition);
    }
    // A successful local read — including "no entry yet" — is real local
    // persistence; only blocked storage reports memory.
    persistence = "local";
  } catch {
    // Blocked or corrupt storage: start empty and stay visibly in memory.
    entries = {};
    persistence = "memory";
  }
  snapshot = { scope, entries, persistence, pendingInMemory };

  function publish(
    next: Record<string, SessionOrganizationEntry>,
    nextPersistence: "local" | "memory",
    nextPending: boolean,
  ) {
    entries = next;
    persistence = nextPersistence;
    pendingInMemory = nextPending;
    snapshot = { scope, entries, persistence, pendingInMemory };
    for (const listener of listeners) listener();
    return snapshot;
  }
  /**
   * Persist with a read-merge: another tab may have written newer flags for
   * other sessions, and a blind overwrite would lose them. Entries the current
   * tab changed win when they are at least as new as the stored copy; removals
   * win unless another tab updated the entry after this tab's baseline; and
   * unrelated entries from other tabs always survive.
   */
  function persist(
    next: Record<string, SessionOrganizationEntry>,
    previous: Record<string, SessionOrganizationEntry>,
    forgotten?: string,
  ): { merged: Record<string, SessionOrganizationEntry>; persistence: "local" | "memory" } {
    try {
      const target = getStorage();
      if (!target) return { merged: next, persistence: "memory" };
      const key = storageKey;
      const raw = target.getItem(key);
      let merged = next;
      if (raw !== null && raw.length <= MAX_STORED_BYTES) {
        const stored = parseSessionOrganizationPayload(JSON.parse(raw), partition);
        merged = {};
        for (const [id, entry] of Object.entries(stored)) {
          if (id === forgotten) continue;
          const mine = next[id];
          const prior = previous[id];
          if (mine) {
            merged[id] = Date.parse(mine.updatedAt) >= Date.parse(entry.updatedAt) ? mine : entry;
          } else if (prior && Date.parse(entry.updatedAt) <= Date.parse(prior.updatedAt)) {
            // Removed locally after this tab's baseline: the deletion wins.
          } else {
            // Unrelated to this tab's change, or updated by another tab after
            // this tab's baseline: keep it.
            merged[id] = entry;
          }
        }
        for (const [id, entry] of Object.entries(next)) {
          if (!(id in merged)) merged[id] = entry;
        }
      }
      const bounded = Object.entries(merged).sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt)).slice(0, MAX_ENTRIES);
      merged = Object.fromEntries(bounded);
      const body = serialize(partition, merged);
      if (body.length > MAX_STORED_BYTES) return { merged, persistence: "memory" };
      target.setItem(key, body);
      return { merged, persistence: "local" };
    } catch {
      // Quota, disabled storage or serialization refusal: the caller keeps the
      // change in memory and the UI reports that it is page-local.
      return { merged: next, persistence: "memory" };
    }
  }

  function fromStorage(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      const raw = getStorage()?.getItem(storageKey);
      const next = raw && raw.length <= MAX_STORED_BYTES ? parseSessionOrganizationPayload(JSON.parse(raw), partition) : {};
      publish(pendingInMemory ? { ...next, ...entries } : next, "local", pendingInMemory);
    } catch { /* retain last known state on failed read */ }
  }
  return {
    clear() { publish({}, "memory", false); },
    forget(sessionId) {
      if (!isSessionId(sessionId)) return;
      const next = { ...entries }; delete next[sessionId];
      const written = persist(next, entries, sessionId);
      publish(written.merged, written.persistence, written.persistence === "memory");
    },
    subscribe(listener) {
      if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", fromStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", fromStorage);
      };
    },
    getSnapshot: () => snapshot,
    setFlag(sessionId, flag, value) {
      if (!isSessionId(sessionId) || !isFlag(flag) || typeof value !== "boolean") {
        return snapshot;
      }
      const current = entries[sessionId] ?? { archived: false, pinned: false, updatedAt: "" };
      const updatedAt = new Date().toISOString();
      const next: SessionOrganizationEntry = {
        archived: flag === "archived" ? value : current.archived,
        pinned: flag === "pinned" ? value : current.pinned,
        updatedAt,
      };
      const merged = { ...entries };
      if (next.archived || next.pinned) merged[sessionId] = next;
      else delete merged[sessionId];
      // Bounded store: drop the least recently changed entry before growing.
      let ids = Object.keys(merged);
      if (ids.length > MAX_ENTRIES) {
        ids = ids.sort((a, b) => Date.parse(merged[a]!.updatedAt) - Date.parse(merged[b]!.updatedAt));
        for (const stale of ids.slice(0, ids.length - MAX_ENTRIES)) delete merged[stale];
      }
      const written = persist(merged, entries);
      return publish(written.merged, written.persistence,
        written.persistence === "memory");
    },
    pruneComplete(keepIds) {
      const keep = new Set(
        [...keepIds].filter((id): id is string => isSessionId(id)),
      );
      const merged = Object.fromEntries(
        Object.entries(entries).filter(([id]) => keep.has(id)),
      );
      if (Object.keys(merged).length === Object.keys(entries).length) return;
      const written = persist(merged, entries);
      publish(written.merged, written.persistence,
        written.persistence === "memory");
    },
  };
}

/** Logout / account-change boundary: mirrors the other local session intents. */
export function clearAllSessionOrganization(): void {
  for (const store of stores.values()) store.clear();
  stores.clear();
  try {
    const target = defaultStorage();
    if (!target) return;
    for (const key of Object.keys(target)) {
      if (key.startsWith(SESSION_ORGANIZATION_PREFIX)) target.removeItem(key);
    }
  } catch {
    // Storage unavailable: cached stores are already dropped; nothing claims
    // a successful clear in the UI.
  }
}

export type OrganizedSessionRows<T> = {
  /** Pinned first (server recency order), then the newest remainder. */
  readonly visible: T[];
  /** Archived rows, still openable; server recency order. */
  readonly archived: T[];
};

/**
 * Pure projection over rows the server actually returned. Flags for sessions
 * the account can no longer see are ignored, so expired or unavailable
 * conversations are never resurrected by local state.
 */
export function organizeSessionRows<T extends { id: string }>(
  rows: readonly T[],
  entries: Readonly<Record<string, SessionOrganizationEntry>>,
): OrganizedSessionRows<T> {
  const pinned: T[] = [];
  const rest: T[] = [];
  const archived: T[] = [];
  for (const row of rows) {
    const entry = entries[row.id];
    if (entry?.archived) archived.push(row);
    else if (entry?.pinned) pinned.push(row);
    else rest.push(row);
  }
  return { visible: [...pinned, ...rest], archived };
}

export type SessionOrganizationBinding = {
  readonly snapshot: SessionOrganizationSnapshot;
  readonly setFlag: SessionOrganizationStore["setFlag"];
};

/** Hook: one shared snapshot per scope for every mounted surface. */
export function useSessionOrganization(
  scope: string | null,
  getStorage?: () => Storage | null,
): SessionOrganizationBinding {
  const store = sessionOrganizationStore(scope, getStorage);
  // Hydration must render the same empty snapshot SSR produced; the client
  // re-renders with local flags right after mount, so no mismatch can occur.
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_SNAPSHOT,
  );
  return { snapshot, setFlag: store.setFlag };
}

/** A validated deleted/expired Session retracts its local projection too. */
export function forgetSessionOrganization(scope: string, sessionId: string): void {
  sessionOrganizationStore(scope).forget(sessionId);
}
