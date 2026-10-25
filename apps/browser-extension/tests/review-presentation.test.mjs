import assert from "node:assert/strict";
import test from "node:test";
import {
  dispositionPresentation,
  isSyntheticTransport,
  LONG_MIXED_SCRIPT_SAMPLE,
  progressPresentation,
  sessionPresentation,
  submissionPresentation,
} from "../load-unpacked/lib/review-presentation.js";

test("labels proposal, no-action, ambiguity, and blocked inference without confirmation", () => {
  const presentations = [
    dispositionPresentation("propose_action"),
    dispositionPresentation("no_action"),
    dispositionPresentation("clarify"),
    dispositionPresentation("block"),
  ];

  assert.deepEqual(
    presentations.map((item) => item.state),
    ["propose_action", "no_action", "clarify", "block"],
  );
  assert.match(presentations[1].label, /No action/i);
  assert.match(presentations[2].label, /remain blocked/i);
  assert.match(presentations[3].label, /scoring or ranking/i);
  assert.doesNotMatch(
    presentations.map((item) => item.label).join(" "),
    /candidate state confirmed/i,
  );
});

test("falls back to a visible blocked state for an unknown disposition", () => {
  const result = dispositionPresentation("unexpected");
  assert.equal(result.state, "block");
  assert.match(result.label, /Unrecognized fixture disposition/i);
});

test("ships a synthetic long mixed-script sample for reflow and assistive checks", () => {
  assert.match(LONG_MIXED_SCRIPT_SAMPLE.text, /[\u4e00-\u9fff]/u);
  assert.match(LONG_MIXED_SCRIPT_SAMPLE.text, /[\u0600-\u06ff]/u);
  assert.match(LONG_MIXED_SCRIPT_SAMPLE.text, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(LONG_MIXED_SCRIPT_SAMPLE.synthetic_label, /Synthetic/i);
  assert.ok(LONG_MIXED_SCRIPT_SAMPLE.text.length > 500);
});

test("keeps fixture transport explicit and separate from ordinary localhost drafts", () => {
  assert.equal(isSyntheticTransport({ transport: "fixture" }), true);
  assert.equal(isSyntheticTransport({ transport: "localhost" }), false);
  assert.equal(isSyntheticTransport(null), false);
});

test("presents pending, received, failed, stale, and unknown receipt truth distinctly", () => {
  assert.deepEqual(
    ["pending", "received", "failed", "unknown"].map((state) =>
      submissionPresentation({ state }).title,
    ),
    [
      "Waiting for receipt evidence",
      "Receipt confirmed",
      "Upload failed",
      "Receipt is unknown",
    ],
  );
  assert.equal(
    submissionPresentation({
      state: "failed",
      code: "session_stale",
      authentication_required: true,
    }).title,
    "Sign-in required",
  );
});

test("blocks resubmit while pending, received, or unknown and exposes reconciliation", () => {
  for (const state of ["pending", "received", "unknown"]) {
    assert.equal(submissionPresentation({ state }).blocks_submit, true);
  }
  assert.equal(
    submissionPresentation({ state: "unknown" }).check_receipt,
    true,
  );
  assert.equal(
    submissionPresentation({ state: "failed" }).blocks_submit,
    false,
  );
  assert.equal(
    submissionPresentation({ state: "failed" }).action_label,
    "Retry same reviewed packet",
  );
});

test("names a duplicate receipt without claiming a second creation", () => {
  const result = submissionPresentation({
    state: "received",
    duplicate: true,
  });
  assert.equal(result.title, "Already received — duplicate avoided");
  assert.equal(result.action_label, "Received");
});

test("keeps session loading, ready, and absent states textually distinct", () => {
  assert.deepEqual(
    sessionPresentation({ state: "checking" }, true),
    {
      chip_label: "Checking",
      chip_class: "state-chip--pending",
      busy: true,
    },
  );
  assert.equal(
    sessionPresentation({ state: "ready" }, true).chip_label,
    "Synthetic session",
  );
  assert.equal(
    sessionPresentation({ state: "not_ready" }).chip_label,
    "Not connected",
  );
});

test("progress order remains evidence, session, then explicit submit", () => {
  const initial = progressPresentation({
    sessionState: "not_checked",
    approved: false,
    submissionState: "idle",
  });
  assert.deepEqual(
    initial.map((step) => step.label),
    ["Reviewed asset visible", "Not checked", "Not approved"],
  );
  assert.deepEqual(
    initial.map((step) => step.state),
    ["complete", "current", "upcoming"],
  );

  const received = progressPresentation({
    sessionState: "ready",
    approved: true,
    submissionState: "received",
  });
  assert.deepEqual(
    received.map((step) => step.label),
    ["Private asset cleared", "Ready", "Receipt confirmed"],
  );
  assert.ok(received.every((step) => step.state === "complete"));
});
