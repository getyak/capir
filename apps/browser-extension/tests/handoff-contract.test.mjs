import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExactWebReviewUrl,
  buildHandoffEnvelope,
  classifyReceiptResponse,
  classifyTransportError,
  createRequestIdentity,
  normalizeLocalOrigin,
  retentionCompatibility,
  sessionCopy,
} from "../load-unpacked/lib/handoff-contract.js";
import {
  fixtureCheck,
  fixtureSubmit,
} from "../load-unpacked/lib/fixture-transport.js";

const draft = {
  id: "draft-1",
  kind: "selected_text",
  source: {
    title: "Conversation",
    url: "https://example.test/conversation",
    captured_at: "2026-08-05T09:00:00.000Z",
  },
};

function envelope() {
  const requestIdentity = createRequestIdentity(draft.id, () => "request-1");
  return buildHandoffEnvelope({
    draft,
    reviewedAsset: {
      type: "reviewed_text",
      text: "Exact reviewed excerpt",
      edited_from_selection: false,
    },
    retentionMode: "evidence_crop",
    requestIdentity,
    handoffTarget: "http://localhost:3000",
    sessionVersion: "session-version-4",
    approvedAt: "2026-08-05T09:01:00.000Z",
  });
}

test("accepts HTTPS workspaces and loopback HTTP only", () => {
  assert.equal(
    normalizeLocalOrigin("http://localhost:3000/path"),
    "http://localhost:3000",
  );
  assert.equal(
    normalizeLocalOrigin("http://127.0.0.1:4173"),
    "http://127.0.0.1:4173",
  );
  assert.equal(normalizeLocalOrigin("https://talent-signal.example"), "https://talent-signal.example");
  assert.throws(() => normalizeLocalOrigin("https://user:password@talent-signal.example"));
  assert.throws(() => normalizeLocalOrigin("http://talent-signal.example"));
});

test("opens only a validated receipt on the local Web review surface", () => {
  assert.equal(
    buildExactWebReviewUrl(
      "http://localhost:3000/path",
      "1f1d18be-0190-4b93-8a48-5cb68274cabf",
    ),
    "http://localhost:3000/workspace/captures?task=1f1d18be-0190-4b93-8a48-5cb68274cabf&source=browser-extension",
  );
  assert.throws(() =>
    buildExactWebReviewUrl("http://localhost:3000", "../../workspace"),
  );
  assert.doesNotThrow(() =>
    buildExactWebReviewUrl(
      "https://talent-signal.example",
      "1f1d18be-0190-4b93-8a48-5cb68274cabf",
    ),
  );
});

test("separates observed source, reviewed asset, authorization, and receipt", () => {
  const result = envelope();
  assert.equal(result.source.capture_kind, "selected_text");
  assert.equal(result.review.type, "reviewed_text");
  assert.equal(result.authorization.decision, "submit_reviewed_capture");
  assert.equal(result.idempotency_key, "browser-capture:draft-1:request-1");
  assert.equal(result.handoff_target, "http://localhost:3000");
  assert.deepEqual(result.session, {
    version: "session-version-4",
    credential_transport: "browser_managed",
  });
  assert.equal("receipt" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /cookie|bearer|password|token/i);
});

test("fails closed for unsupported browser retention combinations", () => {
  assert.equal(
    retentionCompatibility("selected_text", "ephemeral").supported,
    false,
  );
  assert.equal(
    retentionCompatibility("selected_text", "evidence_crop").supported,
    true,
  );
  assert.equal(
    retentionCompatibility("selected_text", "full_source").supported,
    false,
  );
  assert.equal(
    retentionCompatibility("visible_tab", "evidence_crop").supported,
    true,
  );
  assert.throws(() =>
    buildHandoffEnvelope({
      draft: { ...draft, kind: "visible_tab" },
      reviewedAsset: { type: "reviewed_image" },
      retentionMode: "ephemeral",
      requestIdentity: createRequestIdentity(draft.id, () => "request-2"),
      handoffTarget: "http://localhost:3000",
    }),
  );
});

