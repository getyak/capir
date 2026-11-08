import { createHash } from "node:crypto";
import { SavedMemorySearchInputSchema } from "@talent-signal/agent";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../database/pool.js";
import { projectSavedMemoryDiscoveryRow, searchSavedMemory, SAVED_MEMORY_PAGE_MAX_JSON_BYTES,
  type SavedMemoryDiscoveryContext, type SavedMemoryFinalReadDomain } from "./savedMemoryDiscovery.js";
import { SavedMemoryReadSet, captureSavedMemoryReadProof, captureSavedMemoryStamp, readSavedMemoryLineage,
  type SavedMemoryAuthority } from "./savedMemoryLineage.js";

// Pure host contract/clock doubles only. They do not prove PostgreSQL, auth,
// mutation transitions, a completed publication or any real provider surface.
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const checked = "2030-01-02T03:04:00.000000Z", expiry = "2030-01-02T04:04:00.000000Z";
const stamp = (n = 1) => ({ item_id: id(n), item_version: 1, lineage_epoch: "9007199254740993",
  memory_owner_id: id(801), scope: "self" as const, subject_id: null, relationship_context_id: null });
const authority = (): SavedMemoryAuthority => ({ auth: { accountId: id(800), userId: id(801) },
  taskID: id(802), expiresAt: expiry, assertCurrent: vi.fn(async () => {}) });
function row(n = 1) {
  return { id: id(n), version: 1, display_text: "Synthetic literal %_\\ clue", original_display_text: null, statement_kind: "source_statement",
    scope: "self", subject_id: null, relationship_context_id: null, person_label: null,
    speaker: null, reporter: null, valid_time: null, observed_time: null, time_status: "unknown", sensitivity: "normal",
    supersedes_id: null, superseded_by_id: null, conflict_group_id: null, cursor_time: checked, stamp: stamp(n), representation_ok: true,
    evidence_refs: [{ evidence_id: id(900 + n), source_kind: "message", capture_id: null, source_resource_id: null,
      source_session_id: id(950), source_message_id: id(951), source_artifact_id: null, locator_sha256: null }] };
}
function harness(rows: unknown[] = [row()]) {
  let state: { id: unknown; cursor_key: unknown; cutoff: string; expires_at: string } | undefined;
  const a = authority(), query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes("AS available")) return { rows: [{ available: true }] };
    if (sql.includes("FROM memory_items m JOIN memory_item_lineage")) return { rows };
    if (sql.includes("FROM memory_discovery_queries")) return { rows: state ? [state] : [] };
    throw new Error("Unexpected pure query");
  });
  const client = { query: vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql.includes("INSERT INTO memory_discovery_queries")) {
      state = { id: parameters?.[2], cursor_key: parameters?.[4], cutoff: checked, expires_at: expiry };
      return { rows: [{ cutoff: checked, expires_at: expiry }] };
    }
    return { rows: [], rowCount: 0 };
  }), release: vi.fn() };
  const finalizeRead = vi.fn(async (_domain: Readonly<SavedMemoryFinalReadDomain>): Promise<unknown> => ({ available: true, checked_at: checked, read_until: expiry }));
  const context: SavedMemoryDiscoveryContext = { pool: { connect: async () => client } as unknown as Pool,
    database: { query } as unknown as DatabaseClient, authority: a, reads: new SavedMemoryReadSet(a),
    remainingContextCharacters: () => 24_000, chargeContextCharacters: vi.fn(() => true), finalizeRead };
  return { context, query, client, finalizeRead };
}
afterEach(() => vi.restoreAllMocks());

