---
name: analyze-candidate-signal
description: Analyze synthetic or user-authorized recruiter conversation content into a proposal-only candidate-momentum packet with exact message evidence, temporal state proposals, visible ambiguity, one recruiter-owned action proposal or no_action, and a truthful handoff. Use when a user supplies a transcript or structured messages and asks what changed or what smallest safe next step to consider. Do not use for retrieval, candidate assessment, identity guessing, confirmed-state changes, or external execution.
---

# Analyze Candidate Signal

Turn only content supplied in the current task into a reviewable artifact. Treat
the artifact as a proposal, never as confirmation or execution authority.

The in-repo variant
[`candidate-signal-analysis`](../../../../.agents/skills/candidate-signal-analysis/SKILL.md)
owns reviewable contact and meeting action proposals; this distributable skill
stays read-only and bounded to one `prepare_question` proposal or `no_action`.
The two output contracts are intentionally different and are not converged.

## Boundaries

- Accept only synthetic content or conversation content the user supplied or
  attached for this purpose. Do not browse, retrieve, or query other systems.
- Do not persist conversation content beyond the user-requested artifact.
- Extract only explicit identity, availability, deadline, preference,
  constraint, commitment, stage, or next-meeting signals.
- Preserve message ID, speaker, exact quote, source time, assignment scope, and
  ambiguity for every material proposal.
- Never infer candidate quality, personality, protected or sensitive traits,
  culture fit, potential, sentiment, engagement, or acceptance probability.
- Never confirm state, merge identity, contact anyone, schedule anything, or
  write to Contacts, Calendar, ATS, CRM, messaging, browser, or a database.
- Return one recruiter-owned `prepare_question` proposal or `no_action`.

## Workflow

1. Verify that the input is synthetic or was supplied by the user for this
   analysis. Set `authorization.kind` to `synthetic` or `user_authorized` and
   state the narrow purpose.
2. Represent the input as JSON with `authorization`, `context`, and `messages`.
   Keep the original message IDs and speakers. Do not invent missing identity,
   assignment, source time, or timezone.
3. From this Skill directory, run:

   ```bash
   python3 scripts/analyze_conversation.py --stdin
   ```

   Send the JSON only over standard input. Do not put private message text in
   command arguments, filenames, or logs.
4. Check that each returned quote is an exact substring of its cited message
   and that every action evidence ID exists. If the check fails, return a
   clarification handoff; do not repair evidence by paraphrasing.
5. Return the analyzer JSON unchanged. Do not promote `proposed`,
   `ambiguous`, or `superseded` state to confirmed state. Do not execute the
   proposal.

Read [references/output-contract.md](references/output-contract.md) before
constructing input manually or interpreting a result.

## Safe stopping

- If identity has multiple plausible matches, return `clarify` with no state
  or action proposal.
- If a relative date or timezone cannot be anchored, preserve the literal text
  as ambiguous and return `clarify`.
- If nothing decision-relevant changed, return `no_action`.
- If the request asks for candidate assessment or a prohibited proxy, return
  `block` and no action.
- If the analyzer does not recognize a signal, do not improvise a fact. Explain
  the coverage limit in the handoff and leave the source unchanged.
