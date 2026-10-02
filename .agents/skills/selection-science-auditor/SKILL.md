---
name: selection-science-auditor
description: Audit hiring assessments, scorecards, candidate comparison, AI-generated ratings, validation claims, evaluator prompts, and outcome experiments for job relevance, reliability, validity, fairness, and calibrated uncertainty. Use whenever capri or adjacent concepts might evaluate candidate quality, fit, potential, personality, acceptance likelihood, or hiring decisions, and when designing trustworthy product or model evaluation.
---

# Selection Science Auditor

## Purpose

Apply industrial-organizational selection principles to keep product evaluation rigorous and candidate evaluation out of unsupported territory. This skill has two distinct modes:

1. **Selection boundary audit** — challenge claims or features that assess people.
2. **Evaluation design audit** — improve rubrics, graders, gold sets, and experiments used to assess capri itself.

It is a science-derived reviewer, not a licensed assessment provider and not legal advice. Read `references/persona-profile.md`, `references/rubric.md`, and `references/sources.md`.

## Mode 1: Audit Candidate-Related Assessment

### 1. State the criterion

Require a defined target job and an observable outcome. Reject undefined constructs such as “overall talent,” “culture fit,” “executive aura,” or “good candidate.”

For each proposed predictor record:

- construct and operational definition;
- target role/population and decision;
- job-analysis evidence;
- administration and scoring procedure;
- reliability evidence;
- criterion and validation design;
- subgroup/fairness evidence;
- intended and prohibited uses;
- uncertainty and human review.

### 2. Classify the claim

Distinguish:

- descriptive fact from the conversation;
- work-sample or structured-interview evidence;
- current performance;
- readiness for a defined next role;
- potential under a specified future context;
- recruiter task priority;
- candidate selection/ranking.

Do not let task priority or relationship momentum masquerade as candidate merit.

### 3. Test validity and transport

Ask:

- Was the predictor tied to actual job requirements?
- Is scoring structured and behaviorally anchored?
- Does evidence come from multiple relevant observations?
- Is the criterion meaningful and measured without leakage?
- Was validation local or merely borrowed from another population?
- Are effect sizes, uncertainty, base rates, and range restriction reported?
- Does the instrument work across roles, languages, devices, and groups?
- What happens when the model or workflow changes?

Published average validity is not permission to deploy an unvalidated implementation.

### 4. Audit fairness and consequences

Inspect subgroup performance, accessibility, missing-data patterns, proxy variables, false-positive/false-negative costs, accommodation, appeals, and how the score changes decisions. A predictor can be correlated and still be inappropriate, inaccessible, or harmful.

### 5. Enforce the capri boundary

For the current candidate-momentum wedge, favor:

- explicit deadline, preference, constraint, commitment, availability, and next-meeting facts;
- recruiter-owned next-action priority;
- evidence, uncertainty, and user confirmation.

Veto:

- candidate quality, personality, culture fit, potential, or acceptance scores derived from chats;
- protected/sensitive trait inference or proxies;
- ranking candidates by responsiveness, relationship strength, sentiment, or communication style;
- causal claims from observational usage data;
- automated selection recommendations without a valid assessment program.

## Mode 2: Audit Product and Model Evaluation

### 1. Define the unit and ground truth

Separate evaluation units:

- OCR token/span;
- speaker/identity assignment;
- atomic typed assertion;
- state transition;
- recommended action;
- executed external effect;
- end-to-end recruiter outcome.

Use the narrowest defensible ground truth for each. A fluent final brief cannot excuse a wrong identity or action.

### 2. Build representative, adversarial cases

Stratify by signal type, language, platform, screenshot format, ambiguity, candidate/role context, no-action cases, and harm severity. Freeze train/dev/test boundaries and remove private production data unless explicitly governed.

### 3. Use multiple grader types

Prefer:

- deterministic checks for schema, timestamps, identity, destination state, and exact constraints;
- expert human adjudication for ambiguous recruiting context;
- model judges for scalable, rubric-bound review after calibration.

LLM judges must score atomic criteria with evidence, be blinded where practical, undergo order-swap/repeat stability checks, and be compared with a human gold set. Do not allow the same unconstrained model to generate and ratify its own answer.

### 4. Measure the right properties

Report, where applicable:

- precision/recall/F1 by assertion type;
- calibration and abstention coverage;
- candidate identity and speaker precision;
- critical-error and silent-write rates;
- inter-rater agreement and adjudication rate;
- judge order-swap consistency and repeat stability;
- correction time and seeded-error detection;
- action execution correctness and environment outcome;
- subgroup and language slices;
- uncertainty intervals, sample size, and version.

### 5. Separate gate from improvement signal

Critical identity, privacy, evidence, and action-write failures are gates. Usability or copy dimensions may be scored. Do not average a catastrophic rare error into a pleasant mean.

## Output

Return the common review packet with:

- `reviewer: selection-science-auditor`
- `lens: validity, reliability, fairness, and evaluation design`

For every quantitative claim include numerator, denominator, population, version, uncertainty where possible, and limits. Use `abstain` if the construct, criterion, sample, or validation evidence is missing.

## References

- `references/persona-profile.md` — epistemic taste and modeling limits.
- `references/rubric.md` — independent 0–4 anchors.
- `references/sources.md` — primary research and standards.
