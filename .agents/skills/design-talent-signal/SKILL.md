---
name: design-talent-signal
description: Design, implement, or review capri product and marketing surfaces using its quiet relational-intelligence system. Use for Person cards and lists, living Person pages, evidence review, audit timelines, relationship graphs, Today briefs, iOS capture, visual tokens, interaction states, or any UI change that must preserve evidence provenance and user control.
---

# Design capri

## Load the product context

Read these files completely before making design decisions:

1. `../../../AGENTS.md`
2. `../../../docs/README.md`
3. `../../../docs/product.md`
4. `../../../docs/design-system.md`

For marketing-site work, also read `../../../design.md` and
`../../../docs/reference/web-experience.md`.

For evidence, action, timeline, graph, or audit work, read the relevant sections
of `../../../docs/capture-to-action.md`. Recruiting research is supplementary
only when the actual task concerns recruiting.

## Classify the surface

Choose one primary surface:

- Marketing narrative
- Desktop knowledge workspace
- People library
- Living Person page
- Evidence review
- Timeline and audit history
- Relationship graph
- iOS capture or Today

State the user question the surface answers. For screenshot handoff, show useful
understanding before requiring contact or folder setup. A Person page starts
with acquaintance background, recent change, and unfinished work. Keep waiting,
stop, and no-action visible rather than inventing urgency. Read current product
scope before using an inherited recruiting example.

Do not begin with components or a visual trend.

## Map meaning before layout

Identify:

- the canonical entity;
- which objects are only views or projections;
- the verified facts, proposals, inferences, and superseded states;
- the exact provenance path;
- the mutation, approval, and failure states;
- the one item that deserves visual attention.

Treat governed relationship state as canonical. Build Person Page, Card,
List, Timeline, and Graph as consistent views of that state.

## Declare the design read

State the surface, audience, visual character, and intended balance of
variance, motion, and density. Use more expressive composition for narrative
surfaces and more restraint for review or action. Lower motion when the
implementation cannot support correct transitions and reduced-motion behavior.

## Compose the surface

Apply these rules:

1. Use page and whitespace grouping before adding cards.
2. Give a card materiality only when it is selectable, comparable, draggable,
   approvable, or temporarily focused.
3. Keep one information order across Card and List.
4. Put exact evidence one click from every decision-relevant fact.
5. Show before and after when a fact changes.
6. Separate proposed, confirmed, edited, inferred, dismissed, and superseded
   states without relying on color alone.
7. Use Graph only to answer a relationship question. Make every edge typed,
   time-bounded, and traceable.
8. Use trends only for a real historical series tied to a decision.
9. Use visual weight for work attention, never human worth.

## Apply the visual system

- Match the project's quiet neutral and restrained vermilion character.
- Follow the existing product's typography, spacing, materiality, and icon
  idiom rather than restating implementation tokens in the Skill.
- Use strong hierarchy before borders, shadows, or additional containers.
- Keep tags and metadata secondary to the current dependency and evidence.
- Do not introduce a competing palette, icon language, or material system.
- For desktop concept images, compare rendered type, avatar footprint, row
  pitch, and chrome against the user's reference at equal viewport scale.
  Prompted dimensions alone are not evidence of compactness. Keep contact
  overflow within a bounded trailing area so names cannot displace Session
  titles; disclose secondary metadata on demand. Supply approved brand assets
  from `brand/README.md` instead of carrying forward invented mockup marks.
- For avatar-led conversation navigation, compare expanded and collapsed
  states with identical content. Include two sessions sharing the same
  participant set; an avatar alone must not silently choose an ambiguous
  session. Keep contact groups distinct from conversation participants. Verify
  both rail order and footer anchoring from the rendered screen, including
  person pages; detached sidebar copies must not bypass the shared source.

## Maintain the Figma workspace

When extending or reorganizing a shared design file:

- Inspect its existing pages and sections before appending work. Update the
  owning platform/flow section and its linked directory; do not create another
  page for each issue or a second live copy for an overview.
- Keep one visible current entry per feature. Label current direction,
  implementation reference, unverified flow, exploration, and historical
  reference separately. Visual polish never establishes release status.
- Name prototype starting points by task, platform, and design status; avoid
  default `Flow N` labels and indistinguishable names. Keep separate starts when
  they serve independent review tasks or version comparisons. Verify saved
  names and original destinations rather than imposing a fixed flow count.
- Put reusable cross-surface components in the system area; keep feature-local
  components with their examples and link to them. Reuse instances and existing
  variables instead of creating parallel sources.
- Use a consistent reading order, section edges, spacing, and descriptive
  screen names. Keep old versions in a named reference section. New editorial
  headings and directories use auto layout; original screen layouts remain
  intact unless their redesign is in scope.
- Before moving linked screens across pages, capture the reactions on their
  interactive descendants, component references, IDs, parents, and positions.
  Page moves can drop prototype actions even when IDs survive. Restore and
  read back affected routes after all destinations arrive; preserve transition
  parameters and inspect a real click-through when the surface is available.
- Verify saved directory destinations, original node/instance preservation,
  section bounds, and readable rendered overviews. State any unverified
  interaction explicitly. Keep dated manifests in evaluations and active
  migration state in a plan, not in this Skill.

## Implement complete states

Include the states relevant to the surface:

- loading;
- empty;
- insufficient evidence or ambiguity;
- proposed;
- confirmed;
- edited;
- dismissed;
- execution failed;
- expired;
- superseded;
- deleted or pending derivative deletion.

Keep actions reversible where the product contract allows. Never let a polished
success state hide a failed or unverified mutation.

## Protect the relationship graph

- Start with a one-hop ego network.
- Expand to two hops only on request.
- Keep node size independent of human value.
- Map edge width to confirmed interaction count in the selected time window.
- Map edge opacity to recency.
- Use dashed edges for proposed or unverified relationships.
- Open relationship evidence from an edge.
- Provide a list equivalent.
- Stop force motion after layout settles.
- Never display an unexplained relationship-energy score.

## Verify

Before finishing:

- For a reference reconstruction, inspect the rendered source and its final CSS
  overrides. Compare matching viewport sizes across the shell, populated child
  pages, settings drilldowns, and native chrome. A token palette or passing
  functional tests alone does not prove fidelity. Keep missing runtime evidence
  and subjective craft deductions explicit.

- Review navigation continuity separately from static fidelity: distinguish a
  document reload, route data revalidation, and avoidable local-state reset.
  Record child-page results individually; an overall craft score cannot hide
  unverified loading, empty, error, narrow, keyboard or theme states.

- For save or review flows, continue through the resulting Person or other
  destination and reload it. Verify its populated layout and saved content;
  the originating review card or success receipt alone does not validate the
  destination's styles, navigation, or persistence.

- Inspect the shell with zero recent items and the account menu open. Keep a
  consistent icon column and row rhythm; avoid orphan empty-state icons, repeated
  history links, native title tooltips over menus, and duplicate primary
  destinations in account controls. An empty history group can be a single
  navigable row; reserve explanatory empty states for the destination page.

- Compare Card and List for semantic parity.
- Trace at least one current fact to exact evidence and through history.
- Test long names, missing avatars, no tags, three tags, stale evidence, and an
  ambiguous identity.
- Test keyboard navigation and a textual graph alternative.
- Test light, dark, reduced-motion, desktop, and mobile states that are in
  scope.
- Confirm that color, card elevation, and large type remain scarce.
- Confirm that no visual device ranks a person.
- Run the repository's relevant lint, typecheck, tests, and build.

Report which canonical objects, provenance states, and attention hierarchy the
design uses.
