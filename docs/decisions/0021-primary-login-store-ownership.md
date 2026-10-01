# ADR 0021: Primary-login browser-store ownership

Status: safety invariants retained by [ADR 0022](0022-browser-owned-macos-login.md), 2026-10-01. The implementation below describes the earlier provider-specific local candidate; browser-owned primary login replaces that machinery while retaining store isolation, durable uncertainty, host retirement and truthful readback. App-level and release acceptance remain required before delivery.

## Context

The macOS wrapper already isolates persistent WebKit storage by canonical
origin. Within one store, response order can still change the effective login:
a delayed A response can install its HttpOnly session cookie after B has signed
in. Ignoring A's native callback does not reverse Set-Cookie. Password login,
logout and Auth.js session refresh also write this cookie; a lock around only
native OAuth consume cannot cover the whole browser.

The r32 disposable WebKit experiment confirms shared-store contamination and
isolation using distinct persistent identifiers. With an explicitly persistent
synthetic cookie and graceful shutdown, a separate process reopened B and sent
its cookie. This is bounded API evidence, not crash recovery or application
acceptance. The first two probe variants did not establish persistence; their
receipts remain preserved. Apple supports identified persistent data stores on
macOS14 and later, matching the project target.

## Decision

Use the existing origin store selection with one active identifier and epoch,
plus a small durable uncertainty journal. Do not introduce a customer-facing
profile manager, copy cookies, place provider credentials in native storage, or
change server account/session ownership. Canonical account and user IDs still
own synchronized People and conversation Sessions; a store identifier is only
local browser routing metadata.

### Primary login versus credential settings

Keep the selected store during ordinary workspace use and every current/target
credential-setting round. Adopt the legacy deterministic origin UUID once for
existing installations so their current workspace does not reset on upgrade.

A new primary-login flow starts from a first-party login entry in a fresh store
whenever any old session-cookie writer may remain. This is the default for a
later explicit login, identity switch, unresolved restart or abandoned login.
Choose and persist the new store **before** displaying its password form,
preparing provider proof or dispatching any authentication request. Never move
or replay an existing password POST, OAuth code, challenge or prepared consume
into the replacement store.

The already-selected login-entry store can host that flow's validation retries
and current provider choice before a potentially committing request is pending.
A second primary flow cannot supersede a possibly committing exchange in the
same store. Only the lease-owning host displays an interactive primary-login
form. Its actual Web password/provider controls share a synchronous single-flight
submission gate, including Enter, alternate-method clicks and rapid retries;
a React render-time disabled flag alone is insufficient. Native provider entry
also checks that same active flow. An uncertain password/fetch result keeps
alternate methods and duplicate submission blocked and offers an explicit new
first-party login entry. A durable marker protects restart; it is not a
concurrent-submission gate. Retrying after an uncertain commit starts again from
the first-party entry in a newly selected store. Credential binding remains in the original
logged-in store; it does not rotate or replace the primary login cookie.

### Durable selection and process ownership

One coordinator owns each origin across all hosts. Each immutable lease includes
origin, store UUID, store epoch, host ID and operation ID. An OS-backed process
lock prevents a second app process from independently writing that origin's
selection; additional hosts in the owning process use the same coordinator.
The OS lock uses a stable separate lock identity; do not lock the journal inode
that atomic replacement will replace. Lock failure is an actionable unavailable
state, not permission to use the old UUID. Do not infer exclusivity merely from a SwiftUI Window declaration.

Persist the selected UUID/epoch and an unresolved login-entry marker atomically
and durably **before** loading that entry. Marking uncertainty before exposing
the login form conservatively covers fetch-based password/session writers that
a navigation delegate cannot observe. The journal contains no bearer token,
password, verifier, pairing secret or provider assertion. Use an atomic file
replacement with file and containing-directory durability, bounded schema and
private permissions; an asynchronous preferences update does not prove ordering.
If persistence fails, do not load or dispatch the new authentication flow.

On restart, unresolved state cannot select the prior store for authentication
writes. Persist a new selection before constructing the replacement host. A
missing/damaged previously initialized registry must not silently fall back to
the legacy UUID. Distinguish the one-time legacy adoption from damaged state.

A session installation is settled only after its actual HTTP response and a
correlated, same-store authenticated readback identify the canonical account
and user. Use a read-only first-party status consumer where password login lacks
a native consume receipt. It returns only safe status/actor metadata after real
active backend-session validation and emits no Set-Cookie, with no-store cache
policy. Do not reuse Auth.js /api/auth/session, which can re-sign the session
cookie. DOM state, a Settings URL, a backend committed fact alone, or a generated
native message cannot settle installation. No status read is allowed to mint or
replay a login or credential mutation. A successful status read proves only the
session observed in that request, not that all older cookie writers have settled;
when the password fetch response is not observable to native code, keep the
conservative uncertainty/rotation rule for the next primary login.

### Retire the whole old epoch

Selecting a replacement store retires every old WorkspaceBrowser/controller,
including hidden hosts and retained callbacks. Reconstruct SwiftUI/WK state by
`{origin, storeID, epoch}`, not origin alone. WKWebView copies its configuration
at initialization; changing a configuration object cannot switch an existing
view's jar.

