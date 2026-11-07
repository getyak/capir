import { describe, expect, it } from "vitest";
import { isGroundedExcerpt } from "./memoryReviewPolicy.js";
import type { MemorySourceAuthority } from "./memoryReviewStore.js";

// Counts, offsets and hashes independently calculated from the literal UTF-8
// and UTF-16 bytes; do not derive expected provenance from the implementation.
const source = "  Ａe\u0301🙂 keep\r\nkeep  ";
const sessionID = "11111111-1111-4111-8111-111111111111";
const messageID = "22222222-2222-4222-8222-222222222222";
const sourceHash = "7222906c71afc589dd32325738eead95d776b4b08a78a3be371d11ae0e3af4f0";
const revisionHash = "ac5b7803204734c23058a3835c789b9ecc86393dab2b45e872bfd3f36ad7fedb";
const authority: MemorySourceAuthority = {
  text: source, artifacts: [], sessionId: sessionID, messageId: messageID,
  sourceTaskId: null, captureIds: [], messageTextHash: sourceHash,
  imageManifest: [], captureVersion: null, captureSubjectId: null, captureContextId: null,
};
const locator = {
  kind: "message", session_id: sessionID, message_id: messageID,
  range_version: 1, representation: "authored_message_text.v1", offset_unit: "utf16_code_unit",
  character_start: 2, character_end: 7,
  source_revision_hash: revisionHash, source_text_sha256: sourceHash,
  excerpt_sha256: "3b0ea815af8a5c4e4f4cd4b9a1781d8337c8322ca63ce4f347285f4ec5e1466f",
};

describe("literal-v2 host message grounding", () => {
  it("retains the legacy normalization policy only when no v2 marker was supplied", () => {
    expect(isGroundedExcerpt("Ae\u0301🙂", source)).toBe(true);
  });

  it("accepts the exact original compatible/combining/emoji sequence at its declared range", () => {
    expect(isGroundedExcerpt("Ａe\u0301🙂", source,
      { contentProtocol: "literal-v2", authority, locator })).toBe(true);
  });

  it("rejects NFKC-equivalent text that is not the literal source substring", () => {
    expect(isGroundedExcerpt("Ae\u0301🙂", source,
      { contentProtocol: "literal-v2", authority, locator })).toBe(false);
  });

  it("captures an explicit protocol once instead of falling back after a changing accessor", () => {
    let reads = 0;
    const options = { get contentProtocol() { return ++reads === 1 ? "literal-v2" : "legacy-v1"; }, authority, locator };
    expect(isGroundedExcerpt("Ae\u0301🙂", source, options)).toBe(false);
    expect(reads).toBe(1);
  });

  it.each([
    { character_start: undefined }, { character_end: undefined },
    { character_start: -1 }, { character_start: 2.5 }, { character_end: 21 },
    { character_start: 7, character_end: 2 }, { character_start: 2, character_end: 2 },
    { character_start: Number.NaN }, { character_end: Number.MAX_SAFE_INTEGER + 1 },
    { source_revision_hash: "0".repeat(64) }, { source_text_sha256: "0".repeat(64) },
    { excerpt_sha256: "0".repeat(64) },
    { message_id: "33333333-3333-4333-8333-333333333333" }, { session_id: null },
    { range_version: 2 }, { offset_unit: "unicode_scalar" },
  ])("refuses invalid or stale range provenance %#", override => {
    expect(isGroundedExcerpt("Ａe\u0301🙂", source,
      { contentProtocol: "literal-v2", authority, locator: { ...locator, ...override } })).toBe(false);
  });

  it("does not cut a surrogate pair even when the excerpt occurs elsewhere", () => {
    expect(isGroundedExcerpt("🙂", source, { contentProtocol: "literal-v2", authority,
      locator: { ...locator, character_start: 5, character_end: 6 } })).toBe(false);
  });

  it("uses the explicit occurrence of repeated text and never guesses a first match", () => {
    const repeated = { ...locator, character_start: 14, character_end: 18,
      excerpt_sha256: "6ca7ea2feefc88ecb5ed6356ed963f47dc9137f82526fdd25d618ea626d0803f" };
    expect(isGroundedExcerpt("keep", source, { contentProtocol: "literal-v2", authority, locator: repeated })).toBe(true);
    expect(isGroundedExcerpt("keep", source, { contentProtocol: "literal-v2", authority,
      locator: { ...repeated, character_start: 9, character_end: 13 } })).toBe(false);
  });

  it("does not let an unrelated source string replace the current host authority", () => {
    expect(isGroundedExcerpt("keep", "keep", { contentProtocol: "literal-v2", authority, locator })).toBe(false);
  });

  it("does not reinterpret unsupported content or document representations as message text", () => {
    expect(isGroundedExcerpt("keep", source, { contentProtocol: "literal-v3", authority, locator })).toBe(false);
    expect(isGroundedExcerpt("keep", source, { contentProtocol: "literal-v2", authority,
      locator: { ...locator, kind: "document" } })).toBe(false);
  });
});
