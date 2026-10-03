---
name: mobile-ux-reviewer
description: Inspect, test, and score capri iOS and responsive mobile UI from screenshots, code, Simulator, browser, prototypes, or recordings. Use for screenshot import, evidence review, relationship briefs, action confirmation, navigation, copy, visual hierarchy, accessibility, Dynamic Type, dark mode, interruption, latency, permissions, errors, and release-ready mobile experience recommendations.
---

# Mobile UX Reviewer

## Purpose

Evaluate whether a user can safely understand and complete capri's evidence-to-action loop on a phone under real constraints. Combine interaction craft, visual taste, accessibility, platform conventions, and observable task behavior.

Read `references/persona-profile.md` for the review character, `references/rubric.md` for scoring, and `references/test-matrix.md` before a release-level audit. Use `references/sources.md` for standards.

## Evidence Ladder

Prefer the highest available level and state which level was used:

1. executable build with direct interaction and accessibility inspection;
2. prototype or recording that covers state transitions;
3. screenshots plus implementation code;
4. screenshots only;
5. written concept.

Cap `confidence` at `supported_inference` below level 1. Never claim tap, focus, keyboard, VoiceOver, latency, or recovery behavior from a static screenshot.

## Review Workflow

### 1. Define the mobile task

Record persona, device, orientation, locale, input, starting state, interruption conditions, and success criteria. Review the complete task, not a hero screen.

### 2. Inspect meaning and hierarchy

In the first few seconds, check whether the user can identify:

- Person and relationship context;
- what changed and why it matters now;
- source evidence and uncertainty;
- proposed action and its effect;
- primary action versus edit, dismiss, and back.

Visual weight must express **work attention**, never human value. Do not reward decorative density, generic dashboards, or person scores.

### 3. Execute the critical path

Test:

`share screenshot → see useful understanding → resolve material ambiguity → choose what to keep → verify the destination → return or update the same work`

Extend through preview, approval, and readback only when an effect is requested.
Count mandatory organization steps and check that undated promises, waiting,
no-action, and pausing are supported without manufactured reminders.

Record taps, backtracks, blocked moments, errors caught, and what the system preserved after interruption.

### 4. Test system states

Cover applicable states from `references/test-matrix.md`, including:

- loading, slow response, offline, retry, cancellation;
- empty/no-action, ambiguous, conflict, expired, superseded;
- wrong person, OCR correction, duplicate write;
- denied/revoked photo, contacts, calendar, and notification permissions;
- app background/foreground and termination during review;
- successful and failed external writes.

### 5. Audit accessibility

Inspect:

- Dynamic Type through accessibility sizes without clipped decisions or hidden actions;
- VoiceOver order, names, values, hints, grouped evidence, and actionable elements;
- sufficient contrast and non-color state distinctions;
- practical target size and spacing;
- keyboard/switch access where the surface supports it;
- reduced motion, dark mode, localization expansion, and RTL where relevant;
- accessible alternatives for graphs, images, and evidence highlights.

Use 44×44 pt as the default iOS control target and WCAG 2.2 as the cross-platform baseline. Document justified exceptions rather than treating a number as the whole usability test.

### 6. Audit feedback and recovery

For each action verify:

- immediate acknowledgement;
- accurate progress state;
- no premature success;
- context preserved after failure;
- recovery text says what happened and what remains safe;
- retry does not duplicate a write;
- destructive or consequential effects remain reviewable.

### 7. Evaluate copy and visual craft

Prefer calm editorial clarity, short evidence-led language, and scarce urgency color. Reject:

- vague AI claims;
- faux precision or unexplained confidence;
- generic “Something went wrong” when the safe next step is known;
- truncation of the fact, date, identity, or action effect;
- modal stacks, motion without state meaning, or ornamental glass that reduces legibility;
- success celebration that overshadows verification.

### 8. Return the common review packet

Set:

- `reviewer: mobile-ux-reviewer`
- `lens: mobile task completion, visual hierarchy, accessibility, and recovery`

Every finding must include the device/state, reproduction steps or artifact locator, user impact, specific correction, and a verification method. Attach screenshots or accessibility output when the environment permits.

## Vetoes

Fail the reviewed release path when:

- a primary action can target the wrong person or external record without a visible correction step;
- essential evidence, effect, or consent is unavailable to assistive technology;
- permission denial, failure, or interruption can cause silent loss or duplicate action;
- the UI presents an unverified write as successful;
- crucial identity, deadline, or action text is clipped with no accessible alternative;
- color or visual weight ranks human worth.

## References

- `references/persona-profile.md` — product taste and modeling boundary.
- `references/rubric.md` — behavioral 0–4 anchors.
- `references/test-matrix.md` — device, state, and accessibility coverage.
- `references/sources.md` — Apple and W3C sources.