describe("strict literal ANY input", () => {
  it("preserves literal wildcard, whitespace, normalization and astral text", () => {
    const terms = [" a_%\\ ", "e\u0301", "é", "🪷".repeat(120)];
    expect(SavedMemorySearchInputSchema.parse({ terms }).terms).toEqual(terms);
  });
  it.each([[], [" "], ["x\0y"], ["\ud800"], ["\udc00"], ["x".repeat(121)], Array(9).fill("x"), Array(8).fill("🪷".repeat(120))])(
    "rejects a whole invalid or over-budget term set", (...terms) => {
      expect(SavedMemorySearchInputSchema.safeParse({ terms }).success).toBe(false);
    },
  );
  it("rejects unknown keys, wrong types, accessors, proxies and sparse arrays without coercion", () => {
    let touched = 0;
    const accessor = Object.defineProperty({}, "terms", { enumerable: true, get() { touched++; return ["x"]; } });
    const proxy = new Proxy({}, { ownKeys() { touched++; return []; } });
    const sparse = ["x", , "y"];
    for (const input of [{ terms: ["x"], write: true }, { terms: ["x"], limit: "2" }, accessor, proxy, { terms: sparse }]) {
      expect(SavedMemorySearchInputSchema.safeParse(input).success).toBe(false);
    }
    expect(touched).toBe(0);
  });
});

describe("original immutable read-set", () => {
  it("retains exact BIGINT beyond binary64 and rejects inconsistent reuse of the same item", () => {
    const reads = new SavedMemoryReadSet(authority()), original = stamp();
    reads.admit([original]); original.lineage_epoch = "9007199254740994";
    expect(reads.snapshot().stamps[0]?.lineage_epoch).toBe("9007199254740993");
    expect(() => reads.admit([original])).toThrow();
    expect(reads.snapshot().stamps).toHaveLength(1);
  });
  it("commits a page atomically and refuses the 257th item without dropping earlier dependencies", () => {
    const reads = new SavedMemoryReadSet(authority());
    reads.admit(Array.from({ length: 256 }, (_, i) => stamp(i + 1)));
    expect(() => reads.admit([stamp(257)])).toThrow();
    expect(reads.snapshot().stamps).toHaveLength(256);
    expect(Object.isFrozen(reads.snapshot().stamps[0])).toBe(true);
    reads.seal(); expect(() => reads.admit([])).toThrow();
  });
  it("binds initial actor/deadline and does not inherit a mutable host object", () => {
    const a = authority(), reads = new SavedMemoryReadSet(a);
    Object.assign(a.auth, { userId: id(99) }); Object.assign(a, { expiresAt: checked });
    expect(reads.snapshot()).toMatchObject({ reader_actor_id: id(801), expires_at: expiry });
  });
  it.each([0, 1.5, 2147483648, Infinity, NaN])("rejects item version %s outside actual DB integer domain", version => {
    expect(() => captureSavedMemoryStamp({ ...stamp(), item_version: version })).toThrow();
  });
  it("refuses getter/proxy proof, unknown format, duplicate/out-of-order tuples and invalid calendar deadlines", () => {
    let touched = 0;
    const good = new SavedMemoryReadSet(authority()).snapshot();
    const getter = Object.defineProperty({ ...good }, "stamps", { enumerable: true, get() { touched++; return []; } });
    const proxy = new Proxy(good, { getOwnPropertyDescriptor() { touched++; throw new Error("private"); } });
    for (const value of [getter, proxy, { ...good, version: 0 }, { ...good, unknown: true },
      { ...good, stamps: [stamp(), stamp()] }, { ...good, stamps: [stamp(2), stamp(1)] },
      { ...good, expires_at: "2030-02-30T00:00:00.000001Z" }]) expect(() => captureSavedMemoryReadProof(value)).toThrow();
    expect(touched).toBe(0);
  });
  it("requires stored digest equality on reconstructed durable lineage, including the empty-set format", async () => {
    const proof = new SavedMemoryReadSet(authority()).snapshot();
    const digest = createHash("sha256").update(JSON.stringify(proof)).digest("hex");
    const query = vi.fn(async () => ({ rows: [{ proof, proof_digest: digest }] }));
    const db = { query } as unknown as DatabaseClient;
    await expect(readSavedMemoryLineage(db, authority().auth, id(802))).resolves.toEqual(proof);
    query.mockResolvedValueOnce({ rows: [{ proof, proof_digest: "0".repeat(64) }] });
    await expect(readSavedMemoryLineage(db, authority().auth, id(802))).rejects.toThrow();
  });
});

