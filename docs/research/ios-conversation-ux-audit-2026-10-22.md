# iOS conversation experience audit — 2026-10-22

## Purpose and evidence boundary

Make a screenshot handoff feel received, understandable, and complete: send
once, see truthful progress, inspect the actual result, make one clear decision,
and return to the same work after interruption. The reference is the existing
Web/macOS conversation experience, adapted to native phone interaction.

Reviewer: `mobile-ux-reviewer`. Lens: task completion, hierarchy, accessibility,
source understanding, and recovery. This is a source-based product audit and
improvement register, not raw evaluation output or a release certificate.
Product boundaries remain in [Product](../product.md),
[Design system](../design-system.md), and
[Capture to action](../capture-to-action.md). The
[delivery plan](../../plans/2026-10-22-ios-conversation-experience.md) owns active
execution and acceptance status.

- Initiated on 2026-10-22; source checked on 2026-10-23, Asia/Shanghai, at
  `81ccb05c`. Later documentation or CI-only changes do not expand this audit's
  behavioral evidence. Runtime changes require renewed verification.
- The supplied native Session screenshot supports observations about layout,
  the absent visible decision, the image preview, and ambiguous status. The
  other supplied image is conversation source material, not another capri UI
  surface. Neither proves elapsed time, tap behavior, or a particular device.
- Private image contents, identities, original filenames, and credentials are
  deliberately omitted. Use synthetic equivalents for repeatable comparison.
- Historical build attempt 6 and the focused 109-test, zero-failure result
  correspond to `82142db`; they are not proof for every later merge revision.
  This document did not run builds, Simulator interactions, or live services.
- At this audit's cutoff, native UI execution, measured latency, live-provider
  completion, installed TestFlight fidelity, and visual direction selection
  remain pending. Source findings have at most `supported_inference`
  confidence; no numerical usability or visual-quality score is assigned.

## Reading the register

**Implemented / source-reviewed** means a concrete implementation exists and
the independent source review closed its confirmed P0/P1 findings. It does not
mean the corresponding user journey passed. **Pending runtime proof** means
the implementation or intended interaction needs direct surface evidence.
**Deferred** means this slice does not implement the recommendation; it remains
visible here rather than being presented as completed.

P0 is a release veto for wrong authority, exposed private data, duplicate
consequential effects, or false completion. P1 blocks a reliable core task or
its release acceptance. P2 improves continuity, clarity, or efficiency after
the core loop works. No new unresolved P0 defect is asserted by this document;
the P0 entries specify conditions that must remain impossible.

## The reported symptoms

| Symptom and available observation | Likely contribution and user impact | Current treatment and remaining proof |
| --- | --- | --- |
| Avatar appears absent; the native image turn has a small empty-looking shape. | A pure-image turn previously mounted a padded empty text bubble. This can resemble a failed avatar. The screenshot alone cannot establish an avatar-network failure. | **Implemented / source-reviewed:** empty-message suppression and a readable initial in the review identity. **Pending runtime proof:** the actual submitted image-only turn. **Deferred:** an app-wide authorized-photo loading/failure audit. See [native user bubble][N-bubble], [review identity][N-card], and [Web avatar][W-avatar]. |
| Sending seems to produce no useful response for a long time. | The screenshot does not provide clear message-local evidence of receipt, queueing, processing, or uncertainty. Slow processing and slow acknowledgement can therefore feel identical; the image cannot establish the actual waiting time. | **Implemented / source-reviewed:** immediate local image presentation, message-local observed status, metadata streaming, and parallel queue/Session reads. **Pending runtime proof:** real timing and recovery. Model execution itself is not proven faster. See [pending presentation][N-pending], [progress][N-progress], and [transport][N-transport]. |
| Prose promises contact review, but no visible contact card appears. | Native response projection lacked the Web result's authoritative proposal locator; text cannot replace an editable decision object. | **Implemented / source-reviewed:** proposal decoding, current authorized review, identity correction, separate contact/item decisions, and destination readback. **Pending runtime proof:** a real source produces a usable card, and an unavailable card never looks ready. See [response contract][N-response], [review host][N-host], and [review store][N-store]. |
| The sent long screenshot is tiny inside a large pale landscape frame. | One fixed landscape box shrinks a tall source into an unreadable strip and wastes the phone's reading area. | **Implemented / source-reviewed:** shared aspect-aware pending/history geometry, bounded long-image preview, explicit original access, multi-image navigation, and retry. **Pending runtime proof:** legibility, zoom, and the local-to-authenticated transition on ordinary and compact phones. See [native media][N-media]. |
| Saved-history language, a review instruction, feedback icons, and a ring-like composer control coexist. | Source identifies the idle ring as the static branded [voice action][N-voice], not a running network spinner. Its appearance can still suggest waiting, making the old answer, current work, and pending human decision harder to distinguish. The screenshot does not prove a request is active. | **Implemented / source-reviewed:** status belongs to its message, the real review precedes feedback, redundant Agent eyebrow text is removed, and restored reviews obtain fresh authority. **Pending runtime proof:** fresh, restored, and running states remain visually distinct. **Deferred:** a recognizable voice affordance (R9) and broader title/chrome refinement. See [turn rendering][N-turn] and [static mark][N-brand-mark]. |

