# Web journey audit — October 7

## Outcome and scope
Experience and review every discoverable ordinary Web flow against frozen
criteria, from signed-out entry through capture/conversation, retrieval, review,
time, account settings and recovery. Report each flow separately. Exercise
reversible writes only in the owned synthetic capir workspace. Do not authorize
real external connections, communication, payment or provider enrollment.
Native-only and unavailable capabilities receive named limits, never a pass.

## Baseline
- Resident source: `b50b22e1fa4723ef1da569f655612da1c7d3b2a3`, build
  `u60F5QOMk1MCwFmJ3SuAQ`, HTTPS port 10443. It includes parallel changes after
  the preceding craft iteration; old captures are not evidence for this audit.
- Managed worktree based on that exact source. Original dirty checkout is
  preserved. Read the active receipt again before reporting or deploying.
- In-app browser entry timed out. Use an isolated headless Chrome context for
  current-run screenshots, DOM, keyboard, performance and network behavior.
- One owned expiring synthetic daily capir run. No personal browser state.

## Frozen criteria
| Dimension | Observable criterion |
| --- | --- |
| Clarity | Within five seconds, the operator can name the page purpose and smallest next action; label contradictions and competing primaries recorded as craft findings, not human-study results. |
| Discoverability | Primary destinations reachable within two deliberate actions from the workspace; account utilities within three. Record actual step counts. |
| Completion | Every attempted supported flow ends in a verified destination/readback, truthful no-action or actionable recovery; record blocked and partial flows separately. |
| Continuity | Back, reload and cross-page return retain saved state; in-progress draft/search loss is explicitly checked. |
| Feedback | A pending operation has an observed state; no fabricated result. Failures preserve input and offer recovery. |
| Visual resilience | Inspect 1440/768/390/320px, light/dark, reduced motion and 200% text. No page-level horizontal overflow, clipped required controls or artificial blank scrolling. |
| Access | Main actions have accessible names, visible keyboard focus and usable reach. Project primary touch targets aim for 44px. Text contrast target 4.5:1 (normal) or 3:1 (large); inspect actual computed/rendered colors. No full compliance claim. |
| Speed/stability | Laboratory LCP ≤2.5s, CLS ≤0.1; record interaction event timings where supported with a 200ms target. These are lab samples, not field p75 or verified field INP. |
| Trust/control | Scope, uncertainty, source path and consequence remain distinguishable; inspect evidence and history, cancellation and owned deletion. No external effect without a separate human decision. |

Performance targets follow [Web Vitals](https://web.dev/articles/vitals).
Contrast and reflow references are W3C
[contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and
[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Milestones
1. Completed: enumerate current visible routes and journeys; capture and inspect
   each important step, with metrics and findings tied to numbered captures.
2. Review confirmed problems and source paths. Fix appropriate issues while
   preserving parallel changes; delegate substantial code through Pi/MiMo Pro.
3. Verify fixes and affected resident services if runtime changes occur; save
   full audit report, stop the owned run, remove credentials and temporary
   copies after preserving evidence. Report actual coverage and blockers.

## Completion evidence
Current-run screenshots and a per-flow report containing step, purpose, health,
tested metrics, findings and explicit limits. Objective pass counts and
subjective craft judgments stay separate. No overall score conceals a blocked
core flow. User design approval and native acceptance are not claimed.

## Verified outcome

The operator audit is complete with explicit restricted-path limits. Formal
evidence is in the ignored local artifact directory
`output/evaluation/2026-10-07-web-journey-audit/`: `report.md`, `gallery.html`,
`steps.json`, 170 inspected/admitted images from 205 captured states, fresh
Web Vitals samples, contrast/reflow data, deployment and cleanup receipts.
Capture count is not a flow success rate. Pending and excluded screens are
identified individually; some ordinary subcases remain untested in the report.

- Fixed and committed: null reminder coerced to an at-start alarm
  (`db5fbb5d`); competing creation surfaces and hidden-file-input overflow
  (`d16b3085`); creation card inner scroll cap (`5c5fb976`).
- Backend released clean from the previous resident backend lineage plus the
  validator patch: `12707f27d570469a44b236d798082696acfe6900`. Web fixes were
  deployed and then integrated by the concurrent owner into
  `429b23e9bea4dedefec68d16060a8871b27fa3c2`. Final actual settings readback
  at 19:08 Shanghai confirms both; older own Web source was not redeployed.
- Backend: 22 focused tests in two files, typecheck and clean Docker build;
  Web: 68 focused tests in three files, typecheck, lint zero errors/six existing
  warnings and clean final production build. Live reminder reload/ICS and
  composer/form behavior verified. No new PR CI or independent agent review
  is claimed. Pi was already owned by another task; bounded fixes were local.
- Final desktop fresh-document lab: nine LCP samples 92–572ms, CLS at most
  0.00037593. Earlier first workspace sample 2928ms remains a recorded failure.
  Tablet calendar CLS 0.148078125 fails the 0.1 target; a second shift probe
  confirms feed-arrival movement. Tab-only INP samples do not establish full
  interaction performance: earlier file/deletion events exceed 200ms, cause
  not isolated.
- Thirteen core responsive samples show no horizontal overflow; real mobile
  wheel/hit-test reaches a 122×44 submit above navigation. Six light/dark
  contrast samples meet applicable targets (5.65–17.95:1). Root font doubling
  is not browser-zoom or full WCAG acceptance.
- Owned test run `46b49c2d-e13c-4f55-8771-4a0c60651751` stopped; canonical
  status is `deleted`, cleanup error null. Browser closed, credentials excluded
  from formal evidence. Ordinary logout and protected redirect verified.

## Remaining craft backlog

See the report's evidence-linked findings before the next runtime slice:
stable tablet calendar loading; time-range review silently cleared by the
60-second refresh; internal source terminology and incorrect delete-progress
wording; search requires two Esc presses with a nonempty query; stopped test
authority described as a connection outage; inconsistent legacy theme/language;
isolating slow source interactions and improving image/source citation feedback.

Native, real OAuth/provider changes, mail registration, admin operations,
identity merge/reversal and external MCP grants were not accepted by this audit.
Further heavyweight builds were not started once the storage guard reported
24 GiB free, below its 30 GiB threshold. Other tasks' artifacts and the dirty
primary checkout were preserved. The unused clean detached wrong-lineage build
checkout was removed through Git; production and rollback checkouts remain.
