# System E2E and multi-Agent experience review

## Outcome

Exercise the current Talent Signal product as a real, cross-surface recruiter
journey and make the highest-leverage bounded corrections needed for a calm,
trustworthy, release-quality feel. Completion requires direct UI evidence from
the primary Web, iOS, and macOS surfaces, deterministic system checks, and
independent workflow, mobile, and evidence-safety reviews tied to one frozen
artifact.

## Frozen artifact and scenario

- Repository commit: `5ba505ae45e3df51b3339427da79c96fde42c137`.
- Starting branch and state: `main`, clean working tree.
- Data boundary: repository-owned synthetic fixtures and disposable local
  state only. No production candidate data or real external write.
- Scenario: a time-constrained relationship operator returns to Today,
  resumes current Agent work, intentionally captures a supported signal,
  resolves identity and context, reviews evidence and uncertainty, decides the
  proposed state and action separately, observes a truthful receipt, and can
  recover the resulting relationship from the primary retrieval surfaces.
- Expected trust boundary: evidence, interpretation, confirmation, action,
  and observed outcome remain distinct; ambiguous identity or time stops;
  retry cannot duplicate work; `no_action` remains valid.

## In scope

- Web public routes, authentication boundary, authenticated workspace, Today,
  People, Pursuits, Eval, Lab, and responsive/navigation behavior.
- iOS Today, Sessions/Ask, People, Agent configuration, capture, evidence
  review, decision, recovery, receipts, compact width, large text, and Chinese.
- macOS Today, relationship workspace, context capture, prepared follow-up,
  reminders, failure/recovery, and window/keyboard behavior.
- Existing backend, Web, native, evaluation, lint, typecheck, build, and E2E
  checks needed to prove the above journey.
- Bounded implementation fixes whose cause and verification are established
  during this run.

## Out of scope

- Production rollout, real candidate content, connector credentials, live
  candidate communication, or any unreviewed Calendar/Contacts/ATS/CRM write.
- Claiming field usability, real-device ergonomics, VoiceOver quality, or
  production privacy behavior when only Simulator/local evidence exists.
- Broad redesigns without a directly reproduced journey failure.

## Panel and ownership

- Recruiter workflow: operational usefulness, interruption cost, and complete
  capture-to-outcome loop.
- Evidence safety: identity, provenance, uncertainty, authorization, retry,
  deletion, and truthful outcome.
- Mobile UX: iOS task clarity, interaction, accessibility, state completeness,
  performance feel, and visual craft.
- Primary adjudicator: freezes evidence, validates independent packets,
  resolves disagreement by jurisdiction, implements bounded corrections, and
  reruns affected reviewers.

Candidate-experience and selection-science reviewers are omitted because this
run does not send candidate-facing communication or introduce candidate
assessment/ranking. They must be added if the observed product path crosses
either boundary.

## Milestones

1. **Completed — freeze routes, fixtures, environment, and completion
   evidence.** The artifact, synthetic-only boundary, exact journeys, selected
   reviewers, and omitted lenses are recorded in the evaluation packet.
2. **Completed — run the baseline.** Real Web, iOS Simulator, and macOS app
   surfaces plus Agent, backend-CI, and evaluation paths were exercised. The
   unhealthy canonical backend is retained as missing evidence rather than
   converted into a pass.
3. **Completed — independent review.** Workflow, safety, and mobile packets
   validate against the review contract and cite frozen, inspectable evidence.
4. **Completed — correct the highest-leverage bounded issues.** Reproduced Web,
   iOS, and macOS interaction, accessibility, recovery, and evidence-integrity
   defects were fixed with focused regression coverage.
5. **Completed — retest and adjudicate.** Affected real surfaces and checks were
   rerun. The post-change verdict is `pass_with_changes`; release remains
   `needs_evidence` for the canonical governed backend loop and human
   VoiceOver/physical-device proof.

## Final handoff

- System result: [`system-summary.md`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-03-system-e2e-agent-review/system-summary.md)
- Final panel: [`panel.json`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-03-system-e2e-agent-review/panel.json)
- Post-change source identity: [`post-change-manifest.json`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-03-system-e2e-agent-review/post-change-manifest.json)
- Task-owned isolated Docker resources were verified empty after interrupted
  backend attempts. No shared or user-owned project was changed.

## Completion evidence

- Direct UI screenshots or test attachments identify build, surface, start
  state, steps, expected/observed result, and post-fix outcome.
- The primary journey reaches a truthful result or intentional stop on each
  implemented surface without false success, identity collapse, or duplicate
  effect.
- Relevant deterministic checks pass, and any unrun check is named with the
  reason.
- Specialist packets validate with the repository review contract and cite
  only frozen, inspectable evidence.
- The final panel contains at most three release-level findings, preserves all
  active vetoes, and names owner, required proof, and pass condition.

## Re-plan triggers

- If the three surfaces implement materially different product loops, test
  each honestly and do not manufacture cross-platform parity.
- If a real backend or signed native prerequisite is unavailable, retain the
  highest executable evidence level and report the blocked proof explicitly.
- If a finding requires production data, external credentials, or a product
  decision that broadens authority, stop that path and request direction.
