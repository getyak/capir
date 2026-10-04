# iOS relationship library design benchmark

Date: 2026-08-07; row-gesture study updated 2026-09-01

## Question

What would make Talent Signal's iOS experience feel aesthetically coherent,
useful, and distinctly appropriate for relationship intelligence rather than
like a compressed CRM or a styled AI demo?

This study compares the current Simulator surface with current first-party
product material from adjacent contact, relationship, task, meeting, and CRM
products. It is directional research, not canonical product truth.

## Current-surface finding

The current iOS workbench is strong where the product must be safe:

- capture is explicit and purpose-bound;
- identity, evidence, proposed state, and action remain distinct;
- a human reviews consequential changes;
- the review flow exposes ambiguity, receipt, retry, and recovery.

Its weakness is more fundamental than color or typography. The first screen is
a synthetic product demonstration with a large marketing headline and nested
workflow cards. It does not yet provide a credible daily destination for:

1. finding a person;
2. understanding what changed in that relationship;
3. seeing the one current dependency;
4. choosing a small, reviewable next step.

The consequence is an aesthetic problem produced by information architecture.
The interface looks like it is explaining the product before it lets the
recruiter use it.

## What aesthetic quality means here

An aesthetically strong Talent Signal app should meet eight conditions.

1. **The product object is immediately legible.** A person within a specific
   recruiting relationship is the primary object, not a chat, dashboard, score,
   or generic task.
2. **Visual hierarchy follows evidentiary hierarchy.** Identity, current
   dependency, change, supporting evidence, action, and outcome appear in that
   semantic order.
3. **Material has a job.** Warm paper-like surfaces support reading; the
   restrained vermilion seam joins exact evidence to the state it changed.
   Blur, gradients, and depth do not become decoration.
4. **Progressive disclosure preserves calm.** The list answers why to look;
   the relationship page explains what changed; exact evidence expands only
   when needed.
5. **Native rhythm reduces effort.** Search, bottom navigation, sheets, swipe
   behavior, Dynamic Type, focus order, and tactile response should feel
   expected on iOS without becoming a clone of Apple Contacts.
6. **States are designed, not appended.** Empty, ambiguous, stale, offline,
   retry, recovery, and no-action states receive the same compositional care as
   the happy path.
7. **The signature is causal, not ornamental.** Talent Signal should be
   recognizable by the evidence-to-change seam and quiet editorial density,
   not by generic glass, sparkles, or oversized radii.
8. **Human dignity stays visible.** The product ranks work attention, never
   people, relationship strength, personality, culture fit, or acceptance
   probability.

## Adjacent product comparison

### Mesh, formerly Clay

