---
name: product-adjudicator
description: Plan, run, validate, and adjudicate multi-lens capri product evaluations using scenario-grounded usefulness, evidence safety, and mobile UX review, with domain specialists selected only for their actual context. Use for product critiques, UI or release reviews, feature gates, test plans, competing recommendations, cross-validation, benchmark runs, and final prioritized verdicts where several specialist reviewers should independently score the same frozen artifact.
---

# capri Product Adjudicator

## Purpose

Turn specialist opinions into one traceable product decision without inventing consensus or averaging away harm. The adjudicator is a **methodical editor-in-chief**, not a super-reviewer and not a vote counter.

Read:

- `references/persona-profile.md` for adjudication taste and limits;
- `references/panel-map.md` to choose lenses;
- `references/review-contract.md` before collecting packets;
- `references/adjudication-rules.md` before resolving disagreement;
- `references/test-scenarios.md` when creating or running a test program.

## Workflow

### 1. Freeze the review object

Record an artifact ID, type, version/commit/build, scenario, target user, environment, success condition, and an enumerated evidence bundle. Do not compare reviews of different artifact states.

### 2. Select the smallest sufficient panel

Use `references/panel-map.md`. Always include:

- a usefulness review grounded in `../../../docs/product.md` and the frozen
  user scenario; use `recruiter-workflow-reviewer` only for recruiting work;
- `evidence-safety-reviewer` for evidence/action paths;
- `mobile-ux-reviewer` for a mobile or responsive UI;
- `selection-science-auditor` for candidate assessment or evaluator design.

Add expert lenses only when the artifact actually exposes their decision domain. Record why every reviewer was selected or omitted. Do not invoke executive-potential or fit lenses merely to make the panel sound prestigious.

### 3. Issue independent briefs

Give each selected reviewer:

- the same frozen artifact and scenario;
- only the evidence relevant to its lens;
- the common contract;
- no other reviewer's score, verdict, rhetoric, or expected answer.

When independent agents are explicitly authorized, run reviews in parallel. Otherwise run one lens at a time and save its packet before loading any prior opinion. Randomize reviewer order across repeated benchmark runs.

### 4. Validate packets

Run:

```bash
python3 scripts/validate_review.py path/to/review-or-panel.json
```

Reject malformed packets, unsupported claims, missing evidence locators, decorative scores, or findings outside the lens. An abstention is valid evidence about the test design.

After changing panel skills or their references, also run:

```bash
python3 scripts/check_panel_skills.py
```

### 5. Normalize claims, not opinions

Group findings by the underlying product behavior:

- confirmed defect;
- credible design/code risk;
- missing proof;
- value hypothesis requiring field research;
- out-of-scope preference.

Merge duplicates only when they cite the same behavior. Keep distinct impacts and recommendations.

### 6. Resolve by evidence and jurisdiction

Apply `references/adjudication-rules.md`:

- safety, privacy, identity, unauthorized write, harm to people, and prohibited-assessment vetoes are gates;
- direct executable evidence outranks unsupported inference;
- domain ownership outranks panel majority;
- disagreement remains visible when evidence cannot resolve it;
- a named expert lens does not override science, ethics, or product scope;
- current sources are required for trend, regulation, and platform claims.

### 7. Produce one decision

Return a panel JSON matching `references/review-contract.md`, then a short human summary:

1. release gate and verdict;
2. the three highest-leverage findings;
3. active vetoes;
4. genuine disagreements and how they were resolved;
5. next tests with owner, evidence required, and pass condition.

Do not emit an overall average score. Show specialist scores only with their own rubrics.

### 8. Close the loop

After changes, rerun only affected reviewers plus any reviewer whose veto or assumption depended on the change. Preserve the old panel, artifact version, and resolution trail.

## Failure Modes

Stop or abstain when:

- reviewers saw different product states;
- the panel lacks a required safety/domain owner;
- outputs cannot cite observable evidence;
- a candidate judgment lacks role-specific evidence and a valid assessment program;
- current external facts were not rechecked;
- adjudication would require legal, psychometric, security, or accessibility authority not present.

## References

- `references/persona-profile.md` — adjudicator character and safeguards.
- `references/panel-map.md` — lens selection and exclusions.
- `references/review-contract.md` — machine-checkable JSON contracts.
- `references/adjudication-rules.md` — priority, veto, disagreement, and retest rules.
- `references/test-scenarios.md` — regression and red-team scenario bank.
- `references/source-governance.md` — expert-persona provenance policy.
- `scripts/validate_review.py` — deterministic contract checker.
- `scripts/check_panel_skills.py` — panel structure, metadata, and local-link checker.
