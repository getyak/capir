// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_ENTRIES,
  SESSION_ORGANIZATION_PREFIX,
  clearAllSessionOrganization,
  createSessionOrganizationStore,
  organizeSessionRows,
  parseSessionOrganizationPayload,
  resetSessionOrganizationStores,
  sessionOrganizationStore,
  useSessionOrganization,
} from "./workspace-session-organization";

const SCOPE_A = "a".repeat(64);
const SCOPE_B = "b".repeat(64);
const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const SESSION_3 = "33333333-3333-4333-8333-333333333333";

function memoryStorage(failWrites = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("quota exceeded");
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage & { map: Map<string, string> };
}

beforeEach(() => {
  window.localStorage.clear();
  resetSessionOrganizationStores();
});

describe("scoped local session organization", () => {
  it("persists only session IDs and flags under the account/user scope", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    store.setFlag(SESSION_1, "archived", true);
    store.setFlag(SESSION_2, "pinned", true);
    expect(store.getSnapshot().persistence).toBe("local");
    expect(store.getSnapshot().pendingInMemory).toBe(false);
    const raw = storage.map.get(SESSION_ORGANIZATION_PREFIX + SCOPE_A);
    expect(raw).toBeDefined();
    expect(raw).toContain(SESSION_1);
    expect(raw).toContain('"archived":true');
    expect(raw).toContain('"pinned":true');
    expect(raw).not.toContain("title");
    expect(raw).not.toContain("消息");
  });

  it("reports local persistence after a successful read even with no flags yet", () => {
    const storage = memoryStorage();
    storage.map.set(SESSION_ORGANIZATION_PREFIX + SCOPE_A, JSON.stringify({ v: 1, scope: SCOPE_A, entries: {} }));
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    expect(store.getSnapshot().persistence).toBe("local");
    expect(store.getSnapshot().entries).toEqual({});
  });

  it("never projects one account's flags onto another scope", () => {
    const storage = memoryStorage();
    const storeA = createSessionOrganizationStore(SCOPE_A, () => storage);
    storeA.setFlag(SESSION_1, "archived", true);
    const storeB = createSessionOrganizationStore(SCOPE_B, () => storage);
    expect(storeB.getSnapshot().entries[SESSION_1]).toBeUndefined();
    expect(storeB.getSnapshot().entries).toEqual({});
  });

  it("rejects invalid scopes, flags, session IDs and foreign or corrupt payloads", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore("not-a-scope", () => storage);
    expect(store.setFlag(SESSION_1, "archived", true).entries).toEqual({});
    expect(storage.map.size).toBe(0);

    const scoped = createSessionOrganizationStore(SCOPE_A, () => storage);
    expect(scoped.setFlag("../../settings", "archived", true).entries).toEqual({});
    expect(scoped.setFlag("plain text", "pinned", true).entries).toEqual({});
    expect(scoped.setFlag(SESSION_1, "exploded" as never, true).entries).toEqual({});
    expect(scoped.setFlag(SESSION_1, "archived", "yes" as never).entries).toEqual({});
    expect(storage.map.size).toBe(0);

    expect(parseSessionOrganizationPayload({ v: 1, scope: SCOPE_B, entries: { [SESSION_1]: { archived: true, pinned: false, updatedAt: "2026-10-01T00:00:00.000Z" } } }, SCOPE_A)).toEqual({});
    expect(parseSessionOrganizationPayload({ v: 2, scope: SCOPE_A, entries: {} }, SCOPE_A)).toEqual({});
    expect(parseSessionOrganizationPayload([SESSION_1], SCOPE_A)).toEqual({});
    expect(parseSessionOrganizationPayload({
      v: 1,
      scope: SCOPE_A,
      entries: {
        [SESSION_1]: { archived: true, pinned: false, updatedAt: "2026-10-01T00:00:00.000Z" },
        [SESSION_2]: { archived: "yes", pinned: false, updatedAt: "2026-10-01T00:00:00.000Z" },
        "../../etc/passwd": { archived: true, pinned: true, updatedAt: "2026-10-01T00:00:00.000Z" },
      },
    }, SCOPE_A)).toEqual({ [SESSION_1]: { archived: true, pinned: false, updatedAt: "2026-10-01T00:00:00.000Z" } });
  });

  it("bounds the raw stored string before parsing it", () => {
    const storage = memoryStorage();
    const oversized = `{"v":1,"scope":"${SCOPE_A}","entries":{${"\"pad\":\"x\",".repeat(9000)}}}`;
    expect(oversized.length).toBeGreaterThan(64 * 1024);
    storage.map.set(SESSION_ORGANIZATION_PREFIX + SCOPE_A, oversized);
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    expect(store.getSnapshot().entries).toEqual({});
  });

  it("keeps the store bounded to a validated number of entries", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    for (let index = 0; index < MAX_ENTRIES + 25; index += 1) {
      const hex = index.toString(16).padStart(12, "0");
      store.setFlag(`00000000-0000-4000-8000-${hex}`, "archived", true);
    }
    expect(Object.keys(store.getSnapshot().entries).length).toBe(MAX_ENTRIES);
  });

  it("expires stale entries without needing any session list to be complete", () => {
    const storage = memoryStorage();
    const stale = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    storage.map.set(SESSION_ORGANIZATION_PREFIX + SCOPE_A, JSON.stringify({
      v: 1,
      scope: SCOPE_A,
      entries: {
        [SESSION_1]: { archived: true, pinned: false, updatedAt: stale },
        [SESSION_2]: { archived: true, pinned: false, updatedAt: new Date().toISOString() },
      },
    }));
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    expect(store.getSnapshot().entries[SESSION_1]).toBeUndefined();
    expect(store.getSnapshot().entries[SESSION_2]).toBeDefined();
  });

  it("keeps unrelated newer flags from other tabs instead of overwriting them", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    store.setFlag(SESSION_1, "pinned", true);
    // Another tab archives a different session afterwards.
    const later = new Date(Date.now() + 5_000).toISOString();
    storage.map.set(SESSION_ORGANIZATION_PREFIX + SCOPE_A, JSON.stringify({
      v: 1,
      scope: SCOPE_A,
      entries: {
        [SESSION_1]: store.getSnapshot().entries[SESSION_1],
        [SESSION_2]: { archived: true, pinned: false, updatedAt: later },
      },
    }));
    store.setFlag(SESSION_3, "archived", true);
    const raw = storage.map.get(SESSION_ORGANIZATION_PREFIX + SCOPE_A)!;
    expect(raw).toContain(SESSION_1);
    expect(raw).toContain(SESSION_2);
    expect(raw).toContain(SESSION_3);
    // The live snapshot reflects the merge too, not just the stored string.
    expect(Object.keys(store.getSnapshot().entries).sort()).toEqual([SESSION_1, SESSION_2, SESSION_3].sort());
  });

  it("stays truthful in memory when storage writes fail and says so", () => {
    const storage = memoryStorage(true);
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    const snapshot = store.setFlag(SESSION_1, "pinned", true);
    expect(snapshot.persistence).toBe("memory");
    expect(snapshot.pendingInMemory).toBe(true);
    expect(snapshot.entries[SESSION_1]?.pinned).toBe(true);
    expect(storage.map.size).toBe(0);
    // Restore still works in the same truthful in-memory session.
    expect(store.setFlag(SESSION_1, "pinned", false).entries[SESSION_1]).toBeUndefined();
  });

  it("restores archived rows reversibly and drops the entry once flags clear", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    store.setFlag(SESSION_1, "archived", true);
    store.setFlag(SESSION_1, "pinned", true);
    store.setFlag(SESSION_1, "archived", false);
    expect(store.getSnapshot().entries[SESSION_1]).toMatchObject({ archived: false, pinned: true });
    store.setFlag(SESSION_1, "pinned", false);
    expect(store.getSnapshot().entries[SESSION_1]).toBeUndefined();
    // And the persisted record is gone too — nothing left to resurrect later.
    expect(storage.map.get(SESSION_ORGANIZATION_PREFIX + SCOPE_A)).not.toContain(SESSION_1);
  });

  it("prunes only against an explicit complete inventory and clears at logout", () => {
    const storage = memoryStorage();
    const store = sessionOrganizationStore(SCOPE_A, () => storage);
    store.setFlag(SESSION_1, "archived", true);
    store.setFlag(SESSION_2, "pinned", true);
    store.pruneComplete([SESSION_1, SESSION_2]);
    expect(store.getSnapshot().entries[SESSION_1]).toBeDefined();
    store.pruneComplete([SESSION_2]);
    expect(store.getSnapshot().entries[SESSION_1]).toBeUndefined();
    expect(store.getSnapshot().entries[SESSION_2]).toBeDefined();

    // Logout boundary: real browser storage and every cached scope are cleared.
    const browserStore = sessionOrganizationStore(SCOPE_B);
    browserStore.setFlag(SESSION_1, "archived", true);
    expect(window.localStorage.getItem(SESSION_ORGANIZATION_PREFIX + SCOPE_B)).not.toBeNull();
    clearAllSessionOrganization();
    expect(window.localStorage.getItem(SESSION_ORGANIZATION_PREFIX + SCOPE_B)).toBeNull();
  });

  it("shares one live snapshot between mounted surfaces of the same scope", () => {
    const storage = memoryStorage();
    const store = sessionOrganizationStore(SCOPE_A, () => storage);
    store.setFlag(SESSION_1, "archived", true);
    expect(sessionOrganizationStore(SCOPE_A, () => storage).getSnapshot().entries[SESSION_1])
      .toBeDefined();
  });
});

