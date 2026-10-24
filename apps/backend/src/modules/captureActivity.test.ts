import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { captureActivityPayload, captureActivityPhase, decryptActivityToken, encryptActivityToken, readCaptureAPNsConfig } from "./captureActivity.js";

describe("capture Activity privacy and state contract", () => {
  it("fails closed on incomplete or untrusted APNs configuration", () => {
    expect(readCaptureAPNsConfig({})).toBeNull();
    expect(() => readCaptureAPNsConfig({ TALENT_SIGNAL_APNS_KEY_ID: "KEY" })).toThrow();
    expect(() => readCaptureAPNsConfig({ TALENT_SIGNAL_APNS_KEY_ID: "ABCDEFGHIJ", TALENT_SIGNAL_APNS_TEAM_ID: "ABCDEFGHIJ", TALENT_SIGNAL_APNS_PRIVATE_KEY: "private", TALENT_SIGNAL_APNS_ENVIRONMENT: "elsewhere" })).toThrow();
  });
  it("validates actual key material and refuses a non-P256 private key", () => {
    const env = { TALENT_SIGNAL_APNS_KEY_ID: "ABCDEFGHIJ", TALENT_SIGNAL_APNS_TEAM_ID: "ABCDEFGHIJ" };
    const wrong = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => readCaptureAPNsConfig({ ...env, TALENT_SIGNAL_APNS_PRIVATE_KEY: wrong })).toThrow();
    const valid = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(readCaptureAPNsConfig({ ...env, TALENT_SIGNAL_APNS_PRIVATE_KEY: valid })?.privateKey).toBe(valid);
  });
  it("maps only canonical queue status and never guesses completion", () => {
    expect(captureActivityPhase("queued", false)).toBe("queued");
    expect(captureActivityPhase("running", false)).toBe("processing");
    expect(captureActivityPhase("running", true)).toBe("paused");
    expect(captureActivityPhase("completed", false)).toBe("review");
    expect(captureActivityPhase("failed", false)).toBe("failed");
    expect(captureActivityPhase("cancelled", false)).toBe("paused");
    expect(captureActivityPhase("new-unknown-state", false)).toBe("paused");
  });
  it("uses an allowlisted payload with epoch seconds and monotonic revision", () => {
    const payload = captureActivityPayload("processing", 12, new Date("2026-10-24T00:00:00Z"));
    expect(payload).toEqual({ aps: { timestamp: 1792800000, event: "update", "stale-date": 1792800090,
      "content-state": { phase: "processing", eventRevision: 112, updatedAtEpochSeconds: 1792800000 } } });
    expect(JSON.stringify(payload)).not.toMatch(/name|image|text|objective|token/i);
    expect(() => captureActivityPayload("processing", -1, new Date())).toThrow();
  });
  it("encrypts tokens under owner and Activity associated data", () => {
    const key = "synthetic-key-not-a-provider-credential";
    const encrypted = encryptActivityToken("abcdef0123456789", key, "account:user:session:activity");
    expect(encrypted).not.toContain("abcdef0123456789");
    expect(decryptActivityToken(encrypted, key, "account:user:session:activity")).toBe("abcdef0123456789");
    expect(() => decryptActivityToken(encrypted, key, "another-owner")).toThrow();
    expect(() => decryptActivityToken(encrypted, "rotated-key", "account:user:session:activity")).toThrow();
  });
});
