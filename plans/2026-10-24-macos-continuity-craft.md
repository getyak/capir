# macOS continuity and language craft — round two

## Outcome and boundary

Continue the user-authorized macOS craft iteration after merged PR #411. The
latest main baseline is `43acf4ea242b70f21d45701f357c56a0b72b7629`. Make the
ordinary desktop conversation easier to navigate and recover, with consistent
interface language and stable keyboard/focus ownership. Preserve the quiet
Notion/Linear-informed capri design, existing source/decision boundaries and
account isolation. Scope will be settled against independent audit evidence.
No iOS changes or simulators, business-data inspection, external messaging or
new services. The user's prior task-specific pause override continues; leave
the global marker and unrelated processes untouched.

## Existing state

PR #411 is read back merged at the baseline. Resident Web runs that clean
revision and the installed native app is 0.2.24 (182). The primary checkout has
unrelated untracked files and stays untouched. New isolated worktree:
`/Users/cubxxw/.codex/worktrees/macos-detail-round-two/talent-signal`, branch
`codex/macos-detail-round-two-20261024`.
Initial resources: 32.71 GiB free, 11.53 GiB swap, 238 Node/npm processes.
Implementation and builds remain serial. No new dev server or device is owned.

## Milestones

State below is the implementation record at PR creation. The permanent report
directory owns subsequent merge, resident runtime, signed-release and cleanup
receipts; a pre-merge plan alone does not establish delivery.

1. **Done:** independent Web/native audits and actual baseline captures identified
   the accepted slice below.
2. **Done:** Pi/MiMo Pro implemented the Web checkpoint on the frozen baseline.
   Codex preserved the patch and tests, stopped the batch at its review checkpoint
   and owns integration and targeted independent-review repairs. No provider or
   billing fallback was used; the cancelled runner is not a verification receipt.
3. **Done:** local checks and independent review closed all discovered P2
   races with no unresolved P0/P1/P2. Native actual-surface proof passed; the
   changed hosted Web behavior awaits deployment in milestone 4.
4. **Active:** create PR, pass current-head gates, merge and deploy every affected existing
   resident service from clean committed source. Verify live revision and changed
   behavior. Native changes require their own signed release acceptance.
5. Preserve formal evidence, revoke owned test run, and clean owned resources.

## Verification and evidence

Independent read-only audits own Web craft and native boundaries separately.
Codex owns external state and final synthesis. Reuse existing clean dependency
artifacts only after lock equality. Formal evidence:
`/Users/cubxxw/ops/reports/macos-detail-round-two-20261024/`.
Registered temporary artifact:
`/private/tmp/ai-test-macos-craft-round-two.Y5FDhL`.
No source or unique evidence is disposable before preservation and acceptance.
MacOS 27 hardware, full VoiceOver and real IME hardware acceptance remain
unverified unless directly observed in this round.

## Accepted slice and current proof

- Pi batch `20261024-002656-caed929d`, frozen baseline above, owns bounded Web
  navigation/recent-session/queue presentation translations, explicit canonical
  readback refresh feedback, and queue-editor focus restoration. New labels use
  all five catalogs. Stored content and protocol owners stay unchanged.
- Codex owns native Settings search Return/focus and endpoint-bound asynchronous
  diagnostics. A separate native agent reviews this diff before build.
- Actual baseline: `⌘F → 软件更新 → Return` stays in the old search overlay.
  Actual paused synthetic queue: keyboard Cancel drops focus to HTML content.
  Both AX and matching full-window captures are saved in the formal directory.
- The possible cancelled-navigation spinner requires an actual redirect/cancel
  reproduction before changing the WebKit lifecycle. It is a recorded follow-up,
  not a completed fix or a new regression claim.
- Owned CLI test run `54ecf747-e491-422c-969e-943844540dd4`, request
  `a7852627-3ebf-4522-910c-1b238de49d3e`; ready dataset 12/30/4. Browser runner
  PID 89087, browser child 89088. Only synthetic UI messages have been sent;
  its queue was paused for editing proof, then resumed for readback-failure proof; the run must be revoked at closure.
- A prior tool-opened blank Chrome-for-Testing instance PID 85092 was selected
  instead of the isolated browser. Its sole blank window was verified; normal
  app-menu Quit closed it, and the task browser was then bound correctly. No
  unrelated browser process was signalled. CUA native-pipe reset was needed once.

The real DevTools surface also showed document/body `lang=en` overridden by a
hardcoded `lang=zh-CN` on WorkspaceShellFrame. Codex owns the one-line binding
to the existing useLocale context; actual after-deploy DOM readback will verify
this rather than adding a test that merely mirrors an attribute assignment.

## Native verification and resource checkpoint

Native Settings search and endpoint-bound probe implementation passed 44 focused
macOS tests with source/test byte parity and independent review (no actionable
P0/P1/P2). An isolated bundle verified Return activation, rail focus/arrow
navigation, close/reopen, successful A probe and removal of A results after
switching to B. The installed client connection was not changed. Preview PID
93941 exited through normal app-menu Quit.

The canonical reply readback failure was reproduced in the isolated synthetic
browser using DevTools request conditions on the exact test-session detail URL.
Two explicit Refresh clicks had no visible pending/failure feedback. Blocking
was disabled and DevTools closed; stored replies returned through normal readback.

Resource pressure later fell below the 30 GiB build floor (20.89 GiB free,
22.14 GiB swap at the low-water checkpoint). New builds are paused. Safe build
cache dry-run found zero eligible entries; artifact completion/reference checks
continue without disturbing other active iOS/Pi tasks. Pi was steered once on
the same frozen task after a read-only inventory phase; it has begun source edits.

## Integration checkpoint

The Pi checkpoint contains ten tracked Web files and two mounted behavioral
suites. Parent render acceptance found and repaired a missing `useT` binding
in the rail (a render crash), then extended the existing language boundary to
the adjacent Session row menu/tray so recent-conversation controls do not remain
Chinese in English display mode. Four fully extracted file entries are removed
from the ratchet; no threshold increased. Stored titles, person initials,
Session identity and protocol/action owners stay unchanged.

Parent checks: 26 tests in four files passed, including a deliberately delayed
JSON body across account A→B→A and a newer canonical readback. Independent review
identified exact-operation fencing gaps in explicit Refresh and queue Save,
and a blank-area focus-stealing edge. A dedicated worker owns only the queue
component and its two new suites to repair these and add mounted regressions.

Owned synthetic run `54ecf747-e491-422c-969e-943844540dd4` is verified deleted;
its credential was removed and runner/browser 89087/89088 exited. Native result
bundle and all baseline/UI proof are preserved in the formal report directory.

Three obsolete Web deployment revisions (ranks 6–8 by commit date) had clean
source, matching build receipts and no process, launchd, open-file or dependent
worktree-link references. Only their generated dependency/build outputs were
removed, with source worktrees, current/latest five releases and the known
backend rollback retained. Logical removed allocation was 3,744,604 KiB; APFS
shared blocks and concurrent disk changes are not claimed as reclaimed bytes.
The latest dependency-preparation checkpoint remains below the 30 GiB build floor.

Final local integration: 137 focused Web tests passed with zero failures;
whole-Web type checking passed. Native source and tests remain byte-identical
to the 44-test isolated native acceptance. Independent final static review
closed the actual-ID A→B→A editor resurrection regression as well as the three
earlier operation/focus findings. No P0/P1/P2 remains in the reviewed diff.
