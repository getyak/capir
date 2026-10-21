# Time workspace

The Web and macOS product window use one authenticated time workspace at
`/workspace/meetings`. The route preserves existing meeting-draft deep links.
See [ADR 0016](../decisions/0016-shared-desktop-workspace-surface.md) for the
shared desktop surface boundary.

## Reading time

Timeline, week and month change the layout. Person and record-type filters
change scope and remain in the URL. Calendar dates use an explicit IANA time
zone and an exclusive upper bound. Range review is limited to 93 local dates.
The week view separates point activities from appointments occupying time;
weeks with clock changes fall back to an actual-time list.

The activity index reads current authorized sources rather than copying a
second permanent history. Person creation is an account record. Session activity
is grouped by actual turn dates and preserves the same Session identity across
days. Meeting drafts remain unconfirmed. Internal schedules are user-authored
intent; passing their end time never marks them completed.

Session retention still applies. Empty and incomplete results must never imply
that expired, unimported device calendar or unread records do not exist. A
paginated result is a short-lived snapshot of identities/order; every page
revalidates current source authority before returning content.

Same-page scope and selection changes use Next.js-integrated native history.
Each action merges against the current URL, so rapid filters and relative date
navigation do not overwrite each other. Browser history changes dismiss clean stale
editors. Unsaved editors remain open until the user saves or explicitly closes them,
even when tab-local storage is unavailable.

On narrow Web screens, read-only person, Session and public-source records use
a named modal detail with keyboard focus inside. Escape or explicit dismissal
closes only the selected record and returns to its usable origin. Range filters
and mutation recovery remain intact. The person-timeline action moves keyboard
focus into the destination workspace after its exact account and URL scope
commit; later reads do not repeat that focus move. Background reads keep the detail shell
open while replacing private content with current loading, failure or coverage
states; unread pages never prove that a record was removed. Desktop details
remain beside the timeline. Schedule and meeting-draft editors retain their
separate unsaved-input and uncertain-write protections.

## Today consumption

Web and its shared Mac product window, and native iOS, consume the same
currently authorized, user-authored canonical arrangement. Today reads at most
three pages of 100 records across seven local calendar dates, including today;
ongoing and all-day arrangements remain eligible until their exclusive end.
Cancelled, completed and unconfirmed records do not become the next arrangement.
Cross-midnight labels retain both dates, and all-day labels exclude the ending
midnight. Device-local iOS calendar entries keep their separate authority.

Today preserves loading, partial, unavailable and verified-empty states per
source. A failed goal producer does not hide a valid arrangement or unread
conversation. Reads reuse the existing active-refresh lifecycle, with no new
poller, model invocation, persistence, mark-read or calendar write. Credential
expiry and account/scope changes withdraw private content and reject late
callbacks. The Web opens the exact existing Time item; native iOS re-reads the
same ID and current revision in a read-only detail and withdraws revoked content.

## Saving and recovery

Manual arrangements can be created, edited, explicitly completed or cancelled,
and deleted. Writes carry an expected revision and a stable operation UUID.
Account/owner-scoped receipts make retries recoverable. Conflicts retain the
user's input until an explicit server/local version decision. Deleting an
internal arrangement clears its content but cannot cancel an exported event in
another application.

Before sending a write, the browser records the exact pending intent in
account-session-bound `sessionStorage`, with a maximum one-day expiry. This
includes the unsent title/note needed to retry the same operation after response
loss. It is confined to that tab and cleared after authoritative completion or
session expiry. Normal logout clears all old account bindings. A pending operation cannot be overwritten by another operation. Unsent edits have separate tab-local recovery and the same one-day expiry. Late responses from a closed editor cannot clear a newer draft. Reload never silently replays it; the user can inspect its
identity, re-read the result or explicitly retry the original operation.

## Calendar handoff

A fresh server read immediately precedes manual schedule export. Only the
reviewed title, time and explicitly selected reminder enter the calendar file.
Private notes, person details and attendees are excluded. The user confirms
import in their calendar application; file generation is not import evidence.
Subsequent edits, cancellation and deletion do not synchronize exported events.

