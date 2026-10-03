# Adjudication rules

## 1. Establish jurisdiction

Let the specialist closest to the claim define the gate:

- evidence identity, privacy, consent, external writes → evidence safety;
- candidate trust and communication → candidate experience;
- assessment validity, fairness, evaluator claims → selection science;
- mobile interaction and accessibility → mobile UX;
- general workflow value → scenario-grounded usefulness evidence;
- recruiting operational value → recruiter workflow only in recruiting context;
- sourcing recall → inclusive sourcing;
- current market change → trend radar;
- outcome/fit, motivation, or potential → their named domain, within limits.

A reviewer may report cross-domain impact, but may not resolve another domain's veto.

## 2. Rank evidence

Use this order, subject to domain relevance:

1. reproducible executable/environment result;
2. directly inspectable artifact, code, log, or source span;
3. observed user/field research with method and sample;
4. current authoritative standard or primary research;
5. supported design inference;
6. taste or preference.

Higher rank does not rescue an irrelevant measure.

## 3. Gate before scoring

Apply active vetoes first. Never average:

- wrong identity/speaker;
- unsupported or stale fact presented as confirmed;
- unauthorized or unverified external write;
- privacy/access/deletion failure;
- inaccessible consequential path;
- deceptive/coercive candidate experience;
- prohibited or unvalidated candidate assessment.

## 4. Resolve conflicts

Use one of four outcomes:

- **Resolve by evidence:** one claim has stronger relevant proof.
- **Synthesize:** recommendations protect different valid constraints.
- **Run a discriminating test:** evidence is presently insufficient.
- **Accept a documented tradeoff:** product owner chooses within a non-veto domain and records cost.

Never write “reviewers disagreed” without preserving each position and the resolution basis.

## 5. Handle scores

- Keep every score attached to its own rubric and confidence.
- Do not average scores from different constructs.
- Use score deltas only within the same reviewer, scenario, rubric version, and comparable artifact.
- Treat `abstain` and `missing_evidence` as test-design information, not failure by default.

## 6. Limit the final priority list

Select at most three top findings by:

1. irreversible human/data harm;
2. likelihood × impact on the core loop;
3. effect on trust and successful action;
4. learning value for the product wedge;
5. correction cost and dependency order.

Keep additional findings in specialist packets.

## 7. Retest

For every claimed resolution record:

- changed artifact version;
- affected reviewer(s);
- exact prior finding/veto;
- test and pass condition;
- result evidence.

Do not mark a veto resolved because code changed; mark it resolved only after its verification passes.
