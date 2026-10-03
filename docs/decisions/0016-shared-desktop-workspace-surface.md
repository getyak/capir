# ADR 0016: One desktop product surface, separate native authority

The display-only maintenance exception is recorded in [ADR 0017](0017-desktop-maintenance-controls.md).

## Context

The existing Web, SwiftUI companion and Tauri capability workbench have different
page trees. Applying shared colors and sidebar widths leaves users navigating
three different products. The Quiet Workspace reconstruction requires the same
conversation, person, calendar and account/settings composition on Web and Mac.
The production Web application depends on Next.js server authentication and
server actions; packaging its output as static local assets does not preserve
those contracts.

## Decision

Use the authenticated Web product as the macOS product window through an
unprivileged WKWebView. The host accepts an explicit HTTPS origin, persists only
that address, and uses WebKit's website data store for its independent Web
session. It installs no JavaScript message handlers, native bridge, script
injection, certificate bypass, file URL access or credential forwarding. Main
navigation stays on the exact scheme/host/port; off-origin links require an
explicit choice before opening the system browser.

Existing SwiftUI intake/review and Tauri capability controls remain native tools,
not substitute implementations of the product page tree. Their authorization
remains separate: opening or signing into the product grants no local capture,
OCR, Keychain or external-write authority. Native tools stay explicitly reachable
from the macOS toolbar/menu. Native and Web sign-outs do not imply revocation of
the other independently authorized session.

## Consequences

Both platforms consume the same actual layouts and business controllers, and
server fixes do not require distributing a second page implementation. The Mac
product requires network reachability to the configured HTTPS service; offline
mode is an honest retry surface. Password authentication, upload, IME, page
navigation and recovery require rendered validation. System-browser OAuth does
not transfer a cookie back to WebKit automatically. [ADR 0022](0022-browser-owned-macos-login.md) introduces a browser-owned, one-use grant and independently verified WebKit session installation; it does not share or copy browser cookies.

The isolated local-asset Tauri bridge remains useful for native capability work.
We rejected attaching it to the remote page, copying prototype mock state into
native views, and maintaining a second CRM store. Reconsider extracting a shared
client application when offline business editing or native in-conversation
capture becomes a supported product requirement with a typed authenticated
transport contract.

API basis: [Apple WKNavigationDelegate](https://developer.apple.com/documentation/webkit/wknavigationdelegate).

## 2026-09-29: Intentional Mac screenshot submission

The owner requested a menu-bar screenshot that enters the existing Agent Session without a second Send. The Mac app now owns an explicitly initiated capture surface. The Web product page still receives no general native bridge or screenshot authority. A separate content-free, same-origin WebKit document carries fixed native-initiated requests in an isolated content world; WebKit keeps its login cookies in the existing origin-partitioned store. The native code neither copies those cookies into URLSession nor accepts capture commands from page JavaScript. Submission is fenced by the current login, stable owner scope and reviewed processing policy, then uses the existing durable conversation queue.

First-use disclosure and OS screen permission remain distinct. Selecting a region authorizes that one purpose-bound upload and Agent analysis, not a relationship fact, external effect or future ambient collection. The exception should be reconsidered if an implementation needs page-callable methods, persistent bearer credentials, cross-origin transfer or a second canonical task store.
