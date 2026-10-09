# macOS material and fluid navigation

> Status 2026-10-09: merged into `main` after a semantic integration with the
> settled GET-129 compact rail. The local spring rail and floating edge reveal
> in this plan were superseded by that rail and are not shipped; the material
> surface, local session organization, reading fold, row motion and completion
> seam remain. See
> [`docs/evaluations/2026-10-09-local-code-deep-analysis/`](../docs/evaluations/2026-10-09-local-code-deep-analysis/README.md).

Outcome: the shipping SwiftUI/WKWebView workspace uses native AppKit material,
quiet grayscale chrome, reversible local session organization, scoped reading
gestures, and motion that explains position changes.

Boundary: presentation and device-local organization only. No backend mutation,
Agent execution, evidence deletion, extra model call, permission bridge, external
publication, or change to `apps/macos-hybrid`.

## Working state

- Branch: `codex/macos-material-motion`; base:
  `6c061b076244d411ae7cc80af7aa5fbbc7a55e05`.
- Parent owns final implementation, review, and verification. The bounded Pi
  implementation (`20261001-162643-d8bb5c9a`, MiMo Pro) was cancelled at a
  checkpoint; its Web diff was integrated and independently corrected. Its
  isolated worktree and session evidence remain available.
- Preserve unrelated `docs/evaluations/2026-09-29-figma-audit/` and `plans/local/`.
- Development-only synthetic preview: `/dev/material-motion`. It uses production
  components and never connects an account or invokes a backend write. Its
  selection/insertion/completion controls are explicitly synthetic.

## Requirements and evidence

| Requirement | Final implementation | Observable evidence |
| --- | --- | --- |
| Native sidebar/popover material | `WorkspaceMaterialSurface.swift` puts `.sidebar` / `.behindWindow` / `.followsWindowActiveState` beneath WebKit; native-only transparent chrome, tinted popovers, opaque ordinary canvas | Helper and exact production `WorkspaceWebSurface` compile with Swift 6; native synthetic AppKit/WKWebView window opens and its search dialog receives focus |
| Material/shadow hierarchy and modal recession | Borderless normal popovers, shadow elevation, grayscale chrome; native canvas reveals its backing while a popup opens | Browser modal: background matrix scale `0.99`; dialog transform `none`, width `560px`; accessible tree contains only modal controls |
| Short completion/confirmation glow | Per-conversation bounded registry observes an actual active message; persisted `informational`/review/proposed-with-decision statuses claim one sweep per message | Producer-shaped answer tests, history/reconnect, multi-block, scope isolation and Strict Mode one-shot tests; synthetic completion control exercises the same renderer |
| Safari-style history gesture | Existing `allowsBackForwardNavigationGestures = true` retained; no global wheel handler | Native property/source audit; synthetic route history navigation restores selection. Physical Safari trackpad gesture remains unverified |
| Left swipe Archive/Pin | Horizontal wheel and pointer handling; spring release; hidden tray inert; named menu, Escape and outside dismissal | Browser horizontal input reveals both actions, Archive removes the row, local archive restores it, Pin moves it first and persists after reload. Hardware-native gesture remains unverified |
| Pinch long reply and spread | Scoped WebKit gesture / ctrl-wheel paths; extractive preview, full text retained, explicit accessible toggle | Browser ctrl-wheel unfolds a collapsed answer; deterministic pinch/selection/code/table/short/streaming tests. Physical WebKit pinch remains unverified |
| Moving highlight and sidebar spring | Scoped shared `layoutId`; fixed symbol geometry; transient edge hover uses width plus offset springs | Five main icons keep x `18px` and identical y positions at widths `236px`/`56px`; floating rail returns to `236px` while content remains at x `56px`; highlight observed between old/new positions |
| New row insertion | Position layout springs and one-time arrivals; first successful asynchronous history and pagination stay static | Synthetic row enters at the top and siblings move below it; asynchronous baseline, new-row and reduced-motion tests |

## State and safety decisions

- Archive and Pin store only bounded session IDs, flags, and change timestamps
  under the existing 64-hex account/user storage partition. They never store
  conversation text or titles, stop a run, delete a Session, or sync devices.
  Their local scope is visible in the menu and archive. Failed storage retains
  a truthful page-only notice; successful retry clears that notice.
- Partial directory pages never prune organization. Pinned rows returned in the
  existing authorized directory are organized before the eight-row recent cap.
  Unknown/unavailable records are never recreated from flags. Validated
  deleted/expired detail retracts that Session's flags; sign-out and the unbound
  session boundary clear organization.
- Existing `workspaceSessionFetch` already revalidates the directory after a
  successful Session create/admission mutation. No second invalidation or extra
  read API was added.
- Folding applies only to completed answer text, never pending decision or
  proposal blocks. Streaming, selected text, code and tables retain their own
  interaction. Code-only responses cannot collapse into an empty preview.
- Native document transparency has no public macOS setter in the installed
  WebKit API. One isolated, guarded `_setDrawsBackground:` KVC path disables it;
  if absent WebKit stays opaque. Public `underPageBackgroundColor` covers
  overscroll only. No native page capability was introduced.
- Origin policy, Settings paint guard, trusted update-click isolation and
  per-origin website storage are preserved. The native Xcode project was
  regenerated from its existing `project.yml` source globs.

## Verification

- Focused Vitest: 18 files / 128 tests passed. After the final rail-preference
  correction, its sidebar/highlight/row regression passed: 3 files / 18 tests.
- All 34 changed Web TypeScript files passed ESLint; the final rail preference
  edit passed a separate ESLint check. Web typecheck and `pnpm docs:check` passed.
- Independent parent review corrected tray exposure, highlight stacking,
  preference/reveal transitions, gesture cancellation, history arrivals,
  scope/reload/deletion behavior, and one-shot completion rendering. Narrow
  deterministic regressions cover these corrections.
- Formal screenshots, logs and synthetic native probe source are saved at
  `/Users/cubxxw/.codex/visualizations/2026/10/01/01a0f68e-787e-78d0-8922-23ae945f9919/macos-material-motion/`.

Evidence is synthetic and must not be represented as an authenticated account
or production release test.

Browser observations: 390px viewport has scrollWidth 390px and four navigation
items with 44px height. The modal returns focus to Search; Archive is reversible;
Pin survives reload; exact full answer returns after expansion. A final clean reload
and subsequent folding/menu/search actions reported no warnings or errors.
Temporary browser viewport and reduced-motion overrides were reset; closing
the modal returned focus to Search.

Native observations: the isolated native preview uses the actual new material
class and transparent backing, preserving native control/accessibility routing.
The OS reports both reduce transparency and reduce motion enabled, so native
rendering correctly uses the solid/static fallback. No OS preference was changed.

Limits: full macOS application build/XCTest and production Next build are not run.
The storage guard reports 62 GiB available, below the 80 GiB heavy-build gate.
Native physical trackpad history, row swipe, pinch, and desktop-color vibrancy
with reduce transparency disabled remain unverified. No iOS simulator was
started. Only this task's registered temporary artifact may be removed after its
formal evidence is preserved; other tasks' artifacts/worktrees are untouched.
