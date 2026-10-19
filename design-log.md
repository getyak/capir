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

The native window and Web sidebar both repeat branding and navigation chrome. A unified desktop title/navigation treatment may be worthwhile, but it changes window structure and remains deferred. The current session first improves shared content and control hierarchy without changing navigation architecture. Mobile Settings currently places seven section links above the content in three rows. A compact section chooser or a single scrolling tab rail could improve first-screen access, but changes navigation structure and remains a pending decision.

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

**Decision:** accepted and deployed for Web.

The mobile heading, Add contact and result count consumed three unnecessary rows. The heading and Add contact now share a row; default search and count share another. A committed query gives the input its full width so Clear and Submit remain usable. Long heading explanations and counts can wrap. No person field, search rule, route, return-session behavior or action changes. Row and arrow transitions use the shared 180ms duration.

| Surface | Before | After |
| --- | --- | --- |
| Web · 390 × 844 | ![Before: stacked directory utilities](design-log/2026-10-20/round-03/web-390-before.jpg) | ![After: content-led directory](design-log/2026-10-20/round-03/web-390-after.jpg) |
| Web · 1440 × 1000 | ![Before: desktop directory](design-log/2026-10-20/round-03/web-1440-before.jpg) | ![After: desktop directory retained](design-log/2026-10-20/round-03/web-1440-after.jpg) |

The same 12 synthetic people remain visible. At 390px the first row starts at 394.38px instead of 483.88px: 89.5px earlier. Desktop composition remains intentionally stable. [Dark mobile](design-log/2026-10-20/round-03/web-dark-390-after.jpg), [dark desktop](design-log/2026-10-20/round-03/web-dark-1440-after.jpg), and [320px no results](design-log/2026-10-20/round-03/web-320-no-results.jpg) were checked. At 320 with a query, the input receives 119px and both actions remain 44 × 44px; clearing returns focus to the input with a 2px outline. The long query remains editable and stored in the URL. No page overflow was found. Normal-motion emulation yields 180ms; the current system reduced-motion preference reduces it to 0.00001s.

Independent source review found no concrete P0/P1/P2 at diff `7bd130aeef92dec1182c07a509ead066cf3c97cb9e1f1dc25bc995c49f352219`. All 32 existing directory rendering/navigation/return tests and Web lint passed. Clean production build and activation passed at `46cc6ab3`, build `4Uabjz41gjNtHpWJL6ZiT`; final light comparisons use resident captures with all 12 synthetic people. [Verification receipt](design-log/2026-10-20/round-03/verification.json). The visual judgment follows Ambi's content priority and the reference products' restrained utility hierarchy; it does not establish overall reference parity. Remaining gaps include small sidebar typography, native repeated chrome and Today summary settling. Misrouted or partially painted captures were rejected; only route/theme/content/scroll-matched images are retained here.


### Loop 4 — Empty and failed Time states stay within reach

**Decision:** accepted locally; combined resident deployment and native after-proof pending.

A desktop-height floor pushed the narrow empty-state explanation behind the mobile navigation and below the short macOS window. Below 1000px, stacked rows now follow their content and the status area uses a 224px floor. Desktop composition remains stable. The Time error panel translates three known browser network-failure strings into “暂时连不上服务，请重试。”; other errors and all request, authorization and retry behavior remain unchanged.

| Surface | Before | After |
| --- | --- | --- |
| Web · 390 × 844 · same empty day | ![Before: empty copy too low](design-log/2026-10-20/round-04/web-390-before.png) | ![After: visible empty explanation](design-log/2026-10-20/round-04/web-390-after.png) |
| Web · 1440 × 1000 | ![Before: desktop empty state](design-log/2026-10-20/round-04/web-1440-before.png) | ![After: desktop rhythm retained](design-log/2026-10-20/round-04/web-1440-after.png) |
| Web · network failure | ![Before: browser error text](design-log/2026-10-20/round-04/web-390-error-before.png) | ![After: concrete recovery copy](design-log/2026-10-20/round-04/web-390-error-after.png) |