Old responses may affect only the quarantined old store. They cannot select an
old UUID, navigate a replacement host, release its lease or clear its journal.
Every asynchronous transition checks its captured lease. Origin switching and
window reopening consult the same durable registry. A late refresh/logout from
an old epoch is isolated just like a late OAuth consume.

Do not delete quarantined stores during recovery. They may contain unsent,
account-scoped local content. Preserve it without copying it into a different
identity. Later bounded cleanup may remove a specific unreferenced store through
WebKit's public API after all its views are released; never enumerate old stores
and automatically reselect or delete them. Store rotation does not revoke a
backend session that may already have been created, undo a credential mutation,
or establish that an abandoned operation was cancelled.

## Production composition contract

The r36 helper-only implementation and repair9 draft exposed an implementation
ambiguity. The following composition is part of this accepted decision; a
per-browser coordinator or a replaced WK view with the old controller does not
satisfy it.

### One application owner and immutable host construction

Create one main-actor application coordinator, initialized once from explicit
launch configuration. It owns one registry/process-lock lifetime and a selection
map by canonical origin. Additional windows and rebuilt SwiftUI views receive
this coordinator by injection; they never independently construct a registry or
acquire the same lock. Each window has a stable host ID outside the subtree that
is rebuilt for a store change.

The coordinator exposes a bounded resolution for each host: unavailable with an
actionable reason, ordinary selected workspace, owned primary-login entry, or a
passive waiting host. The immutable browser construction context contains
`{origin, storeID, epoch, hostID}`; a primary entry additionally carries the full
lease and a fresh first-party GET destination. Registry errors produce the
unavailable resolution. Never force-unwrap a failed coordinator, choose a
temporary fallback directory, or silently reuse the deterministic legacy jar.

Construct WorkspaceBrowser, its WKWebView and DesktopAuthenticationSession as a
single lifetime from this context. The connected SwiftUI subtree and native
view representation are keyed by `{origin, storeID, epoch, hostID}`. A selected
epoch change retires the complete old browser/controller and constructs a new
one. Merely assigning another WKWebView to a property is insufficient: existing
load closures, presentation anchors, KVO, script handlers, event observers and
NSViewRepresentable instances may still point at the old view. Reconstruct all
of them together, and keep old asynchronous callbacks bound to their captured
context. The old store remains quarantined rather than deleted.

Host registration is explicit. Selecting a new epoch publishes to every
registered host of that origin, including hidden hosts; every old controller
loses navigation/mutation authority. Only the owning host may show the selected
login entry. Other hosts display a passive state and cannot silently take the
lease or expose a second form. An explicit user choice may start a new entry in
a fresh store, but an automatic hidden-host callback cannot make that choice.

### Rotate at login entry, before inputs; keep the selected entry for its methods

When the selected ordinary workspace redirects/navigates to primary login,
cancel that old host entry before login inputs appear. An automatic navigation
only requests entry; it never grants ownership. Only the application-selected
visible foreground host, with no conflicting live owner, may automatically
acquire first entry. Hidden/background hosts become passive and cannot rotate
or steal a lease because their session expired. A conflicting owner requires
a deliberate user action to start a fresh entry in the chosen host; callbacks
and restored history cannot simulate that action. The coordinator validates
the requesting host, current selection and foreground/explicit-entry reason
before persisting the fresh entry selection and unresolved lease,
then publish the replacement construction context. The replacement host loads a
fresh first-party login GET only after those writes succeed. It already owns
that entry; its own initial GET does not recursively rotate again.

Password Enter, ordinary provider submission and the native provider handoff
all belong to that same entry. Do not rotate for the first time inside a provider
button's `/desktop-auth/request` interception: password input may already have
been exposed and the old controller/load closure may still target the old jar.
The provider interception validates the current host's entry lease, then starts
proof in the already selected entry store. Settings current/target credential
rounds never request primary-entry rotation.

A navigation-delegate GET check alone is insufficient. Native login rendering
has a fail-closed presentation boundary covering Next client routing, history,
BFCache restoration and return from registration/recovery. Configure a native
display-only user-agent marker before the first request and entry-ownership
metadata at document start, derived from the immutable construction context.
For a native host, the server login surface initially renders an inert entry
shell, not interactive password/provider controls. Only the owning fresh entry's
client boundary may render/enable those controls. Ordinary browsers keep their
normal login surface. Spoofing display metadata grants no backend authority.
The visible entry/new-entry action requests the fixed first-party native entry
route; the application coordinator remains the sole lease authority.

The presentation boundary rechecks on route/history restoration and on host
revocation; an old cached owned flag cannot reopen a completed/retired entry.
Full document navigation is required for the native fresh-entry transition;
no RSC redirect or restored history may bypass that boundary. Host lease loss
immediately makes the old surface noninteractive and retires its view/controller.
The same synchronous client submission gate covers every enabled method;
metadata never carries a cookie, password, verifier or provider assertion.

