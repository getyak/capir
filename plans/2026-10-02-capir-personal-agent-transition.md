# capir personal Agent transition

## Status and decision question

> Note 2026-10-09: the capri rebrand landed after this snapshot (#276 and
> follow-ups); the old-name findings below are dated evidence, not current
> state.

- Brief ID: `capir-transition-2026-10-02`.
- Status: draft recommendation; repository assessment complete, product
  implementation not started by this task.
- Audience: product owner and the engineers delivering the first capir release.
- Question: what is the smallest release that makes the personal Agent promise
  useful, understandable, and safe for existing users?
- Snapshot: 2026-10-02, Asia/Shanghai; checkout HEAD
  `6c061b076244d411ae7cc80af7aa5fbbc7a55e05`, branch
  `codex/macos-material-motion`, with concurrent uncommitted Web/macOS work.
- Authorization: optimize the supplied proposal. This document does not claim
  authorization to publish a site, migrate production data, or change accounts.

## Executive brief

Recommendation: define the promise, prove one meeting-continuity loop, then
ship the matching website and visible brand together. Expand continuing work
only after that loop is useful. Keep persistent technical identifiers stable
unless a separately demonstrated need justifies migration.

Three findings govern the sequence:

1. **Observation:** current canonical product language and website configuration
   still use Talent Signal [E1, E2]. The supplied claim that `docs/product.md`
   already uses capir is inconsistent with this checkout.
2. **Observation:** governed Sessions, People, Memory, meeting drafts, and
   isolated test-account boundaries have documentary/code evidence [E1, E4,
   E5]. **Interpretation:** this is a reusable foundation, not proof that the
   proposed natural-language meeting journey works end to end today.
3. **Observation:** an installed local `capir --help` reports Stage A auth and
   Web sandbox commands, with native/live/evaluation stages deferred [E6].
   Its wrapper points to a separate `capir-cli` worktree. This is discovery
   evidence, not proof of backend availability, source/build revision agreement,
   or a successful test-space lifecycle.

No decision is required to deliver this brief. The cohort, positioning copy,
visual direction, and release channels below remain recommendations. capir is
the brand supplied by the user; no new domain, address, or availability claim
is assumed.

## Outcome and boundaries

The proposed first release lets a user return to an existing person and
relationship, prepare a meeting from inspectable authorized context, record a
reviewable recollection afterward, and resume the same shared outcome later.
The public story accurately describes that release and its access conditions.

First-release scope:

- one primary cohort and one recurring job;
- a compact brand/capability contract;
- one real meeting-continuity journey on Web, including the existing macOS Web
  surface where verified;
- a matching marketing homepage and minimal affected secondary copy;
- user-visible name updates on supported clients, with compatibility evidence.

Deferred: universal life assistant, new autonomous outreach, broad connector
collection, a complete native navigation redesign, three full marketing demos,
speculative notification infrastructure, package/Bundle ID renames, and domain
migration. iOS behavior parity is not implied by Web success. Native changes
need their own relevant verification under the shared-device guard.

## Product contract: proposed, not yet canonical

Recommended initial cohort: independent consultants and small-team founders
with repeat client or partner meetings. Validate this cohort with actual use;
it is a focused starting hypothesis, not established market demand.

Recommended positioning:

> capir is your personal Agent for keeping important conversations and shared
> work moving. It brings back the context you chose to preserve, helps you
> prepare the next conversation, and continues from confirmed outcomes.

The supplied Chinese emotional headline can remain a candidate. Pair it with a
literal job statement: remember authorized context, prepare a meeting, and
continue shared work. Avoid promising comprehensive understanding or indefinite
retention. “Personal Agent” describes the assistant serving the account owner;
“Person” remains a contact identity, not another autonomous assistant.

Preserve the existing state owners:

| User concept | Existing owner | Boundary |
| --- | --- | --- |
| You | Authenticated account/user and reviewed self context | No contact record substitutes for the account owner. |
| People | Person plus relationship-scoped context | One identity never grants access to every relationship context. |
| Shared work | Pursuit, owned Action, reviewed state and outcome | No new parallel Tasks truth store solely for a new label. |
| Continuing conversation | Session | Conversation context alone is not evidence or action authority. |
| Memory | Governed attributable Memory | Separate source-backed material, user statements, and interpretation. |
| What happened | Receipt and verified readback | A generated answer is not a completed effect. |

