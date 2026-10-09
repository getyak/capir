# Lab V2 first delivery

## Outcome

Implement the first delivery approved in the Lab V2 design: a useful native
device Lab plus one synthetic-input, real-model comparison loop. Preserve the
existing deterministic Lab as an explicitly named secondary task.

## Boundary

Device work includes app/environment information, temporary appearance preview,
rebuildable URL cache cleanup, session sign-out, and isolated onboarding replay.
The real-model task reuses the existing governed Chat provider and compares two
server-approved configurations. No candidate data, arbitrary endpoints, global
model changes, business writes, or automatic release promotion are introduced.
Full runtime environment switching, online experiments and Instruments-level
profiling remain later phases from the approved design.

## Milestones

1. Complete: durable authenticated experiment contracts and real executor.
2. Complete: native device Lab and experiment UI, reachable offline.
3. Complete: verified backend recovery/isolation and native tasks on Simulator;
   inspected light/dark/accessibility layout and fixed observed issues.
4. Complete: reconciled ADR 0012, delivery and iOS documentation; preserved exact proof.

## Observable completion

- Internal builds expose useful device actions with or without remote capability.
- A real comparison records its actual provider/model, frozen synthetic input,
  duration, usage availability, and failures; lost responses recover by stable ID.
- Destructive actions have scoped confirmation; cache cleanup preserves durable
  capture/draft/recovery stores and onboarding replay is explicitly isolated.
- Focused backend/iOS tests and real native interaction pass. Live provider proof
  depends on existing authorized configuration and is never replaced by a stub
  without disclosure.

## Existing state

Untracked design draft/plan from the prior turn are retained. `.pnpm-store/` and
the unrelated MX01 evaluation artifacts belong to existing work and are untouched.
One owner implements and verifies this slice in the current working tree.

## Verification record

- [Dated evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-04-lab-v2/README.md) owns
  screenshots, live provider evidence, scope and remaining device-release gaps.
- Live proof used exactly two configured `glm-5.3` calls on synthetic evidence.
  No second model was configured; the UI explicitly calls this repeatability.
- Fixed semantic request hashing after inspection showed that JSON key order
  could vary across mobile retries. The database proof now tests reordered keys.
- Fixed asynchronous cache feedback and verified effective AX5 rather than
  trusting a launch argument. Removed decorative icons at accessibility sizes.
- Temporary proof API/database are isolated from the existing internal service.
  No TestFlight upload or production migration is part of this delivery.

## Completion

Completed the approved first slice. Backend checks, PostgreSQL failure/recovery
proof, five native unit tests, five native UI journeys, corrected effective AX5
verification, Release compilation, localization, Wiki and documentation checks
passed. The evaluation records remaining physical-device/VoiceOver coverage and
deferred scope. Temporary proof services were stopped and their disposable
database removed after preserving synthetic evidence. Existing user work and
the internal TestFlight backend were preserved.