## What to carry over from Web and macOS

macOS hosts the shared Web workbench in [WKWebView][M-workspace], with native
navigation, authentication, capture, appearance, and failure boundaries around
it. Web and macOS therefore provide a shared conversation implementation for
this comparison, not two independent native implementations. Repository code
is a reference capability; it does not establish current production behavior.

| Experience | Existing reference source | Native decision or remaining gap |
| --- | --- | --- |
| Structured results belong inside the answer. | [Session message parts][W-parts] creates the Memory result from a proposal ID/revision and renders `MemoryReviewCard`; [review controller][W-memory] owns authorized state. | Native now decodes both actual producer forms, opens the real review, and renders it before feedback. Preserve typed result semantics rather than parsing an instruction out of prose. |
| Sending and completion have separate evidence. | [Conversation controller][W-conversation] retains local outbox identity/bytes until canonical history settles them and reconciles uncertain admission before retry. | Native preserves the protected message and operation identity; local preview is not a server receipt. Test uncertain sends and saves without generating a new intent. |
| Observed processing can be understood. | [Web stream consumption][W-stream] and [work-row rendering][W-work] distinguish forming output, actual status, and recovery. | Native consumes verified metadata, not unvalidated screenshot prose. A completed queue entry still requires final Session readback. |
| Input remains useful while work runs. | [Web composer and queue controls][W-composer] allow the next draft, queued work, and explicit Stop. | **Deferred gap:** native `composerInputDisabled` includes sending and pending images. First separate safe draft editing from dispatch authority; full queue/steering parity is a separate change. |
| Reading position belongs to the reader. | [Reading-position hook][W-reading] and [thread integration][W-thread] remember reading intent and follow only when appropriate. | **Deferred gap:** native currently scrolls on a new conversation item. Adopt an equivalent reader-intent policy with a quiet new-reply affordance. |
| Image failure is recoverable. | [Web image strip/viewer][W-images] retains image order, supports per-image retry, and offers fit/actual-size inspection. | Native now shares preview geometry and preserves local bytes until authenticated original decoding. Test one failed image without replaying the whole message. |
| A long image needs a phone-specific preview. | [Web image CSS][W-image-css] currently gives a single thumbnail a `3:2` crop. | Do not copy that geometry as a mobile standard. Carry over the original-viewer and recovery behavior; use the native long-image treatment. |
| Identity remains readable when a photo fails. | [IdentityAvatar][W-avatar] keeps a stable fallback and drops a failed photo. [Avatar preferences][W-avatar-preferences] owns presentation choices. | The native review has a readable initial. Reuse the same semantic fallback hierarchy across native identity surfaces later; do not imply a browser-local preference is cross-device account data. |
| Corrections and partial decisions survive. | [Web Memory controller][W-memory] tracks drafts, rebases, and operation readback; the card separates identity from details. | Native uses fresh review authority, protected exact-intent recovery, and incremental decisions. Confirm that one accepted detail leaves its siblings pending. |
| Source identity survives a folded conversation. | [Human-message projection][W-human] retains canonical steering identities while excluding host-authored results. | [Native source index][N-source] resolves historical and canonical supplemental sources to the correct parent; image sources use their own index, not the latest answer's image. |

