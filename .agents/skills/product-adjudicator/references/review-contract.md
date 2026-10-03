# Review contracts

The recruitment examples illustrate the shared packet schema; they are not
the default capri scenario or mandatory reviewer panel. Use the current Product
contract and actual user context when choosing a panel.

Use JSON for validation and durable comparison. YAML shown by individual skills should be converted without changing fields.

## Specialist review

```json
{
  "reviewer": "mobile-ux-reviewer",
  "lens": "mobile task completion, visual hierarchy, accessibility, and recovery",
  "verdict": "pass_with_changes",
  "score": 2,
  "confidence": "direct",
  "findings": [
    {
      "severity": "high",
      "criterion": "State completeness",
      "observation": "Retry creates a second meeting after a client timeout.",
      "evidence": "build 42; iPhone 15; scenario TS-ACT-03; steps 5–8; calendar contains two event IDs",
      "user_impact": "The recruiter can double-book the candidate and damage trust.",
      "recommendation": "Use an idempotency key and reconcile the first request before offering retry.",
      "verification": "Repeat TS-ACT-03 ten times; exactly one destination event exists in every run."
    }
  ],
  "strengths": ["The preview identifies candidate, timezone, and destination calendar."],
  "missing_evidence": [],
  "vetoes": [],
  "open_questions": ["Does the integration expose a client request identifier?"]
}
```

Rules:

- `score` is integer 0–4; it must be `null` when `verdict` is `abstain`.
- `confidence` is `direct`, `supported_inference`, or `insufficient`.
- `severity` is `blocker`, `high`, `medium`, or `low`.
- Every finding field is a non-empty string.
- Evidence names a reproducible artifact/state; “best practice” is not evidence.

## Panel result

```json
{
  "panel_id": "TS-2026-08-04-001",
  "artifact": {
    "id": "ios-screenshot-review",
    "type": "ios-build",
    "version": "build-42"
  },
  "scenario": "Import a candidate chat with a Wednesday offer deadline and remote-work constraint.",
  "frozen_evidence": ["build 42", "scenario TS-CORE-01", "screen recording sha256:..."],
  "review_plan": [
    {
      "reviewer": "recruiter-workflow-reviewer",
      "status": "selected",
      "reason": "Core recruiter workflow."
    }
  ],
  "reviews": [],
  "adjudication": {
    "verdict": "abstain",
    "release_gate": "needs_evidence",
    "top_findings": [],
    "agreements": [],
    "disagreements": [],
    "veto_resolution": [],
    "rationale": "Selected reviews have not yet been collected."
  },
  "next_tests": [
    {
      "owner": "product",
      "test": "Run the selected panel on build 42.",
      "evidence_required": "Valid specialist packets tied to the frozen recording.",
      "pass_condition": "All selected reviewers return contract-valid packets."
    }
  ]
}
```

`top_findings` items require:

```json
{
  "reviewer": "evidence-safety-reviewer",
  "criterion": "Identity binding",
  "severity": "blocker",
  "reason": "The evidence can be attached to the wrong candidate.",
  "next_step": "Require scoped identity confirmation before persistence.",
  "verification": "Wrong-identity test cannot persist without explicit correction."
}
```

`disagreements` items require:

```json
{
  "issue": "Whether another confirmation step is justified",
  "positions": [
    {
      "reviewer": "recruiter-workflow-reviewer",
      "position": "Remove the step",
      "evidence": "Three repeated taps on the critical path"
    },
    {
      "reviewer": "evidence-safety-reviewer",
      "position": "Keep a scoped confirmation",
      "evidence": "The action writes to Calendar"
    }
  ],
  "resolution": "Combine preview and confirmation on one screen.",
  "resolution_basis": "Preserves authorization while removing a context switch."
}
```

Every specialist veto must have a matching `veto_resolution` item:

```json
{
  "reviewer": "evidence-safety-reviewer",
  "veto": "Silent calendar write",
  "status": "active",
  "evidence": "build 42 executes before preview"
}
```

`status` is `active`, `resolved`, or `not_applicable`. An active veto requires
`release_gate: block` and `verdict: fail`.