Stable assistant identity means durable account-scoped preferences and governed
context across sessions, not a model retaining private state. A model change
cannot broaden source access or rewrite confirmed history.

## First journey and verification

Use synthetic people, messages, outcomes and timestamps. Use an explicit
calendar date and timezone in fixtures even when the user says “tomorrow”.

1. The user asks to prepare a meeting with Chen Xia. Resolve one exact
   account-scoped person and relationship; two same-name people require a
   minimal clarification before private evidence is read.
2. Produce an editable preparation with prior discussion, existing open
   commitments, unknowns, and questions to confirm. Link supported claims to
   inspectable evidence. Show evidence freshness and unsupported recollections.
3. Save/restore the preparation in its originating Session. Existing drafts
   and owned Actions take precedence over creating duplicate work.
4. After the meeting, accept the user's recollection as an attributable draft.
   Review is required before it becomes confirmed shared state. A new reminder,
   message or calendar effect needs a separate exact-effect decision.
5. Reopen later and show the confirmed change, unresolved dependency, owner,
   and continuation condition. Stop or complete the work without inventing
   follow-ups. If nothing needs action, say so.

Minimum acceptance cases:

| Case | Observable result |
| --- | --- |
| One exact person, available evidence | Useful preparation, inspectable citations, no hidden external effect. |
| Same-name ambiguity | One clarification; neither person's private context leaks. |
| No history or insufficient evidence | Honest gap and a useful editable next question, no fabricated recap. |
| Relative date ambiguity | Date/timezone clarified or labeled unresolved. |
| Existing draft/action | Reuse or explicit revision, no duplicate owned work. |
| Source dispute/deletion | Current dependent answer/preparation becomes stale or unsupported; historical review remains correctly labeled. |
| Network loss/relaunch/retry | Original intent and operation identity recover; unknown outcomes reconcile before replay. |
| Account or test-space switch | Prior private context/drafts stay outside the new scope. |
| Stop/no-action | No new continuation/reminder is scheduled; justified no-action remains visible. |

Product-value evidence is separate from correctness: observe whether users can
prepare without manually reconstructing the prior exchange and whether they
return to continue the same work. Record usefulness judgments and denominators;
do not count generated text or message volume as successful continuity.

## Marketing and brand work

Build the public demonstration from the verified journey and synthetic fixtures.
Label simulation and access limitations on the surface. A marketing animation
does not establish live-model, integration, or cross-device capability.

Two directions worth prototyping after the product invariant is verified:

- **A: resume the conversation.** Open directly on the request and an editable
  preparation. Reveal evidence and the unresolved commitment in place. The
  visual argument is immediate reduction in context reconstruction.
- **B: carry the work forward.** Open on one shared outcome across before,
  after, and next meeting. Make the confirmed change and waiting condition the
  signature interaction. The visual argument is continuity over time.

Both must become visible first-viewport and mid-page prototypes, including a
mobile collapse, before selecting a design. A is the current recommendation
for first-use clarity; B remains a challenger. No rendered preference test has
been performed in this task, so neither is a validated winner. During design
execution, use deepen-design, then ui-ux-pro-max, and finally
design-taste-frontend as directed by the repository's Agent Kit guidance.

Suggested homepage sequence: concrete request and result, how context carries
forward, inspect/correct/delete control, actual access path. Use warmth and calm
as constraints, not as a substitute for a distinctive product demonstration.
Motion must end in readable state and retain its meaning under reduced motion.

Minimal brand contract: lowercase `capir` spelling, naming rules, wordmark and
icon usage, one visual direction, and bilingual terms. Compare keeping the old
symbol with a new symbol; avoid blocking the working slice on a complete brand
system. The current brand checker pins exact geometry [E7]; an approved symbol
change must update its source-of-truth contract and generated client assets,
not simply overwrite one SVG.

