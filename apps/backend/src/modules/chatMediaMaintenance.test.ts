import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { ChatMediaStorage } from "./chatMediaStorage.js";
import { inspectDeletedChatMedia } from "./chatMediaMaintenance.js";

// Synthetic tombstone metadata; no conversation, name, or image body enters inventory.
const account = "10000000-0000-4000-8000-000000000001";
const person = "20000000-0000-4000-8000-000000000001";
const media = "50000000-0000-4000-8000-000000000001";
const key = `${account}/${person}/${media}`;
function row(overrides = {}) {
  return { account_id: account, id: media, subject_id: person, object_key: key, storage_provider: "s3",
    upload_state: "idle", upload_storage_scope: null, trusted_intent: true, submitted: false,
    deleted_at: new Date("2026-10-22T00:00:00Z"), audit_sequence: "41", ...overrides };
}
function pool(rows: unknown[]) {
  const query = async (sql: string) => {
    if (sql.includes("FROM chat_media_assets media")) return { rows };
    if (!["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) && !sql.startsWith("SET TRANSACTION")) throw new Error("Inventory attempted a mutation");
    return { rows: [] };
  };
  return { connect: async () => ({ query, release() {} }) } as unknown as Pool;
}

describe("historical Chat media deletion inventory", () => {
  it("reports only exact trusted tombstones and redacts keys and identities", async () => {
    const inspected: string[] = [];
    const storage = { provider: "s3", labScopeID: "synthetic-scope", async inspectVersions(objectKey: string) {
      inspected.push(objectKey); return { versions: 2, deleteMarkers: 1 };
    } } as unknown as ChatMediaStorage;
    const report = await inspectDeletedChatMedia(pool([row()]), storage);
    expect(inspected).toEqual([key]);
    expect(report).toMatchObject({ mode: "dry_run", inspected: 1, retained_versions: 2, retained_delete_markers: 1,
      entries: [{ blockers: ["legacy_storage_scope_unverified"], versions: 2, delete_markers: 1 }] });
    for (const privateValue of [account, person, media, key]) expect(JSON.stringify(report)).not.toContain(privateValue);
  });

  it("never inspects unproven, submitted, in-flight, cross-owner, or migrated objects", async () => {
    let inspected = 0;
    const storage = { provider: "s3", labScopeID: "synthetic-scope", async inspectVersions() { inspected++; return { versions: 1, deleteMarkers: 0 }; } } as unknown as ChatMediaStorage;
    const rows = [row({ trusted_intent: false }), row({ submitted: true }), row({ upload_state: "writing" }),
      row({ object_key: `another-owner/${person}/${media}` }), row({ upload_storage_scope: "retired-scope" }), row({ storage_provider: "local" })];
    const report = await inspectDeletedChatMedia(pool(rows), storage);
    expect(inspected).toBe(0);
    expect(report.entries.every(entry => entry.blockers.length > 0)).toBe(true);
    expect(report.retained_versions).toBe(0);
  });

  it("retains a failed version listing as a blocker instead of a zero-residue claim", async () => {
    const storage = { provider: "s3", labScopeID: "synthetic-scope", async inspectVersions() { throw new Error("PRIVATE_STORAGE_CANARY"); } } as unknown as ChatMediaStorage;
    const report = await inspectDeletedChatMedia(pool([row({ upload_storage_scope: "synthetic-scope" })]), storage);
    expect(report.entries[0]?.blockers).toContain("version_inventory_failed");
    expect(report.entries[0]?.versions).toBeNull();
    expect(JSON.stringify(report)).not.toContain("PRIVATE_STORAGE_CANARY");
  });
});
