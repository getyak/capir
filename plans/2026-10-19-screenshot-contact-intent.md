# Screenshot contact creation without format gates

## Outcome

Any intentionally shared screenshot may supply the person the user wants to
add. The Agent guides the user to an editable contact draft regardless of
source format, existing relationship, stable handle, or completeness. Saving
remains a human decision. Missing information and namesakes are review hints,
not reasons to refuse a new record.

## Scope and inventory

| Existing constraint | Resolution |
| --- | --- |
| Workspace prompt requires a stable clue for authored person notes | Remove; a name or user-provided label can start a draft |
| Name-only image proposals limited to direct-chat counterparties | Remove in prompt, adapter guidance, image inspection, and host validation |
| Image name must exactly equal a private-chat header | Accept a selected visible name anywhere in admitted pixels |
| Default draft requires exactly one current screenshot | Inspect current images and offer one unambiguous target; let the Agent guide selection for multiple targets |
| Historical-image creation requires command-regex recognition | Remove; current intent is interpreted by the Agent, source access still checked |
| Human-bound/existing-contact scope suppresses every new-person option | Remove this blanket suppression |
| Text draft requires a stable clue, imperative, and non-question wording | Remove semantic regex gates; preserve literal field provenance |
| Same-name directory match blocks preparing or saving a new contact | Allow an explicitly reviewed separate record; keep existing-contact access independent |
| Relationship background treated as required | Keep optional and stop inventing a relationship for contact-only drafts |
| Profile intake requires at least one extracted clue | Allow a visible name alone to reach profile review |
| Stable-handle ownership or invalid optional fields | Never make these prerequisites; retain canonical ownership validation when a human explicitly confirms a handle |
| Authentication, source revocation/deletion, explicit refusal, idempotency, private recall authority | Retain; these protect user control and do not assess contact eligibility |

## Approach

Extend image observations with source-grounded candidate names independent of
chat classification. Use one generic candidate resolver for model-selected and
default contact proposals, retaining the actual image locator. Simplify the
workspace prompt around user intent, editable drafts, and human saving. Remove
creation eligibility heuristics rather than adding source-format exceptions.
Update the existing review UI so namesakes can be created explicitly. Preserve
uncertainty and source attribution; never turn a new record into identity
confirmation or access to an existing person's private memory.

## Milestones

1. Complete: generic image targets, optional details, namesake creation,
   legacy form and profile-review recovery, and source-bound follow-ups.
2. Complete: independent review corrections; Agent 551 passing, backend
   standard 1111 passing, relevant database/runtime 263 passing, queue/MCP 74
   passing serially, changed Web paths 96 passing, type and documentation checks.
3. Active: clean-source resident deployment and isolated real Web acceptance.

## Proof

Exercise public profiles, public posts, group participants, named photo/poster
subjects, nickname-only notes, multiple images, later image references,
namesakes, no-save intent, revoked sources, failed optional research, human
save, reload/readback, and test-account cleanup. Use the documented `capir test`
entry and retain only sanitized results in ignored output. Preserve unrelated
changes in the original checkout.

## State

Base: `50047ca0`; implementation uses the task-owned
`codex/screenshot-contact-intent` worktree. Original checkout has unrelated
tracked and untracked user changes. Implementation is ready for committed-source deployment. Review also corrected
an image/message locator mix-up, source manifests containing unrelated historical
images, pending queue authority, and multi-image self-memory preservation.
The broad all-database concurrent run exposed shared queue/MCP test interference;
its affected 74 tests pass in the serial follow-up. A full Web run initially had
one obsolete button-label expectation; all affected UI tests now pass. Live
acceptance remains required.
