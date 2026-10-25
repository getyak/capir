# Sidebar footer hover restoration

## Outcome and boundary

Restore the quiet, coordinated Connect apps / download capsule transition the
user preferred. The footer stays anchored; the focused utility borrows space
from its neighbor. Preserve explicit activation, truthful host update state,
keyboard focus recovery, Escape tooltip dismissal, and reduced motion.

This changes shared Web/macOS Web content only. No native package, account data,
update authority, or unrelated conversation styling is in scope.

## Evidence and approach

- User supplied the installed capri screenshot with a fixed rectangular `51%`
  update entry and requested the previous elegant hover expansion.
- Commit `58a3cf05` (PR #390) replaced the previous reciprocal 220ms capsule
  widths with fixed 76px update geometry. Its focus and update-state fixes must
  stay intact.
- Use a 44px resting circle and a bounded capsule on hover or keyboard focus;
  Connect apps yields space without moving the account or footer endpoints.
  Real progress remains visible at rest. Touch does not depend on hover.
- The source checkout has unrelated untracked work; implementation uses a
  managed worktree from `88c5f572` (`origin/main` when inspected).

## Milestones

1. Complete: restored presentation in the shared footer stylesheet and
   documented the interaction in its component comment. Added the existing host
   progress value as a presentation attribute so unknown download progress can
   retain its text label. No update behavior or authority changed.
2. Complete: verified rest / hover / focus / progress / failed / collapsed /
   coarse-touch / dark / reduced-motion states with the actual footer component
   and source stylesheet in a synthetic host fixture. Focused tests pass 24/24;
   changed-file ESLint and documentation checks pass.
3. In progress: independent review passed; commit and deploy resident Web from clean source;
   read back its revision and inspect the changed interaction.

## Current constraint

`/Users/cubxxw/.agent-pause` exists, owned by `current-chat-sre`, with
`reason=disk_below_40_GiB`. The current read-only resource sample reports
49.24 GiB disk free, 147 Node/npm processes and 9.12 GiB swap. The standing
instruction forbids new builds and delegation while the marker exists. A
task-specific exception was explicitly approved in this chat for necessary
verification, one Web production build and deployment. Preserve the global
marker. Serialize resource-heavy work and retain all unrelated active work.

## Completion evidence

`git diff --check` passes. Focused footer/account tests pass 24/24. The initial
test attempt could not import the unbuilt contracts package; building that
workspace dependency resolved setup, after which the complete selected suite
passed. Documentation/architecture checks and changed-file ESLint pass.

Sixteen rendered fixture observations and matching 1280x720 screenshots are
retained under `/Users/cubxxw/ops/runs/sidebar-footer-morph-20261025/`.
The default 248px sidebar entry expands 44px to 123px; its right edge stays at
235px. At minimum 200px it expands 44px to 75px, with its right edge fixed at
187px. Independent review identified a 1px border-budget discrepancy; the
corrected formula accounts for both sidebar padding and border. A separate
observed tooltip overflow at minimum width was fixed (x=-33px to x=11px).
Keyboard Tab expands, Escape hides the tooltip, progress stays visible at rest
and in the collapsed rail, and failed retry remains visible. Unknown progress
and installing use text, not an invented percentage. Coarse-touch emulation
retains a visible label. Normal motion uses 220ms and reduced motion 0ms. Both
themes were inspected; fixture console has no warnings/errors.

The independent reviewer closed the geometry concern and reviewed the final
tooltip delta with no unresolved findings. These fixtures are presentation
evidence; they do not prove a host update occurred. Production build, current-head
CI and live Web/native surface readback remain pending.

Record exact source revision, relevant checks, rendered geometry and interaction
results, live Web revision/build ID, and remaining coverage gaps. Source edits
alone do not establish visual acceptance or deployed behavior.

## Resource ownership

This task owns its managed worktree and registered test artifact
`/private/tmp/ai-test-sidebar-footer-morph-20261025.d6IlYU`. Frozen dependencies
are being prepared in the task worktree. No service, browser tab or simulator has
been started yet. Retain the worktree until delivery and acceptance finish.