Maintain a capability matrix per surface/environment with four separate states:
verified available, restricted/internal, synthetic demonstration, and planned.
Each claim needs access conditions and evidence. Public CTA, FAQ, pricing copy,
download links and metadata must derive from the same release facts. Offer
“Download capir” only for a verified published artifact and installation path;
otherwise use the actual access request. Preserve reachable current service
addresses until replacements are configured and verified.

## Continuing work and proactive help

After the first slice, expose business state such as active, waiting on another
party, waiting on the user, completed, or stopped only where the existing
governed records support it. Keep Agent execution status (queued/running/failed)
separate. Show why a waiting state applies, who owns the next step, and what
event or date makes it worth revisiting.

Before adding proactive help, reuse any existing scheduling/recovery contract
and establish scoped triggers, expiry, cancellation, and explicit user control.
Unchanged or non-actionable state should stay quiet. A source-backed change can
prepare an internal suggestion; it never authorizes an external message.

## Name and compatibility strategy

| Category | First-release treatment | Required evidence |
| --- | --- | --- |
| Display name, menu, FAQ, notification, metadata | Update deliberately to capir. | Relevant rendered surfaces and name inventory allowlist. |
| Brand configuration | Centralize Web copy first; share native values through an appropriate simple resource contract. | No scattered divergent user-facing name or invented address. |
| Internal package/import/build names | Retain initially; rename only for demonstrated engineering value. | All consumers inventoried; each later batch builds independently. |
| Bundle IDs, keychain groups, extension IDs, database/cache keys, update feeds | Preserve by default. Migration is optional, not a completion requirement. | Old installed version upgrades with account, draft, data and links intact. |
| URLs, API/tool/event names | Preserve existing contracts or add explicit compatible aliases. | Known callers and stored links still work; retirement is separately evidenced. |
| Domain/OAuth/email infrastructure | Separate cutover after replacement ownership and configuration are established. | Old and new login/callback/link paths verified, with rollback. |

Historical ADRs and evidence retain the historical brand. Generated wiki pages
are updated through their editable source. No global search-and-replace may
alter persisted identity or erase provenance. If a local data-key migration is
necessary, make old reads/new writes, idempotent conversion, interruption
recovery, and non-destructive rollback explicit before rollout.

## Staged delivery

| Milestone | Complete deliverable | Exit condition |
| --- | --- | --- |
| M0: truth and baseline | Cohort/job contract, capability matrix, name/identifier inventory, upgrade fixture. | Claims classified and first-release boundaries reviewable. |
| M1: working continuity | Prepare, record a reviewed recollection, reopen the same outcome. | Real authenticated surface succeeds; applicable ambiguity/deletion/retry/isolation cases pass. |
| M2: visible capir release | Homepage, compact brand contract, affected secondary copy and supported client display names. | Public demo matches tested capability; accessible desktop/mobile rendering; actual access path verified; old-install smoke passes. |
| M3: durable continuing work | Visible waiting/stop/continuation conditions and controlled proactive suggestions. | Correct trigger, cancellation, quiet unchanged state and recovery observed. |
| M4: optional technical cleanup | Only justified internal/service identifier changes, in separate batches. | Consumer compatibility, upgrade and rollback evidence for each affected boundary. |

Each implementation task needs its own bounded plan, owner, and evidence. Keep
one delivery milestone active at a time. Independent writes use separate
worktrees or explicit non-overlapping ownership; do not reuse this dirty UI
branch for implementation. Substantial coding follows the Pi delegation
preference. If entered as Linear development tasks, follow the complete branch,
independent sub-agent review, latest-head CI, merge, and issue readback workflow.

## CLI and evaluation scope

The installed wrapper targets
`/Users/cubxxw/.codex/worktrees/capir-cli/talent-signal/apps/cli/dist/cli.js`.
Coordinate with that work's owner rather than create a second implementation.
First map its installed build to the owning source revision and selected backend.
Reuse valid scoped authorization and server-discovered capabilities before
creating a named isolated space. Do not treat local help output as a grant.

