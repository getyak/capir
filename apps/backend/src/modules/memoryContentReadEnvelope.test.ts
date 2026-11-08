import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as owner from "./memoryReadAuthority.js";

// These literal SHA values come from independent static expansion of immutable
// a827c99d, not the new builder or its runtime output. Existing GET448 SQL is a
// protected compatibility boundary; this is a golden, not a proof of PG access.
describe("additive Memory content reader and protected legacy authority", () => {
  it.each([
    { login: 3, accepted: 4, original: undefined, bytes: 3348, sha: "58740db4d8789b97ec9dba114911b6a942568ca21e6f1afd974a7d89f797feba" },
    { login: 3, accepted: 4, original: 6, bytes: 3383, sha: "37bb10ec4f41b8b1fd83cc72bd7e9caef72b0fa4982770deec4d3f3f304451bc" },
    { login: 7, accepted: 10, original: 12, bytes: 3389, sha: "dea19e2336304b2091814af50fa2eaeca2260eb6679be178537bff74c9d18ac3" },
  ])("keeps legacy resolved SQL byte-identical for its existing $login/$accepted slots", row => {
    const sql = owner.memoryReadAuthoritySQL(row.login, row.accepted, row.original);
    expect(Buffer.byteLength(sql, "utf8")).toBe(row.bytes);
    expect(createHash("sha256").update(sql).digest("hex")).toBe(row.sha);
  });

  const original = { token_hash: "a".repeat(64), expires_at: new Date("2026-11-08T06:30:00.000Z"),
    accepted_deadline: "2026-11-08T06:00:01.000000Z", checked_ms: "1794117600000",
    snapshot_at: "2026-11-08T06:00:00.000000Z" };
  it("keeps the earlier accepted-slot deadline instead of renewing to current session expiry", () => {
    expect(owner.memoryReadAuthorityBounds(original)).toEqual({ nowMs: 1794117600000,
      sessionExpiresAtMs: 1794117601000 });
  });
  it.each([
    { token_hash: "not-a-token-hash" }, { accepted_deadline: "2026-11-08T06:00:01Z" },
    { checked_ms: "not-a-clock" }, { accepted_deadline: "2026-11-08T06:00:00.000000Z" },
  ])("keeps malformed or expired legacy observation fail-closed (%j)", delta => {
    expect(owner.memoryReadAuthorityBounds({ ...original, ...delta })).toBeNull();
  });

  it("exposes the planned factory through the existing authority namespace without a missing-module red", () => {
    expect(typeof Reflect.get(owner, "createMemoryContentReaderProbeFactory"),
      "Explicit API availability only; no joint authority/PG behavior is established by this case.").toBe("function");
  });
});
