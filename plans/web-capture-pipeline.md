# Web capture pipeline

## Outcome and boundary

An intentional browser selection, page excerpt, visible-tab capture, or chosen
screen capture reaches the signed-in user's durable backend task. AI extracts
attributable source material, resolves or creates a reversible internal Person,
and exposes progress, ambiguity, failure, source and the actual result in the
Web workspace. No inferred field becomes a confirmed fact or external action.

## Evidence and approach

- Baseline: `e9bbaa5b`, isolated branch `codex/web-capture-pipeline`.
- Existing browser handoff only admits one synthetic text fixture. Image upload
  is disabled in the extension despite the backend's newer governed image store.
- Reuse the account/owner-scoped contact task runner, image lifecycle, canonical
  resource intake and People. Extend admission for exact reviewed text and source
  metadata instead of creating a second CRM, database, or AI runner.
- Use same-origin requests inside the chosen Web tab so browser-managed login
  works without exposing credentials or weakening cookie/CSRF settings.
- Web surface: desktop capture inbox for recruiters, quiet neutral typography,
  compact recent-source list, one selected processing/result panel, minimal motion.
- Keep screenshot/iOS contracts backward compatible; add text admission separately.

## Milestones

1. Complete: extend durable task admission, source provenance and text extraction.
2. Complete: connect extension capture and receipt reconciliation to real authenticated tasks.
3. Complete: integrate the capture inbox with workspace navigation and complete UI states.
4. Complete for the initial local implementation: focused tests, browser surfaces,
   database readback and local deployment were verified.
5. Active: integrate with latest main, verify shared SDK text admission, publish
   a PR, pass the latest CI checks and merge to main.

## Remote delivery integration

The user authorized pushing and merging on 2026-09-10. Main advanced to
`65afe690` with the shared Claude harness after the original local implementation.
A clean worktree/branch `codex/web-capture-delivery` carries only capture changes
onto this baseline. It excludes the separate account-management branch that was
preserved for the earlier local deployment.

Keep the SDK loop, original-image review, profile-confirmation route, strict
source citations, screenshot recovery journal, monitoring and main's lifecycle
fences. Add reviewed text to the same SDK with exact-substring validation and
deterministic document blocks. Text-created records remain proposed evidence;
image profiles retain their explicit confirmed-profile review. New database
tests prove SDK text filing, no-person completion and invented-source rejection.
Session bindings use main's credential-bound HMAC, and browser provenance omits
URL query parameters and fragments.

## Completion evidence

Use synthetic sources only for testing. Exercise text/image admission, duplicate
retry, changed payload, account isolation, no person, ambiguous person, restart,
deletion and stale session. Render desktop/mobile and both themes. Run affected
typechecks/tests/build, extension packaging and `pnpm docs:check`. Rebuild and
redeploy the local TestFlight backend as required by backend AGENTS.md. Record
actual evidence and remaining limitations here before handoff.

## Implementation sources

- Next.js 16.3.4 bundled guide: `next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- https://developer.chrome.com/docs/extensions/reference/api/desktopCapture

## Progress

Implemented the shared text/image pipeline, exact-task handoff, capture inbox,
source/person views and governed deletion. Backend integration: 11/11 passed;
extension contracts: 36/36 passed; initial BFF tests: 3/3 passed. Live browser
proof uses an isolated PostgreSQL container on 55640, backend 4348 and Web 3048.
No production account or private source is used in proof artifacts.

Live AI exposed GLM-5.3 rejecting disabled thinking (provider code 1210). Text
extraction now uses enabled thinking with low effort. Text extraction has a
separate versioned product prompt and exact-substring validation. Successful live
AI and extension/browser verification completed on 2026-09-10. The real extension
submitted page text twice with the same request and received the same durable
task. Real AI created a Person. A subsequent reviewed screenshot reused that
Person, including recovery of the same task after a backend restart and provider
429. Original image readback returned HTTP 200. Screenshots are in
`output/web-capture-pipeline/` (synthetic sources only). See the
[evaluation record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-web-capture/README.md).

## Delivery status

Implementation and review verification are complete. The final PostgreSQL suite
passes 24/24, including explicit namesake selection and deletion interruption /
replay. The [evaluation record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-10-web-capture/README.md)
owns the synthetic live SDK and regression evidence. The final delivery commit
must pass CI and be deployed through the local TestFlight script before merge.
[PR #175](https://github.com/getyak/talent-signal/pull/175) is the authoritative
remote merge and check readback; local runtime logs remain ignored artifacts.