test("preserves effective retention and source access from the receipt", () => {
  const receipt = classifyReceiptResponse(202, {
    status: "received",
    receipt_id: "receipt-ephemeral",
    retention: {
      effective_policy: {
        mode: "ephemeral",
        retention_until: null,
      },
      source_access: {
        state: "purged",
        reason: "review_completed",
      },
    },
  });
  assert.equal(receipt.state, "received");
  assert.equal(receipt.retention.source_access.state, "purged");
  assert.match(receipt.message, /already purged/i);
});

test("classifies pending, received, duplicate, stale, and invalid responses truthfully", () => {
  assert.equal(
    classifyReceiptResponse(202, { status: "pending" }).state,
    "pending",
  );
  assert.equal(
    classifyReceiptResponse(202, {
      status: "received",
      receipt_id: "receipt-1",
      capture_id: "1f1d18be-0190-4b93-8a48-5cb68274cabf",
    }).state,
    "received",
  );
  assert.equal(
    classifyReceiptResponse(202, {
      status: "received",
      receipt_id: "receipt-1",
      capture_id: "1f1d18be-0190-4b93-8a48-5cb68274cabf",
    }).capture_id,
    "1f1d18be-0190-4b93-8a48-5cb68274cabf",
  );
  const duplicate = classifyReceiptResponse(409, {
    status: "received",
    code: "duplicate",
    receipt_id: "receipt-1",
  });
  assert.equal(duplicate.state, "received");
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    classifyReceiptResponse(409, { code: "session_stale" }).code,
    "session_changed",
  );
  assert.equal(classifyReceiptResponse(500, {}).state, "unknown");
  assert.equal(classifyReceiptResponse(204, {}).state, "unknown");
});

test("keeps both timeout and unreachable-service outcomes unknown until receipt recovery", () => {
  assert.equal(
    classifyTransportError(new DOMException("timeout", "AbortError")).state,
    "unknown",
  );
  assert.equal(classifyTransportError(new TypeError("offline")).state, "unknown");
});

test("retries offline with the same idempotency key and prevents duplicate creation", async () => {
  const packet = envelope();
  await assert.rejects(
    fixtureSubmit({
      envelope: packet,
      scenario: "offline",
      attempt: 1,
      delayMs: 0,
    }),
    /offline/i,
  );
  const retried = await fixtureSubmit({
    envelope: packet,
    scenario: "offline",
    attempt: 2,
    delayMs: 0,
  });
  assert.equal(retried.state, "received");

  const duplicate = await fixtureSubmit({
    envelope: packet,
    scenario: "duplicate",
    delayMs: 0,
  });
  assert.equal(duplicate.state, "received");
  assert.equal(duplicate.duplicate, true);
  assert.equal(packet.idempotency_key, "browser-capture:draft-1:request-1");
});

test("reconciles an unknown fixture receipt without resubmitting", async () => {
  const packet = envelope();
  await assert.rejects(
    fixtureSubmit({
      envelope: packet,
      scenario: "unknown_then_received",
      delayMs: 0,
    }),
    (error) => error.name === "AbortError",
  );
  const reconciled = await fixtureCheck({
    requestId: packet.request_id,
    scenario: "unknown_then_received",
    delayMs: 0,
  });
  assert.equal(reconciled.state, "received");
});

test("requires an observable ready session and never exposes a credential", () => {
  const ready = sessionCopy(200, {
    status: "ready",
    contact_agent: true,
    workspace_label: "Fixture workspace",
    session_version: "version-4",
    token: "must-not-be-copied",
  });
  assert.deepEqual(ready, {
    state: "ready",
    workspace_label: "Fixture workspace",
    session_version: "version-4",
    message:
      "Browser-managed local session is ready. No token is exposed to the extension.",
  });
  assert.equal(sessionCopy(401, {}).state, "not_ready");
});