At 390px the empty heading moves from 728.28px to 639.92px, and its explanation ends at 704.42px. At 1440px the heading remains at 553.22px. [Dark empty state](design-log/2026-10-20/round-04/web-dark-390-after.png), [actual loading](design-log/2026-10-20/round-04/web-390-loading.png), and [320px keyboard-expanded review](design-log/2026-10-20/round-04/web-dark-320-expanded.png) were checked without page overflow. The expanded capture intentionally follows keyboard focus and is scrolled. Error/loading proof uses a temporarily paused or failed Time Fetch in the isolated QA tab, with interception cleared afterward; Enter on Retry restores the real response. No response fixture, record write or authentication bypass is used.

Independent source review found no concrete issue at diff `40b39082a7aea6cba48e61d8f09a54bfb148c644e26796bc9fb4fa199ba8c698`. The 38 existing Time tests, Web lint, typecheck and documentation checks pass after the display-copy change. [Verification receipt](design-log/2026-10-20/round-04/verification.json) records local proof; production and native after-proof will be attached after the next clean combined build.


### Loop 6 — Extension choices stop competing with their content

**Decision:** accepted locally; resident deployment and native after-proof pending. Loop 5's separate shared-sidebar batch is still being verified.

Four full-width black catalog buttons and a black selected direction tab gave utility controls more weight than the service descriptions. Direction tabs now use one fine selected underline. Catalog choices use compact secondary controls within the same existing grid. The outgoing-client empty state uses whitespace instead of another box. Body, error and empty copy use the shared 15px size, with 13px domain/auth metadata. Request, submission and confirmation primary controls remain distinct; no service, permission, route, record or business logic changes.

| Surface | Before | After |
| --- | --- | --- |
| Web · 390 × 844 | ![Before: competing catalog actions](design-log/2026-10-20/round-06/web-390-before.png) | ![After: service content leads](design-log/2026-10-20/round-06/web-390-after.png) |
| Web · 1440 × 1000 | ![Before: four black action bars](design-log/2026-10-20/round-06/web-1440-before.png) | ![After: quiet peer choices](design-log/2026-10-20/round-06/web-1440-after.png) |
| Web · outgoing client empty state | ![Before: framed empty panel](design-log/2026-10-20/round-06/outbound-390-before.png) | ![After: clear next action](design-log/2026-10-20/round-06/outbound-390-after.png) |

At 390px, the first service starts at 494.08px instead of 564.72px: 70.64px earlier. Catalog targets remain 90 × 44px; both direction tabs remain at least 44px tall and sit on one row at 320. The custom form stays within 320px, with 44px inputs and 16px input text. [Dark mobile](design-log/2026-10-20/round-06/web-dark-390-after.png), [dark desktop](design-log/2026-10-20/round-06/web-dark-1440-after.png), [forced colors](design-log/2026-10-20/round-06/web-forced-colors-390.png) and [real read failure](design-log/2026-10-20/round-06/web-error-390.png) were checked. Actual forced-color inspection caught transparent unselected tab borders becoming black; explicit Canvas/Highlight borders fix the ambiguous selection. Arrow keys move selection and focus, and the 2px outline remains visible. Reduced motion removes the 180ms transitions.

A temporarily failed directory Fetch disables all four choices without creating a connection or token. After interception is cleared, keyboard Reload restores all four and removes the error. All 28 existing extension/directory/request tests, Web lint and documentation checks pass. Independent final source review found no concrete P0–P2 at diff `6fa45e851b5e0745b93feadbcbb5a8ab41de8a5b6a415ca601a8df161df45768`. [Verification receipt](design-log/2026-10-20/round-06/verification.json). Scrolled or stale-painted captures were rejected; the final comparison checks viewport, theme and scroll position before capture and visually verifies saved pixels. Production/native proof will follow the next clean combined build.


### Loop 5 — Shared utilities become legible without growing the shell

**Decision:** accepted locally after independent review; combined resident deployment and native after-proof pending. This bounded batch ran alongside Loop 6 and is committed afterward.