[Mesh](https://me.sh/) presents a relationship memory with search, reminders,
life updates, a home feed, and native iOS surfaces. Its
[iOS 26 redesign](https://library.me.sh/2025/10/09/ios-and-macos-26/) uses
contact-photo-derived cards and an adaptive Home, People, and Groups tab bar.
[Clay's March 2026 rebrand](https://library.me.sh/2026/03/25/clay-is-now-mesh/)
also confirms that current references should use Mesh.

- Borrow: people as the primary object, native navigation, reminders, and
  photo-responsive identity treatment.
- Do not copy: visual effects as the product signature, ambient surveillance
  as the default premise, or relationship-strength scoring.

### folk

[folk mobile](https://www.folk.app/mobile) prioritizes adding contacts, voice
notes, fast search, and portable relationship context. Its current
[mobile search documentation](https://help.folk.app/en/articles/15178813-contacts-list-search-on-mobile)
starts with All people, distinguishes people and companies, and searches
across contact fields and notes.

- Borrow: search as a home-level action, useful default scope, and one-tap
  capture of relationship context.
- Do not copy: sales-pipeline language, bulk-outreach logic, or closing metrics
  in the person's primary surface.

### Cardhop

[Cardhop](https://flexibits.com/cardhop) combines natural-language contact
actions, smart lists, focus filters, relationship fields, widgets, and
device-local privacy.

- Borrow: low-friction command grammar, focus filters, and relationships that
  remain understandable as fields and lists.
- Do not copy: free-form commands that could bypass evidence review or grouped
  actions that obscure their exact external effect.

### Things

[Things](https://culturedcode.com/things/features/) achieves calm through a
clear object model, paper-like item detail, tucked-away metadata, Quick Find,
Today, and restrained purposeful motion.

- Borrow: progressive disclosure, editorial whitespace, stable Today and
  Library destinations, and continuity between list and detail.
- Do not copy: check-off semantics for a human relationship. A quiet
  relationship is not an incomplete task.

### Granola

[Granola for iOS](https://docs.granola.ai/help-center/ios/getting-started)
deliberately serves in-person and iOS-call capture while keeping advanced work
on desktop.

- Borrow: the discipline to make mobile complementary instead of reproducing
  every desktop capability.
- Do not copy: capture as the only durable mobile destination. Talent Signal
  still needs retrieval and relationship continuity after capture.

### Attio

[Attio mobile](https://attio.com/help/reference/tools-and-extensions/attio-on-mobile)
preserves records, lists, email, calls, notes, tasks, and comments on mobile.

- Borrow: a coherent record model and direct paths from a list to full context.
- Do not copy: desktop CRM breadth, customizable database chrome, or many
  equally weighted activity types on a small screen.

### Dex

[Dex](https://getdex.com/product/) uses contact timelines, reminders, and
groups to support personal relationship follow-through.

- Borrow: visible relationship history and lightweight follow-up cadence.
- Do not copy: guilt-inducing "stay in touch" mechanics or a synthetic measure
  of relationship health.

## Second iteration: quiet Agent and museum composition

The supplied Notion mobile screenshot clarified a useful tension. A nearly
monochrome field, plain document list, and persistent AI affordance create
excellent scanability, but the same screen duplicates navigation, search, AI,
and compose controls while a floating dock covers the bottom of the document
list. It is an effective knowledge-work shell, not yet the right relationship
object model.

### Notion

[Notion search](https://www.notion.com/help/search) brings workspace search and
workspace questions into a familiar retrieval surface, while
[Notion Agents](https://www.notion.com/product/agents) makes permissions, run
history, and reversibility part of Agent operation.

- Borrow: persistent access to find and ask, governed permissions, visible
  history, and reversible Agent work.
- Do not copy: separate search, chat, compose, and AI destinations competing
  for the same mobile attention, or an Agent becoming the canonical record.

### flomo

[flomo](https://flomoapp.com/) deliberately removes formatting, layout, and
classification decisions from capture.
[flomo AI voice](https://help.flomoapp.com/ai/aivoice.html) keeps the original
record available while limiting cleanup to lightweight transcription repair,
and [flomo Agent](https://help.flomoapp.com/ai/agent.html) treats the Agent as
an optional reader of the user's existing notes rather than a setup-heavy
workspace.

- Borrow: one sentence or voice moment, no classification before expression,
  preservation of the raw words, and an Agent that lives quietly beside the
  archive.
- Do not copy: personal-note semantics for governed recruiting evidence or
  silent model-authored changes to confirmed relationship state.

### Raycast

[Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions) exposes
search, questions, and tool invocation through one command surface while
keeping the invoked capability legible.

- Borrow: one entry for find, ask, and invoke; reveal tools only after intent.
- Do not copy: an opaque command that hides evidence scope or the exact effect
  of a consequential action.

### Japanese museum references

The [MIHO Museum approach](https://www.miho.jp/en/architecture/approach/) uses
a path, tunnel, bridge, understated entrance, and natural light to prepare
attention before the collection. The
[21st Century Museum of Contemporary Art, Kanazawa](https://www.kanazawa21.jp/data_list.php?d=2&g=11)
uses openness, brightness, courtyards, and multiple entrances to make culture
approachable without a monumental front door.

- Borrow: thresholds, calm intervals, hairline boundaries, natural material
  contrast, and more than one understandable entrance.
- Do not copy: treating people as exhibits, imposing a literal gallery map, or
  using empty space that delays routine retrieval.

## What Capture becomes

Capture is removed as a navigation destination. It is not renamed.

Its useful capability becomes **Remember a moment**, one job inside the
contextual Guide and, later, an operating-system share or voice surface:

1. the recruiter writes or speaks one natural sentence;
2. the exact raw words remain visible as user-authored material;
3. the Agent proposes a possible person and relationship context;
4. it asks for at most one missing detail when that detail changes meaning;
5. the result is staged as a draft, with no confirmed state or external action
   changed until human review.

This transformation changes the mental model from filing an artifact to
preserving a meaningful relationship moment with the least possible
administration.

## Third iteration: translucent chrome and object actions

The next critique focused on where navigation material ends and relationship
operations begin. The supplied Notion screenshot demonstrates that a lightly
translucent navigation field can remain present without feeling like a heavy
toolbar. Copying its complete pill language, however, would fragment Talent
Signal into a collection of floating controls and weaken the archive's spatial
calm.

### Material fork

Two rendered material branches were compared:

- **Museum Glass:** status and primary navigation form one continuous
  translucent threshold, while the bottom Guide remains one optical rail.
- **Floating Objects:** brand, navigation, and Guide controls become separate
  translucent islands closer to Notion's mobile composition.

Museum Glass is selected. It keeps the page boundary and navigation hierarchy
legible during deep scroll, uses one continuous optical layer rather than
several grey pills, and leaves the relationship content visually primary.
Floating Objects survives as a desktop study control because it is useful for
testing the boundary where liveliness becomes chrome fragmentation.

The selected material uses backdrop blur, restrained saturation, an upper edge
highlight, and a hairline boundary. It falls back to the opaque pearl surface
when reduced transparency is requested. Translucency remains limited to
navigation and temporary focused menus; evidence and relationship content do
not become glass cards.

### Global versus relationship-scoped operations

Find, ask, and remember are global intent operations, so they remain in the
stable bottom Guide rail. Repeating the Guide or search icon in a selected
person's top-right would make global navigation compete with the relationship
object.

The person page therefore uses:

- **Share:** stage a private, recruiter-reviewed view, export preview, or
  access review. No option claims that a link, file, or permission changed
  before verification. Sharing remains unavailable while identity is
  unresolved.
- **Actions:** edit relationship, add note or evidence, add to favorites, and
  open relationship history. Edit and add remain staged; favorite is explicitly
  a personal shortcut rather than a person or relationship rank.

Every person row now opens that person's own detail content and actions. The
prior prototype incorrectly reused Leila's detail for every selected row.

### Brand entrance

The text wordmark is replaced by one circular Talent Signal mark with a stable
graphite core. It opens account-scoped Settings, Privacy and evidence,
Support, and What's new. This keeps configuration discoverable without
pretending that workspace settings belong to the selected relationship.

## Product-shape decision

Two brand theorems survived the initial branch:

- **Relationship Ledger:** calm people library first, then an
  evidence-to-change ledger inside the living relationship.
- **Relationship Constellation:** one-hop, question-specific relationship map
  with typed, time-bound edges and an equivalent list.

The initial Relationship Ledger established the correct object model but its
name and first implementation still felt administrative: filter chips, filled
cards, repeated red seams, and a three-item dock made the experience resemble
a calm CRM.

The second iteration therefore compared:

- **Living Archive:** a sparse, stable relationship index whose space and
  sequence borrow from a quiet museum, with a contextual Guide beside the
  relationship.
- **Quiet Concierge:** an Agent-first threshold that begins with intent and
  reveals the archive only when needed.

Living Archive is selected for the primary iOS architecture. It keeps direct
browseability, stable spatial memory, and a durable person-within-relationship
object without turning the interface into an inventory. Quiet Concierge has
the more dramatic first impression and lower visible input burden, but it is
weaker when a recruiter wants to scan without first forming a question. Its
composition survives as the expanded Guide state.

The Relationship Constellation survives only as a secondary question view. It
is justified when a recruiter asks a real relationship question such as "who
can help with this decision?" It is not a home screen, does not use node size
to rank people, does not infer unconfirmed edges, and always provides a list
equivalent.

Within the selected direction, People is the stable retrieval destination.
Today remains separate so only relationships with a supported reason to look
now enter the judgment brief. Combining Today into the People list would make
urgency visually dominant, while removing People would make quiet but important
relationships hard to retrieve. The default return-surface decision is
resolved in the fourth iteration below.

## Feature ledger

### Keep

- intentional screenshot capture and device-visible processing boundary;
- editable extraction before evidence promotion;
- explicit identity comparison with no preselected match;
- exact-effect review, receipt, retry, reversal, and recovery;
- historical evidence distinct from current confirmed state;
- `no_action` as a legitimate result.

### Reframe

- Remove Capture as a product destination and turn its useful behavior into
  Remember a moment inside the unified Guide, voice, and share surfaces.
- Turn the current large workflow cards into progressive review sheets.
- Make Today an attention view, not an importance ranking.
- Treat a relationship graph as a secondary answer to a scoped question.
- Use the vermilion redline only where evidence causally changes state.
- Use one contextual entry for find, ask, and remember instead of separate
  search, chat, capture, and compose controls.

### Add first

1. Searchable People archive across name, role, company, assignment, and
   recruiter-authored notes.
2. Work-state filters: changed, waiting on client, decision this week,
   identity review, and no action.
3. Living relationship page with one context selector and one current
   dependency.
4. Exact evidence attached to the changed state, with provenance and review
   status.
5. One smallest safe action with a preview of target, content, and effect.
6. One-line or voice memory that preserves raw words and stages
   interpretation as a draft.
7. State preservation when returning from detail, collection, Guide, or
   review.
8. Thoughtful empty, ambiguous, stale, offline, retry, and recovery states.

### Add after evidence

- saved work-state views and a private Today widget;
- quick recruiter notes and voice capture with explicit source labeling;
- assignment-specific relationship context;
- typed relationship paths with time and provenance;
- private notification previews and reversible reminder actions;
- an offline-readable cache of previously reviewed relationship state.

### Remove or defer

- synthetic product demonstrations as the default home;
- marketing headlines inside the daily product surface;
- nested card-on-card workflow exposition;
- numbered steps on ordinary retrieval screens;
- "AI analysis" labels, sparkles, and theatrical agent copy;
- unverified success messages or multiple competing recommendations;
- tiny metadata, decorative graphs, person scores, and acceptance predictions;
- ambient contact, email, or calendar ingestion before authorization and
  deletion semantics are proven;
- full ATS, bulk messaging, customizable dashboards, and desktop CRM parity.

## Observable validation

The direction is ready for native implementation only when a recruiter can:

1. find a known person from the default screen in five seconds;
2. state what changed and what is waiting after one detail-screen scan;
3. open the exact supporting evidence in one additional action;
4. distinguish confirmed, ambiguous, stale, and no-action states without color
   alone;
5. preview the exact effect of an action before any external write;
6. return to the same query, filter, and scroll position;
7. complete the same tasks at larger Dynamic Type, in dark mode, with reduced
   motion, and through VoiceOver semantic order.

## Fourth iteration: Editorial Today

The next critique supplied a stronger mobile composition: a compact translucent
navigation threshold, an open editorial page, one dominant return-to item, a
recoverable interrupted review, and a separate evidence-to-change composition.
The useful mechanism was not its serif type or warm paper alone. It changed the
product from a resource manager into a daily judgment brief.

This iteration supersedes the earlier choice of People as the default
destination. People remains the stable retrieval surface, but Today becomes the
return surface because the product promise is to reduce context reconstruction
at the moment a relationship needs judgment. The change is bounded: Today
contains at most a few evidence-supported dependencies, while all quiet
relationships remain directly available through People.

### Reference judgments

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
  makes hierarchy and harmony the reason for elevating controls above content;
  Talent Signal borrows the stable, labeled navigation threshold and keeps
  relationship actions out of the tab layer.
- [Apple tab bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
  separates navigation from actions and warns against unstable destinations;
  Talent Signal keeps Today, People, and Library stable while search, capture,
  share, and review remain contextual actions.
- [Granola for iPhone](https://docs.granola.ai/help-center/ios/getting-started)
  narrows mobile scope to coming meetings, notes, chat, and settings; Talent
  Signal borrows that restraint but makes governed relationship state, not the
  note, the durable destination.
- [Things](https://culturedcode.com/things/features/) uses Today, progressive
  disclosure, and a clear paper-like object to make powerful detail feel calm;
  Talent Signal borrows the daily focus and open-page hierarchy, not task
  completion semantics for people.
- [Notion Agents](https://www.notion.com/product/agents) keeps permissions,
  history, and reversibility visible inside the workspace; Talent Signal
  borrows governed Agent presence but does not turn an evidence review into
  autonomous work or an AI destination.

### Structural fork

Two materially different first-viewport compositions were rendered:

- **Open Page:** hierarchy comes from one warm field, editorial type, sparse
  rules, and whitespace. Only the focused evidence review receives a bounded
  surface.
- **Floating Briefs:** the dominant change, resume rows, and no-action summary
  become individually elevated cards.

Open Page is selected. Floating Briefs improves local grouping but turns the
daily brief into a familiar premium-SaaS card stack and makes chrome compete
with the relationship decision. Open Page is more ownable because the
vermilion causal seam, not card treatment, carries the product mechanism.

### Interaction decision

The selected loop is:

```text
Today return-to item
→ exact reviewed evidence
→ proposed relationship-state change
→ keep unresolved or confirm change
→ internal-state receipt and undo
```

The receipt explicitly states that no message was sent and no external system
was written. Resume-with-context names what was preserved, where the recruiter
stopped, and what did not happen. The bottom Agent threshold supports search,
one-line intent, and capture, but remains draft-only until the affected
relationship object is reviewed.

## Fifth iteration: row gesture ownership

### Question

How should Session and People rows support swipe and long press without making
the same horizontal drag unpredictably navigate among Today, Sessions, and
People, and when should a revealed row return to rest?

This study owns the dated evidence and implementation direction. The stable
product rule is summarized in the canonical design system; executable behavior
still belongs in the iOS code and tests.

### Current implementation and direct evidence

The conflict is structural:

- the retrieval shell uses a page-style `TabView`, so the full content region
  recognizes horizontal drag as a destination change;
- Session rows use native `List` row `swipeActions` for `Unread` and `Remove`;
- People rows are buttons in a `ScrollView` and have no row swipe or context
  actions;
- the existing paging tests prove destination swiping, but do not exercise row
  reveal, mutual exclusion, dismissal, long press, or assistive alternatives.

The owning code is
[`RelationshipArchiveView.swift`](../../apps/ios/Sources/Features/RelationshipArchiveView.swift):
the page container begins around line 436, Session row actions around line 1656,
and the People `ScrollView` around line 1880. The paging-only proof is in
[`CandidateSignalUITests.swift`](../../apps/ios/UITests/CandidateSignalUITests.swift)
around line 369.

Evidence level 1 testing on an iPhone 17 Pro Simulator running iOS 26.5 with
Xcode 26.6 produced three outcomes:

| Drag begun on a Session row | Expected | Observed |
| --- | --- | --- |
| Standard full left swipe | Reveal `Remove`; remain in Sessions | Navigated to People |
| Short, fast left drag | Reveal `Remove`; remain in Sessions | Navigated to People |
| Slower medium left drag | Reveal `Remove`; remain in Sessions | Stayed in Sessions; revealed nothing |

The captured synthetic evidence is in the
[`2026-09-01 iOS row gesture baseline`](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-01-ios-row-gesture-research/README.md).
The probes did not reach a stable revealed state, so they could not truthfully
validate dismissal. This is evidence of an arbitration failure, not evidence
that dismissal is correct or incorrect in isolation.

### Primary-source judgment

[Apple's gesture guidance](https://developer.apple.com/design/human-interface-guidelines/gestures)
describes swipe as a standard way to reveal actions, dismiss views, and scroll,
but also says gestures should be predictable, responsive, and distinct from
other gestures. It recommends system behavior, more than one interaction path,
and custom gestures only when necessary.

The SwiftUI [`swipeActions`](https://developer.apple.com/documentation/swiftui/view/swipeactions%28edge%3Aallowsfullswipe%3Acontent%3A%29)
API is specifically a List-row interaction, while
[`PageTabViewStyle`](https://developer.apple.com/documentation/swiftui/pagetabviewstyle)
is explicitly a paged scrolling container. Nesting both on the same axis gives
two legitimate recognizers no semantic way to infer whether the recruiter meant
"act on this row" or "leave this destination."

[Apple's context-menu guidance](https://developer.apple.com/design/human-interface-guidelines/context-menus)
supports touch-and-hold for a small set of highly relevant item actions, warns
that the menu is hidden by default, and places destructive items last. It is a
useful equivalent and discovery aid, not the only path to an important action.

[Apple's motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
prefers brief, precise motion that follows the gesture, discourages repeated
ornamental movement, and requires motion to be optional. Apple's
[`Animate with springs`](https://developer.apple.com/videos/play/wwdc2023/10158/)
session explains why a spring can preserve the gesture's release velocity
without implying that every interaction should bounce.

[Apple's accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility)
requires alternatives to gestures and cautions against time-boxed UI.
SwiftUI's
[`accessibilityAction(named:_:)`](https://developer.apple.com/documentation/swiftui/view/accessibilityaction%28named%3A_%3A%29)
provides the VoiceOver action equivalent.

### Decision: one horizontal owner at each level

The selected direction is:

1. **Explicit top controls own primary retrieval.** Today, Sessions, and People
   remain stable, labeled, at least 44-point targets. Content-wide page swiping
   is removed. The top selection changes destinations by tap, keyboard, Switch
   Control, or VoiceOver activation.
2. **Rows own horizontal direct manipulation.** A drag that begins on a Session
   or People row can reveal only that row's actions. It never changes the
   primary destination.
3. **Vertical movement owns scrolling.** Use native `List` recognition rather
   than app-defined angle, distance, or velocity thresholds.
4. **Tap owns the primary row action.** Tapping a row opens the Session or
   person. Swipe and long press accelerate secondary actions and never replace
   the visible primary path.
5. **Long press owns the contextual menu.** It exposes the same semantic
   actions as swipe plus the primary `Open` action; it does not introduce a
   more consequential hidden command.

This intentionally supersedes the earlier plan-level choice to combine explicit
top controls with content-wide paging. Tuning drag thresholds while keeping both
horizontal owners is rejected because the direct probes already show a dead
zone and a navigation zone, and hand speed, row height, Dynamic Type, and device
size would keep moving that boundary.

### Action vocabulary and authority

Directions describe where the action surface originates, not a universal moral
meaning. Do not add a second edge merely for symmetry.

| Surface | Finger movement | Initial action | Full swipe | Authority boundary |
| --- | --- | --- | --- | --- |
| Session | Left, revealing trailing edge | `Remove from this device` | Disabled | Opens an exact-effect confirmation or a recoverable undo; never silently deletes protected history |
| Session | Right, revealing leading edge | `Mark unread` or `Mark read` | Allowed only after persistence and recovery are verified | Changes only the Session's local retrieval state |
| People | Left, revealing trailing edge | `Ask about this person` | Disabled | Opens the existing composer with visible person and relationship scope; sends nothing and changes no relationship state |
| People | Right, revealing leading edge | None in the first slice | Not applicable | Do not invent favorite, priority, or relationship-health state to fill an edge |

The People long-press menu may contain `Open person`, `Ask about this person`,
and `Remember a moment` only when each routes into the existing governed surface
with visible scope. `Remove person`, merge, evidence deletion, message, calendar,
contact, ATS, CRM, and notification writes do not belong in a row shortcut.

The existing Session label `Remove` is too vague for protected history and its
current store mutation has no visible recovery. Swipe implementation must not
make that current behavior easier to trigger. A first slice should either stage
an exact-effect confirmation or supply a real undo that survives interruption;
full swipe remains disabled.

### Revealed-state contract

Only one row action surface may be open in a container. A revealed row returns
to rest whenever the recruiter expresses a new intent outside that action
surface:

- taps or starts a swipe on another row;
- begins vertical scrolling;
- taps Today, Sessions, or People, including the already-selected destination;
- opens the menu, calendar, global composer, a sheet, or a person/Session;
- changes search, filter, language, or accessibility layout;
- backgrounds the app or the scene becomes inactive;
- completes, cancels, or fails the selected row action.

Do not dismiss on a timer. A passive pause is not a new intent, and timed
dismissal creates a cognitive and motor-accessibility penalty. Tapping inside
the revealed action surface performs or confirms that action; long press first
returns any swiped row to rest and then presents one system context menu.

This can be represented as a small interaction state machine:

```text
rest
  -> tracking(row, edge)
  -> revealed(row, edge)
  -> confirming(row, action) | executing(row, action)
  -> rest

any new intent outside row/action, scene interruption, or container change
  -> rest
```

The state is transient presentation only. It is not persisted, restored on
launch, recorded as relationship state, or interpreted as user authorization.

### Motion and feedback language

- Track the finger one-to-one. Keep the action underlay stationary while the
  row moves; do not scale, tilt, blur, parallax, or turn the row into a glass
  card.
- Let native row mechanics own resistance, velocity, threshold, and release
  spring. A custom drag engine is a fallback only if the non-paged native List
  fails the dismissal contract in executable testing.
- Keep the action width large enough for a 44-by-44-point target and reveal its
  symbol and text without truncating the action effect.
- Use graphite or the existing neutral fill for read-state actions. Reserve
  system destructive red for the revealed removal control. Vermilion continues
  to mark consequential evidence-to-change attention, not generic swiping.
- Use the existing restrained selection spring for the top indicator, close to
  a 0.3-second snappy response with little or no overshoot. Change the content
  with a brief cross-fade; a normal-motion build may add at most a subtle
  directional offset because the destination changed by explicit selection,
  not by a dragged page.
- Under Reduce Motion, keep direct finger tracking but remove bounce and page
  displacement; use an opacity-only transition of about 0.2 seconds.
- Use the system context-menu haptic. Add no haptic for partial reveal or
  automatic dismissal. A discrete haptic may accompany a verified reversible
  full-swipe commit, never a pending or failed mutation.

### Current-toolchain implementation direction

The project currently uses Xcode 26.6 and supports iOS 16. The smallest native
prototype is therefore:

1. replace page-style primary navigation with a non-paging selection container
   while preserving each destination's search and scroll state;
2. express both Sessions and People as native List rows;
3. use `swipeActions` and `contextMenu`, with the same action definitions also
   supplied as VoiceOver accessibility actions;
4. keep destructive Session removal staged and explicit;
5. test native mutual exclusion and dismissal before adding app-owned gesture
   state.

Apple's current beta SwiftUI documentation also introduces a
`swipeActionsContainer()` coordinator and a `swipeActions` overload that reports
presentation changes. They are a future simplification after the project
toolchain supports them and final-OS testing passes; the research does not make
a beta API or an iOS 27-only path a release dependency.

Rejected alternatives:

- **Keep page swiping and tune thresholds:** preserves the failure class and
  creates device- and velocity-dependent behavior.
- **Custom row drag inside the pager:** adds recognition, RTL, pointer,
  accessibility, Dynamic Type, and physics debt while the parent still owns the
  same axis.
- **Long press only:** avoids the conflict but makes common shortcuts hidden and
  does not satisfy direct row manipulation.
- **Persist the open row:** mistakes temporary presentation for user state and
  recreates the stale reveal after relaunch.

### Verification matrix for implementation

The affected path cannot pass on a build or screenshot alone. Use direct
interaction and record `pass`, `fail`, or `not_run` for each row:

| Area | Required proof |
| --- | --- |
| Gesture ownership | Short, medium, full, slow, fast, and slightly diagonal row drags never change Today/Sessions/People; top controls still change every destination |
| Edge semantics | Session leading/trailing and People trailing actions match their visible labels; an empty edge neither navigates nor produces false feedback |
| Mutual exclusion | Swiping row B closes row A; no two action surfaces remain visible |
| Dismissal | Tap outside, vertical scroll, selected and unselected top tabs, search/filter change, menu/calendar/composer/sheet, action completion/failure, background/foreground, and relaunch all return to rest |
| Consequence | Session removal cannot full-swipe, names local deletion scope, requires confirmation or real undo, and preserves governed Person/Pursuit/evidence state |
| Long press | System context menu contains the same allowed actions, destructive last, no sensitive custom preview, and closes an existing reveal |
| Accessibility | VoiceOver actions perform every shortcut without swiping; Switch Control and Full Keyboard Access reach equivalents; targets are at least 44 points |
| Motion | Normal motion tracks the finger without jank; Reduce Motion removes bounce and page displacement; no required meaning depends on animation or haptic |
| Content | English, Simplified Chinese, 200-percent expansion, RTL, long names, AX3, and AX5 do not clip identity or action effect |
| Devices | Small and large supported iPhones, current iOS and the iOS 16 deployment target, light/dark/increased contrast, and interruption are exercised |

Add regression tests that first assert the selected top destination, then swipe
a specific row and assert both the revealed action and the unchanged
destination. Separate tests must reveal an action, trigger each dismissal event,
and assert the action is no longer in the accessibility hierarchy. Retain the
existing top-control navigation test, but replace the current content-wide
paging test because that behavior is intentionally removed.

### Mobile UX review packet

- `reviewer: mobile-ux-reviewer`
- `lens: mobile task completion, visual hierarchy, accessibility, and recovery`
- `device/state: iPhone 17 Pro Simulator, iOS 26.5, synthetic preview, standard English`
- `evidence: executable build with direct interaction for the conflict; code and
  primary-source research for the unimplemented direction`
- `confidence: observed` for the gesture conflict and `supported_inference` for
  the proposed post-fix behavior
- `verdict: fail` for the affected gesture path

The current path scores platform interaction 1 and state completeness 1: a
standard row swipe changes the primary destination, a slower drag can produce no
result, People lacks parity, and the revealed-state recovery path cannot be
reliably entered for validation. This does not re-score the rest of the mobile
product. Release status can move to `pass_with_changes` only after the ownership,
dismissal, consequence, and accessibility rows above have executable proof.

## Sixth iteration: pages own the horizontal axis

### Product decision

Direct user evaluation found that removing content-wide paging made Today,
Sessions, and People feel like disconnected destinations. The preferred model
is one continuous retrieval space in which the primary page, rather than a row,
owns horizontal movement.

This supersedes the fifth-iteration ownership decision without restoring its
original two-owner conflict:

1. a native page container owns every horizontal drag across Today, Sessions,
   and People, including loading, failure, empty, preview, and loaded states;
2. the labeled top selection remains tappable and follows live page movement;
3. Session and People rows remove `swipeActions` entirely;
4. tap remains the row's primary Open action;
5. a visible 44-point menu and the native long-press context menu expose the
   same secondary commands;
6. VoiceOver actions provide a non-gesture equivalent;
7. local Session deletion remains destructive-last and requires its existing
   exact-effect confirmation.

The visible menu is required because a context menu alone is hidden by default.
The long press supplies direct, item-anchored focus and system feedback, not a
separate command vocabulary. People shortcuts remain limited to opening the
person and starting a visibly scoped Ask. Session shortcuts remain limited to
opening, changing local read state, and staging deletion of local history.

### Motion, direction, and continuity

The page tracks the finger with native paging physics. While it moves, the top
indicator interpolates between the measured centers of the adjacent labels and
stretches modestly around the midpoint before returning to its resting width.
Using measured anchors avoids assumptions about equal label widths and keeps
the trajectory correct when the interface is right-to-left. It does not scale
cards, add parallax, or place glass inside content.

A tap on a top label uses the same page transition. Under Reduce Motion, the
indicator does not stretch or bounce and the selected label remains the stable
semantic signal. Page changes do not reconstruct the retrieval shell: People
search and filter state, each list's visible position, and the user's current
context survive page changes and temporary sheets.

At accessibility text sizes, the two utility actions move to their own row.
The destination selector keeps the user's full Dynamic Type category and may
scroll horizontally so every label remains complete with a 44-point target;
dynamic edge insets derived from the viewport and the measured first and last
tabs let every selected destination remain centered when space is constrained.

### Verification change

Replace tests that expect a page swipe to remain on the current destination.
Executable proof now needs to show:

- Today swipes to Sessions, Sessions swipes to People, and both reverse;
- the selected top label agrees with the visible page after every transition;
- tapping a top label reaches the same destination and preserves local
  scroll, search, and filter state after page changes and temporary sheets;
- row secondary commands are available from both the visible menu and long
  press, with matching labels and consequences;
- no row exposes a native leading or trailing swipe action;
- the indicator follows real label anchors in both LTR and RTL layouts;
- Dynamic Type, Simplified Chinese, Reduce Motion, VoiceOver, interruption,
  and small/large supported iPhones preserve navigation and command
  reachability.
