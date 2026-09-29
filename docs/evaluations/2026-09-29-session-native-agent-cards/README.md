# Session-native contact, Memory, and calendar cards: implementation review

Date: 2026-09-29. Scope: the shared Web workspace used by browsers and the macOS Web window. All observed names, accounts, and appointments below were synthetic and held in an isolated local PostgreSQL database.

## Outcome

One assistant turn now renders through `assistant-ui` with typed data parts. The turn can hold an Add contact card, independently actionable Memory cards (including an update), and a calendar draft card. Each action stays in the Session. Existing chat admission, composer, attachments, queue, and draft ownership remain with the product's conversation controller. The model supplies proposal inputs, never write authority; domain validation and a human click still precede every consequential write.

The contact decision creates only a Person and leaves every Memory sibling pending. A Memory decision commits, edits, retains an old value, records a conflict, or skips one item without changing another. A calendar click generates a revision- and source-checked `.ics` file; import remains a separate action in the calendar application. The Session says the draft was generated and asks the user to confirm import there. Contact and Memory decisions use scoped operation readback for receipts and undo; refresh recovers saved and skipped item cards without making a second write.

## Direct evidence

| Boundary | Observed result |
| --- | --- |
| Real Agent dispatch and domain transition | A database integration test ran `executeUnscopedChatTask`, dispatched `memory_review.propose` through a scripted provider, created one contact-only receipt, then accepted one Memory item and skipped its sibling. Final database statuses were committed and skipped. The existing image-only production dispatch and legacy batch commit tests also passed. |
| Local Web Session | In an authenticated local browser with a synthetic Session, Add contact produced an added-contact receipt; Remember produced a saved Memory receipt while a sibling stayed pending; Not now produced a skipped receipt. Reload displayed the saved and skipped Memory receipts with their exact excerpts. The original fixture had already lost its contact locator before the recovery fix; contact receipt persistence after a combined reload is covered by controller tests, not by that browser recording. |
| Calendar card | The same local Session displayed title, local time, IANA zone, exact source, and Download/Edit/Not now buttons. Clicking Download changed the card to “已生成日历草稿，请在日历应用中确认导入”. The interface did not claim an event was added. The download was not followed through a macOS save panel or a calendar import. |
| Responsive presentation | The card actions and status remained readable and clickable at a 390 × 844 browser viewport. The wide Web layout was also inspected. The temporary viewport override was reset. |
| Source inspection | Component tests confirm that a screenshot card requests the exact same-Session image under the current account binding, with no source filename or bytes in the assistant-ui data part. The new viewer highlights an admitted region when present. A contact-only card uses an exact sentence from the originating text; with one attached image it offers the original image. The viewer was not visually tested in the locked macOS app. |
| Source withdrawal | A revoked source removes old change text, excerpts, and contact identity from direct cards and disables their actions. Scoped operation readback omits the item snapshot after source deletion. |
| macOS application | The native project built and its unit suite passed through `scripts/macos/check.sh`; the compiled app already permits same-origin calendar Blob downloads and owns the save panel. The Mac was locked during UI inspection, so the actual WKWebView click, save panel, and saved-file result are not claimed as verified. |

## Verification run

- Backend Memory unit and isolated database integration: 94/94 passed, including actual Agent tool dispatch, contact-only preservation, item decisions, replay, source deletion, and legacy batch behavior.
- Meeting draft isolated database integration: 9/9 passed.
- Web conversation, Memory, calendar route, and calendar utility tests: 163/163 passed.
- Backend and Web TypeScript checks passed after the final test fixture correction.
- Web lint passed with five pre-existing unused-symbol warnings and no errors.
- `pnpm docs:check` passed after this record was added.
- `scripts/macos/check.sh` passed: macOS build and unit tests; UI tests compiled but were not run.

## Limits and next checks

This review does not claim native iOS or external MCP Apps support. Those remain separate platform slices. Session synchronization was not changed. The synthetic browser Session was inserted to inspect presentation and interaction; it does not replace the separate real Agent dispatch test. Before release, exercise the actual macOS WKWebView calendar save panel on an unlocked Mac and recheck the original-image dialog there. No calendar import or external calendar write was performed in this evaluation.
