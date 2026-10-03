---
name: candidate-signal-analysis
description: Extract recruiter-controlled candidate facts from a conversation screenshot or transcript, propose reviewable contact and meeting action cards, and produce evidence-backed candidate-momentum insights. Use when building, testing, or reviewing a specifically recruiting-scoped screenshot-to-action-to-insight flow in capri.
---

# Candidate Signal Analysis

1. Read the conversation and optional recruiter context.
2. Extract only explicit, decision-relevant facts: identity, availability, deadline, preference, commitment, stage, or next meeting.
3. Match a contact only when identity evidence is sufficient; otherwise propose a create-contact card.
4. Propose only `create_contact`, `update_contact`, or `create_meeting` cards. Cite a short source excerpt on each card.
5. Separate facts from inferences. Do not turn a soft preference into a hard constraint.
6. After confirmed cards are supplied, emit one verdict: `advance`, `resolve_blocker`, `at_risk`, or `wait`.
7. Recommend one concrete next step with a reason and timeframe.

Return JSON matching `references/output-contract.md`. Mark ambiguity rather than guessing.

## Guardrails

- Never infer protected characteristics or sensitive personal details.
- Verify every attributed statement against the visible speaker label and original image; left/right position alone does not establish a role. A message labeled self is not evidence of the contact's acknowledgment or interest. Include a counterexample with an owner-authored acknowledgment when evaluating screenshot findings.
- Never create or update data without a reviewable action card.
- Never claim a candidate will accept, decline, or churn; express risk as an inference with evidence.
