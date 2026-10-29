# GET-316 Conversation menus and continuity

## Outcome and boundary

Make conversations easy to recognize, organize, copy, share and return to on
the Web workspace embedded by the macOS client. One Linear issue and one PR;
each independently useful improvement is its own commit. Source: a user-supplied
94-second screen recording, interpreted from visible captions (no audio track).
Raw frames and caption OCR remain in a task-owned local artifact, never Git.

Preserve account isolation, drafts, execution provenance and deletion behavior.
Archive/pin remain reversible local preferences. Rename updates the canonical
Session using the existing revision-checked mutation. Sharing exports only the
authenticated conversation URL and never creates public access. Copy includes
sent text and completed answer prose, excluding raw images, hidden tools,
credentials, pending proposals and unfinished output.

## Evidence and unknowns

- Starting revision: `6ddc00ea` (`origin/main`, fetched 2026-10-29).
- Recording 18–30s: pin marker and six-dot reorder control crowd sidebar titles.
- 35–60s: reference hover three-dot menu with rename, pin, archive, copy, share.
- 64–79s: the user reports a recently sent chat was not processed correctly;
  the recording does not show an error or establish its cause.
- 80–94s: recent conversations appear below old rows. The local order projection
  ranks every saved ID before unseen new IDs; backend listing is newest first.
- Installed desktop acceptance and browser acceptance are separate proof.

## Chosen approach

Reuse the existing Session row menu, local pin/archive store, drag controller,
Radix popover/dialog, authenticated Web routes and canonical Session save.
Avoid another metadata store or a public-share capability. Implement sequentially
in this worktree; review the final branch with an independent agent as required
by AGENTS.md for this multi-path change. Keep repository plans here per PLANS.md.

## Commit sequence and verification

- [ ] Quiet hover/focus three-dot menu: preserve vertical drag, optional swipe,
  keyboard pin/archive/reorder and a coarse-pointer target; browser geometry.
- [ ] Canonical rename: bounded nonempty title, revision conflict, unavailable
  Session, cancellation, failure and readback; row/directory/open-header sync.
- [ ] Copy conversation: authenticated fresh read, only eligible completed prose,
  clipboard success/failure, cancellation on scope/unmount changes.
- [ ] Share conversation: clean same-origin authenticated URL, native share when
  supported, copy-link fallback, cancellation/failure feedback; no private query.
- [ ] Recent ordering/continuity: new conversations precede saved old ordering,
  explicit reset to newest activity; paginated directory dedupe and refresh;
  preserve pinned groups and unrelated local preferences.
- [ ] Investigate recent message handoff with isolated synthetic content; fix
  only a reproduced cause in a separate commit, otherwise retain uncertainty.

For each meaningful behavior: focused regression first, implement, run the
focused checks, commit the improvement. Run appropriate Web lint/type/test,
docs checks and browser acceptance after all commits. Provision an expiring
test account using capir help/test create, retain sanitized evidence, stop it.
Deploy affected resident Web from clean committed source and read back revision
and changed behavior. Backend deployment is required only if backend runtime
changes; current approach reuses its existing mutation contract. Create and
attach one combined PR, link GET-316, and record CI/review/deployment separately.
User requested a PR for review; leave it open and the issue In Review until
the requested surface evidence and any final merge decision are resolved.

## Progress

Intake and source comparison complete. Implementation active. Resource audit:
59 GiB host free, high swap and many shared Node/MCP processes; run heavy checks
serially and preserve shared services. No pause marker was present.
