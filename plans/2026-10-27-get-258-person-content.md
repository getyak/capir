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
2. Complete: synced main, independent review, focus fix and re-review; 136 tests passed.
3. Complete: PR #462 passed its latest-head gates and merged as `dfb7dbe`.
4. Complete: clean-source resident Web deployed; actual isolated-account
   desktop/mobile, localization, context navigation, profile provenance, avatar
   focus, restart recovery and test cleanup verified. Merged-main CI and Security
   passed. The reference was found in capir-evals and inspected.
5. Active: repair the automatic downstream iOS release DNS failure, independently
   review the repair, follow its checks and release to completion, then record
   Linear Done and resource handoff.

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

## Delivery deviation: downstream release DNS

The dated pre-review notes above describe the initial state. Final Web evidence
is in the GET-258 directory under this chat's permanent visualization artifacts.
The isolated run is now deleted and its local credential was removed.

After the merged-main CI passed, automatic Release iOS run `40528257635` failed
twice in `Compute release version`: `git fetch` could not resolve `github.com`.
Earlier release `40505045946` failed at the same boundary. The private backend
probe succeeded immediately before each failure. The pinned Tailscale Action
sets macOS Ethernet DNS to `100.100.100.100` and resets it to DHCP only in its
post-action hook. The repair moves that exact DNS reset to immediately after
private API verification, before public GitHub, RubyGems and Apple traffic.
It does not change tailnet policy, TLS, backend authorization or signing.

The policy regression first fails on the missing restoration step. Independent
review and actual downstream success remain required. Linear stays In Progress.