Sidebar names and search results now use the shared 15px body size. Labels, dates, counters and supporting context use 13px metadata. Nonstandard weights collapse into 400/500/600. Existing sidebar widths, calendar cell heights, single-line session titles, truncation and every action remain intact. The compact avatar initials retain their existing geometric sizing. Mobile search entry stays 16px, and its initial/error/no-results explanation uses 15px. Ordinary utility transitions share 180ms; the existing 220ms footer morph remains within the design range.

| Surface | Before | After |
| --- | --- | --- |
| Web · People · 1440 × 1000 | ![Before: undersized sidebar identity](design-log/2026-10-20/round-05/people-1440-before.png) | ![After: shared reading hierarchy](design-log/2026-10-20/round-05/people-1440-after.png) |
| Web · People · 390 × 844 | ![Before: smaller utility labels](design-log/2026-10-20/round-05/people-390-before.jpg) | ![After: legible utility labels](design-log/2026-10-20/round-05/people-390-after.png) |
| Web · conversation · 1440 × 1000 | ![Before: tiny history utilities](design-log/2026-10-20/round-05/conversation-1440-before.png) | ![After: consistent history utilities](design-log/2026-10-20/round-05/conversation-1440-after.png) |

The sidebar stays 248px wide. Person rows are 52.39px high; at [900 × 720](design-log/2026-10-20/round-05/people-900-after.png), the sidebar scrolls independently instead of stretching the page. [Collapsed navigation](design-log/2026-10-20/round-05/collapsed-900-after.png) retains all direct routes. Mobile navigation remains 44px tall, with the People list still starting at 394.38px. [Dark People](design-log/2026-10-20/round-05/people-dark-1440-after.png) preserves the same hierarchy.

[Search on desktop](design-log/2026-10-20/round-05/search-1440-after.png), [390px keyboard selection](design-log/2026-10-20/round-05/search-390-after.png) and [320px no results](design-log/2026-10-20/round-05/search-empty-320-after.png) were exercised. Meta+K and Control+K open it, ArrowDown selects a result, Enter opens the actual synthetic person, and Escape closes it. At 320, the dialog is 288px wide and input text remains 16px, without page overflow. Focus is visible at 2px. Computed normal transitions are 180ms; actual reduced-motion transitions resolve to 0.00001s, including the late-defined rail controls.

The [small-calendar forced-color label](design-log/2026-10-20/round-05/time-forced-colors-1440.png) now stays readable on its system highlight. [Cross-month selected date](design-log/2026-10-20/round-05/calendar-selected-outside-forced-1440.png) retains Highlight/HighlightText even when also outside the browsed month. Those state captures include the local preview's separate sidebar authentication error, and one includes a transient actual health/loading warning. They are state-specific proof, not matched normal Time comparisons; the normal Time after-image will come from the resident service.

Independent review caught and closed three P2 issues: selected archived text without a highlight background, reduced-motion rules preceding later transitions, and outside-date GrayText overriding the selected text color. The archived branch is verified by source and review; no records were created to fabricate it. Final three-file diff fingerprint: `55e0177be0d2c5160cddfe0f2050dec8fc688d0e95c94b0e74d2e6aa08d57bb0`. Parent verification passes 59 existing tests across five relevant suites, Web lint and documentation checks; the worker contract's 35 tests and lint also pass. [Verification receipt](design-log/2026-10-20/round-05/verification.json). The stale development CSS was identified by computed 13px versus source 15px, then fixed by stopping the sole owned preview, confirming no open cache files, clearing only its dev cache, and reloading. The final 320px capture is actually 15px.

Native before-images use the same empty Time day on the primary authorized workspace: [1123 × 865](design-log/2026-10-20/round-05/macos-default-before.png) and [900 × 720](design-log/2026-10-20/round-05/macos-narrow-before.png). Native menu navigation and reload restored an inspectable page; the window is restored to its default size. A provisional capture retained an old painted date selection and was replaced after explicit-date reload. After-proof remains required after the combined deployment. Today summaries remain a separate unresolved runtime observation.
