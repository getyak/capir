/**
 * Redaction boundary tests for the runtime/stdout envelope and the browser
 * receipt path: legal 43-character base64url credentials that begin or end
 * with "-" or "_" must be scrubbed everywhere, while public 64-hex scenario
 * digests must survive untouched.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOKEN_LIKE_PATTERN,
  failureEnvelope,
  redactText,
  redactValue,
  successEnvelope,
} from "../dist/output.js";

const token43 = (char) => char.repeat(43);
const DIGEST = "b".repeat(64);

const CANARIES = [
  token43("t"), // all-letter control
  token43("-"), // legal base64url, leading and trailing hyphen
  token43("_"),
  `-${token43("x").slice(1)}`,
  `${token43("y").slice(0, 42)}-`,
  `_${token43("z").slice(1)}`,
  `${token43("w").slice(0, 42)}_`,
];

describe("token-alphabet redaction boundary", () => {
  it("scrubs every legal 43-character token shape from free text", () => {
    for (const canary of CANARIES) {
      const message = `token ${canary} is revoked; see digest ${DIGEST}`;
      const redacted = redactText(message);
      assert.ok(!redacted.includes(canary), `raw canary survived: ${JSON.stringify(canary.slice(0, 4))}…`);
      assert.ok(redacted.includes("[REDACTED]"));
      assert.ok(redacted.includes(DIGEST), "public 64-hex scenario digest preserved");
    }
  });

  it("keeps 64-hex digests out of the token matcher", () => {
    assert.equal(DIGEST.match(TOKEN_LIKE_PATTERN), null);
    assert.equal(`${DIGEST} ${DIGEST}`.match(TOKEN_LIKE_PATTERN), null);
    // A hex run longer than a digest is not a digest and stays scrubbed.
    assert.ok(redactText(`x ${"a".repeat(65)} y`).includes("[REDACTED]"));
  });

  it("redacts the actual failure envelope end to end", () => {
    for (const canary of CANARIES) {
      const envelope = failureEnvelope("auth logout", {
        code: "CAPIR_LOGOUT_FAILED",
        message: `token ${canary} is revoked for digest ${DIGEST}`,
        run: { note: `echo ${canary}` },
      });
      const serialized = JSON.stringify(envelope);
      assert.ok(!serialized.includes(canary), "failure envelope leaked a canary");
      assert.ok(envelope.error.message.includes(DIGEST));
      assert.ok(JSON.stringify(envelope.run).includes("[REDACTED]"));
    }
  });

  it("redacts browser receipt payloads before they are written to disk", () => {
    // Shape of the browser runner's receipts (runner-receipt.json and
    // rendered-excerpt.json) written through redactValue.
    for (const canary of CANARIES) {
      const receipt = {
        ok: false,
        launched: true,
        error: {
          code: "CAPIR_BROWSER_HANDOFF_FAILED",
          message: `The Web handoff exchange returned HTTP 401 token ${canary} is revoked`,
        },
        observations: [`authorization: Bearer ${canary}`, `digest ${DIGEST} recorded`],
        verification: {
          banner_state: "active",
          demo_expiry: "2026-10-01T12:00:00.000Z",
          directory_state: "ready",
          people_links: 0,
          observations: [`handoff_secret=${canary}`],
        },
      };
      const serialized = JSON.stringify(redactValue(receipt));
      assert.ok(!serialized.includes(canary), "browser receipt leaked a canary");
      assert.ok(serialized.includes(DIGEST), "public digest preserved in receipts");
    }
  });

  it("keeps success envelopes secret-free and digests readable", () => {
    const envelope = successEnvelope("sandbox start", {
      grant: { token: token43("-"), digest: DIGEST },
      note: `state=${token43("_")}`,
    });
    const serialized = JSON.stringify(envelope);
    for (const canary of [token43("-"), token43("_")]) {
      assert.ok(!serialized.includes(canary));
    }
    assert.ok(serialized.includes(DIGEST));
    assert.equal(envelope.grant.token, "[REDACTED]");
    assert.equal(envelope.grant.digest, DIGEST);
  });
});
