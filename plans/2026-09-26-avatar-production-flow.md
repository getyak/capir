# Complete the Web avatar workflow

## Outcome and boundary

Deliver the approved Figma avatar flow through the real authenticated Web workspace: deterministic fallback, default style, per-contact and personal choices, upload/crop/preview/save/cancel/reset, and consistent destination readback after reload.

Preserve the disclosed browser-local, account-and-user-isolated persistence boundary. Do not fetch new provider photos, proxy private images, change identity evidence, or imply cloud/iOS synchronization. Preserve existing personal avatar generation and unrelated concurrent edits.

## Inspected gaps

The existing shared renderer and local persistence are implemented, but the directory mounts a dialog controller per person, every avatar subscribes to the entire store, uploads only support a fixed center crop, and an open editor can silently overwrite a newer saved choice. Previous verification used a temporary component route because the backend was unavailable; it did not prove authenticated entry and destination wiring.

## Milestones

1. Complete: one lazy workspace editor, focused subscriptions, recoverable stale-write handling, bounded crop controls and source-photo fallback.
2. Complete: keep the server-rendered directory lightweight; subscribe avatars only to their own preference and applicable default. Production inspection found the existing API caps directory/search responses at 20, so the unreachable virtualized branch and its new dependency were removed.
3. Complete: authenticated editing, personal generation, actual cross-tab save/clear recovery, focused tests, lint, TypeScript and production build pass.
4. Complete: reviewed against REVIEW.md; preserved source identity/provenance, explicit browser-local scope, cancellation, failed writes and recoverable stale state. Evidence and limitations are recorded below.

## Completion evidence

Exercise settings and People through normal authentication, save and cancel, photo upload/crop, missing-name and broken-image fallback, account isolation, stale edits, clear/recovery, reload and cross-surface readback. Inspect desktop/light, dark, and 390px layouts. Use production routes and components. Isolated test data must never be seeded into the shared TestFlight database.

Browser plugin is not listed in this session; use the installed Playwright runtime for browser verification. Figma reference: [contact avatar board](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=34-1369).

## Implementation evidence

- Store regressions first reproduced three failures: stale overwrite, unstable unchanged references, and retention of unexpected fields. All now pass. The final eight-file focused run passes 41 cases, including the real dialog controls, palette contrast, failed photo/upload/storage paths, crop bounds, account isolation, personal generation, stale saves and stale clear confirmation. Four directory/subscription cases passed again after removing virtualization. A 100-subscriber check updates only the changed contact.
- Happy DOM storage proxies require mocking the window storage getter, not its bound/proxied method. Tests now await lazy-module loading and asynchronous saves. Initial host-load timeouts were followed by clean passing runs; timed-out runs are not counted as passes.
- Focused ESLint passes. Production Next.js build compiled successfully, completed TypeScript, and generated all 40 static pages. Shared contracts, agent and workspace UI builds passed first.
- A disposable PostgreSQL 18 container `talent-signal-contact-avatar-proof` on loopback port 55447 holds 1,200 synthetic contacts. The initial empty native-Postgres proof database was too old for current migrations and is not used. The shared TestFlight database was not seeded.
- Local proof API: port 4439; Web: port 3139. Production login and the onboarding screen's existing workspace link lead to the real People page. Browser proof covers Chinese/English/unnamed fallbacks, draft cancellation, save/reload/focus restoration, real PNG decoding and WebP crop encoding, photo readback on the person detail page, global defaults preserving photos, removal/reset, and a 390px dark modal with no horizontal overflow or browser exceptions. The synthetic cropped thumbnail is 1,655 data-URL characters.
- Screenshots and the browser readback report are retained in [the synthetic browser evidence](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-26-avatar-workflow/report.json). Raw local verification scripts stay in `/tmp/contact-avatar-qa/`; authentication state is not copied into repository artifacts.
- Two real tabs exercised stale avatar saves, loading the newer choice, and destination updates. The real settings page verified personal-avatar shuffling, reload readback, invalid-image rejection without losing a saved image, cancellation of clearing, conflict detection for a stale clear confirmation, and confirmed reset propagating to the other tab. These checks reported no browser exceptions.
- No new virtualization dependency remains. Existing DiceBear pins and unrelated concurrent edits were preserved.
- Owned proof services and the disposable container were stopped. The unused native proof database was dropped; generated Next.js path changes were removed from tracked configuration. No shared database or user account was modified.

## Re-plan and boundaries

The fixture contains 1,200 synthetic contacts, but the production directory contract (`PersonDirectoryResponseSchema`) and query both cap a response at 20. This is existing directory behavior, not evidence for a 1,200-row production flow. Large-directory pagination and virtualization require a separate end-to-end directory slice. No such capability is claimed here.

Avatar choices remain browser-local and scoped to the authenticated account and user. This delivery does not add cloud/native synchronization, provider-photo ingestion, server thumbnail generation, or backend changes. Existing authorized source URLs remain lazy-loaded directly; selected uploads are cropped to 192px and stripped of original metadata locally.

Documentation validation still reports the same two unrelated broken links in `output/evaluation-first-agent-platform-opik-prd-original-en.md`; no avatar-plan link error was reported.

API references: [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request) and the installed Next.js lazy-loading guide.

## Remote delivery

The user authorized a new pull request, remote push, CI monitoring, and merge after verification. Delivery is isolated on `codex/avatar-preferences-flow`; unrelated primary-checkout edits remain untouched. The fresh isolated full Web run passed 1,382 tests with one existing skipped case. The seven editor cases passed again after the review fixes. Full lint has zero errors and six existing warnings. Documentation, wiki, architecture boundaries and diagrams all pass in this clean checkout; the primary checkout's ignored output is not part of the PR.

Independent review found and verified fixes for mobile row overlap and focus restoration when the account menu closes behind the avatar dialog. There are no remaining reviewer findings. [PR #252](https://github.com/getyak/talent-signal/pull/252) is open. While it was being created, PR #251 merged the avatar foundation and redesigned settings into `main`. The delivery branch merges that current baseline, preserving the new settings navigation, labelled profile trigger, local DiceBear rendering/cache and native settings work. The remaining PR scope is crop controls, shared on-demand editing, focused subscriptions, stale-write/clear recovery and the reviewed mobile/focus fixes.

The integrated 46-case focused run passes. A new rendered profile test also passes, exercising the labelled settings trigger through save/readback/focus restoration without calling account mutation. Full Web, TypeScript, lint and production-build checks are being rerun on the integrated source. The overlapping earlier build is discarded as proof. Remote CI and independent integration review must pass before merge; no remote merge is claimed yet.
