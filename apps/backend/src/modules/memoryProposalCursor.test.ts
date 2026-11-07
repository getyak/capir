import { describe, expect, it } from "vitest";
import { openMemoryProposalCursor, sealMemoryProposalCursor,
  type MemoryProposalCursorScope, type MemoryProposalCursorState } from "./memoryProposalCursor.js";

const scope: MemoryProposalCursorScope = {
  accountId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000002",
  loginSessionId: "10000000-0000-4000-8000-000000000003", purpose: "people",
  personId: "10000000-0000-4000-8000-000000000004", contextId: null, sourceSessionId: null,
};
const nowMs = Date.parse("2026-11-07T12:00:00Z");
const bounds = { nowMs, sessionExpiresAtMs: nowMs + 60_000 };
const state: MemoryProposalCursorState = { snapshotAt: "2026-11-07T11:59:59.123456Z",
  beforeCreatedAt: "2026-11-07T11:59:00.123455Z", beforeId: "10000000-0000-4000-8000-000000000005",
  validUntilMs: nowMs + 30_000 };
// Synthetic digest-shaped material; never a login token or stored session hash.
const syntheticKeyMaterial = "a".repeat(64);

describe("opaque purpose-bound Memory proposal continuation", () => {
  it("round trips exact microseconds with randomized opaque encoding, not issuer authority", () => {
    const first = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
    const second = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(1024);
    expect(Buffer.from(first.split(".")[1]!, "base64url").toString("utf8")).not.toContain(state.beforeId);
    expect(openMemoryProposalCursor(first, syntheticKeyMaterial, scope, bounds)).toEqual(state);
    expect(openMemoryProposalCursor(second, syntheticKeyMaterial, scope, bounds)).toEqual(state);
  });

  it.each(Object.entries({ accountId: "other-account", userId: "other-user", loginSessionId: "renewed-login",
    purpose: "chat", personId: "other-person", contextId: "other-context", sourceSessionId: "other-source-session" }))(
    "cannot reuse a cursor after changing %s", (field, value) => {
      const cursor = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
      expect(() => openMemoryProposalCursor(cursor, syntheticKeyMaterial,
        { ...scope, [field]: value } as MemoryProposalCursorScope, bounds)).toThrow(/fresh read/);
    });

  it.each([null, "", "not-a-session-hash", "b".repeat(64)])("fails closed on unknown/rotated material %s", material => {
    const cursor = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
    expect(() => openMemoryProposalCursor(cursor, material, scope, bounds)).toThrow(/fresh read/);
  });

  it("rejects corrupted encoding/version/oversize/malformed without echoing caller content", () => {
    const cursor = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
    for (const value of ["private-frontier", "x".repeat(1025), cursor.replace(/^mp1/, "mp2"),
      cursor.slice(0, 8) + (cursor[8] === "A" ? "B" : "A") + cursor.slice(9)]) {
      try { openMemoryProposalCursor(value, syntheticKeyMaterial, scope, bounds); expect.fail("accepted"); }
      catch (error) { expect((error as Error).message).toBe("The proposal list changed. Start a fresh read."); }
    }
  });

  it("rejects expired or newly shortened session authority without inheriting a renewed deadline", () => {
    const cursor = sealMemoryProposalCursor(syntheticKeyMaterial, scope, state, bounds);
    expect(() => openMemoryProposalCursor(cursor, syntheticKeyMaterial, scope,
      { ...bounds, nowMs: state.validUntilMs })).toThrow(/fresh read/);
    expect(() => openMemoryProposalCursor(cursor, syntheticKeyMaterial, scope,
      { ...bounds, sessionExpiresAtMs: nowMs + 1_000 })).toThrow(/fresh read/);
  });

  it.each([
    { beforeCreatedAt: "2026-11-07T11:59:59.123457Z" },
    { snapshotAt: "2026-11-08T11:59:59.123456Z" },
    { snapshotAt: "2026-02-30T11:59:59.123456Z" },
    { beforeCreatedAt: "2026-11-07T11:59:00.123Z" },
    { beforeId: "hidden-not-a-uuid" }, { validUntilMs: nowMs + 60_001 },
    { validUntilMs: nowMs }, { validUntilMs: Number.NaN },
  ])("rejects invalid server frontier/deadline %j", change => {
    expect(() => sealMemoryProposalCursor(syntheticKeyMaterial, scope,
      { ...state, ...change }, bounds)).toThrow(/fresh read/);
  });
});
