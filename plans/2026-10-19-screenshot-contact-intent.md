# Screenshot contact creation without format gates

## Outcome and status

Complete. Any intentionally shared screenshot may supply the person the user
wants to add. The Agent guides target selection or a missing label and prepares
an editable draft without source-format, acquaintance, identity-clue or profile
completeness prerequisites. Saving remains a human decision. Missing information
and namesakes are review hints, not reasons to refuse a new record.

## Constraint inventory

| Previous constraint | Resolution |
| --- | --- |
| Workspace prompt requires a stable clue for authored contact notes | Removed; a name, nickname, handle or user-provided label can start a draft |
| Name-only image proposals limited to private-chat counterparties | Removed across prompt, adapter, image inspection and host validation |
| Name must exactly equal a private-chat header | The Agent may select a visible name anywhere in an admitted image |
| Default draft requires exactly one current screenshot | Current images can supply one unambiguous target; guide a choice for multiple targets |
| Historical-image creation requires command-regex recognition | Removed; the Agent interprets intent and uses the admitted original |
| Bound/existing-contact scope suppresses all new-person options | Removed |
| Text draft requires a stable clue, imperative and non-question wording | Removed semantic eligibility regexes; source fields remain literal |
| Same-name directory match blocks preparing or saving a new contact | An explicitly reviewed separate record is allowed |
| Relationship background is required | Optional; contact-only drafts leave it empty |
| Profile intake requires an extracted identity clue | Name-only profile review is allowed |
| Manual create requires background, a first note or a successful directory read | Removed; a nonempty label is sufficient |
| Normal completed queue cleanup invalidates retained historical images | Corrected; validate the durable original Session and image manifest |
| Optional research failure blocks creation | It does not block the editable card or Save |
| Authentication, source revocation/deletion, explicit refusal, idempotency and private recall authority | Retained; these protect control and integrity rather than assess contact eligibility |

Optional identity handles still undergo ownership checks when the human chooses
to confirm them. A separate new record never confirms an identity or authorizes
access to another same-name person's private memory.

## Implementation

Base: `50047ca0`. Work is isolated on `codex/screenshot-contact-intent`; the
original checkout's unrelated dirty files remain untouched.

- `ce434ba0`: generic source-grounded image targets, optional details, separate
  namesake creation, profile/manual form recovery, historical source binding and
  the canonical product contract in `docs/capture-to-action.md`.
- `d155a792`: finite authority-probe timing correction found during real QA.
- `a03f84e5`: completed/scrubbed historical-image correction found during real QA.

Independent review also corrected image/message locator mixing, unrelated
historical images in source manifests, pending queue authority and multi-image
self-memory preservation. No critical, high or medium review findings remain.

## Resident deployment

All affected services were deployed from clean committed source on the actual
M4 Mac mini. Source and runtime were read back; earlier releases remain available.

- Resident Web: `ce434ba03f118c261ed7f87c6fd178af419e5d5e`.
- API and Agent Host: `a03f84e58a6aa90fc357dba904b2a8e5239ef30b`.
- Shared backend image: `talent-signal-backend-local:contact-intent-a03f84e58a6a-20261019`.
- Actual API and Agent Host image ID:
  `sha256:8333c2f3f2a59af6986df78febb25123166655a300b0144d221394f779394750`.
- Bundled live `assistant/workspace` and Opik repository mirror SHA-256:
  `e17f49def6c4df8cb2aac472a32b0cdc0f2107ed0e16dde75e55aec9e2c9e941`.

The backend current pointer and paired Infisical recovery image/revision were
verified. Both active release sources are clean. The resident backend keeper
was restored and reports exit 0. Deployment checks passed for observation
write/read/delete, Apple auth, synthetic speech, model answers and HTTPS
readiness. The final historical fix changes backend code only; the deployed Web
already contains the complete contact UI change.

## Verification

Use the narrow checks relevant to these paths. Evidence is sanitized and stored
in ignored `output/evaluation/contact-intent/` and
`output/playwright/contact-intent/`.

