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

## Verification

Use the focused Web `time-*` tests, backend time workspace tests and an isolated
localhost PostgreSQL database via `TIME_WORKSPACE_TEST_DATABASE_URL`. Include
cross-account/owner scope, source removal/retention, same-name identities,
cross-day/DST intervals, complete pagination, replay/conflict/deletion and
post-model source changes. Mac origin tests cover foreign blobs, lookalike hosts
and forbidden URL schemes. Real browser and Mac handoff verification is separate
from unit/prototype evidence; delivery evidence belongs in the GET-24 plan.