A visible explicit new-login/recovery action acquires a new entry lease before
reopening any methods. A possibly committing request in an older entry is not
replayed. On process startup, an unresolved persisted entry is replaced before
any host can load it for authentication; old lease host IDs are not revived.
The coordinator distinguishes initial workspace adoption, resume of settled
workspace use, and fresh login entry, so normal workspace navigation does not
continually create stores.

### Same-store observation and asynchronous fences

The actual app uses the fixed read-only primary-status route from the owning
WK store and correlates its response with the captured host/store/epoch/lease.
The route must validate the primary token directly, without the workspace-aware
client that can select a secondary Lab token. Return safe actor metadata only.
Do not extract HttpOnly auth cookies into URLSession or native storage to make
this request, and do not add a general-purpose page-to-native credential bridge.
A fixed same-origin status fetch returning only this safe metadata is permitted.
Invoke it from host-owned code in a dedicated isolated WK content world in the
owning main frame; do not accept a page-posted actor or DOM text. Use the exact
configured status URL with a fresh read correlation, same-origin credentials,
no-store and redirect rejection. Validate the exact final origin/path, HTTP200,
JSON MIME and bounded actor/status schema before using the result. Correlate
both dispatch and asynchronous completion with the captured full lease/store
and read generation. A response to an old view cannot resolve a newer entry.

Keep observedActor separate from settledEntry. Status can update the observed
identity and recovery UI but cannot by itself clear an unresolved possibly
committing write. Settling requires the separately observed matching installation
response and this live readback; when a password fetch response cannot be
observed by the host, retain the conservative uncertainty/rotation rule. A page
route, native consume callback or decoded JSON without that provenance cannot
clear uncertainty.

Retain the explicit distinction between an observed actor and quiescent cookie
writers. A password success observation does not prove every older response is
done. The next primary login still rotates. Every asynchronous resolution,
lease release, marker update and host retirement compares the full captured
lease; no callback looks up an unrelated newer lease and clears that instead.

### Test host isolation is enforced at application bootstrap

The production root is resolved only after strict launch-argument validation.
The `--primary-login-store-root` override requires one absolute task-owned path;
a missing value, duplicate switch or another switch as its value is an error,
not a production-root fallback. Tests inject one shared coordinator and explicit
roots, not a registry for each view.

macOS unit tests have a real TEST_HOST application, so helper-only temporary
roots do not isolate app bootstrap. The generated test launch configuration must
supply a task-owned root before any workspace host is constructed. Detecting an
XCTest host without an explicit root must fail closed into an unavailable test
host state before touching the standard registry. UI test launch arguments must
also name the task root and isolated Web origin. Registry-root isolation does
not isolate WebKit's globally identified persistent jars. In disposable test
mode, disable legacy-store adoption entirely: allocate a fresh task-namespaced
persistent UUID and reuse only selections recorded in that task registry. Never
read or adopt the installed application's origin selection, saved preferences,
legacy deterministic UUID or other WebKit identifiers. Both unit TEST_HOST and
UI runs must explicitly supply their isolated origin as well as root; otherwise
remain unavailable before constructing any WK view. Record effective arguments,
origin, root and task store identifier at the safe metadata level; never log
cookies, verifiers or assertions. Build and compile are separate from launching
this isolated application.

## Product behavior

Normal workspace use and Settings binding remain quiet and continuous. An
uncertain login offers a real read-only result check and a deliberate new login;
use plain copy such as “尚未确认登录结果”, without exposing cookie/store/epoch
terminology. New login preserves cloud data and does not delete quarantined
local drafts. Do not promise immediate recovery of local-only drafts into the
new account or show a no-op retry button after its authority has been lost.

## Acceptance and limits

Required app-level evidence, beyond the r32 API experiment:

1. Two real hosts share one active lease; a pending session-writing A prevents
   same-store B. A deliberate replacement constructs B in a different selected
   store before proof/input, and late A cannot affect any active B host.
2. Repeat held-response ordering for native consume, old JWT refresh and logout;
   server-authenticated readback from B stays B. Credential rounds still use the
   same primary store and preserve login cookie/People/Session identity.
3. Terminate/relaunch around journal persistence, server commit before response,
   response before receipt and new-store selection before login. Unresolved old
   stores never re-enter. Graceful persistence is not crash durability evidence.
4. Test process lock contention, failed atomic persistence, damaged initialized
   state, same-origin host reconstruction, origin switching and stale callbacks.
5. Run actual password/provider primary login entry and truthful recovery UI;
   preserve unsent local state without exposing it to another account. Use only
   disposable test registries/stores when exercising this behavior locally.

No new backend schema or generic profile system is required. If implementation
cannot enforce these store ownership boundaries, keep primary-login support
unaccepted instead of treating response cancellation as cookie rollback.

## References

- [WebKit persistent profile API](https://webkit.org/blog/14423/building-profiles-with-new-webkit-api/)
- [WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)
- [ADR0019 system authentication handoff](0019-macos-system-authentication-handoff.md)
- [ADR0020 credential proof rounds](0020-macos-credential-proof-rounds.md)
- [Independent store-ownership review](../evaluations/account-sync/login-store-ownership-review.md)
- [r32 WebKit probe review](../evaluations/account-sync/login-store-boundary-r32-review.md)