## Prioritized improvement register

### P0 — preserve trust through the whole decision

| ID | Required behavior and concrete acceptance | State |
| --- | --- | --- |
| T1 | A proposal remains bound to its account, Session, actual source message, current revision, and permitted review surface. A queue answer remains Chat even inside a relationship Session; a scoped Ask cannot expose or save unrelated person/self details. Switch account/context during a read and confirm that old content and actions cannot enter the new scope. | **Implemented / source-reviewed; pending runtime proof.** [Scope/source policy][N-source], [review client][N-client], [store][N-store]. |
| T2 | An unknown admission/save/rebase never becomes success or permits an unrelated retry. Lose the response before and after server application; reconcile or replay only the frozen exact intent with the original key. Repeated taps must produce one intended outcome. | **Implemented / source-reviewed; pending runtime proof.** Test source assertions separately from a real service's behavior. |
| T3 | Adding identity does not save every suggested detail. Confirm contact only, then save one selected detail and leave the rest pending. Correcting a name obtains a fresh review and requires another explicit confirmation. | **Implemented / source-reviewed; synthetic UI cases present, execution pending.** [Review actions][N-card], [incremental store][N-store]. |
| T4 | Revoked/deleted/expired sources remove dependent action authority. Leaving an account clears its protected recovery scope. Credentials are never copied or logged; private sources must not enter generic diagnostics, public artifacts, or unrequested clipboard/share exports. Deliberate copy/share keeps its reviewed content scope and conveys no live authority. Verify revocation during a request and recovery. | **Implemented / source-reviewed boundaries; pending runtime proof.** [Client][N-client], [protected retention][N-retention], [workspace scope][N-workspace]. |

### P1 — finish the screenshot-to-result loop

| ID | Recommendation and completion evidence | State |
| --- | --- | --- |
| C1 | A committed Send immediately shows the actual local text/images. Show sending until admission; make receipt, observed processing, waiting, uncertainty, and stopped states distinguishable without invented progress percentages. Exercise image-only, text+image, and follow-up input. | **Implemented / source-reviewed; pending runtime proof and timing.** |
| C2 | Put one short status under the originating message. A disconnected or stale feed stops claiming live progress; returning checks the same message. No speculative acknowledgement or unvalidated screenshot transcript should precede the validated result. | **Implemented / source-reviewed; pending runtime proof.** |
| C3 | Put the real review in the answer. A new contact starts with name, optional context, source, and Add contact; suggested details stay secondary until identity is confirmed. Loading/unavailable states expose a useful retry and never promise a ready card. Preserve explicit analysis-only/no-save intent and useful no-contact answers. | **Implemented / source-reviewed for typed rendering and review; pending real-provider intent coverage.** |
| C4 | Match image preview to source shape. No empty text bubble, wide empty mat around a narrow long image, or transition blink between local preview and verified original. Verify tall, landscape, square, and mixed multi-image sources; inspect and retry one original independently. | **Implemented / source-reviewed; pending rendered proof.** |
| C5 | Verify the actual destination after saving. Show exactly what was added, keep unselected details pending, open the resulting Person, and reopen the same Session after termination. The receipt and destination must agree; a card saying saved is insufficient. | **Implemented / source-reviewed readback; pending native/live completion.** |
| C6 | Preserve draft, source position, selected detail, correction, and unknown-operation identity through source inspection, Back, backgrounding, and relaunch. Test failure between each transition; a source visit must not erase an edit or silently resume a write. | **Partly implemented / source-reviewed:** same-store suspension retains local edits; submitted uncertain operations retain their protected exact intent across store recreation. **Deferred:** preserving unsent name/context edits after the store is destroyed or the app terminates; the draft API does not contain those fields. Broader lifecycle and live recovery still require proof. |
| C7 | Keep the keyboard from covering the current decision or source. Preserve Chinese marked text, committed newlines, photo/file selection, and permission-denial recovery. Source inspection should dismiss the edit keyboard deliberately and return predictably. | **Partly implemented / existing input policy; pending primary/compact-device proof.** No general keyboard redesign is claimed. |
| C8 | Copy and regenerate are different actions. Copy provides short feedback and exports only the selected readable content; retry first checks the protected operation; regenerate is a new explicit request and preserves the prior answer. Explain genuinely unavailable recovery rather than leaving an inert icon. | **Existing controls retained; pending behavioral audit.** [Native controls][N-controls]. No broad retry/control redesign is claimed. |
| C9 | VoiceOver must announce identity, proposed state, source access, changed fields, and action effect in a useful order. Check 44-point controls, AX5 wrapping, dark/increased-contrast rendering, reduced motion, and focus return; status updates should not repeatedly interrupt reading. | **Semantics and synthetic coverage present; pending assistive-technology and rendered proof.** |
| C10 | Establish where the waiting time occurs. Record the segment timings below before claiming a faster end-to-end experience or changing model/provider behavior. | **Deferred instrumentation and measurement; no current latency result.** |

