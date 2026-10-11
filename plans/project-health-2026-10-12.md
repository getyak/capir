# Project health audit and repair

## Outcome and boundary

Audit the complete tracked capri repository for concrete correctness, safety,
redundancy, architecture, structure and documentation problems. Repair confirmed
findings in sequential Pi + MiMo batches, with Codex owning independent review,
acceptance, PR delivery and merge. Preserve personal data, compatibility,
historical evidence, unrelated work and current product authority boundaries.

An audit cannot prove that software has no unknown defects. Completion requires
an explicit coverage record, disposition of every confirmed finding, no open
confirmed P0/P1 findings, current-head applicable CI, verified resident-service
deployment for runtime changes, and a merged PR. Do not turn suspected debt into
an invented defect or silently discard a supported surface.

## Baseline and existing state

- Frozen baseline: `e751b37a8692a33387b7325004d7532face32021` (`origin/main`).
- Source checkout has unrelated untracked evaluation, plan and browser output.
- This task owns its managed `project-health-oct12` worktree; Pi owns only its
  isolated task worktree and specified source paths. One active Pi writer per
  repository. Another active Pi task belongs to Brain, not capri.
- Initial tracked inventory: 2,109 application files, 81 package files, 114
  script files, 100 documentation files and 227 plan files. These counts include
  tests and assets, and are not claims of defects.
- Baseline documentation and architecture boundary checks passed. The source
  checkout documentation count includes local untracked material; acceptance
  will use the isolated committed tree.
- Resource guard: 65 GiB free; 105 Node/npm processes. Reuse existing tooling,
  serialize heavy checks, and do not interrupt other projects.

## Milestones

1. **Complete: evidence and coverage.** Inventory all tracked areas, trace risky
   production paths, identify duplicate/dead ownership and stale documentation,
   record exact evidence, severity, consequence and a proposed repair.
2. **Active: sequential implementation.** Give Pi one independently verifiable
   outcome per batch; inspect receipts and actual diffs before accepting.
3. **Pending: independent review and acceptance.** Fix confirmed review findings;
   run relevant negative-path checks and applicable repository gates. Deploy
   affected resident services from clean committed source and verify revision
   and changed behavior.
4. **Pending: PR, CI and merge.** Create a reviewable PR, bind all applicable CI
   and review evidence to its latest head, resolve failures, merge without
   bypassing protection, and read back final state.

## Evidence and decisions

The read-only Pi audit is task `20261012-013442-7a6fbff5`, based on
`4ee04b1883b50d7d708e72378a5aa39487a7834f`; its scope is the audit report only.
The audit report was independently reviewed and imported; implementation follows the ordered finding register. Parent synthetic probes independently reproduce
conflicting local journal writes (10/10 starts and terminal pairs accepted),
raw error content in backend logs, and ignored-output interference in docs checks.
Two Web limiter implementations retain expired unique keys without a bound.
Current canonical audience and review guidance also contain conflicting legacy
phrasing. These observations await synthesis with the repository-wide audit.

Baseline checks from the isolated tree: Agent 392 passed / 1 skipped, Agent Host
81 passed, backend 968 passed / 531 skipped, Web 2,147 passed. Typechecks passed.
Backend skips require isolated integration databases and do not establish those
paths. Policy tests passed after dependency setup, including 13 architecture
tests; the first architecture run failed solely because installation was pending.
CLI packaging tests passed: 230 passed / 1 platform-specific skip. No native builds were run.

Private working evidence is under the task artifact directory
`~/.codex/task-artifacts/project-health-2026-10-12/`; the registered rebuildable
test artifact is `/private/tmp/ai-test-project-health-oct12.2YTmvn`. Preserve
minimal sanitized proof in the delivery record before removing temporary output.

The audit report will live at `plans/project-health-audit-2026-10-12.md` while
work is active. It must separate confirmed defects, maintainability debt,
historical records and rejected suspicions. Final durable methods belong in
their existing canonical homes or deterministic checks; dated audit artifacts
must not become a parallel architecture specification.

No native simulator or native code change is required merely because the audit
reads native source. Native changes require the documented storage/session guard
and targeted native acceptance. No production personal records, credentials or
raw private evaluation evidence are audit inputs.
