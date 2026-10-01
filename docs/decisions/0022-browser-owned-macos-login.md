# ADR 0022: Browser-owned macOS primary login

Status: accepted for this user-authorized implementation, 2026-10-01. Runtime and release acceptance remain tracked in [the execution plan](../../plans/2026-10-01-macos-browser-login.md).

## Outcome

The Mac app never displays a username, password, registration or provider-authentication form. Its signed-out surface offers one action, “在浏览器中登录”, followed by calm waiting, cancel, retry and truthful unresolved-result recovery. Existing authenticated workspaces reopen directly. Authentication happens in the user's default browser; a valid Web session can continue after an explicit account confirmation, and otherwise the existing Web login methods apply.

One canonical account/user and product store remains shared across Web, Mac and iOS. Each device has an independently revocable backend session. Browsers and WebKit do not share cookie jars. A native callback does not establish success by itself.

## Choice and alternatives

Use one first-party browser authorization grant, not a native implementation per provider. NSWorkspace opens the validated first-party HTTPS entry in the default browser. Its Boolean result acknowledges dispatch, not authentication. The existing application delegate receives the fixed private-scheme callback and forwards it to the application-wide coordinator. The browser identifies the live canonical account and asks for explicit continuation to this Mac. A signed-out browser uses the existing login and onboarding path, then returns to this entry. Google never authenticates inside WKWebView. Browser cookies remain browser-owned; reuse depends on that browser's live session.

A default-browser loopback listener adds a local server, lifecycle and port surface; the existing fixed private scheme avoids that additional transport. ASWebAuthenticationSession was evaluated but did not produce a visible authorization window in the controlled Safari acceptance run; ordinary default-browser delivery is the smaller replacement. This observation does not establish a platform-wide defect. A new per-provider native linking protocol duplicates existing Web settings and prolongs credential handling; settings remain browser-owned. Manual passwords, pasted tokens/codes and copying browser cookies into WebKit are rejected.

## Authority and transport

The native operation generates cryptographically random state, S256 PKCE verifier/challenge and a cancellation secret in memory. Anonymous preparation creates a bounded backend grant tied to the exact allowlisted Web origin, protocol version, immutable primary-login purpose, state hash and challenge; the server accepts no arbitrary callback or client-supplied account/user authority. Only hashes of proof/cancellation secrets are stored. The first-party browser may inspect a pending grant, but only intentional CSRF-protected approval authenticated to a live real backend session can attach an account/user. Lab identities cannot issue real Mac sessions.

The browser confirmation shows the verified account and a request-specific matching hint also shown on Mac, with Continue and Cancel. If the browser is signed out, its safe same-origin return target survives all existing Web login methods and onboarding. GETs/mail scanners cannot approve, cancel, consume or create a session.

Confirmation pages use an origin-only `strict-origin` referrer policy, protecting path/query proofs while retaining the exact Origin on intentional same-origin form POSTs. `no-referrer` would serialize these navigation POST origins as `null` under Fetch and break the strict origin guard. API completion documents retain `no-referrer`. Null or foreign origins remain refused even when other metadata looks trusted; sealed session-bound CSRF proof and live backend approval are still required.

Approval revalidates the active browser backend session in a transaction and mints a code valid for at most one minute within a five-minute grant. Callback is fixed to `com.talentsignal.macos.auth://complete`, containing opaque attempt, code and state only. Native validates bounded format, its current waiting operation, state, deadline, origin, generation and store epoch before changing state or dispatching exchange. Unsolicited, malformed, foreign, stale and cold-start callbacks are ignored without cancelling a legitimate pending operation; accepted callbacks synchronously leave waiting so duplicate delivery cannot consume twice. Browser-tab closure supplies no completion event: explicit Mac cancellation and the five-minute timeout remain available. A callback is not credential installation and cannot authorize local capture or another effect.

Private-scheme routing is not exclusive. S256 PKCE prevents another handler from redeeming an intercepted code; it does not prove the calling application's identity or prevent routing denial of service. Explicit verified-account approval and the matching hint remain necessary. The inherited reverse-domain scheme assumes first-party control of its namespace. Its `://complete` compatibility form differs from RFC8252 section 7.1's single-slash example; this protocol adopts the external-browser/PKCE security pattern without claiming exact conformance to that URI form.