Web strict replay is the currently advertised Stage A boundary [E6]. Native
macOS handoff must demonstrate a separate test window, correct account scope,
and return to the unchanged daily session before being called available. Live
model and evaluation modes remain separate tasks with explicit budgets and
repeated-case methodology. Unsupported modes must fail before allocation.
Cleanup completion needs server readback; revoked access alone is not deletion.

Use deterministic replay for business invariants. Evaluate model usefulness
separately with frozen synthetic inputs, repeated attempts, latency, cost and
visible output review. Do not expand collection or external model exposure for
the sake of an evaluation.

## Evidence ledger and limits

All repository evidence below is code/document inspection at the snapshot above;
it is not fresh production runtime evidence.

- **E1 — canonical:** [Product](../docs/product.md), “Audience and job”,
  “Canonical experience”, and “Product loop”. Supports the existing state
  model, governed continuity and current old name; does not prove this journey.
- **E2 — configuration:** [site configuration](../apps/web/lib/site.ts), lines
  1–11. Supports old display name, domain, email and request subject.
- **E3 — code/copy:** [homepage](../apps/web/components/marketing/marketing-home.tsx)
  and `apps/web/lib/relationship-vision-copy.ts` (removed with the capri
  rebrand in #276), including lines 41 and 108–114. Supports synthetic
  relationship demonstration and declared vision limitations; no browser
  rendering was inspected in this task. This observation predates the capri
  rebrand and is a dated snapshot only.
- **E4 — operations:** [Account access](../docs/operations/account-access.md),
  “Cross-device synchronization”, “Account onboarding” and “Internal test
  workspaces”. Supports existing contracts; live configuration is unverified.
- **E5 — code:** [Meeting handoff](../apps/web/components/meeting-draft-handoff.tsx),
  [draft actions](../apps/web/components/meeting-draft-actions.tsx), and
  [meeting drafts](../apps/backend/src/modules/meetingDrafts.ts). Supports
  governed draft/recovery implementation structure, not the natural-language
  preparation journey's live correctness.
- **E6 — local command observation:** `/Users/cubxxw/.local/bin/capir --help`
  returned `capir.v1`, Stage A `auth login/status/logout` and
  `sandbox start/status/stop`, Web-only strict replay, and explicitly deferred
  native/live/evaluation stages. Reading the 132-byte executable wrapper located
  its build in the separate `capir-cli` worktree; build/source revision and
  backend mapping remain unverified. `capir` text was not found in this
  checkout's inspected source.
- **E7 — executable configuration:** [Brand asset check](../scripts/check-brand-assets.mjs),
  lines 15–16 and subsequent geometry checks. Supports pinned current geometry.
- **E8 — client configuration:** [iOS project](../apps/ios/project.yml), line 51;
  [macOS project](../apps/macos/project.yml), line 36;
  [macOS Info](../apps/macos/Info.plist), lines 7–24;
  [extension manifest](../apps/browser-extension/load-unpacked/manifest.json),
  lines 3–5. Supports separate display and persistent/update identifiers.
- **E9 — canonical:** [Delivery](../docs/delivery.md), “Delivery principle”,
  “Current foundation”, and “Definition of done”. Supports complete vertical
  slices and separation of local acceptance from production rollout.

Reconsider the sequence if real use shows that meeting preparation is not a
recurring job, continuation requires unsupported integrations, or a currently
installed identifier cannot support the release. Resolve the smallest proven
constraint before broadening the product or migration.

## This assessment's verification

- [x] Read the routed product/delivery/documentation contracts and review standard.
- [x] Inspect relevant marketing, meeting, brand and client configuration.
- [x] Discover the installed CLI through read-only help; make no auth or sandbox mutation.
- [x] Preserve concurrent user/source changes; add only this non-overlapping plan.
- [x] `pnpm docs:check` passed: canonical documentation, local Markdown links,
  published wiki, architecture boundaries and all three diagram contracts.
- Storage preflight returned exit 2: 76 GiB free against an 80 GiB heavy-build
  threshold, plus existing registered-artifact observations. This task ran only
  lightweight document checks; no native build, simulator, Docker stack, or
  cross-task cleanup was started.

Implementation milestones M0–M4 remain proposed and unstarted by this task.
No website, application behavior, account, external publication or persistent
identifier was changed as part of preparing this brief.
