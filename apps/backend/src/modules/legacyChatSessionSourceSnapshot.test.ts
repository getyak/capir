import { describe, expect, it } from "vitest";
import { restoreLegacyChatSourceGuard, validateLegacyChatSourceSnapshot } from "./legacyChatSourceSnapshot.js";
import type { AuthContext } from "./auth.js";
import type { DatabaseClient } from "../database/pool.js";

const valid = () => ({ version: 2,
  accountId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002",
  generation: "9223372036854775807", sessionID: "00000000-0000-4000-8000-000000000003",
  sessionStamp: "a".repeat(32), sessionExpiresAt: "2099-01-01T00:00:10.654321Z",
  expiresAt: "2099-01-01T00:00:05.123456Z", personIDs: [] as unknown[] });
const message = "The source context changed. Retry using its current state.";

describe("original empty-Session v2 snapshot public validator", () => {
  it("retains exact original six-digit deadlines, BIGINT text and Session binding in a frozen small value", () => {
    const input = valid(), snapshot = validateLegacyChatSourceSnapshot(input);
    expect(snapshot).toEqual(input); expect(snapshot.version).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.personIDs)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(snapshot), "utf8")).toBeLessThanOrEqual(4096);
    input.sessionID = "00000000-0000-4000-8000-000000000009";
    input.personIDs.push(input.userId); input.expiresAt = "2099-01-01T00:00:09.000000Z";
    expect(snapshot).toEqual({ ...valid(), personIDs: [] });
  });

  it("accepts only explicit own data even for a null-prototype stored JSON record", () => {
    const input: unknown = Object.assign(Object.create(null), valid());
    expect(validateLegacyChatSourceSnapshot(input)).toEqual(valid());
  });

  it.each(["version", "accountId", "userId", "generation", "sessionID", "sessionStamp", "sessionExpiresAt", "expiresAt", "personIDs"] as const)(
    "rejects an own %s accessor without invoking it", key => {
      let reads = 0;
      const input = valid();
      Object.defineProperty(input, key, { enumerable: true, get() { reads++; throw new Error("SYNTHETIC_PRIVATE_GETTER"); } });
      expect(() => validateLegacyChatSourceSnapshot(input)).toThrowError(message); expect(reads).toBe(0);
    });

  it.each(["top", "revoked", "people"] as const)("rejects %s proxies without calling their traps", kind => {
    let traps = 0;
    const trap = () => { traps++; throw new Error("SYNTHETIC_PRIVATE_PROXY"); };
    const input = valid(); let candidate: unknown = input;
    if (kind === "top") candidate = new Proxy(input, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    if (kind === "people") input.personIDs = new Proxy([], { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    if (kind === "revoked") { const revocable = Proxy.revocable(input, {}); revocable.revoke(); candidate = revocable.proxy; }
    expect(() => validateLegacyChatSourceSnapshot(candidate)).toThrowError(message); expect(traps).toBe(0);
  });

  it.each(["inherited_session", "inherited_version", "custom_prototype", "extra", "symbol", "nonenumerable"] as const)(
    "rejects %s slots rather than reading caller-owned inherited state", kind => {
      const input: Record<string, unknown> = valid(); let candidate: unknown = input, reads = 0;
      const inherited = { get sessionID() { reads++; return valid().sessionID; }, get version() { reads++; return 2; } };
      if (kind === "inherited_session") { delete input.sessionID; candidate = Object.setPrototypeOf({ ...input }, inherited); }
      if (kind === "inherited_version") { delete input.version; candidate = Object.setPrototypeOf({ ...input }, inherited); }
      if (kind === "custom_prototype") candidate = Object.assign(Object.create({}), input);
      if (kind === "extra") input.objective = "SYNTHETIC_PRIVATE_TEXT";
      if (kind === "symbol") Object.defineProperty(input, Symbol("extra"), { value: "synthetic", enumerable: true });
      if (kind === "nonenumerable") Object.defineProperty(input, "sessionID", { value: input.sessionID, enumerable: false });
      expect(() => validateLegacyChatSourceSnapshot(candidate)).toThrowError(message); expect(reads).toBe(0);
    });

  it.each(["accountId", "userId", "sessionID"] as const)("rejects a noncanonical %s instead of normalizing it", key => {
    for (const value of ["not-an-id", "00000000-0000-4000-8000-00000000000A", "", null, [valid()[key]]]) {
      expect(() => validateLegacyChatSourceSnapshot({ ...valid(), [key]: value })).toThrowError(message);
    }
  });

  it.each(["accountId", "userId"] as const)("binds a valid but different %s before any DB work", key => {
    const input = valid(); let queries = 0;
    const scope: AuthContext = { accountId: input.accountId,userId: input.userId,
      sessionId: "00000000-0000-4000-8000-000000000004",userKind: "password_human",
      accountSlug: "synthetic",userEmail: "synthetic@example.invalid" };
    input[key] = "00000000-0000-4000-8000-000000000009";
    const database = { query: async () => { queries++; throw new Error("Unexpected synthetic DB access."); } } as unknown as DatabaseClient;
    // This is server snapshot binding, not a claim that a UUID authenticates a
    // real reader. Actual SQL/session authority remains covered by real PG.
    expect(() => restoreLegacyChatSourceGuard(database,scope,input)).toThrowError(message);
    expect(queries).toBe(0);
  });

  it.each(["expiresAt", "sessionExpiresAt"] as const)("rejects imprecise or invalid %s", key => {
    for (const value of ["2099-01-01T00:00:05.123Z", "2099-01-01T00:00:05.1234567Z", "2099-01-01T00:00:05.123456+00:00",
      "2099-02-30T00:00:05.123456Z", "0000-01-01T00:00:05.123456Z", "2099-01-01T00:00:05.123456Z\0", null]) {
      expect(() => validateLegacyChatSourceSnapshot({ ...valid(), [key]: value })).toThrowError(message);
    }
  });

  it("rejects an execution deadline past the exact original Session expiry, including its sixth digit", () => {
    expect(() => validateLegacyChatSourceSnapshot({ ...valid(), sessionExpiresAt: "2099-01-01T00:00:05.123455Z" }))
      .toThrowError(message);
    expect(validateLegacyChatSourceSnapshot({ ...valid(), sessionExpiresAt: valid().expiresAt }).expiresAt).toBe(valid().expiresAt);
  });

  it.each(["generation_number", "generation_leading_zero", "generation_overflow", "version", "stamp", "stamp_array",
    "people_nonempty", "people_extra", "people_hole", "oversized_generation", "oversized_stamp", "oversized_expiry"] as const)(
    "rejects invalid or oversized %s without discarding/truncating a slot", kind => {
      const input: Record<string, unknown> = valid();
      if (kind === "generation_number") input.generation = 1;
      if (kind === "generation_leading_zero") input.generation = "01";
      if (kind === "generation_overflow") input.generation = "9223372036854775808";
      if (kind === "version") input.version = 3;
      if (kind === "stamp") input.sessionStamp = "A".repeat(32);
      if (kind === "stamp_array") input.sessionStamp = ["a".repeat(32)];
      if (kind === "people_nonempty") input.personIDs = [valid().userId];
      if (kind === "people_extra") input.personIDs = Object.assign([], { label: "synthetic" });
      if (kind === "people_hole") input.personIDs = new Array(1);
      if (kind === "oversized_generation") input.generation = "1".repeat(4097);
      if (kind === "oversized_stamp") input.sessionStamp = "a".repeat(4097);
      if (kind === "oversized_expiry") input.expiresAt = "2".repeat(4097);
      expect(() => validateLegacyChatSourceSnapshot(input)).toThrowError(message);
    });

  it("does not invoke coercion or serialization on a non-string source slot", () => {
    let calls = 0;
    const trap = () => { calls++; throw new Error("SYNTHETIC_PRIVATE_COERCION"); };
    const deceptive = { toString: trap, toJSON: trap, [Symbol.toPrimitive]: trap };
    for (const key of ["accountId", "userId", "generation", "sessionID", "sessionStamp", "sessionExpiresAt", "expiresAt"] as const)
      expect(() => validateLegacyChatSourceSnapshot({ ...valid(), [key]: deceptive })).toThrowError(message);
    expect(calls).toBe(0);
  });
});
