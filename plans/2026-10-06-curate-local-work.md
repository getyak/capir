# Curate valuable local work after remote sync

## Outcome and boundary

Publish a reviewed branch containing the existing local Figma and Notion
maintenance guidance, current design direction, and consistent composer person
avatars, based on origin/main at 4e0840fd. The owner approved this curation and
submission after a read-only comparison. The primary checkout and its local
files remain owned by the parent chat.

The committed main tree already matches origin/main; the four additional local
commits add no unique file contents. Do not replay those commits.

## File ownership

This worktree owns only the selected two Skill amendments, design-system
amendments, composer add menu, its layout stylesheet and focused regression coverage, and this
plan. Preserve upstream processing-status, document intake, menu focus and
anchoring behavior. No account, Person, Memory, or external business effect
changes are authorized by this curation.

## Selection and archive disposition

- Retain the existing Figma maintenance and owner-controlled Notion guidance.
- Retain the current onboarding, contact-header, and sidebar design direction;
  distinguish design proposals from shipped behavior and use ADR 0022 for
  browser-owned Mac login instead of superseded ADR 0019.
- Retain shared composer avatars if focused checks establish preference parity.
- Exclude the appended People CSS: upstream already owns avatar positioning and
  the appended rules override its narrow-screen positioning.
- Exclude the broad test/* ignore rule and the duplicate local Opik ADR 0013.
  ADR 0015 and the phase-one playbook own the current Opik boundary.
- Leave old CLI drafts, dated plans, research, and design assets recoverable in
  the primary checkout. They remain historical/proposed material; this PR does
  not claim to migrate or validate that entire corpus.
- Leave docs/evaluations and scripts/evals out of the product branch. The
  private-repository mapping in evals/README.md owns their destination. Private
  destination byte comparison and migration are separate work.

## Milestones and verification

- [x] Verify clean upstream baseline and dependency setup.
- [x] Apply only the selected guidance and corrected design authority.
- [x] Preserve real person-avatar preferences through the rewritten menu;
      verify focused menu and avatar cases, lint, and typecheck.
- [x] Run pnpm docs:check and review the complete diff against REVIEW.md.
- [x] Commit, push the isolated branch, create a PR, and read back
      the remote revision. Confirm no primary files were changed by this chat.

## Evidence and limits

The Notion correction and Figma preservation guidance correspond to existing
owner corrections recorded in the local September 26, September 30, and
October 3 design plans. This chat does not repeat those external writes or
claim fresh Figma/Notion runtime acceptance. Subagents are prohibited in this
side conversation; review stays inline. The final report must distinguish
source checks and rendered fixture evidence from deployed-product acceptance.

Baseline: 30 menu/avatar cases passed, and docs/wiki/architecture checks passed.
The new avatar-preference parity case failed against upstream as expected
(no person avatar), before the existing local component integration was applied.

Browser fixture verification uses the actual menu/avatar components and product
styles with an explicitly synthetic directory; it performs no account writes.
It reproduced horizontal overflow (372px scroll width in a 286px client area),
which clipped avatars. The group now admits shrinkage and uses one minmax(0,1fr)
track. The same geometry check is the RED/GREEN proof; screenshot and structured
results remain in ignored output/curation-visual. This is rendered fixture
acceptance, not authenticated-product or release acceptance.

Inline review found no identity, evidence-authority or external-effect changes.
Person display preferences stay scoped to the existing provider and do not bind
identity. Existing source amendments were retained without another Figma/Notion
write; fresh subagent behavior testing is outside this side chat's permission.

Verified before submission: 31 focused menu/avatar tests; touched-file ESLint;
Web typecheck including the real workspace package builds; docs, wiki and
architecture gates. Four real-Chrome synthetic fixture combinations (1280px
and 360px, light and dark, reduced motion) passed with 36px avatars, 51px person
rows, zero horizontal overflow, unchanged preference resolution, and Escape
returning focus to the trigger from the explicitly focused menu. Screenshots
were inspected. The baseline full product suite and authenticated AI flows were
not rerun for this presentation/documentation curation.

Primary selected source hashes still match the captured pre-curation snapshot.
The isolated branch, not the primary checkout, owns all edits in this PR.

Submission: https://github.com/getyak/capir/pull/297 on branch
`codex/curate-local-work-20261006`. Source commit: `8b6d9956`.
Remote main was rechecked at `4e0840fd` before submission.