### P2 — reduce friction after the core loop is reliable

| ID | Recommendation and boundary | State |
| --- | --- | --- |
| R1 | Audit authorized account/contact photos across conversation, People, and destination pages. Show readable initials immediately, replace them only with a valid authorized image, and retain a stable fallback after failure. Keep the nearby name; a photo does not verify identity. Do not extract permanent avatars from private screenshots. | **Deferred app-wide work.** The empty-bubble fix is not an avatar-service fix. |
| R2 | Allow composing the next draft while a run is active. Keep safe local editing independent of whether dispatch is blocked; preserve attachment identity and scope. Add queued/steering controls only with an explicit shared contract, not by bypassing the existing send guard. | **Deferred.** [Current native guard][N-input] vs [Web composer][W-composer]. |
| R3 | Preserve reading intent. Follow a new reply only while already near the latest message; otherwise show a small new-reply control. Restore the inspected source and prior reading anchor after leaving its viewer. | **Deferred.** [Current auto-scroll][N-scroll] vs [Web reading policy][W-reading]. |
| R4 | Replace the generic active-Session title with a concise topic/target when supported by the saved Session. Preserve native Back and interactive-pop, avoid duplicate source/title labels, and reduce header-to-content dead space. Long names and accessibility sizes must remain readable. | **Deferred focused navigation/copy work.** [Current title][N-title]. Do not add avatars or new navigation destinations merely to fill space. |
| R5 | Keep the current decision visually dominant. Use body-scale prose, one primary action, quiet source controls, and secondary feedback. Refine saved-history wording so it identifies what needs revalidation while separately reauthorized reviews remain usable. | **Partly implemented / source-reviewed; rendered selection pending.** Broader chrome and saved-history wording remain follow-up. |
| R6 | Reuse correctly sized thumbnails and bounded, account-scoped caches. Release local preview bytes only after authenticated original validation; check repeated long-image sessions for retained memory and smooth scrolling. Invalidate derivatives when their source/account becomes unavailable. | **Local-to-authenticated handoff implemented; resource/performance proof pending.** General cache tuning is deferred. |
| R7 | Keep multi-image order and count discoverable with direct previous/next/original access. Preserve the failed image's position; avoid forcing the user to resend all attachments. Use familiar native inspection gestures and preserve reduced-motion behavior. | **Navigation/retry implemented; rendered ergonomics pending.** New ornamental motion is not required. |
| R8 | Verify consistent language, date/time meaning, and error specificity across restored answers, contact identity, detail saves, and sources. English and Simplified Chinese should express the same effect; no generic Agent label should compete with the object being reviewed. | **Localization/source checks exist; end-to-end content proof pending.** No new reminders or inferred deadlines are proposed. |
| R9 | Use a recognizable microphone icon for idle voice input, retaining a clear accessible name and the existing tap/hold behavior. Show listening and transcription feedback only from the actual voice state; keep message processing feedback with its originating message. Verify idle, recording, transcription, cancellation, and unavailable states so the control cannot be mistaken for network progress. | **Deferred.** [Current voice action][N-voice] displays a [static brand mark][N-brand-mark]; the separate [active voice transcript][N-voice-transcript] already reads the real transcription phase. No voice-control redesign or runtime validation is claimed. |

