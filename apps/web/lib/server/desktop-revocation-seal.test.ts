import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./backendAuth", () => ({ authSecret: () => "synthetic-auth-encryption-key" }));
import { sealDesktopRevocationProof, openDesktopRevocationProof } from "./desktop-revocation-seal";
const scope = { account_id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222",
  session_id: "33333333-3333-4333-8333-333333333333" };
const access = "a".repeat(43);
beforeEach(() => vi.useRealTimers());
it("escrows only encrypted destructive proof with randomized nonces and no arbitrary expiry", () => {
  const first = sealDesktopRevocationProof("https://web.test", scope, access);
  expect(first).not.toContain(access);
  expect(first).not.toContain(scope.session_id);
  expect(sealDesktopRevocationProof("https://web.test", scope, access)).not.toBe(first);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2099-01-01"));
  expect(openDesktopRevocationProof(first, "https://web.test", scope)).toBe(access);
});
it("rejects tampering, other origins, every mismatched tuple and oversized proofs", () => {
  const proof = sealDesktopRevocationProof("https://web.test", scope, access);
  const pieces = proof.split("."); pieces[2] = (pieces[2]![0] === "a" ? "b" : "a") + pieces[2]!.slice(1);
  expect(() => openDesktopRevocationProof(pieces.join("."), "https://web.test", scope)).toThrow();
  expect(() => openDesktopRevocationProof(proof, "https://other.test", scope)).toThrow();
  for (const field of ["account_id", "user_id", "session_id"] as const) {
    expect(() => openDesktopRevocationProof(proof, "https://web.test", { ...scope, [field]: "44444444-4444-4444-8444-444444444444" })).toThrow();
  }
  for (const invalid of [proof.replace("v1.", "v2."), proof + "padding", "a".repeat(2049)]) {
    expect(() => openDesktopRevocationProof(invalid, "https://web.test", scope)).toThrow();
  }
});
