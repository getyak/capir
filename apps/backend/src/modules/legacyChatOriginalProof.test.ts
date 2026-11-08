import { describe, expect, it } from "vitest";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({ version: 1, tokenHash: "a".repeat(64), accountId: uuid(1), userId: uuid(2), sessionId: uuid(3),
  userKind: "password_human", tokenBranch: "previous", originalDeadline: "2099-01-01T00:00:00.123456Z",
  deployment: { enabled: false, userAuthEnabled: false, webOrigin: null, backendOrigin: null }, labBinding: null });
const human = () => ({ entry: uuid(4), workspace: uuid(5), parent: uuid(6), principal: null, generation: null,
  ownerAccount: uuid(7), ownerUser: uuid(8), grant: uuid(9), entitlementGeneration: 17, run: null });
const operator = () => ({ entry: uuid(4), workspace: uuid(5), parent: null, principal: uuid(10), generation: 19,
  ownerAccount: null, ownerUser: null, grant: null, entitlementGeneration: null, run: uuid(11) });

describe("server-only original credential proof", () => {
  it("returns an independent deeply frozen original microsecond binding with no bearer/profile fields", async () => {
    const { validateLegacyChatOriginalProof } = await import("./legacyChatOriginalProof.js");
    const input = base();
    const result = validateLegacyChatOriginalProof(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input); expect(result.deployment).not.toBe(input.deployment);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.deployment)).toBe(true);
    input.originalDeadline = "2099-01-01T00:00:00.999999Z";
    expect(result.originalDeadline).toBe("2099-01-01T00:00:00.123456Z");
    expect(result).not.toHaveProperty("userEmail"); expect(result).not.toHaveProperty("accountSlug");
    expect(result).not.toHaveProperty("authorization");
  });

  it.each(["human", "operator"])("retains exact real-safe-integer Lab lineage: %s", async kind => {
    const { validateLegacyChatOriginalProof } = await import("./legacyChatOriginalProof.js");
    const input = { ...base(), userKind: "lab_human", labBinding: kind === "human" ? human() : operator() };
    const result = validateLegacyChatOriginalProof(input);
    expect(result.labBinding).toEqual(input.labBinding);
    expect(Object.isFrozen(result.labBinding)).toBe(true);
    expect(result.labBinding).not.toBe(input.labBinding);
  });

  it("preserves empty disabled origins and all six UTC fractional digits without normalization", async () => {
    const { validateLegacyChatOriginalProof } = await import("./legacyChatOriginalProof.js");
    const input = { ...base(), deployment: { ...base().deployment, webOrigin: "", backendOrigin: "" } };
    expect(validateLegacyChatOriginalProof(input).deployment).toEqual(input.deployment);
    expect(validateLegacyChatOriginalProof(input).originalDeadline).toBe(input.originalDeadline);
  });

  it.each(["unknown", "version", "deadline_precision", "calendar", "nul", "surrogate", "hash_object", "session", "kind", "branch", "deployment", "lab_missing", "lab_extra", "lab_generation", "lab_mixed"])("rejects malformed proof %s without conversion", async kind => {
    const { validateLegacyChatOriginalProof } = await import("./legacyChatOriginalProof.js");
    const input: Record<string, unknown> = base();
    let conversions = 0;
    if (kind === "unknown") input.objective = "PRIVATE_SYNTHETIC";
    if (kind === "version") input.version = 2;
    if (kind === "deadline_precision") input.originalDeadline = "2099-01-01T00:00:00.123Z";
    if (kind === "calendar") input.originalDeadline = "2099-02-29T00:00:00.123456Z";
    if (kind === "nul") input.deployment = { ...base().deployment, webOrigin: "https://synthetic\0.invalid" };
    if (kind === "surrogate") input.deployment = { ...base().deployment, webOrigin: "https://synthetic\ud800.invalid" };
    if (kind === "hash_object") input.tokenHash = { toString() { conversions++; return "a".repeat(64); } };
    if (kind === "session") input.sessionId = uuid(3) + "extra";
    if (kind === "kind") input.userKind = "machine";
    if (kind === "branch") input.tokenBranch = "fresh";
    if (kind === "deployment") input.deployment = { ...base().deployment, enabled: 1 };
    if (kind === "lab_missing") input.userKind = "lab_human";
    if (kind === "lab_extra") input.labBinding = human();
    if (kind === "lab_generation") Object.assign(input, { userKind: "lab_human", labBinding: { ...operator(), generation: "19" } });
    if (kind === "lab_mixed") Object.assign(input, { userKind: "lab_human", labBinding: { ...operator(), parent: uuid(6) } });
    expect(() => validateLegacyChatOriginalProof(input)).toThrow("LEGACY_CHAT_ORIGINAL_PROOF_INVALID");
    expect(conversions).toBe(0);
  });

  it.each(["top", "nested", "proxy"])("rejects %s accessors without invoking them or exposing their error", async kind => {
    const { validateLegacyChatOriginalProof } = await import("./legacyChatOriginalProof.js");
    let reads = 0;
    const getter = () => { reads++; throw new Error("PRIVATE_SYNTHETIC_GETTER"); };
    const input = base();
    if (kind === "top") Object.defineProperty(input, "tokenHash", { get: getter });
    if (kind === "nested") Object.defineProperty(input.deployment, "webOrigin", { get: getter });
    const value = kind === "proxy" ? new Proxy(input, { ownKeys: getter, get: getter }) : input;
    expect(() => validateLegacyChatOriginalProof(value)).toThrow("LEGACY_CHAT_ORIGINAL_PROOF_INVALID");
    expect(reads).toBe(0);
  });
});
