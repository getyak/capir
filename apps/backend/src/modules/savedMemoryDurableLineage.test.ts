import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { recordSessionChatSourcesWithRetention, type SessionChatRetentionReceipt } from "./agentSessionSources.js";
import type { AuthContext } from "./auth.js";
import { captureSavedMemoryReadProof } from "./savedMemoryLineage.js";
import { captureSavedMemoryDurableProof, captureSavedMemoryRetainedProof, registerSavedMemoryDurableLineage,
  savedMemoryDurableProofDigest } from "./savedMemoryDurableLineage.js";

// Pure metadata/negative-capability tests only. These DTOs, no-Session source
// facts and query doubles are NOT actual completed publications/PG positives.
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const expiry = "2030-01-02T03:04:05.123456Z";
const auth: AuthContext = { accountId: id(100), userId: id(101), accountSlug: "synthetic",
  userEmail: "synthetic@example.invalid", userKind: "password_human", sessionId: id(102) };
const stamp = (n = 1) => ({ item_id: id(n), item_version: 3, lineage_epoch: "9007199254740993",
  memory_owner_id: auth.userId, scope: "self" as const, subject_id: null, relationship_context_id: null });
function proof() {
  return { version: 2, account_id: auth.accountId, reader_actor_id: auth.userId, task_id: id(103),
    completion_idempotency_id: id(104), retention_kind: "session_bound", source_origin_session_id: id(105),
    expires_at: expiry, stamps: [stamp()] };
}
function noSession() { return { ...proof(), retention_kind: "canonical_no_session", source_origin_session_id: null, expires_at: null }; }
function exposure() { return { version: 1, account_id: auth.accountId, reader_actor_id: auth.userId,
  task_id: id(103), expires_at: "2030-01-02T03:04:00.000001Z", stamps: [] }; }

describe("strict versioned durable Memory metadata, not permission", () => {
  it("captures exact six-digit original retention and detached sorted stamps", () => {
    const input = proof(), result = captureSavedMemoryDurableProof(input);
    input.stamps[0]!.lineage_epoch = "9007199254740994";
    expect(result.expires_at).toBe(expiry);
    expect(result.stamps[0]?.lineage_epoch).toBe("9007199254740993");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.stamps)).toBe(true);
    expect(Object.isFrozen(result.stamps[0])).toBe(true);
  });

  it("accepts only an explicit no-Session/null/origin-null representation, including explicit-zero metadata", () => {
    const input = { ...noSession(), stamps: [] };
    expect(captureSavedMemoryDurableProof(input)).toEqual(input);
    // This is a closed DTO, not a claim that a missing historical record is empty.
    expect(captureSavedMemoryRetainedProof(input).version).toBe(2);
    for (const bad of [{ ...input, expires_at: expiry }, { ...input, source_origin_session_id: id(105) },
      { ...input, expires_at: undefined }, { ...input, source_origin_session_id: undefined }])
      expect(() => captureSavedMemoryDurableProof(bad)).toThrow();
  });

  it.each([null, undefined, "2030-01-02T03:04:05.123Z", "2030-02-30T03:04:05.123456Z", "infinity"])(
    "refuses missing, rounded or invalid finite Session expiry %s", value => {
      expect(() => captureSavedMemoryDurableProof({ ...proof(), expires_at: value })).toThrow();
    },
  );

  it("does not reinterpret v1 finite proofs or unknown formats as durable no-Session", () => {
    const finite = exposure();
    expect(captureSavedMemoryRetainedProof(finite)).toEqual(captureSavedMemoryReadProof(finite));
    for (const bad of [{ ...finite, expires_at: null }, { ...finite, version: 0 }, { ...finite, version: 3 },
      { ...finite, version: undefined }, { ...proof(), retention_kind: "legacy_finite" },
      { ...noSession(), stamps: undefined }, { ...noSession(), unknown: true }])
      expect(() => captureSavedMemoryRetainedProof(bad)).toThrow();
  });

  it("requires every actual completion and source-branch binding", () => {
    for (const key of ["account_id", "reader_actor_id", "task_id", "completion_idempotency_id"] as const) {
      expect(() => captureSavedMemoryDurableProof({ ...proof(), [key]: null })).toThrow();
    }
    expect(() => captureSavedMemoryDurableProof({ ...proof(), source_origin_session_id: null })).toThrow();
    expect(() => captureSavedMemoryDurableProof({ ...proof(), authorized: true })).toThrow();
  });

  it("refuses reordered/duplicate epochs, sparse arrays, getters and proxies without touching hooks", () => {
    let touched = 0;
    const getter = Object.defineProperty(proof(), "stamps", { enumerable: true, get() { touched++; return []; } });
    const proxy = new Proxy(proof(), { ownKeys() { touched++; throw new Error("PRIVATE_SYNTHETIC"); } });
    const inherited = Object.assign(Object.create({ version: 2 }), proof()); delete inherited.version;
    for (const bad of [getter, proxy, inherited, { ...proof(), stamps: [stamp(2), stamp(1)] },
      { ...proof(), stamps: [stamp(), stamp()] }, { ...proof(), stamps: [stamp(), , stamp(2)] },
      { ...proof(), stamps: Array.from({ length: 257 }, (_, i) => stamp(i + 1)) }]) {
      expect(() => captureSavedMemoryDurableProof(bad)).toThrow();
    }
    expect(touched).toBe(0);
  });

  it("binds every durable field to the independent protocol tuple, preserving integer precision", () => {
    const input = proof();
    const expected = createHash("sha256").update(JSON.stringify(["saved-memory-durable.v2", auth.accountId,
      auth.userId, id(103), id(104), "session_bound", id(105), expiry,
      [[id(1), 3, "9007199254740993", auth.userId, "self", null, null]]]), "utf8").digest("hex");
    expect(savedMemoryDurableProofDigest(input)).toBe(expected);
    const variants = [{ ...input, account_id: id(201) }, { ...input, reader_actor_id: id(202) },
      { ...input, task_id: id(203) }, { ...input, completion_idempotency_id: id(204) },
      { ...input, source_origin_session_id: id(205) }, { ...input, expires_at: "2030-01-02T03:04:05.123457Z" },
      { ...input, stamps: [{ ...stamp(), item_id: id(6) }] },
      { ...input, stamps: [{ ...stamp(), item_version: 4 }] },
      { ...input, stamps: [{ ...stamp(), lineage_epoch: "9007199254740994" }] },
      { ...input, stamps: [{ ...stamp(), memory_owner_id: id(206) }] },
      { ...input, stamps: [{ ...stamp(), scope: "person", subject_id: id(207) }] },
      { ...input, stamps: [{ ...stamp(), scope: "relationship", subject_id: id(207), relationship_context_id: id(208) }] }, noSession()];
    for (const variant of variants) expect(savedMemoryDurableProofDigest(variant) === expected).toBe(false);
  });
});

