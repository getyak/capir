# Screenshot contact Agent release

## Outcome and scope

Commit, review, merge, and publish the implemented screenshot contact Agent to
TestFlight. The user explicitly authorized all four actions. Work is isolated
from the shared dirty checkout in `codex/screenshot-contact-agent`, starting
at main `7f437c7`. Preserve the new full-screen Session and voice composer.

## Milestones

1. Complete: integrate the owned Agent, host, backend, Web, iOS, configuration,
   and evidence changes; verify the exact branch.
2. Complete: commit, push PR #135, inspect CI, and squash merge after all checks.
3. Complete: deploy the merged backend and verify TestFlight upload, Apple
   processing, the release receipt, and internal testing-group availability.

## Decisions and boundaries

- Keep already-deployed migration identifiers and checksums immutable. The
  main migration `047_proposed_extracted_text` and task migration
  `047_screenshot_contact_tasks` are distinct full identifiers; retain both.
- Use main's `proposed_extracted_text` for machine-generated message evidence.
- Add the real PostgreSQL authority test to CI after migration and seeding.
- Provider credentials stay in Infisical; no secret values enter this branch.
- Prior UI/live-model evidence is in the linked implementation plan. This
  release requires new branch validation and an actual TestFlight receipt.

## Completion evidence

Release **0.1.57**, build **20260906001520**, is processed and available to the
internal testing group. [PR #135](https://github.com/getyak/talent-signal/pull/135)
merged as `76265c7ee69de2d223bb4b9d0e65f2c04eced093`.

- [PR CI](https://github.com/getyak/talent-signal/actions/runs/33998762556)
  and [main CI](https://github.com/getyak/talent-signal/actions/runs/33999731001)
  passed. iOS passed 457 unit tests and all nine UI smoke journeys.
- [Release workflow](https://github.com/getyak/talent-signal/actions/runs/34000737448)
  completed after Apple confirmed the exact upload as valid. The automation-owned
  [GitHub release](https://github.com/getyak/talent-signal/releases/tag/v0.1.57)
  contains the IPA and [immutable processing receipt](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-screenshot-contact-agent/testflight-release-receipt.json).
- [Read-only access audit](https://github.com/getyak/talent-signal/actions/runs/34001221666)
  confirmed the exact version/build, `VALID`, active internal membership,
  all-build access, and `SERVER_ACCESS_READY=true`. No invitation was resent.
  [Sanitized audit](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-screenshot-contact-agent/testflight-access-verification.json)
  does not claim a physical-device installation of this exact build.
- The deployed image is
  `sha256:e0d094795577a87f4c948f64dd53bba7301091584a64c4a0cd7431b77d0a9bea`.
  Seven source-file hashes matched the release tree. Readiness reports migration
  `048_contact_task_invalidation`; Apple auth, voice, chat, and HTTPS probes passed.

The requested commit, PR, merge, and TestFlight publication are complete.

## Branch verification

- Agent: 55 tests; Agent Host: 34 tests; backend: 309 tests; Web: 323 tests passed.
- Seven PostgreSQL authority tests passed after applying main and task migrations,
  including the new `proposed_extracted_text` assertion. CI runs this same suite.
- Full Web lint/typecheck/production build, backend build, documentation and
  localization checks passed. Release Simulator build passed.
- Updated old provider test fixtures to the stable content hash, independent of
  request IDs, and health-check assertions to the installed task migration.
- Native retry retains its request only while image, objective, and selected
  scope match. A changed scope receives a fresh idempotency key.

PR: https://github.com/getyak/talent-signal/pull/135. First CI policy check
identified an undeclared database environment name in the local proof launcher.
It now uses the existing DATABASE_URL contract while retaining its explicit
disposable-database guard. No production credential scope was added.
