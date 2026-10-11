# Web sidebar refinement — 2026-10-11

## Outcome and boundary

Deliver a readable, calm Web sidebar from the user-provided Today screenshot.
The expanded Web sidebar uses a compact brand/collapse header, visible vertical
primary destinations and full-width person rows. Retain collapsed navigation,
mobile destinations, search/focus recovery, account scope and existing routes.
Native hosted material remains scoped; no backend or authentication change.

## Grounding and decision

The current sidebar reserves 110px above a compact horizontal icon toolbar and
uses two person columns inside 248px. Restarting did not alter that design.
Choose labeled vertical destinations over a compact toolbar with clearer
spacing: the user's complaint concerns recognition and reading, not decoration.
The compact toolbar is retained as the native-hosted presentation and as the
comparison baseline. Project neutral tokens and Phosphor icons remain canonical.
Apply design-talent-signal and UI/UX navigation/focus guidance; marketing-page
hero, palette and narrative rules do not apply to this workspace.

## Ownership and concurrent work

- Parent owns sidebar source, evidence, commits and resident Web activation.
- Pi task 20261011-165355-7c8e7081 owns concurrent GET-141 authentication work;
  no second Pi writer is started. Use an isolated source checkout from main
  71c86a917e67b86c2ed631104468f31e741944c7.
- Independent reviewer will assess correctness and scope after implementation.
- Do not interact with another task's browser account. Owned capir run:
  846d26db-13ab-49ee-9735-7f85cd7ed6f2; create request:
  ed611212-33c5-4df1-9c29-96c53371f083. It is a daily synthetic staging workspace.
  Credentials stay in /private/tmp/ai-test-sidebar-refinement-20261011.isjmiK
  and the existing OS keyring. Stop/readback before completion.

## Milestones

1. Active: settle bounded navigation composition and meaningful state coverage.
2. Pending: implementation, focused host tests, typecheck/lint and build.
3. Pending: rendered desktop/collapsed/mobile, dark, keyboard and recovery checks.
4. Pending: independent review and clean committed release deployment.
5. Pending: final live proof, run cleanup and release-cache lifecycle audit.

## Completion evidence

Navigation labels visible on expanded Web desktop; narrow dock stays reachable;
ordinary person names fit a full row; no unintended overflow. Search opens and
returns focus, active destinations persist across collapse/reload, footer and
account menu remain reachable in short windows. Render from real production
entry with the authenticated backend; passing static tests alone is insufficient.
Prepare a clean detached production release, activate using the resident
installer, then verify live revision, HTTPS auth readiness and protected workspace.
Preserve current and rollback releases. Do not modify live dependencies.
