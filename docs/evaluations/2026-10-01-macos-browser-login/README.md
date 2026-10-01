# Browser-owned Mac login acceptance, October 1, 2026

Decision: [ADR 0022](../../decisions/0022-browser-owned-macos-login.md). Active delivery state: [execution plan](../../../plans/2026-10-01-macos-browser-login.md). The screenshot contains only an owned disposable account. No customer evidence or provider credentials were collected.

| Evidence | Result | Scope |
| --- | --- | --- |
| Backend module, automatic request-log redaction and real PostgreSQL tests | 32 passed | Real constraints, exactly one concurrent device session, revocation winning its write-lock race, expired code after lock waiting refusing all session writes; unit failure matrix |
| Web server-page, protocol and proxy tests | 52 passed | Primary-session CSRF binding, exact origin/state, ordinary Credentials exchange, no-cookie-write live status and revoked/incomplete-cookie reauthentication |
| Native Debug application build | Passed | Production native constructors, generated Xcode source membership, no iOS Simulator |
| Native XCTest regression suite | 260 executed, 9 explicitly skipped, zero failures | 251 passing state/store, settings, Capture, workspace and other native unit tests; opt-in live fixtures excluded |
| Opted-in real persistent WKWebView test | Passed, 5.343 seconds | Actual anonymous prepare, synthetic authenticated backend approval, supported Auth.js cookie installation, awaited navigation, correlated live status, reopened selected store and stale-store refusal |
| Actual first-party browser confirmation and cancel | Observed | Live backend-owned disposable identity, request hint, intentional cancellation |
| Actual revoked-browser-session recovery | Observed | Retained browser cookie with backend session revoked; exact Mac request redirected to normal browser reauthentication, then returned to the same confirmation request and identity |
| Independent sub-agent review | No unresolved P0/P1 | URL-proof logging, stale lock-wait expiry and revoked-cookie recovery findings repaired and independently rechecked |
| CodeQL follow-up regressions | Backend 26 passed, Web 17 passed | Unbiased hint generation, quoted request-identifier escaping and closing-script input protection; independent re-review passed with no remaining P0/P1/P2; new-head scanning tracked in the plan |
| Full native → system browser → callback → workspace | Pending | The actual default Chrome process runs headless with no startup window. ASWebAuthenticationSession starts, but no visible browser is available for the intentional approval. Temporary Safari selection needs explicit user permission; no system preference was changed |
| Live Google/Apple provider and installed signed release | Pending | Disposable WebKit/HTTP proof is not provider proof or an installed-app update |
| Local backend deployment | Pending | Opik mount failure recovered without data deletion; next deployment requires Colima-shared clean detached checkout. Storage audit reports 64 GiB against the required 80 GiB build minimum |

The WebKit test calls the production transport and exchanger. Its direct backend approval is a controlled fixture, not evidence of browser intention or OS callback delivery. The XCTest clock-wait regression uses real PostgreSQL locks with a deterministic clock advanced after observing the lock barrier. Helpers cannot establish the missing full user chain. Source hashes identify the verified implementation snapshot; later changes require relevant revalidation.

![Disposable browser confirmation](browser-confirmation.jpg)

![Observed native expiry and browser-only retry](native-expiry.png)