macOS accepts downloads only from the configured main-frame origin, including
blobs created by that exact origin. A calendar MIME check precedes NSSavePanel.
There is no script bridge, arbitrary file write, automatic calendar launch or
silent replacement of an existing file. WebKit reports completion separately
from cancellation/failure. The implementation follows Apple's
[download destination contract](https://developer.apple.com/documentation/webkit/wkdownloaddelegate/download(_:decidedestinationusing:suggestedfilename:completionhandler:)).

## Agent review

Range review reads bounded, currently authorized activity metadata. Generated
prose is temporary and unconfirmed, with exact admitted source records and a
coverage statement. Source text cannot grant execution authority. The host
revalidates full admitted metadata during model context reads and after completion, rejecting stale results. A 32,000-character metadata budget bounds model input; truncated reviews list only the sources actually provided and remain explicitly incomplete.
Provider failure remains unavailable; it does not create a synthetic successful
review. Results are not written into long-term Memory or a new Session.
The Web keeps a completed review in tab memory across automatic refresh, with
an explicit stale and unverified label. Account/scope changes clear it. A
complete read proving removal, or any admitted-source metadata change, clears
the whole generated prose; hiding just a citation cannot withdraw its old text.
Partial pagination cannot establish absence. Failed regeneration preserves the
previous answer with its original question and stale label.

## Person source sync

One owner can confirm periodic re-reads of ONE exact already-authorized public
URL bound to ONE person. The confirmation is a separate deliberate decision
from the one-shot research approval: it echoes the exact source URL, bound
person/context, an honest 24-hour UTC interval (IANA zone for display only) and
a required expiry (UI default 30 days). The first cycle is due immediately.
Only one live grant exists per person; expired grants never silently revive and
require a fresh owner confirmation.

Each due cycle freezes its request from immutable grant-time values: the exact
canonical URL/domain plus the ORIGINAL grant actor, authorization revision and
time. Per-cycle fabricated approvals do not exist. Live authority (active
account, live non-expired grant, active Person, still-available bound seed with
an authorized unexpired receipt at the frozen authorization revision) is
re-derived from the database at dispatch, at every page capture commit and at
final completion, in the SAME transaction as the write and following the source
authorization lineage lock order, so pause/revoke/expiry/person archive/source
revocation can never commit new evidence afterwards. Recurring fetches pin DNS
at the TLS socket and keep the existing HTTPS, same-origin redirect, robots-per-
hop, byte and time limits; exactly one page at link depth 0 is read per cycle.

Each cycle consumes at most three total attempts inside a durable 15-minute
deadline, counted before any network or research lease. Exhaustion settles with
bounded database receipt reconciliation only: committed partial evidence is
preserved, an unverifiable outcome reads back as unknown and a missing
database write leaves the cycle unresolved and blocks any new one. Cross-cycle
unchanged dedup uses the source lineage, canonical locator and stable extracted
body hash: an unchanged cycle is a success with zero new observations and no
duplicate capture or calendar card. New observations stay proposed evidence and
surface only as additive unconfirmed `public_source_update` calendar activities;
nothing auto-enters Memory, contacts are never created, and
`external_effect='none'` holds everywhere. Deleting a grant keeps an
identity-only receipt with its operation id; deleted or deauthorized source
content never reappears in grant/run readbacks or recovery.
Reopening a revoked or expired manual public source still mounts the
owner-scoped periodic management control even when its URL is redacted.
The existing grant can be deleted; a missing URL or source authorization
never enables a new grant or resume, and the one-shot research form stays hidden.
Grant and run content visibility checks the live source receipt as well as
capture/resource state, including an elapsed authorization deadline before its
expiry sweep runs. Filtered ownership remains available for deletion, while
source URLs and observed locators are redacted after deauthorization.
The default Web URL intake uses ephemeral transport retention. Purging that
transport on `review_completed` preserves the reviewed evidence and its separate
authorization, so it must not make a new grant appear revoked. Readbacks accept
this specific purged state while still checking authorization and retention
deadlines before sweeps run. Retention-deadline purges and deletion stay hidden.
Regression coverage must create a public URL through the actual resource intake;
an inserted `available` receipt cannot prove this default Web lifecycle.

## Verification

Use the focused Web `time-*` tests, backend time workspace tests and an isolated
localhost PostgreSQL database via `TIME_WORKSPACE_TEST_DATABASE_URL`. Include
cross-account/owner scope, source removal/retention, same-name identities,
cross-day/DST intervals, complete pagination, replay/conflict/deletion and
post-model source changes. Mac origin tests cover foreign blobs, lookalike hosts
and forbidden URL schemes. Real browser and Mac handoff verification is separate
from unit/prototype evidence; delivery evidence belongs in the GET-24 plan.
GET-131 person source sync adds `src/modules/personSourceSync` tests (guarded
`TIME_WORKSPACE_TEST_DATABASE_URL` integration cases plus focused unit/route/UI
tests) covering duplicate replica dispatch, shared-transaction late-commit
gates, restart replay of the same cycle, attempt/deadline exhaustion, honest
unknown readback, source-deletion redaction and the additive calendar card.


The CI PostgreSQL authority step explicitly runs the person-source-sync
integration file with `TIME_WORKSPACE_TEST_DATABASE_URL`; the default unit pass
skips it and is not a database proof. SQL adapters cannot establish reserved-word
validity, transaction-time semantics, affected-row results or lock interleaving.
Use controlled waits inside real transactions and verify the actual producer's
run/task/idempotency response together, including partial recovery and deleted
or revoked evidence. Keep original failing logs separate from corrected runs.
