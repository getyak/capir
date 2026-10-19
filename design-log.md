# Design log

## 2026-10-20 — Web and macOS craft session

Work window: 00:36–12:00 Asia/Shanghai. New implementation stops at 11:30.

The surface is the signed-in personal workspace: resume a conversation, find a person, understand today's unfinished work, and review time. Content and the next useful action lead; utility chrome remains secondary. Business logic, records, and feature availability remain outside this session's changes.

Baseline source: remote main `1c7c9891`; resident Web `20c0d64a`; macOS uses the same resident workspace inside AppKit. See [active plan](plans/2026-10-20-design-noon.md) for evidence locations and verification state.

### Reference criteria

- [Ambi](https://www.ambi.ai/en): restrained composition and quiet chrome.
- [Linear](https://linear.app): precise alignment and information density.
- [Notion](https://www.notion.com/product): content priority and subtle separation.
- [Things](https://culturedcode.com/things/): native window rhythm and clear task hierarchy.

Reference parity is a visual judgment, never established by passing functional tests alone.

### Pending decisions

The native window and Web sidebar both repeat branding and navigation chrome. A unified desktop title/navigation treatment may be worthwhile, but it changes window structure and remains deferred. The current session first improves shared content and control hierarchy without changing navigation architecture.

### Loop 0 — baseline inspection

The conversation canvas is already calm, with a single composer and secondary prompts. The installed macOS app initially shows an expired-session recovery state. The shared Web workspace is the primary opportunity to improve both platforms consistently.


### Loop 1 — Today becomes a brief, not a dashboard

**Decision:** accepted and deployed for Web; installed macOS layout is visible, with summary settling still under investigation.

The oversized date and three rounded panels gave empty summaries more weight than the assigned action. The shared Today styles now use the workspace 24px title, quiet metadata, whitespace and one low-contrast separator. The actual task, outcome and milestone share one left edge. The target workspace link remains the sole filled primary action; optional Agent controls are secondary. No record, authority, route or action behavior changes.

At 390px, two short status summaries remain side by side. A populated title receives the full reading width in stacked rows. The initial all-stacked alternative was rejected because it recovered too little space. Long strings wrap, and keyboard focus, reduced motion and forced-color styling remain explicit.

| Surface | Before | After |
| --- | --- | --- |
| Web · 1440 × 1000 | ![Before: boxed Today](design-log/2026-10-20/round-01/web-1440-before.jpg) | ![After: content-first Today](design-log/2026-10-20/round-01/web-1440-after.jpg) |
| Web · 390 × 844 | ![Before: mobile Today](design-log/2026-10-20/round-01/web-390-before.jpg) | ![After: mobile Today](design-log/2026-10-20/round-01/web-390-after.jpg) |

The matched synthetic workspace retains the same test banner and content. The mobile before-capture is from resident Web `20c0d64a`; the final light after-captures are resident `40166aab`, which preserves concurrently deployed `06770526`. The malformed local mobile image was rejected. At 390px the settled task heading begins at 469.89px instead of 625.30px (155.41px earlier); horizontal overflow is absent. Desktop task position and primary action also move upward. This establishes improved content visibility, not visual parity with the reference products.

Additional states: [dark desktop](design-log/2026-10-20/round-01/web-dark-1440-after.jpg), [dark mobile](design-log/2026-10-20/round-01/web-dark-390-after.jpg), [unavailable summaries](design-log/2026-10-20/round-01/web-error-1440-after.jpg). Requests were blocked only within the local QA tab, then unblocked; keyboard Retry restored both summaries. Enter toggled the source disclosure without changing state. Reduced-motion emulation reduced the link transition to 0.00001s. A transient real health warning was observed and recovered independently; it is not attributed to this CSS change.

Independent source review closed the initial P2 timing and font-weight findings and found no P0/P1. Final source diff fingerprint: `e6b3534d13f479474f7af4d6c2e2cfe077d0a29c68c773d2cf2b8e4324c23cf6`. The populated-summary branch was also exercised with an isolated, clearly labeled [source-CSS layout fixture](design-log/2026-10-20/round-01/css-fixture-populated-390.jpg): titles receive 350px at 390 and 280px at 320, with no overflow and a visible 2px keyboard outline. This is synthetic layout proof, not a live populated-record claim. Final focused tests passed: 39 tests across Today context, its data helpers and pursuit Today rendering. `pnpm docs:check` passed. A clean detached production build and activation passed. [Verification receipt](design-log/2026-10-20/round-01/verification.json) binds revision `40166aab` to build ID `3eHsC9QkVQxOaQMMKZZfo`; loopback authentication, certificate-validated Tailscale login, protected synthetic Today and launchd restart recovery passed. The first activation safely refused another installer's lock; its completed `06770526` was merged before rebuilding rather than overwritten. Native 0.2.8 shows the new CSS and ⌘K/Esc works, but both summaries remain loading after background reload; normal native summary proof is outstanding. Independent static review found no CSS cause and identified the existing hidden-page early return as a hypothesis requiring runtime evidence.


### Loop 2 — Time controls recede behind the records

**Decision:** accepted and deployed for Web; native Time empty state verified at both sizes. Today summary completion remains open.

The date, independently boxed view controls and framed review row consumed the first mobile screen. The Time component now uses a single view track, quieter date and filter controls, inline range metadata and an unframed review disclosure. Add schedule remains the only filled toolbar action. This is one CSS module; no feature, record, URL or action logic changes.

| Surface | Before | After |
| --- | --- | --- |
| Web · 1440 × 1000 | ![Before: Time toolbar](design-log/2026-10-20/round-02/web-1440-before.jpg) | ![After: quiet Time toolbar](design-log/2026-10-20/round-02/web-1440-after.jpg) |
| Web · 390 × 844 | ![Before: mobile Time](design-log/2026-10-20/round-02/web-390-before.jpg) | ![After: mobile Time](design-log/2026-10-20/round-02/web-390-after.jpg) |

The matched synthetic records begin at 594.17px instead of 703.67px at 390: 109.5px earlier. Default toolbar controls use two rows. An [enabled filter](design-log/2026-10-20/round-02/web-390-filter-enabled.jpg) deliberately wraps to three rows to retain its full state label. At 320 the date wraps; this remains a craft gap, without page overflow. [Dark desktop](design-log/2026-10-20/round-02/web-dark-1440-after.jpg) and [dark mobile](design-log/2026-10-20/round-02/web-dark-390-after.jpg) retain hierarchy. Final light screenshots come from resident `38fa6c00`, build `MakeWxrw-wksqlK0dm4LM`; its sidebar reads the actual empty schedule state. The earlier local preview showed a separate session-expired sidebar status and was replaced in the formal light comparison.

Actual forced-color screenshots exposed Canvas text backplates obscuring light labels. The final narrowly scoped rules use the user's system palette and disable backplates only for filled primary and selected/expanded controls. Their hover styles preserve those colors. [Verified result](design-log/2026-10-20/round-02/web-forced-colors-after.png). The existing small-calendar selected label has the same backplate problem outside this module and remains a separate follow-up. [MDN's forced-colors guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/forced-colors) supports this targeted treatment.

All toolbar targets remain at least 44px tall. Enter opens/closes the native details disclosure with a 2px focus outline. Week/month state appears in the URL; the narrow week grid scrolls locally, while the page remains within 390px. Reduced motion removes transitions. Typecheck and 38 focused tests across Time views, workspace and date helpers passed; worker lint passed. Independent review found no new concrete P0/P1/P2 at final CSS diff `f8df2bec04331bc254c7a6a6cbc684a1ed5569eb01351b7be9a7e0663fd6a91c`. A clean detached production build, loopback authentication and certificate-validated HTTPS passed. Launchd recovery exceeded the initial 25-second readiness window, then recovered without another restart; subsequent authentication, HTTPS and protected records passed. Logs show delayed configuration injection before Next became ready. See [verification receipt](design-log/2026-10-20/round-02/verification.json).


Native Time: [1123 × 865](design-log/2026-10-20/round-02/macos-default-after.png), [900 × 720](design-log/2026-10-20/round-02/macos-narrow-after.png). Normal quit/reopen restored navigation and ⌘K/Esc after an unresponsive WebView observation. This is actual empty-state proof, not a populated-record comparison. Narrow-window empty copy sits too low and is the next visual target. The Today summaries still load indefinitely in these observations; no runtime cause or product fix is claimed.

### Loop 3 — People reaches the list sooner

**Decision:** accepted in local visual QA; clean resident deployment pending.

The mobile heading, Add contact and result count consumed three unnecessary rows. The heading and Add contact now share a row; default search and count share another. A committed query gives the input its full width so Clear and Submit remain usable. Long heading explanations and counts can wrap. No person field, search rule, route, return-session behavior or action changes. Row and arrow transitions use the shared 180ms duration.

| Surface | Before | After |
| --- | --- | --- |
| Web · 390 × 844 | ![Before: stacked directory utilities](design-log/2026-10-20/round-03/web-390-before.jpg) | ![After: content-led directory](design-log/2026-10-20/round-03/web-390-after.jpg) |
| Web · 1440 × 1000 | ![Before: desktop directory](design-log/2026-10-20/round-03/web-1440-before.jpg) | ![After: desktop directory retained](design-log/2026-10-20/round-03/web-1440-after.jpg) |

The same 12 synthetic people remain visible. At 390px the first row starts at 394.38px instead of 483.88px: 89.5px earlier. Desktop composition remains intentionally stable. [Dark mobile](design-log/2026-10-20/round-03/web-dark-390-after.jpg), [dark desktop](design-log/2026-10-20/round-03/web-dark-1440-after.jpg), and [320px no results](design-log/2026-10-20/round-03/web-320-no-results.jpg) were checked. At 320 with a query, the input receives 119px and both actions remain 44 × 44px; clearing returns focus to the input with a 2px outline. The long query remains editable and stored in the URL. No page overflow was found. Normal-motion emulation yields 180ms; the current system reduced-motion preference reduces it to 0.00001s.

Independent source review found no concrete P0/P1/P2 at diff `7bd130aeef92dec1182c07a509ead066cf3c97cb9e1f1dc25bc995c49f352219`. All 32 existing directory rendering/navigation/return tests and Web lint passed. [Verification receipt](design-log/2026-10-20/round-03/verification.json). The visual judgment follows Ambi's content priority and the reference products' restrained utility hierarchy; it does not establish overall reference parity. Remaining gaps include small sidebar typography, native repeated chrome and Today summary settling. Misrouted or partially painted captures were rejected; only route/theme/content/scroll-matched images are retained here.
