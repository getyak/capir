# Project health audit and repair — completed

## Outcome and boundary

Audit the tracked capri repository for correctness, safety, redundancy,
architecture, structure and documentation problems, then repair confirmed
findings in sequential batches. Codex owns independent review, acceptance,
PR delivery and merge. The initial nine accepted batches used Pi; the user's
later instruction required native Codex agents for all remaining work, which
used no further Pi/MiMo runs.

The runtime audit and repair are complete at merged revision
`f18eafb232d1da5781ca0632672c2590703bea89`. This archive and the operational
bootstrap guidance are the final documentation closeout. An audit cannot prove
that software has no unknown defects. The checked scenarios, remaining upstream
advisories and coverage limits are explicit in
[the archived audit register](project-health-audit-2026-10-12.md).

## Baseline and isolation

- Frozen baseline: `e751b37a8692a33387b7325004d7532face32021` (`origin/main`).
- Initial audit inventory: 2,882 tracked files across applications, shared
  packages, scripts, native source, documentation, research and plans. Inventory
  and static coverage do not mean every line received manual review.
- Implementation used the managed `project-health-oct12` worktree and isolated,
  explicitly owned batch worktrees. Unrelated source-checkout browser output,
  evaluations and local plans were preserved.
- No applied SQL migration or execution-manifest identity was changed. No real
  personal conversations, screenshots or customer database records were audit
  inputs. No local native simulator was started or native source changed.

## Completed milestones

1. Inventory, risky-entry traces and synthetic reproduction separated confirmed
   defects, maintainability debt, historical evidence and rejected suspicions.
2. Nine sequential implementation batches and the subsequent native Codex
   integration/build repairs passed source-bound independent review. No
   confirmed P0/P1 finding remains open in the reviewed scope.
3. PRs325–331 merged after their current-head applicable checks and repository
   gates. The final runtime revision's postmerge CI and Security workflows
   succeeded on attempt1, including remote iOS smoke; 16 checks succeeded and
   seven applicable scope/release checks skipped.
4. A complete clean-source image passed the 990-entry policy, streaming cache
   verification and required Linux-arm64 native execution. API, Agent Host,
   Web and browser executor all deployed and read back at `f18eafb2`.
5. Root independently read back the resident sources and live surface, then
   verified one expiring daily test workspace (12 contacts, 30 observations,
   four tasks), changed negative paths and test-account deletion. The credential
   projection and owned browser runner were removed. Completed plans move to
   this archive; reusable bootstrap prevention stays in the existing operations
   guide.

## Evidence and limits

Sanitized formal receipts are retained under
`~/.codex/task-artifacts/project-health-2026-10-12/`, including the reviewed
source ledger, merged PR readbacks, postmerge checks, full-image and resident
receipts, `live-resident-independent-readback.json`,
`live-final-acceptance.json` and `final-workspace-entry.png`. Rebuildable temporary
output is registered separately for precise cleanup after proof preservation.

The screenshot establishes test-entry banner, dataset counts and main chat
rendering; it does not establish every sidebar's settled state. Screenshot-route
requests establish the disabled-AI/no-action path and account rate budget, not
successful model image processing. The final root probes sent no images and
made no live model calls. Resident deployment's authorized synthetic Agent
health checks are separately recorded in its receipt.

The braces High development advisory has no released upstream fix; a reviewed
bounded local patch mitigates the checked path. The glib0.18.5 advisory remains
open for its target-gated graph. ARM64 macOS graph inspection succeeded;
Intel/Linux offline attempts lacked cache and are not passing evidence. Full
production npm audit is clean, but these facts do not dismiss the two GitHub
advisories. A timed-out disposable BuildKit export retains an orphan history
record because the installed API cannot cancel its solver by ref; the host
client is absent and bounded load checks found no continuing heavy load. No
shared daemon restart or history deletion was used to claim cancellation.
