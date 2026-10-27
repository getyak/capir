# GET-266: Human review status, optional diagnostics

## Outcome and boundary

The default Web conversation record answers whether work is still running,
needs a decision, failed, stopped, or needs checking. Tool counts, durations,
and implementation identifiers belong inside its existing inline disclosure.
Preserve the GET-251 hierarchy and GET-264 attachment/record ownership, exact
decision authority, retry identity, and persisted state projection. No native
logic, provider calls, billing, or unrelated issue changes are in scope.

## Evidence and approach

- Native Linear readback confirms GetYak/GET-266, In Progress, its current
  description, relations and screenshot. No canonical PR exists by title or
  branch. The advertised agent-context tool is unavailable on the server.
- Clean task branch and current remote main both start at
  `acc538f9b13af2a4b191ed903bfda401e81e4cfe` (GET-264, PR #455).
- `SessionExecutionRecord` projects governed decision state into
  `SessionExecutionCard`. Its summary currently contains tool counts and time;
  only live collapsed rows hide them with CSS. Move them into the disclosure
  body for every phase and use ordinary phase language in all five locales.
- The attached screenshot matches this component. Keep its decision cards and
  existing Escape/focus ownership. Failure/recovery and unknown outcomes stay
  visible through their existing state and controls.
- Initial resources: 273 Node/npm processes, 16.59 GiB swap, about 35 GiB free;
  kernel pressure level 2, not critical. Serialize checks, reuse offline package
  cache and resident services. No Simulator or cross-project cleanup.
- Registered task artifact: `/private/tmp/ai-test-GET-266.ZKgCBK`.
  Existing runtime, browser and device resources are shared, not task-owned.

## Milestones

1. **Complete:** focused disclosure regression, minimal presentation/copy changes.
2. **Active:** relevant conversation tests, lint/typecheck/docs and rendered desktop/narrow
   keyboard, detail, reload and truthful-state checks without paid model calls.
3. Independent native Codex review; resolve confirmed P0/P1 and bind to head.
4. One canonical PR, Linear backlink/readback, all applicable latest-head CI,
   protected ordinary merge and exact merge readback.
5. Clean-source resident Web deployment, real isolated test-space readback and
   interaction acceptance, run cleanup, Linear Done readback, Symphony event
   bound to the original generation/thread, and owned-resource cleanup.

## Completion evidence

Record tests, reviewer/head, PR/CI/merge, deployment revision/build ID and actual
authenticated interactions separately. Do not infer product acceptance from a
static capture or fixture test. Keep missing evidence and blockers explicit;
no empty PR or premature Linear completion.

Local evidence: all eight phase-disclosure cases failed against the original
summary; the modified component passes them. Focused revalidation passes 36
tests, including unknown review readback. The preceding conversation suite
passed 375 of 376; its stale copy expectation is corrected and a final run is
pending. Typecheck, affected-file ESLint and docs/architecture checks pass.
The docs budget failure was resolved within the existing canonical section.