describe("whole-item projection and physical capacity", () => {
  it("fits all maximal fields and 10 evidence refs under512KiB without relaxing the24k Run budget", () => {
    const source = row(), control = "\u0001";
    const max = { ...source, scope: "relationship", subject_id: id(2), relationship_context_id: id(3),
      version: 2147483647, stamp: { ...stamp(), item_version: 2147483647, scope: "relationship", subject_id: id(2), relationship_context_id: id(3) },
      display_text: control.repeat(32768), original_display_text: control.repeat(32768),
      person_label: control.repeat(2048), speaker: control.repeat(2048), reporter: control.repeat(2048),
      valid_time: expiry, observed_time: expiry, supersedes_id: id(4), superseded_by_id: id(6), conflict_group_id: id(5), sensitivity: "sensitive",
      evidence_refs: Array.from({ length: 10 }, (_, i) => ({ ...source.evidence_refs[0]!, evidence_id: id(900 + i),
        source_kind: "image_region", capture_id: id(10), source_resource_id: id(11), source_artifact_id: control.repeat(1024), locator_sha256: "f".repeat(64) })) };
    const projected = projectSavedMemoryDiscoveryRow(max).item;
    const output = { matching: "literal_terms_any", coverage: "current_authorized_matches_under_fixed_cutoff", semantic_absence: false,
      items: [projected], has_more: true, next_cursor: "x".repeat(1024) };
    const encoded = JSON.stringify(output), exactBytes = Buffer.byteLength(encoded, "utf8");
    // Variable bytes:393216 text +36864 metadata +61440 artifacts=491520.
    // All fixed keys/UUIDs/time/enums/numbers/cursor fit a separate8192B bound.
    expect(exactBytes).toBeLessThanOrEqual(491520 + 8192);
    expect(exactBytes).toBeLessThanOrEqual(SAVED_MEMORY_PAGE_MAX_JSON_BYTES);
    expect(encoded.length).toBeGreaterThan(24_000);
    expect(projected.display_text).toBe(max.display_text);
    expect(projected.original_display_text).toBe(max.original_display_text);
  });
  it("does not turn corrupt/oversize metadata or an 11th retained ref into silent absence", () => {
    const r = row();
    for (const value of [{ ...r, display_text: "x".repeat(32769) }, { ...r, representation_ok: false },
      { ...r, speaker: "x\0y" }, { ...r, evidence_refs: Array(11).fill(r.evidence_refs[0]) }, { ...r, evidence_refs: [] }]) {
      expect(() => projectSavedMemoryDiscoveryRow(value)).toThrow();
    }
  });
});

