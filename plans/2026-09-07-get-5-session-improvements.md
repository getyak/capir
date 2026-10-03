# GET-5 Session improvements

## Outcome and boundary

Implement the seven requirements in [GET-5](https://linear.app/getyak/issue/GET-5/session-%E8%AE%BE%E8%AE%A1%E7%9A%84%E4%B8%80%E7%B3%BB%E5%88%97%E9%97%AE%E9%A2%98%E6%94%B9%E8%BF%9B), including its contact-draft and cross-device continuity supplement read on 2026-09-07. A Session must remain a continuous, recoverable conversation while contacts, source evidence, decisions and receipts retain their own authority.

The user authorized implementation and independent sub-agent evaluations followed by autonomous corrections. Completion means every requirement has implementation and observable proof, with no unresolved confirmed critical or major defect. It does not claim an absolute optimum or authorize unrelated deployment, external communications, automatic identity changes, or private-message model training.

## Requirements

1. Preserve Session identity, message order, contextual conversation and pending operations across follow-ups, scope binding, capture, app restart and same-account devices.
2. Prepare a compact, editable contact draft from grounded name and stable identity clues. Missing relationship purpose stays empty. Saving uses existing exact identity review, idempotent operation and canonical readback. Decline and expiry preserve the original conversation. One active person draft at a time.
3. Explain screenshot processing through the conversation and meaningful results; keep mechanical history secondary.
4. Support native iOS back navigation and interactive return from an active Session.
5. Enable hold-to-talk over empty input space while preserving text editing, IME, permission and voice-finalization behavior.
6. Render useful Markdown structures accessibly, including lists, headings, quotes, links, code and tables.
7. Add quiet per-answer regenerate/copy/feedback controls and a Session menu for full-conversation sharing and safe fork.

## Evidence and initial findings

- Baseline: `d363ac04`, clean worktree, branch `codex/get-5-session-improvements`.
- `RelationshipAskView.swift` creates or reuses conversations through several independent paths; screenshot processing remains separate from normal turns.
- `RelationshipArchiveModels.swift` persists Sessions only locally and has one global pending contact proposal.
- `ConversationContactIntake.swift` currently supplies `General relationship` for absent context.
- Linear was read through authenticated Chrome UI; no issue edits or comments were sent.

## Ownership

Root owns synthesis, Markdown, integration hooks, localization, documentation, Xcode/Simulator and final deployment/verification. Independent workers own backend Session sync; iOS Session model/store; backend chat context; iOS Session UI; and contact interpretation. They use non-overlapping files and coordinate contracts explicitly.

## Current state

Complete. The final 110-file product artifact has independent recruiter/mobile/safety follow-up, zero remaining confirmed implementation findings and no active veto. Native cancellation and response-loss/footer recovery pass; the final Release build and required local TestFlight backend deployment/readback pass. The [evaluation report](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-5/README.md) owns final results; [twenty checks](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-07-get-5/checks.md) define the evidence boundary.

## Verified implementation

- Signed iOS Simulator unit suite:513/513, including41 contact-intake cases and final Session/capture lifecycle guards.
- Backend:128/128 across seven files; the final clock/prompt delta passes87/87 affected cases including42 real PostgreSQL Session cases and34 provider cases. This is a targeted rerun, not215 distinct tests.
- Actual native journeys cover all seven requirements, including authenticated canonical contact save/receipt restoration and deletion cancellation, response-loss recovery with the complete truthful footer, screenshot interruption and completed-source follow-up, native back, voice/text input, GFM controls and fork identity. Coverage is cumulative across targeted runs; failed runs remain preserved.
- iPhone17Pro and SE3: Chinese dark AX5 and reduced-motion rendering passed; table/code captures were inspected. Release Simulator build passed and completed-screenshot DEBUG markers are absent from the executable.
- Actual configured GLM trials prove grounded contact preparation, canonical text continuity and canonical screenshot-summary continuity. Screenshot v2 exposed a database transaction/app-clock discrepancy and an invented date example; both were corrected and the same two v3 trials passed. All inputs are synthetic and rolled back; individual trials are not a reliability estimate.

## Review and correction trail

- Backend independent v1/v2 reviews identified scope/source, draft clocks, lock ordering, storage size and identifier cases. Executable PostgreSQL regressions cover their corrections. Two platform rejections prevented an independent v3 code-review run; it is not counted as a pass.
- iOS independent v1–v4 reviews corrected proposal revival, delayed-task ownership, deleted Session resurrection, fixed retention, per-Session sync isolation, and screenshot admission/recovery capacity. The final reviewed delta had no actionable findings.
- The independent recruiter/mobile/safety product panel v1 blocked on canonical deletion wording and ordinary reply lifecycle. It also identified misleading unknown-save copy, indistinguishable forks and missing unconfirmed labels on mixed-citation replies. Root accepted and implemented all five, then added original-request replay/generation race and database-clock regressions.
- Panel v2 closed both safety vetoes and found one footer inconsistency. Root corrected it, verified the full visible card and exact original-request recovery, and obtained all three independent v3 follow-ups. Panel v3 passes the implementation gate; recruiter field-value evidence remains an explicit research limit, not an open implementation finding.
- Prior failed native selectors, preview fixture launches and infrastructure timeouts remain historical evidence. They are not rewritten as successful runs. The latest failure was an isolated fixture request hitting PostgreSQL's12-second client timeout while Colima had severe memory/CPU pressure; no persistent lock or full disk was found.

## Deployment boundary

Root rebuilt and redeployed with `scripts/deploy/testflight-local.sh` under `apps/backend/AGENTS.md`. Existing project secrets were validated and reused only in process memory because the local secret CLI login expired. The official Node24 base was checksum/layer verified and loaded after Docker Hub TLS failure; no daemon proxy or global networking was changed. The final running image is `talent-signal-backend-local:get5-session-20260907`; 32 relevant source hashes and all six new migration checksums match the reviewed source.

API remains on Mac loopback4317, PostgreSQL internal, Tailscale Serve private. Existing other Serve handlers are preserved. Readiness/live checks return200; unauthenticated Session access returns401. Apple authentication and synthetic provider probes pass. No iOS release upload or physical-device validation is claimed. Isolated synthetic test services are stopped and evidence retained.

## Completion evidence

1. Completed: freeze the final artifact and rerun the three affected product reviewers independently.
2. Completed: resolve every active veto against executable evidence and validate the final panel JSON.
3. Completed: verify running source, migration, readiness, authentication and unchanged network exposure after deployment.
4. Completed: localization, docs and diff checks; final evaluation and proof artifacts recorded for handoff.

Detailed implementation ownership and historical findings remain in the related GET-5 worker plans and versioned evaluation reports. At the implementation handoff, no issue comment, commit, push, PR or App Store Connect upload had been performed. The subsequent user instruction authorizes submitting and merging this work through the repository gates.
