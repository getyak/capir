# Quiet Web conversation craft

Outcome: Make the desktop Web conversation calm, precise and responsive; fix the add control and expose local file intake and real capabilities progressively.

Boundary: Web runtime and conversation surfaces only. Preserve unrelated dirty main-checkout work. Baseline origin/main ee202e84. No native build, no connector authorization, no external messages, no invented skill execution. Document reading is transient Web parsing into user-reviewed draft, not source/fact confirmation. Existing image delivery remains unchanged.

Evidence: Current add menu immediately loads People, hardcodes panel IDs and anchors an absolute popup without viewport avoidance. Resident Web afee6075; remote main ee202e84 includes dependency updates. Existing Figma file 7Z8yHplvwjVhpq8IuKv87f is reachable via cloud metadata, but further inspection hit Starter MCP quota; desktop Figwright was initially disconnected, then recovered by opening the already-installed plugin. Current Figma design references were read via get_design_context and rendered: 31:135 and its 404:2355 composer. Existing audit remains historical.

Approach: Compact add menu with secondary People/capabilities views; portal positioning, immediate press feedback, restrained interruptible motion, strong keyboard and reduced-motion behavior. Any file may be selected; PNG/JPEG/WebP remain inline. PDF/DOCX/UTF-8 text can be read transiently into an explicit preview and a bounded editable message excerpt. Unsupported formats receive an honest error and never reach a model. Actual connected-tool management uses existing Extensions.

Alternative A: floating attachment/tools menu with one-step upload, deeper People lookup. Alternative B: persistent utility strip with file/person/tools buttons; reject because it competes with draft and creates always-on chrome. Compare rendered directions before final polish.

Milestones:
1. Implement the shared menu, file preview and conversation visual rhythm (complete).
2. Independent source review and focused checks complete; actual browser acceptance pending.
3. Clean-source resident Web deployment and live acceptance in progress.

Done evidence: passing focused checks, before/after browser evidence, responsive menu bounds and keyboard recovery, document preview/cancel/error preserving draft, image flow unchanged, clean-source deployment receipt and authenticated live behavior. Cloud Figma quota was exhausted; the existing desktop Figwright plugin recovered design inspection and editable design work.

## Design evidence

Pi implementation: `20261006-021908-6bcc610e`, frozen provider/model `xiaomi-token-plan-cn/mimo-v2.6-pro`, base ee202e84. Isolated Web implementation, no external write authority.

Figma: [editable comparison section](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=778-4981). A 778:4982 and B 778:5292 reuse the existing editable screen hierarchy and bound variables. A menu 778:5758 has actual auto-layout rows, 15/21 px primary typography, 12/17 px secondary, restrained surface and 16 px radius. The inherited shell is a design reference, not a claim that every depicted runtime feature is newly implemented. A/B were rendered and A selected for attention economy. Shared composer reference: 880 px reading axis, 62 px height, 44 px targets, 16 px radius. Runtime adaptation preserves host tokens and supported actions.

Observed resident baseline in isolated run 8e577a4c-2f4a-4f8d-bf83-c1d5ff140a94: default add opens 8 People results and a long note; autofocus scrolls the list so the file action can become invisible. Desktop and narrow baseline observed through CUA. No real relationship data was read.

## Design reasoning and reference boundary

The chosen direction gives typing and reading one shared axis. Utility actions are disclosed through a single add target; document preview, failures and consequential decisions stay explicit. The control feels responsive through immediate press feedback, short reversible surface transitions and a stable focus return. Shadows establish one popover layer; typography and spacing provide hierarchy before extra color or ornament.

Apple Design skill informed direct manipulation, interruptible motion and accessibility. The [Apple menu guidance](https://developer.apple.com/design/human-interface-guidelines/menus) is a primary reference. [Claude file-upload documentation](https://support.claude.com/en/articles/8241126-upload-files-to-claude) demonstrates the familiar plus → file selection interaction; its capabilities and limits are not inherited by this product. Talent Signal keeps bounded, truthful intake and explicit editable review.

Rendered A/B and baseline images are saved in ignored `output/evaluation/2026-10-06-web-quiet-composer/`; they are dated evidence, not canonical product truth. This plan owns active delivery status only.

## Implementation review checkpoint

Codex owns the shared server DOCX preflight (`bounded-docx*` and the `documentExtraction.ts` call) outside Pi's component/preview-route ownership. The new file picker exposed a compressed-byte-only limit; extraction now preflights actual ZIP32 expansion with asynchronous, output-limited Node zlib before Mammoth. It rejects unsupported encrypted, split, shifted and ZIP64 layouts rather than guessing. Seven focused archive/parser tests pass, including lying size metadata and the existing malformed-field recovery fixture. Node runtime is v22.23.2; `maxOutputLength` is documented since v12.19/v14.5 and verified against the installed runtime.

Knowledge routing: Existing Product and Design System already own truthful authority and progressive disclosure. The new file-intake mechanics are executable behavior: local decoding, transient parsing, explicit staging, send bounds and stale/cancel recovery belong in code and focused counterexample tests. A proposed extra canonical paragraph duplicated that foundation and exceeded its context budget, so it was removed. Dated Figma/runtime observations remain ignored evaluation evidence; no always-on guidance or unrelated articles were added.

Pi attempt was intentionally stopped at turn 79 to supply the independent corrections before further implementation: truthful server-upload copy, imported-text send limit, SSR-safe portal theming, context invalidation, viewport clamping and focus restoration. Preserved work resumed in the same frozen task with repair count 1; no budget/model/provider expansion.

## Independent review and verification

Independent reviewer `ui_interaction_review` confirmed closure of picker context invalidation (P1), IME key ownership, modal-safe undo insertion and delayed autofocus after unmount (P2). No remaining P0/P1 in the reviewed slice. The delayed insertion revalidates the committed draft, binding, availability and send cap, and requires a still-mounted textarea. Regression tests cover picker binding/disabled/readOnly changes, composing menu keys and unmount before close autofocus. Press feedback keeps the add button hit area stationary.

Combined focused tests passed 113 cases before the final unmount guard regression; subsequent menu/file subset passed 44. Web typecheck passed; full app lint has only six pre-existing warnings, and touched-file lint is being rechecked after the final effect refinement. Docs and architecture checks passed. A full Web run passed 1802 cases but hit three 5-second timeouts in unchanged legacy new-conversation cases under parallel load; the affected two test files then passed all 30 cases with two workers and unchanged assertions. This is recorded as resource-sensitive validation, not an all-green full-suite claim.

The original synthetic daily run expired and was read back as deleted. A new explicitly named empty run `2c452623-b9a3-4b2c-ac9d-301cb62bcbe8` is ready and verified with zero synthetic records. A daily provisioning attempt returned a known service failure; no run identifier was issued. Production fixture credentials were not valid; do not seed or alter the shared database to obtain access. Authenticated browser acceptance remains pending while checking the isolated account login.
