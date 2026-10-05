# Conversation working status

## Outcome and boundary

Remove the synthetic opening acknowledgement from active Web conversation
projection. Before genuine output arrives, show one quiet identity/status row;
queued, running, stopping and terminal outcomes remain distinct. Preserve
execution evidence, draft provenance, elapsed timestamps and human decisions.
No backend/model/prompt/authentication or unrelated pending UI changes.

## Evidence and approach

The main branch projected a fixed first-person sentence as run-update output.
The source checkout contains another unfinished feedback change and remains
untouched. Work is isolated on codex/conversation-working-status. The supplied
Grok Bot screenshot and [official presence design](https://x.ai/news/designing-grok-bot)
support identity motion, a plain status and details on demand. The canonical
experience boundary lives only in docs/design-system.md; deterministic
projection and phase tests enforce it.

## Verification

- Passed: focused projection/execution tests 29/29; full Web typecheck;
  changed-file ESLint; repository docs, wiki and architecture checks.
- Passed: rendered production components at 1280px and 390px, including
  status-to-result replacement, queued/stopping/failure labels, keyboard
  disclosure, reduced motion, no horizontal overflow and no console errors.
  The isolated component fixture is not authenticated backend/model proof.
- Independent read-only review found no actionable defects.
- Passed: conversation components and execution helpers, 123/123 tests.
- Pending: PR checks and delivery readback.

CLI updater PR 291 merged at 0d1c9b3e, but signed publication and local replacement
remain blocked on human Infisical login. This additional Web task does not
replace that pending authorized outcome.
