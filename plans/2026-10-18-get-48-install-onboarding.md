# GET-48 installation and first value implementation plan

> For agentic workers: use superpowers:executing-plans inline, followed by an independent Codex reviewer. The user has authorized continuous execution and normal PR/release gates; no additional design approval is pending.

**Goal:** Make the Mac installer and first launch a coherent invitation, then let a person inspect and correct one explicitly fictional conversation before connecting their own workspace.

**Spec:** [GET-48](https://linear.app/getyak/issue/GET-48/安装界面优化), the repository design system, and the existing browser-owned desktop login contract.

**Architecture:** Preserve WorkspaceConnectionForm and browser login as the only connection/authentication owners. A native, memory-only example exposes source, interpretation and a proposed next step without network, person creation, scheduling or sending. Generate Finder metadata with a build-only, pinned DSStore package on the mounted writable image; the installed app gains no dependency.

**Stack:** macOS 14+, existing Swift 5.9 app / SwiftUI and AppKit, current Xcode Swift 6.3.3 build host, separate Swift tools 6.2 packaging utility. DSStore 1.0.0, tag revision `6dc395837c3dc371f9c3e71794fab719db74c17a`, zero dependencies, MIT; verify resolved revision and retain license before use.

## Baseline and scope

- Latest fetched origin/main: `fc371c07e10edbbe56ae20f56c1f8037cda5c62e`. Main has unrelated untracked evidence; use the separate `codex/get-48-install-onboarding` worktree. The app worktree tool is bound to the unrelated Lighthouse checkout, so use the Git fallback for this repository.
- Packaging currently makes a plain disk image with an app, Applications symlink and Install.txt. No Finder layout/background is generated.
- The first-run view currently displays only the connection form. The current login already confirms in the browser; no native password form is needed.
- Include disk image composition, optional short entrance, offline sample, source/correction interaction, existing full-link connection entry and accessibility. Custom external link registration and actual AI research are later capabilities, not implied by a pasted workspace link. Do not introduce them.
- Preserve existing production account, installed preferences, updater trust anchor, release target, signing/notarization, Intel support and Web/backend services. No iOS Simulator, no real model requests, no real conversation data.

## Design choice

Compare two rendered directions before polish: A, one paper invitation with a restrained source excerpt and two clear entry actions; B, a split evidence/connection composition. Choose A unless rendering disproves its five-second clarity: it fits the compact installer, separates fictional material from real connection, and avoids making a service-address form the first impression. Both use the existing held-interval mark, warm paper and ink. Vermilion belongs only to the mark on the new surfaces; no decorative progress strip. Record the actual comparison, including deductions, as subjective design evidence.

Installer: approximately 720 x 460 points, 2x background pixels, app left / actual Applications folder right, one quiet arrow, the exact invitation and clear installation/opening instruction. Put Install.txt outside the central drag path. Hidden background and Finder files remain hidden. Finder metadata is written on the mounted image, so the background Carbon Alias describes the deliverable volume, not a developer directory.

First launch: same visual language; connect action immediately available; optional 0.75s entrance never delays input and reduced motion displays the final state immediately. Secondary example stays optional and reversible. The sample is explicitly fictional and local, without fake model processing. Its three labeled interpretations reveal the exact source phrase. Editing the dependency, agreement or proposed follow-up updates only that example; a missing date stays unknown. Returning to connection preserves an address draft. Connection still uses the existing normalization, probe, browser login and per-origin session isolation.

## Fixed acceptance matrix (before implementation)

| ID | Scenario and expected result | Verification / failure condition |
| --- | --- | --- |
| I1 | Open the final DMG: paper background, invitation, app at left, actual Applications target at right, clear drag and launch instructions in a compact window. | Read generated DSStore and inspect the actual mounted image in Finder; fail for wrong alias volume, cropped copy, overlap or invisible target. |
| I2 | Drag-install and open the published signed Universal app: exact new source/build, signature/notarization and unchanged update trust. | Normal release CI, receipts, checksum download, signed bundle readback and isolated first-run launch. A local preview/build alone fails this row. |
| I3 | Fresh launch shows connect and optional sample; input is immediately usable; configured users keep their existing workbench. | Real native app + focused tests; fail for welcome loops, preference reset, hidden action or blocked input. |
| I4 | Enter sample offline: visibly fictional, source sentence exact, three distinct source-backed interpretations; no actual date guessed from Thursday. | Actual UI and model tests; fail for implied live model output, person creation or external traffic. |
| I5 | Activate each interpretation: reveal its exact source quote. Edit and apply an explanation: corresponding displayed result updates; cancel/return/reopen behaves coherently. | Unit tests plus actual keyboard/pointer native UI; fail for stale result, lost source, unexpected mutation or implicit send/schedule. |
| I6 | Paste an ordinary HTTPS workspace link: existing canonical origin validation and browser confirmation remain; malformed credentials/query/fragment/foreign transport rejected. | Existing connection/login tests and native link-entry verification; fail for bypassed auth, native password collection or automatic new trust. |
| I7 | Reduced motion/transparency, light/dark appearance, narrow supported window and enlarged text: content and actions remain readable with source inspection and keyboard focus. | Real rendered windows with screenshots; VoiceOver labels/AX structure and keyboard walk; fail for truncation, hidden controls, focus loss or animation required for meaning. |
| I8 | New example may be revisited/abandoned without changing saved origin, account, people, memories or messages; no analytics/private content/new model calls. | Pure state tests, dependency audit and actual offline run; fail for persistence/network/domain writes or cross-account retained content. |
| I9 | Packaging failure detaches only this task's mounted image; immutable release outputs cannot be overwritten. Existing ZIP/app signing and Intel/arm64 checks remain. | Packaging integration/failure tests + Universal package checks; fail for leaked mounts, broadly killed services or relaxed signing gates. |
| I10 | Review and delivery bind exact source. | Independent reviewer closes confirmed P0/P1; current PR head all applicable CI/gates; normal merge; actual signed release and behavior readback; only then Linear Done/readback. |

## Review focus

1. A link or example must not mutate configured production identity or bypass browser-owned authentication.
2. A fictional Thursday is not a date, observation, permission or executed follow-up.
3. The Carbon Alias must survive conversion/mounting on another path, without exposing private build paths in visible content.
4. Accessibility and window sizing must preserve connection controls and editable evidence in actual native rendering.
5. A completed build or signed older release cannot satisfy I2/I10 for this source.

## Task 1: Installer composition and build boundary

**Files:** build-only package under `scripts/macos/installer/`, `scripts/macos/package.sh`, packaging tests and operational documentation.

**Interface:** a tool invoked with an explicit mounted volume directory and approved app icon; it generates the 2x background and `.DS_Store`, or exits nonzero without touching another path. The script mounts only its scratch image, invokes the tool, detaches and converts, preserving final-output refusal and signing order.

- [ ] Write/run a failing integration test for visible layout metadata, portable background alias, unsafe arguments and exact mount cleanup on failure.
- [ ] Implement the minimum build-only utility from the pinned upstream API and retain upstream license.
- [ ] Run its behavioral tests and verify a real mounted installer in Finder; preserve evidence.

## Task 2: Native first value and existing connection

**Files:** new `apps/macos/Sources/Features/FirstRunExperience.swift`, memory-only sample model, `QuietWorkspaceView.swift`, focused native tests/accessible UI identifiers. Adjust the app window's first-run minimum only if necessary without weakening configured-workspace sizing.

**Interface:** first-run experience owns local `welcome/example/connection` presentation; WorkspaceConnectionForm remains the real connection owner. Sample model returns source-linked results and updates only explicit edited sample fields.

- [ ] Write/run failing sample tests for exact source linkage, unknown date, editing, reset/cancel and no connection persistence.
- [ ] Implement sample state and SwiftUI surfaces; preserve draft ownership when navigating.
- [ ] Verify focused state/connection/login regressions and the actual native sample/keyboard/light/dark/reduced-motion/enlarged-text rendering; record A/B design comparison and chosen direction.

## Task 3: Independent review and signed delivery

- [ ] Run the relevant full native host suite, build Universal package, docs check and packaging tests, after resource audit; bind evidence to the committed diff.
- [ ] Independent Codex review against this frozen matrix, original issue, complete diff and evidence; repair/verify/review confirmed P0/P1.
- [ ] Create/attach Linear-linked PR, pass latest-head CI/security/protection, normal merge and wait for the exact signed Mac release.
- [ ] Verify published bytes, source/build, actual installer and isolated first launch; preserve existing installed data/preferences; clean task artifacts after durable evidence. Linear Done/readback only on all required rows passing.

## Sources and limits

- [Apple onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) and [Reduce Motion environment](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion).
- [DSStore upstream](https://github.com/sindresorhus/DSStore): mounted-volume Carbon Alias and scratch-image conversion contract. Finder metadata is reverse engineered, so actual Finder acceptance remains mandatory.
- [Existing distribution contract](../docs/operations/macos-distribution.md); release remains the existing `main` CI-driven signed publication flow.

Current status: design/standards frozen; implementation not started. GET-152 remains separately In Progress at PR99's genuine Vercel deployment quota gate, with a resumable checkpoint and real production host evidence.
