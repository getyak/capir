# GET-258: content-first Person page

## Outcome and scope

A Person page leads with the person and real saved content. A genuinely empty
page has one short localized sentence and an existing actionable entry.
Relationship context and basic information appear only with content; avatar
editing remains discoverable without a camera overlay. No identity, evidence,
review, privacy, loading, editing, draft or recovery authority changes.

## Evidence and approach

- Baseline: remote main `110302ddc8e6ae81a3f91d7f4a1970d3a5ec3831`.
- Actual route: `apps/web/app/workspace/people/[id]/page.tsx`, using the client
  `PersonMemoryContent` and shared `AvatarEditor`.
- Current empty page stacks context help, memory heading/count/modes, an empty
  explanation and an empty reference column. The avatar is already compact.
- Keep populated context links, provenance and existing memory controls. Hide
  only successfully empty sections. Preserve pagination, error and orphan drafts.
- Existing `/workspace` opens the ordinary new conversation; exact person/context
  links open the governed relationship workspace. Never invent a context.

## Milestones

1. Complete: focused render/interaction/locale regressions and minimal UI change.
2. Active: sync current main and independently review committed changes; resolve confirmed P0/P1 findings.
3. One main PR, latest-head CI/protection readback and normal merge.
4. Clean-source resident Web deployment and real default-account acceptance;
   only then Linear Done readback and ownership/resource handoff.

## Verification

Cover empty/populated/name-only/profile-only/contextless pages; localization;
pending review; retained provenance and contact masking; incomplete pagination,
failed reads and draft recovery. Run focused Web tests, lint/typecheck/build and
docs checks, plus rendered desktop/mobile light/dark and keyboard checks.
Record runtime and visual evidence separately from fixture tests. Keep any
deployment or account-access blockers explicit and leave Linear In Progress.

## Verification before independent review

- Nine affected Web test files: 135 tests passed. New empty-state checks first
  failed against the unchanged UI. A missing timestamp in a new test context
  fixture was corrected after typecheck identified it.
- Web typecheck, lint, docs/Wiki and architecture gates passed on the initial
  base. Current main advanced to `e79aee2`; repeat affected checks after syncing.
- Existing default-account CLI grant was renewed without new authorization.
  Daily isolated run `d18b01f0-ce8c-4377-80fa-a6dc2f3b14df` is ready (12 contacts,
  30 observations, 4 tasks). Automatic browser launch failed because the installed
  CLI requests a missing Chromium binary; preserve/reuse this same run.
- The named quiet-pages 04-person reference was not found in repository files
  or local visualization filenames. Reference fidelity remains unverified;
  rendered-product acceptance is still required.
- Runtime build/deployment, independent review, PR, CI and Linear Done remain
  outstanding. No Simulator or product model request has been started.
