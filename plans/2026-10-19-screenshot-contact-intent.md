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

## Harness observations

The first test run (`799f8bd1-04e3-42ea-8eb6-9ec49d96c8ee`) was stopped and
verified `deleted` before a second owned attempt began. It corrected native
file-chooser interception; no Agent request was sent in that first attempt.
Keep failed samples as harness evidence. During the second attempt, a stale
file chooser after navigation was reselected through the actual menu before
sending; no missing-image attempt is counted as product acceptance.

## Resident release and live acceptance

- Deployed runtime source: `ce434ba03f118c261ed7f87c6fd178af419e5d5e`.
- Both the resident Web and API/Agent Host now use that clean committed source.
  Recovery image/revision settings were read back from Infisical; the backend
  current pointer was verified atomically. Previous releases remain available.
- Bundled `assistant/workspace` and the Opik repository mirror both hash to
  `e17f49def6c4df8cb2aac472a32b0cdc0f2107ed0e16dde75e55aec9e2c9e941`.
- Owned temporary test run: `79128427-2cad-4ba6-9ebd-10850ebab30c`; create
  request: `015128a3-b639-4f9b-a3dd-8f514062bae4`. The canonical entry banner and
  ordinary password login have both been verified. Credentials remain in the
  expiring run's OS keyring and the active private browser process only.
- QA runs on the actual M4 Mac mini as `cubxxw`. The temporary driver under
  `~/.cache/codex/contact-intent/` accepts ordered `command-N.json` files and
  writes sanitized `response-N.json`. Inspect existing command/response files for the next sequence number. The
  public-profile contact was saved, reloaded, and read on its actual Person
  page. Group/namesake and historical-image cases are in progress. The driver must receive
  `stop` and the cleanup readback must be verified before handoff.
- LaunchAgent labels `com.talentsignal.contact-intent-probe`,
  `com.talentsignal.contact-intent-deploy`, and `com.talentsignal.contact-intent-qa`
  are temporary and must be unregistered after the owned test is stopped.

- Live public-profile case: saved Person `ac09f4b3-9f3f-4c9d-a019-cfe9a1e3f745`,
  reloaded its Session and opened its actual Person page with no relationship
  context and zero accepted Memory.
- Live group/namesake case: explicitly created a separate Person
  `b8afb8d8-3215-49e6-a20d-dde901a75084` from the group participant and reloaded
  the saved receipt. It did not bind to the earlier same-name person.
- The analysis-only prelude of the historical-image case failed before model
  execution: product run `4cb5ecf6-8b43-4c77-b41e-d61889543860` recorded
  `harness.source_guard.rejected`, `failure_code=PROBE_TIMEOUT`,
  `phase=admission`. This is the test-account authority probe's finite timeout,
  not a contact eligibility rejection. The exact retained queue message is being
  retried once through the actual Web recovery control. Do not hide this sample.

## Live-discovered authority timing correction

The retained analysis message reached the model after explicit retry/continue,
but run `693f6ec9-eafa-4e08-b920-150410a4a6f4` was aborted by the same
`PROBE_TIMEOUT` on recheck. Its SDK initialized and emitted one response; usage
was incomplete, so no successful outcome or zero-cost claim is made. The owned
workspace remained active and unexpired; direct database reads took 50/1/1/0 ms,
and database activity showed no lock wait. The one-second bound includes shared
pool and host scheduling delay and is too short for this resident environment.

The backend-only correction permits a finite five-second authority wait. It
preserves NOWAIT, stop, user/account, state, expiry, source generation and Session
checks. Delayed successful authority does not permit private reads early;
authority expiring during the wait still fails closed. The old implementation
failed the delayed-admission regression; the corrected source passes it.
Independent review found no security or correctness blocker. Re-deploy only the
affected backend image/services, then retry the original retained message.

Timing-correction checks: the 27 focused authority tests and backend typecheck
passed. The standard backend run passed 1112 tests with one unrelated five-second
application-test timeout; that complete application file passed all 28 tests when
rerun alone. Documentation and architecture checks passed. Backend has no lint
script; the existing Web lint had already passed for the feature release.

## Live-discovered completed-source correction

After the timing release, the exact retained analysis message completed in seven
seconds with no proposal. Its later text-only add request correctly invoked
`memory_review`, but the image validator rejected the historical source: normal
queue completion had set `content_state=scrubbed` after persisting the original
message in its Session. The image and Session were still retained and unexpired.
The earlier integration fixture had used `completed/retained`, which concealed
this real queue transition.

The correction accepts a completed scrubbed queue entry only when the canonical
Session resolver still finds the original human message and matching immutable
image manifest. Ownership, expiry, image byte hash and revocation checks remain.
Regression coverage now uses the actual completed/scrubbed state and rejects a
cancelled entry, missing Session turn and changed manifest. The old source failed
the new completed/scrubbed case. The corrected database and host suites passed
199 tests; backend typecheck passed. The failed live sample remains in proof.

Independent review found no critical, high or medium blocker, including no new
lock-order inversion in the canonical source check.