## Performance: measure the stages before setting a service promise

Use one stable request/message/run correlation and monotonic client timing.
Keep captured text, names, image bytes, credentials, and URLs out of timing
events. Separate observed server timestamps from client durations; do not
subtract unsynchronized clocks as if they measured network or model latency.

| Segment | Start → end | What a failure or long tail means |
| --- | --- | --- |
| Local acknowledgement | Committed Send tap → first painted local message/image | Main-thread work, image preparation, persistence, or presentation is blocking perceived receipt. |
| Admission | Protected local intent ready → verified admission receipt | Session synchronization, encoding, upload, network, and admission are combined here; instrument them separately if this segment dominates. |
| Queue delay | Verified server accepted time → observed run start | Capacity/scheduling delay, not rendering delay. Report only when both trustworthy server timestamps exist. |
| First useful status | Send → first verified message-local queue/stage status | Whether the user can understand the wait; this is not first answer or model output quality. |
| Decision readiness | Send → actual authorized, editable review or complete answer painted | The total time to useful understanding. Split provider completion, canonical readback, proposal open, and native rendering where evidence permits. |
| Confirmation | Confirm tap → scoped operation result and destination readback | Save latency; an HTTP response or spinner disappearance alone is not the end event. |
| Recovery | Reopen/Check status → reconciled same-message result | Whether interruption is inexpensive without duplicate upload or effects. |

**Proposed acceptance target, not a measurement:** local acknowledgement should
paint within 200 ms at the selected representative payload and device. Record
the payload class, theme/text size, device, network condition, sample count,
and both median and P95 before adopting that target as a release threshold.
No current P50/P95, completion ETA, or percentage improvement is established.
Do not set a universal provider completion target from one successful run.

Measure ordinary and compact-screen rendering separately from server timing;
changing screen size is not a reason to repeat unrelated provider calls.
Avoid repeated uploads merely to collect a cleaner screenshot. Existing run
and operation identities remain the recovery source of truth.

## Acceptance that remains necessary

1. Run the [seven deterministic UI scenarios][N-ui] with the same synthetic
   content for editorial and compact review. Compare uncropped light/dark
   screenshots for immediate comprehension, source readability, primary-action
   prominence, and small-screen/AX5 fit. Record the selected direction and its
   concrete deductions; fixture success does not prove live behavior.
2. Complete the [opt-in contact-review journey][N-live-contact] against the
   isolated authorized account: inspect one synthetic source, upload once,
   obtain the actual card, correct if needed, confirm contact only, read the
   destination, and reopen. Exercise a [visual question/follow-up][N-live-image]
   separately so successful contact extraction cannot hide a missing answer.
3. Exercise no-contact/no-action, namesakes, mixed images, one failed image,
   stale review, response loss, source deletion, cross-account changes,
   background/termination, and cross-device confirmation. Keep synthetic,
   authenticated-service, provider, native-device, and release evidence distinct.
4. Inspect keyboard and VoiceOver behavior directly, with compact-device use
   justified by the actual long-image/keyboard/large-text risk. Check source
   inspection, corrections, the confirmation button, and return focus rather
   than relying on an accessibility identifier existing in code.
5. Bind passing checks to the final behavior-changing revision and complete
   the delivery plan's applicable release/readback and resource closeout.
   A source audit, existing tests, PR creation, or a successful prior build
   cannot establish that the installed iOS experience is ready.

## Scope discipline