- Agent: 551 passing, 14 skipped.
- Main backend standard run: 1111 passing, 615 skipped.
- Main relevant database/runtime suites: 263 passing; queue/MCP: 74 passing
  serially. An exploratory all-database concurrent run had fixture/race failures;
  it is not represented as a passing run.
- Full Web: 2479 passing. Changed UI paths: 96 passing.
- Timing correction: 27 authority tests pass; backend typecheck passes. Its
  standard run passed 1112 with one unrelated five-second application-test
  timeout; that complete file passed all 28 tests when run alone.
- Historical completed-source correction: 199 relevant database/host tests pass,
  including real completed/scrubbed state, cancelled entry, missing Session turn
  and changed manifest cases. The new positive regression failed on old source.
- Applicable types, existing Web lint, documentation, wiki and architecture
  checks pass. Backend has no separate lint script.

## Real Web acceptance

The documented `capir test create --env staging --preset daily --open web` entry,
canonical run banner and ordinary login were verified. Only expiring synthetic
accounts and fixtures were used; no default or real account data was changed.

| Scenario | Observed result |
| --- | --- |
| Public profile without email, phone, URL or relationship | Editable card; saved, refreshed, opened Person page with empty context and zero confirmed Memory |
| Group participant with an existing same-name contact | Direct Add as new button; saved a separate Person and refreshed the receipt |
| Explicit analysis-only request | Completed in seven seconds with no contact or Memory proposal |
| Later text-only request referring to the earlier public-post image | Card appeared without reupload; saved, refreshed and opened the Person page |
| Optional public research unavailable | Honest unavailable receipt; contact creation and Save remained available |

Saved synthetic Person IDs were respectively:
`ac09f4b3-9f3f-4c9d-a019-cfe9a1e3f745`,
`b8afb8d8-3215-49e6-a20d-dde901a75084` and
`60450de7-8bc7-43af-839d-d2273193ea61`.
The historical proposal `4335f33c-5598-4e9c-ad33-1dfe0670d3b3` retained the
original image message `07a3ab4d-e6da-4602-9a3d-df7d98fd1c70`, rather than
claiming the later text-only message as its source. Its Person page also had
empty context and zero confirmed Memory.

## Retained failure evidence

The first owned attempt corrected native file-chooser interception before any
Agent request. Later stale chooser samples were corrected through the real
menu; no missing-image attempt counts as product acceptance.

The historical prelude first hit `PROBE_TIMEOUT` in run
`4cb5ecf6-8b43-4c77-b41e-d61889543860`; retry run
`693f6ec9-eafa-4e08-b920-150410a4a6f4` hit it on recheck after one model response.
Usage was incomplete, so no zero-cost claim is made. The owned workspace was
active and unexpired; direct reads took 50/1/1/0 ms with no lock wait. The probe's
one-second budget included shared pool and host scheduling. Its finite five-second
replacement still rejects expiry during the wait and admits no private read early.

After that correction, the analysis-only message completed. A later add request
in run `b8abe8f0-b4c6-4341-a8c6-2feff373ab3f` invoked `memory_review` but was
rejected because normal queue completion had scrubbed transient text while the
original image remained in its Session. The old fixture used completed/retained
and concealed this transition. The corrected path accepts a completed scrubbed
entry only after canonical Session/message/manifest validation; cancelled,
removed or changed sources cannot regain authority. Independent review found
no new lock-order inversion. Fresh real UI retry then saved successfully.

## Cleanup and handoff

Both owned test runs were stopped through `capir test stop` and independently
read back as `deleted`, with `cleanup_error=null`:

- `799f8bd1-04e3-42ea-8eb6-9ec49d96c8ee`.
- `79128427-2cad-4ba6-9ebd-10850ebab30c`, create request
  `015128a3-b639-4f9b-a3dd-8f514062bae4`.

The private test browser closed and all five task-only LaunchAgent jobs were
unregistered. The task's synthetic local database container was removed.
`live-proof.zip` contains the sanitized UI actions, snapshots, screenshots,
source provenance, deployed revisions and cleanup readback. Failed samples are
preserved alongside the successful results. The prompt source and this
constraint inventory were queued to open in the Codex editor.
