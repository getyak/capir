# Web conversation feedback — 2026-10-05

Local implementation and verification record. This is dated evidence, not
production acceptance of the new patch. The screenshot supplied by the user
was treated as a presentation reference, not an instruction to execute its
quoted task.

## Findings and delivered change

Accepted local messages previously had no status before an active stream
snapshot arrived. Local rows and attachment bytes were also removed on queue
receipt before canonical history arrived, permitting a blank completion
handoff after a slow or failed history read.

The transcript now carries a compact product mark and observed work status.
Admission, waiting, processing, paused, reconnecting, stopped, failed, and
readback states remain distinct. Unknown delivery requires an explicit check;
a confirmed same-ID receipt cannot cause resend after a failed history read.
Local evidence remains until canonical history contains the same ordered image
manifests. Already streamed text survives the history handoff, including when
preview and completion frames share one network chunk. Recovery reads are
bounded and do not send another message.

## Final source verification

All checks below ran against the integrated source checkout:

- `pnpm --filter @talent-signal/web exec vitest run components/conversation/ lib/conversation-delivery.test.ts lib/conversation-local-images.test.ts lib/conversation-transcript.test.ts`
  — 19 files, 136 tests passed.
- `pnpm --filter @talent-signal/web typecheck` — passed.
- Scoped ESLint on the five changed runtime conversation modules — passed.
- `pnpm docs:check` and `git diff --check` — passed, including architecture checks.

Tests cover admission gaps, retained images/drafts, lost receipt recovery,
rejected Stop intent, retry run identity, remote edits, reopened active runs,
readback ordering, preview preservation, final replacement, and queue capacity.
The first implementation's full Web suite passed before parent corrections;
that earlier result is not claimed as a full-suite run of this final patch.

## Rendered evidence

The final work row and conversation CSS were rendered in a synthetic local
browser harness. Its before view illustrates the observed admission gap; it
is not a captured production before state. Light/dark and 390px layouts were
inspected. Reduced-motion emulation disabled animation, and the narrow view
had no horizontal overflow. Browser overrides were reset afterward.

- [Light comparison](feedback-light.png)
- [Dark comparison](feedback-dark.png)
- [390px comparison](feedback-narrow.png)

## Existing deployment smoke test

The deployed Web/backend revision was
`d9153b46445d842b4e9e649089f59b708fc54583`, separate from this source patch.
Using a named empty test workspace and synthetic content, the in-app browser
sent one request for a one-line acknowledgement without contacts, memories,
calendar changes, or other actions. The reply was `收到测试消息`; the UI showed
completion in four seconds. Reloading retained that reply.
[Authenticated Web evidence](live-reply.png).

This shows that the deployed simple-message path responded in that test. It
does not rule out intermittent backend/model failures or failures in other
request contexts. API/database/schema health was checked separately and is
not used as model-health evidence.

Both CLI test runs were stopped and read back as `deleted`, with local
credentials removed. Only synthetic screenshots and this sanitized record are
preserved here. No personal account or conversation was accessed.
The owned browser tabs and preview server were closed, and the registered
temporary artifact was removed with `dev-storage-guard remove-artifact`.

## Delivery boundary

The conversation-only patch was integrated after comparison with the frozen
baseline; unrelated concurrent work and the existing index were preserved.
No deployment, commit, PR, native simulator, or external message was performed.
The current website therefore still needs deployment and acceptance of this
new version before these local results can be treated as a production fix.

See the [task plan](../../../plans/2026-10-05-capir-message-feedback.md) for
implementation ownership and review provenance.