The improvement target is the existing capture-to-continuity loop. It does not
require another dashboard, contact wizard, progress-card stack, automatic
external action, extra permanent profile fields, or person scoring. A useful
answer with nothing to save is successful. A clear identity with no background
can be added without inventing a detail. Waiting, declining, and stopping must
remain understandable outcomes.

Revisit deferred work using observed task failures and segment timings. Keep
this dated audit's evidence boundary intact; put new runtime results in the
approved private evaluation output and current delivery status in the plan.

## Platform references

Apple's [feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback)
supports acknowledgement that explains an action's result. Its
[progress-indicator guidance](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
supports truthful waiting feedback and actionable explanations when progress
cannot continue. The [accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility)
and [design tips](https://developer.apple.com/design/tips/) inform Dynamic Type
coverage and practical 44-point touch targets. These are platform references,
not evidence that capri currently passes their requirements or that any native
interaction in this audit has been measured.

[M-workspace]: ../../apps/macos/Sources/Features/QuietWorkspaceView.swift#L73
[W-parts]: ../../apps/web/components/conversation/session-message-parts.tsx#L131
[W-memory]: ../../apps/web/components/memory-review/use-memory-review.ts#L171
[W-conversation]: ../../apps/web/components/conversation/use-conversation.ts#L109
[W-stream]: ../../apps/web/components/conversation/use-conversation.ts#L373
[W-work]: ../../apps/web/components/conversation/session-message-parts.tsx#L389
[W-composer]: ../../apps/web/components/conversation/queued-conversation.tsx#L341
[W-thread]: ../../apps/web/components/conversation/queued-conversation.tsx#L132
[W-reading]: ../../apps/web/components/conversation/use-conversation-reading-position.ts#L84
[W-images]: ../../apps/web/components/conversation/conversation-images.tsx#L46
[W-image-css]: ../../apps/web/components/conversation/queued-conversation.module.css#L121
[W-avatar]: ../../apps/web/components/identity-avatar.tsx#L8
[W-avatar-preferences]: ../../apps/web/lib/avatar-preferences.ts
[W-human]: ../../apps/web/lib/session-human-messages.ts#L5
[N-bubble]: ../../apps/ios/Sources/Features/RelationshipAskTurnSupport.swift#L14
[N-card]: ../../apps/ios/Sources/Features/ConversationMemoryReviewCard.swift#L124
[N-response]: ../../apps/ios/Sources/Services/PursuitWorkspaceClient.swift#L1912
[N-host]: ../../apps/ios/Sources/Features/ConversationMemoryReviewHost.swift#L6
[N-store]: ../../apps/ios/Sources/Features/ConversationMemoryReviewStore.swift#L241
[N-client]: ../../apps/ios/Sources/Services/ConversationMemoryReviewClient.swift
[N-pending]: ../../apps/ios/Sources/Features/ConversationImagePendingMessage.swift#L97
[N-progress]: ../../apps/ios/Sources/Features/ConversationImageProgress.swift#L6
[N-transport]: ../../apps/ios/Sources/Services/ConversationImageClient.swift#L250
[N-media]: ../../apps/ios/Sources/Features/ConversationImageConversation.swift#L57
[N-source]: ../../apps/ios/Sources/Features/ConversationMemorySourceIndex.swift#L5
[N-retention]: ../../apps/ios/Sources/Services/ConversationMemoryOperationPersistence.swift
[N-workspace]: ../../apps/ios/Sources/Features/PursuitWorkspaceStore.swift#L329
[N-turn]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L7748
[N-controls]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L7961
[N-input]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L2095
[N-scroll]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L1473
[N-title]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L538
[N-voice]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L1863
[N-brand-mark]: ../../apps/ios/Sources/App/TalentSignalBrandMark.swift#L7
[N-voice-transcript]: ../../apps/ios/Sources/Features/RelationshipAskView.swift#L2013
[N-ui]: ../../apps/ios/UITests/ConversationExperienceUITests.swift
[N-live-contact]: ../../apps/ios/UITests/LiveContactReviewUITests.swift
[N-live-image]: ../../apps/ios/UITests/LiveImageQuestionUITests.swift
