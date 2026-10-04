# Sessions and People retrieval refinement

Status: complete. Implementation, real-surface review, and focused verification passed.

## Outcome and boundary

Make both native retrieval pages searchable and filterable, reduce competing
row chrome, and distinguish unread Sessions with restrained elevation and type.
Keep Person identity, provenance, Session read persistence, page gestures,
context menus, deletion confirmation, and unrelated work intact. Preview data
only is used for screenshots. No external writes or release deployment.

## Evidence and direction

- Sessions currently has no search/filter; People uses heavy stroked controls.
- People combines a disclosure arrow, timestamp, and a separate actions menu,
  leaving little room for names and contextual metadata.
- Current cards share the same stroke and material regardless of read state.
- The app is native SwiftUI; Apple HIG and native API documentation govern
  implementation, rather than CSS values from the iOS 27 reference skill.
- Compare the current bordered direction with quiet content surfaces and
  selective unread elevation on the actual iPhone Simulator before handoff.

## Milestones

1. Complete: capture installed Sessions/People and inspect the visible hierarchy.
2. Complete: implement shared search/filter chrome, local Session retrieval policy,
   simplified rows, and explicit accessible read-state semantics.
3. Complete: verify real search/filter/menu/read transitions, light/dark and AX5 layout;
   run focused checks and save accepted screenshots with review notes.

## Completion evidence

Before/after screenshots, focused retrieval policy tests, relevant native UI
checks, successful build/localization/docs checks, and a reviewed scoped diff.

## Environment

The initial build is queued behind another task's machine-wide iOS check.
Do not interrupt that task or bypass its build lock.

## References

- [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Apple lists](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)

## Final verification

- Captured and inspected nine native screenshots; [review and artifacts](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-ios-retrieval-design/README.md).
- Eight distinct focused tests passed across initial and corrective runs. The
  initial run exposed reset hit-area and accessibility-identifier problems;
  both were fixed and both affected interaction tests passed on rerun.
- Debug Simulator build, localization, docs, and scoped whitespace checks passed.
- The machine-wide lock was respected and released. Temporary builds and full
  xcresult bundles are classified under `/tmp/talent-signal-retrieval-design/`.
- Screenshot baselines are from the previously installed Debug build, explicitly
  distinguished from the dirty current-source revision. No deployment or
  external effect was performed. Real-device and VoiceOver speech testing were
  outside the verified scope.
