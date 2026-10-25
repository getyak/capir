export const DISPOSITION_PRESENTATION = Object.freeze({
  propose_action: {
    label:
      "Proposed next step. Review one bounded action; no effect is authorized.",
    state: "propose_action",
  },
  no_action: {
    label:
      "No action. There is not enough evidence for a useful next step; no task is created.",
    state: "no_action",
  },
  clarify: {
    label:
      "Clarification required. Identity, time, persistence, and action remain blocked.",
    state: "clarify",
  },
  block: {
    label:
      "Blocked inference. Candidate scoring or ranking is outside this product boundary.",
    state: "block",
  },
});

export const LONG_MIXED_SCRIPT_SAMPLE = Object.freeze({
  source: {
    title:
      "Synthetic long-content review · Alexandria-Marie 陈嘉仪 (Alex) · Principal AI Systems & 产品设计 · Singapore ↔ London",
    url:
      "fixture://talent-signal-craft/long-mixed-script/%E4%B8%AD%E8%8B%B1%E6%96%87-accessibility-reflow-review",
    captured_at: "2026-08-05T17:30:00+08:00",
  },
  text:
    "Synthetic evidence only — 这是一段用于排版、缩放与屏幕阅读器验证的中英混合长文本。\n\nCandidate: “I can review the revised Staff+ scope on Wednesday, 但 remote policy 仍需书面确认。Please do not treat Tuesday afternoon availability as consent to schedule a meeting.”\n\nRecruiter note: preserve exact speaker, date, timezone, punctuation, and the distinction between availability, preference, constraint, and consent. لا تستنتج قبول العرض أو الملاءمة الثقافية من هذه الرسالة.\n\nLong identifier stress: TS-CRAFT-02-EXACT-REVIEWED-ASSET-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789.",
  synthetic_label: "Synthetic long mixed-script sample",
});

export function isSyntheticTransport(draft) {
  return draft?.transport === "fixture";
}

export function dispositionPresentation(disposition) {
  return (
    DISPOSITION_PRESENTATION[disposition] ?? {
      label: `Unrecognized fixture disposition: ${String(disposition)}`,
      state: "block",
    }
  );
}

export function submissionPresentation(submission = { state: "idle" }) {
  const state = submission.state ?? "idle";
  const title = {
    idle: "",
    pending: "Waiting for receipt evidence",
    received: submission.duplicate
      ? "Already received — duplicate avoided"
      : "Receipt confirmed",
    failed:
      submission.authentication_required === true
        ? "Sign-in required"
        : submission.code === "session_changed" ? "Web session changed"
        : submission.code === "connection_unavailable" ? "Connection unavailable"
        : "Upload failed",
    unknown: "Receipt is unknown",
  }[state] ?? "Receipt state unavailable";

  const actionLabel = {
    idle: "Submit reviewed capture",
    pending: "Upload pending",
    received: "Received",
    failed: "Retry same reviewed packet",
    unknown: "Check receipt first",
  }[state] ?? "Submit unavailable";

  return {
    visible: state !== "idle",
    title,
    action_label: actionLabel,
    check_receipt: ["pending", "unknown"].includes(state),
    busy: state === "pending",
    blocks_submit: ["pending", "received", "unknown"].includes(state),
  };
}

export function sessionPresentation(session, synthetic = false) {
  const state = session?.state ?? "not_checked";
  return {
    chip_label:
      {
        ready: synthetic ? "Synthetic session" : "Session ready",
        checking: "Checking",
        not_ready: "Not connected",
        unavailable: "Connection unavailable",
        changed: "Session changed",
        not_checked: "Not checked",
      }[state] ?? "Not checked",
    chip_class:
      state === "ready"
        ? "state-chip--ready"
        : state === "checking"
          ? "state-chip--pending"
          : "state-chip--unknown",
    busy: state === "checking",
  };
}

export function progressPresentation({
  sessionState,
  approved,
  submissionState,
}) {
  const received = submissionState === "received";
  const sessionReady = sessionState === "ready";
  const submitted = submissionState !== "idle";

  return [
    {
      state: "complete",
      label: received ? "Private asset cleared" : "Reviewed asset visible",
    },
    {
      state: sessionReady ? "complete" : "current",
      label:
        sessionState === "checking"
          ? "Checking"
          : sessionReady
            ? "Ready"
            : "Not checked",
    },
    {
      state:
        received
          ? "complete"
          : sessionReady
            ? "current"
            : "upcoming",
      label:
        submissionState === "pending"
          ? "Submitting"
          : received
            ? "Receipt confirmed"
            : submitted
              ? "Recovery required"
              : approved
                ? "Approved"
                : "Not approved",
    },
  ];
}
