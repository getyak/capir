# GET-5 conversation backend

## Outcome and boundary

Carry bounded, account- and relationship-scoped previous dialogue into model
requests so follow-up turns work. Prepare review-only contact drafts from current
message names and stable identity clues, preserving missing fields and exact
message provenance. Dialogue never grants tool permissions, citations, confirmed
state, or a contact write.

## Ownership

This work owns Chat request fields, chat/unscoped executors, answer provider,
workspace conversation tool validation, and associated Agent schemas/prompts.
The Session backend owner supplies canonical, retention-checked history. The
root owns integration verification and local TestFlight deployment.

## Milestones

1. Complete: canonical Session history API and bounded provider context.
2. Complete: proactive/incomplete draft grounding and exact update resolution.
3. Complete: focused contract/provider/tool verification; root owns integration
   review, credentialed model proof, and deployment.

## Evidence and decisions

- Existing Chat requests have no Session identity or dialogue history.
- Workspace contact proposals already have source excerpts and fingerprints,
  but require a non-empty relationship context and do not bind a message ID.
- Stable identity clues remain email, phone, or public profile URL. Company or
  job title alone does not qualify for a proactive draft.
- User requests implementation and independent review; formal contact saves
  remain explicit human decisions.
- Both request schemas accept optional `session_id` and `message_id` UUIDs.
  `readAgentSessionConversation` owns account/user/scope/retention checks; the
  Chat adapters send at most 12 previous messages and 12,000 characters, with
  at most 2,000 characters per message. Current message IDs are excluded.
- History has an explicit conversation-only authority label. The current
  objective alone grounds tool requests; the current manifest alone grants
  citations. Audit stores message references, never raw dialogue.
- Draft source excerpts must cover proposed fields and refer to the exact
  current message; the server binds `source_message_id` into its fingerprint.
  A missing relationship stays empty. Stable clue formats are validated.
- Truncated search output cannot manufacture a unique update/read target;
  duplicate names including a person without a relationship remain ambiguous.
- Review caught a canonical-history filter that omitted all cited scoped
  answers. The Session owner removed that filter after checking source/task
  availability; history still carries no citation IDs or target authority.

## Verification

Test actual provider HTTP payloads, prior dialogue scope/limits, unchanged
citation/tool boundaries, incomplete drafts, ordinary-question/name-only/quoted
text no-action cases, and ambiguous updates. Run relevant TypeScript tests and
typecheck, then report deployment dependency to the root.

Initial checks passed backend typecheck, the Agent suite, focused backend Chat,
provider, unscoped, and workspace tool tests, `pnpm docs:check`, and
`git diff --check`. These inspect actual HTTP payload assembly and typed tool
enforcement. The additional credentialed proof below tests actual provider
choice and caused the narrow implementation fixes recorded there.

## Credentialed synthetic proof and resulting fixes

The [live provider receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-5/conversation-provider-proof.json)
records GLM-5.3 requests using synthetic invented people and `example.com`
addresses. Infisical's host login was unavailable. An isolated temporary probe
used the already-admitted backend process environment; no key was printed,
exported, or written into proof files, and no running service file was replaced.

The first live trials exposed two defects. A permissive native Tool superset
encouraged proposal fields on search and concatenated search clues; the strict
host correctly rejected them but the model exhausted its budget. A proposal
staged on the last model turn was also lost while awaiting a redundant model
fingerprint echo. The final adapter exposes four flat operation-specific
transport functions, maps each into the unchanged governed `contact_workspace`
executor, and terminates with the host fingerprint after successful staging.
Unknown/ungranted aliases, operation overrides, direct ungranted calls, and
named-contact preflight without a manifest grant are explicitly denied.

Final live results:

- Missing-context natural note: grounded incomplete draft, two requests,
  10.1 seconds, no denied tools.
- Full-context natural note: grounded draft, two requests, 10.65 seconds,
  no denied tools. An earlier trial used four requests and 26.0 seconds because
  two relationship-label paraphrases were correctly rejected. Explicit field
  descriptions then required verbatim contiguous substrings and removed those
  retries in the affected-case re-probe; validation and budgets stayed fixed.
- Actual disposable PostgreSQL task response → Session save → follow-up:
  previous user and assistant dialogue reached the real provider, and “Expand
  option two” produced the correct editable email draft in two requests.
  The owned synthetic Session was deleted afterward.

The final runtime passed 58 Agent tests, 68 focused backend Chat/provider/
workspace/unscoped tests, backend build, and documentation checks; the Agent was
rebuilt after the final instruction-only field wording. Sources are frozen for
the root's integrated review and deployment. These are individual live trials,
not a latency or reliability benchmark. The missing-context and canonical
history proofs used the final runtime immediately before that contact-field
wording change; the affected full-context case was re-probed afterward.

The isolated probe directory and disposable database environment copy were
removed from the running container after verification. Ignored local scripts
and redacted synthetic receipts remain under `tmp/get-5-conversation-proof/`;
the curated, secret-free receipt above is the durable evidence.

## Final screenshot continuity provider proof

The [screenshot provider receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-5/screenshot-provider-proof.json)
records two actual GLM-5.3 trials after the Session backend owner froze migration
055 and reported 121 passing PostgreSQL/backend tests. The unbound follow-up
and the newly bound first question both used the canonical synthetic screenshot
summary to explain Friday. Both preserved missing date/time-zone uncertainty,
returned a visibly unconfirmed proposed answer, and produced no citations,
contact proposals, tool calls, or external writes. Each used one provider request.

The proof used a new synthetic account in the isolated fresh database, actual
Session mutation and Chat functions, and a final outer transaction rollback.
The provider received no images, OCR, or client-cached summary. Exact source
fingerprints were recorded for both derived answers. Source hashes stayed fixed;
the admitted provider credential remained only inside the existing process.

One automated regex initially missed “don't know” in the unbound answer. The
receipt preserves that initial result and the explicit semantic adjudication;
neither call was rerun. The bound reply also revealed two wording improvements:
it suggested supplying the screenshot again and added “together” to reviewing a
draft. The reply retained its unconfirmed boundary, but the prompt could ask only
for missing date/time-zone detail and avoid unsupported participant wording.
These observations were sent to the root before any source change. Two trials
are behavioral proof for these inputs, not a reliability or latency benchmark.