describe("private source fact cannot stand in for canonical completion", () => {
  it("rejects a JSON-shaped receipt before touching any SQL", async () => {
    const query = vi.fn(async () => { throw new Error("Unexpected pure SQL"); });
    const client = { query } as unknown as PoolClient;
    await expect(registerSavedMemoryDurableLineage(client, auth, exposure(),
      Object.freeze({}) as SessionChatRetentionReceipt, id(104))).rejects.toMatchObject({ code: "SAVED_MEMORY_UNAVAILABLE", statusCode: 409 });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a real no-Session source-branch fact when no canonical transaction assigned an xid", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "SELECT pg_current_xact_id_if_assigned()::text AS transaction_id") return { rows: [{ transaction_id: null }] };
      throw new Error("Unexpected pure SQL");
    });
    const client = { query } as unknown as PoolClient;
    // The actual old source owner has a successful no-Session early return.
    // No completion, accepted item or authority row is fabricated here.
    const fact = await recordSessionChatSourcesWithRetention(client, auth, undefined, id(103), []);
    await expect(registerSavedMemoryDurableLineage(client, auth, exposure(), fact, id(104))).rejects.toMatchObject({ code: "SAVED_MEMORY_UNAVAILABLE", statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe("SELECT pg_current_xact_id_if_assigned()::text AS transaction_id");
    await expect(registerSavedMemoryDurableLineage(client, auth, exposure(), fact, id(104))).rejects.toMatchObject({ code: "SAVED_MEMORY_UNAVAILABLE", statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("refuses a source fact on a different held client and cannot reuse the consumed attempt", async () => {
    const query = vi.fn(async () => { throw new Error("Unexpected pure SQL"); });
    const original = { query } as unknown as PoolClient, other = { query } as unknown as PoolClient;
    const fact = await recordSessionChatSourcesWithRetention(original, auth, undefined, id(103), []);
    await expect(registerSavedMemoryDurableLineage(other, auth, exposure(), fact, id(104))).rejects.toMatchObject({ code: "SAVED_MEMORY_UNAVAILABLE", statusCode: 409 });
    await expect(registerSavedMemoryDurableLineage(original, auth, exposure(), fact, id(104))).rejects.toMatchObject({ code: "SAVED_MEMORY_UNAVAILABLE", statusCode: 409 });
    expect(query).not.toHaveBeenCalled();
  });
});