describe("host-only final joint envelope", () => {
  it("binds original tuples/query role/cutoff and returns deeply detached output", async () => {
    const h = harness(), page = await searchSavedMemory(h.context, { terms: ["%_\\"] });
    const domain = h.finalizeRead.mock.calls[0]![0];
    expect(domain).toMatchObject({ proof: { account_id: id(800), reader_actor_id: id(801), expires_at: expiry },
      page_limit: 10, projection_version: 1, cutoff: checked, delivered_stamps: [stamp()] });
    expect(domain.literal_patterns).toEqual(["%\\%\\_\\\\%"]);
    expect(Object.isFrozen(domain.proof.stamps[0])).toBe(true);
    expect(page.items).toHaveLength(1); expect(page.semantic_absence).toBe(false);
    expect(Object.isFrozen(page.items[0])).toBe(true);
    expect(h.context.reads.snapshot().stamps).toEqual([stamp()]);
    expect(h.client.release).toHaveBeenCalledOnce();
  });
  it("does not provide capability when the real final owner is missing or rejects", async () => {
    const missing = harness(); Object.assign(missing.context, { finalizeRead: undefined });
    await expect(searchSavedMemory(missing.context, { terms: ["x"] })).rejects.toThrow();
    expect(missing.query).not.toHaveBeenCalled();
    const denied = harness(); denied.finalizeRead.mockResolvedValue({ available: false, checked_at: checked, read_until: expiry });
    await expect(searchSavedMemory(denied.context, { terms: ["x"] })).rejects.toThrow();
    expect(denied.context.chargeContextCharacters).not.toHaveBeenCalled();
    expect(denied.context.reads.snapshot().stamps).toEqual([]);
  });
  it("keeps the returned microsecond anchor and rejects changed terms or tampered AEAD", async () => {
    const r = { ...row(), cursor_time: "2030-01-02T03:03:59.123456Z" };
    const h = harness([r, row(2)]), page = await searchSavedMemory(h.context, { terms: ["x"], limit: 1 });
    expect(page.has_more).toBe(true); expect(page.next_cursor).not.toBeNull();
    await searchSavedMemory(h.context, { terms: ["x"], limit: 1, cursor: page.next_cursor! });
    // The query double does not execute SQL keyset filtering. This verifies
    // exact cursor -> real parameter plumbing, not PostgreSQL page coverage.
    const selected = h.query.mock.calls.filter(([sql]) => sql.includes("FROM memory_items m JOIN memory_item_lineage"));
    expect(selected).toHaveLength(2); expect(selected[1]?.[1]?.[5]).toBe(r.cursor_time); expect(selected[1]?.[1]?.[6]).toBe(r.id);
    await expect(searchSavedMemory(h.context, { terms: ["different"], limit: 1, cursor: page.next_cursor! })).rejects.toMatchObject({ code: "SAVED_MEMORY_QUERY_RESET" });
    await expect(searchSavedMemory(h.context, { terms: ["x"], limit: 1, cursor: page.next_cursor!.slice(0, -1) + "!" })).rejects.toThrow();
  });
  it("charges the complete final roundtrip and synchronous serialization/admission against the original deadline", async () => {
    let now = 0n; vi.spyOn(process.hrtime, "bigint").mockImplementation(() => now);
    const h = harness();
    h.finalizeRead.mockImplementation(async () => { now = 1001n; return { available: true, checked_at: checked, read_until: "2030-01-02T03:04:00.000001Z" }; });
    await expect(searchSavedMemory(h.context, { terms: ["x"] })).rejects.toThrow();
    expect(h.context.chargeContextCharacters).not.toHaveBeenCalled();
    const later = harness(); now = 0n;
    later.finalizeRead.mockResolvedValue({ available: true, checked_at: checked, read_until: "2030-01-02T03:04:00.000001Z" });
    Object.assign(later.context, { chargeContextCharacters: () => { now = 1001n; return true; } });
    await expect(searchSavedMemory(later.context, { terms: ["x"] })).rejects.toThrow();
  });
  it("rejects concurrent read-set changes during the final await rather than blessing an unverified union", async () => {
    const h = harness(); h.finalizeRead.mockImplementation(async () => {
      h.context.reads.admit([stamp(2)]); return { available: true, checked_at: checked, read_until: expiry };
    });
    await expect(searchSavedMemory(h.context, { terms: ["x"] })).rejects.toThrow();
    expect(h.context.chargeContextCharacters).not.toHaveBeenCalled();
  });
  it("refuses a whole maximal item under a smaller real Run budget without creating a cursor over it", async () => {
    const h = harness([{ ...row(), display_text: "x".repeat(32768) }]);
    await expect(searchSavedMemory(h.context, { terms: ["x"] })).rejects.toMatchObject({ code: "SAVED_MEMORY_BUDGET_LIMITED" });
    expect(h.finalizeRead).not.toHaveBeenCalled(); expect(h.context.reads.snapshot().stamps).toEqual([]);
  });
  it("still fences and charges an empty page; no-results is never semantic absence", async () => {
    const h = harness([]), page = await searchSavedMemory(h.context, { terms: ["absent"] });
    expect(page).toMatchObject({ items: [], has_more: false, semantic_absence: false });
    expect(h.finalizeRead).toHaveBeenCalledOnce(); expect(h.context.chargeContextCharacters).toHaveBeenCalledOnce();
    const empty = harness([]); Object.assign(empty.context, { remainingContextCharacters: () => 1 });
    await expect(searchSavedMemory(empty.context, { terms: ["x"] })).rejects.toThrow();
    expect(empty.context.chargeContextCharacters).not.toHaveBeenCalled();
  });
});