describe("organized row projection", () => {
  const rows = [
    { id: SESSION_1, title: "newest" },
    { id: SESSION_2, title: "middle" },
    { id: SESSION_3, title: "oldest" },
  ];

  it("keeps pinned rows first and the newest remainder on top", () => {
    const { visible, archived } = organizeSessionRows(rows, {
      [SESSION_3]: { archived: false, pinned: true, updatedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(visible.map((row) => row.id)).toEqual([SESSION_3, SESSION_1, SESSION_2]);
    expect(archived).toEqual([]);
  });

  it("separates archived rows without deleting or hiding them from the archive", () => {
    const { visible, archived } = organizeSessionRows(rows, {
      [SESSION_1]: { archived: true, pinned: true, updatedAt: "2026-10-01T00:00:00.000Z" },
      [SESSION_2]: { archived: true, pinned: false, updatedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(visible.map((row) => row.id)).toEqual([SESSION_3]);
    expect(archived.map((row) => row.id)).toEqual([SESSION_1, SESSION_2]);
  });

  it("ignores flags for sessions the account can no longer see", () => {
    const { visible, archived } = organizeSessionRows(rows, {
      ["99999999-9999-4999-8999-999999999999"]: { archived: true, pinned: true, updatedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(visible).toEqual(rows);
    expect(archived).toEqual([]);
  });
});

describe("bound hook shape", () => {
  it("returns inert state for an unbound workspace and never claims persistence", () => {
    const seen: Array<{ scope: string | null; persistence: string; entries: unknown }> = [];
    function Probe({ scope }: { scope: string | null }) {
      const { snapshot } = useSessionOrganization(scope);
      seen.push({ scope: snapshot.scope, persistence: snapshot.persistence, entries: snapshot.entries });
      return null;
    }
    const html = renderToStaticMarkup(createElement(Probe, { scope: null }));
    expect(html).toBe("");
    expect(seen).toEqual([{ scope: null, persistence: "memory", entries: {} }]);
  });

  it("hydrates from one stable empty snapshot before local storage is read", () => {
    const storage = memoryStorage();
    storage.map.set(SESSION_ORGANIZATION_PREFIX + SCOPE_A, JSON.stringify({
      v: 1,
      scope: SCOPE_A,
      entries: { [SESSION_1]: { archived: true, pinned: false, updatedAt: new Date().toISOString() } },
    }));
    const rendered: string[] = [];
    function Probe() {
      const { snapshot } = useSessionOrganization(SCOPE_A, () => storage);
      rendered.push(JSON.stringify(snapshot.entries));
      return null;
    }
    // The server snapshot path (used during SSR and hydration) must be empty
    // even though the store already holds local flags.
    renderToStaticMarkup(createElement(Probe));
    expect(rendered).toEqual(["{}"]);
  });

  it("keeps listeners wired to the shared store", () => {
    const storage = memoryStorage();
    const store = createSessionOrganizationStore(SCOPE_A, () => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setFlag(SESSION_1, "archived", true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setFlag(SESSION_1, "archived", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

it("retracts the exact local flag after a validated tombstone without losing other sessions", () => {
  const storage = memoryStorage();
  const store = createSessionOrganizationStore(SCOPE_A, () => storage);
  store.setFlag(SESSION_1, "pinned", true);
  store.setFlag(SESSION_2, "archived", true);
  store.forget(SESSION_1);
  expect(store.getSnapshot().entries[SESSION_1]).toBeUndefined();
  expect(store.getSnapshot().entries[SESSION_2]?.archived).toBe(true);
  expect(JSON.parse(storage.getItem(SESSION_ORGANIZATION_PREFIX + SCOPE_A)!).entries[SESSION_1]).toBeUndefined();
});