Native submits the code and verifier by a fixed same-origin WKWebView POST. The backend atomically checks challenge, origin, purpose, approved identity, browser-session validity, expiry and terminal state before creating one ordinary device session with the existing session policy. The Web server installs the normal encrypted Auth.js HttpOnly cookie through supported Auth.js signIn; raw backend/provider credentials never enter callback URLs, rendered DOM, logs, native preferences, message handlers or URLSession cookie storage. An approved login is not a Settings step-up and never attaches another credential. Browser and Mac sign-out remain independent unless an explicit backend session revocation applies.

## Store ownership and recovery

Retain ADR0021's invariants but use the smallest implementation for browser-owned primary login. One application coordinator per canonical origin owns selected persistent WK store UUID/epoch and a single active login lease; all workspace and capture hosts must use that selected store and retire on epoch change. Adopt the legacy deterministic store once to preserve existing sessions. Before exposing a new primary login or sending any possible cookie-writing exchange, atomically persist a fresh store selection and unresolved marker under process ownership; never copy old cookies, local storage or drafts to another account.

A cancelled/late request may still have installed a cookie or created a backend session. Do not equate stopLoading, cancellation or elapsed time with rollback. Preserve uncertainty; a new intentional login uses another store, and restart with unresolved state must not select the old uncertain store for a new authentication write. Persistence failure blocks dispatch. Keep old store/draft data quarantined rather than deleting it during recovery. Normal authenticated navigation and external account settings do not rotate stores.

A fixed read-only status endpoint uses the primary cookie, checks the live backend session, emits no Set-Cookie and Cache-Control: no-store, and returns only protocol/operation-correlated canonical identity and expiry. Native reads it in its own current selected WK context and checks the exact approved account/user before opening the original safe workspace/onboarding target. Do not use Auth.js /api/auth/session as a non-writing readback. Unknown result offers “检查登录结果” and deliberate “重新登录”; success needs the same live identity readback. Callback failure before possible exchange has a recoverable cancelled state. After possible exchange, cancellation remains uncertain until readback or an explicit fresh-store retry. Old callbacks/readbacks cannot mutate a newer epoch or another origin.

## Success standards

The complete user chain is: native action → browser authentication or existing-account confirmation → intentional approval → bound callback → one-use device-session exchange in selected WebKit store → live backend identity readback → original workspace/onboarding. Each stage has its own observed receipt; only the final readback admits the workspace. Exercise this path using the actual constructors and transport, including relaunch persistence, cancellation, revocation and late-response isolation. Controlled synthetic evidence is labeled separately from live provider authentication and installed-release acceptance.

## Supersession

This decision replaces ADR0019's primary-login provider-specific prepare/authorize/link protocol and its requirement for fresh provider proof on every ordinary Mac login. That protocol is not required for browser-owned account settings. ADR0018's canonical identity, explicit credential changes and sync boundaries remain intact. ADR0021's late-cookie/store-ownership safety remains applicable; its credential-round native machinery is unnecessary here.

## Sources

- [Codex browser authentication](https://learn.chatgpt.com/docs/auth).
- [Claude Code browser login](https://code.claude.com/docs/en/authentication).
- [Cursor browser SDK login](https://cursor.com/docs/sdk/typescript).
- [OAuth for native apps, RFC8252](https://www.rfc-editor.org/rfc/rfc8252.html).
- [Apple default-browser URL opening](https://developer.apple.com/documentation/appkit/nsworkspace/open(_:)).
- [Apple application URL delivery](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/application(_:open:)).
- [Apple identified WK data stores](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/init(foridentifier:)).
- [Auth.js Credentials](https://authjs.dev/getting-started/providers/credentials).
- [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers).
- [Fetch Origin-header algorithm](https://fetch.spec.whatwg.org/#append-a-request-origin-header).
- [Strict-origin referrer policy](https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-strict-origin).
