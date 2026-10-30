# GET-337: Fix recurring Opik connection pool failures

Linear: https://linear.app/getyak/issue/GET-337/fix-recurring-opik-connection-pool-failures

## Outcome

Keep the existing private Opik dependency healthy after slow ClickHouse responses,
without losing data or relying on recurring restarts. Restore a trustworthy path
for the remaining video-experience resident backend deployment.

This plan is active, not an implementation or acceptance claim. The initial branch
is `codex/get-337-opik-pool-recovery`, based on origin/main
`13f1d909290638b2d6014010414a1d55689d8f57` after a fresh fetch. The repository and
resident services have other active owners; preserve their work and releases.

## Scope and boundaries

- Own the focused Opik correction, regression coverage, source/deployment contract,
  linked PR, independent review and actual dependency acceptance.
- Preserve current and rollback images and every existing Opik ClickHouse, MySQL,
  Minio and other volume. No deletion or database rollback.
- Do not change provider, account, spending, conversation exposure or retention.
- Do not restart unrelated services, clear a pause marker, trim or globally prune.
- Original video, real conversations, credentials, headers and raw logs stay local.
- The previous isolated business run is deleted and its authorization consumed.
  This task does not grant another account, model request, image, contact or Memory
  write. Ask for that separately only when the concrete deployment is ready.

## Evidence and unknowns

The actual pinned Opik backend image labels identify version 2.2.45 and revision
`dd40343a223ec8d0ab11eafc5f88cbf18532c0ac`. Classified pool acquisition timeouts
persisted while a same-container direct ClickHouse SELECT 1 succeeded. One precise
recovery restarted the same image/container. It returned HTTP 200 briefly, then
returned 503 again at 13:35 China on 2026-10-30, about 47 minutes after restart.
The strict recovery receipt also reported Networks drift; preserve that failed
receipt and its bounded independent readback rather than changing it to success.

The official upstream [PR 8606](https://github.com/comet-ml/opik/pull/8606)
fixes a compatible mechanism: cancellation can strand late ClickHouse responses
and exhaust the pool. Its applicability to this pinned binary and the actual
local trigger still need verification. Source similarity is not a local causal
reproduction. A read-only actual jar listing succeeded; no archive was extracted
or application main class executed.

The target148 Node backend OCI/import/runtime checks are already complete. Its
`scripts/prompts/start-opik.sh` uses a fixed compose image and can restart an
unhealthy Opik backend during canonical startup. A correction must remain coherent
with that clean-source contract; a manual live image swap would be reverted by a
later canonical startup. Do not silently alter that source or coerce its image
provenance. Reuse the already-built Node image only if the exact runtime closure
and deployment authority are independently established; otherwise document the
necessary new target before any build.

The three application PG backups created 13:06 China are valid until 19:06, but
are not Opik ClickHouse/MySQL/Minio backups. No new dump is needed during research.
Any dependency upgrade needs an explicit migration/catalog/data/rollback review
and fresh appropriate backups before it touches the resident stack.

Local sanitized authority: video-review/progress.md and
runtime/release-148af253/opik-durable-research.json under the parent task's saved
artifacts. These contain exact immutable operation and evidence references.

## Milestones

1. **Active: establish mechanism and choose the narrow correction.** Verify the
   pinned upstream source, dependency versions, all affected cancellation paths,
   supported configuration, first fixed release and migration differences. Keep
   direct observations separate from inference. Do not change live configuration.
2. Add a meaningful regression that fails on the current behavior. Choose a
   supported configuration only if it eliminates the leak; otherwise evaluate a
   focused tested backport against a pinned upgrade. Avoid speculative changes.
3. Obtain independent review, pass applicable checks, rebase current main as
   necessary and create a linked PR with the same plain English title. Respect
   the shared host's resource and pause gates before any heavy build/test.
4. Deploy from clean committed source with appropriate data backups and exact
   version/source/image bindings. Verify unchanged protected services, real
   readiness and the canonical observation path, including a window longer than
   the observed recurrence interval. No fabricated traces or unauthorized model
   calls. Resume the video backend rollout only after dependency gates pass.
5. Read back issue completion only after real acceptance; otherwise retain an
   accurate recovery plan and open state. Clean only exclusively owned temporary
   resources after formal evidence and recovery references are saved.

## Rejected approaches

- Replaying the completed or failed restart, scheduling restarts, or simply
  increasing pool size: none proves the leak is corrected.
- Disabling readiness checks to hide the failure.
- Blindly upgrading the whole stack or replaying migrations without review.
- Borrowing another chat's test account or treating model prose as acceptance.
- Weakening retained-Web/main/source locks to get past concurrent releases.

## Progress

2026-10-30 13:52 China: issue created and independently read back In Progress with
all eight video issues related. Fresh branch/worktree created; no dependency
install, code change, test/build, image pull, model request or service action.
Read-only primary-source research agent remains active. Parent owns serial checks,
review, source integration and deployment; no duplicate work is dispatched.


2026-10-30 14:10 China: primary-source report completed (SHA fd73be9f...):
exact pinned health code has the cancellation/late-response defect. The official
fixed 2.2.86 adds 17 migrations, so evaluate a same-schema source backport first.
Bounded current log classification identifies v2 HttpAPIClientHelper frames, no
R2DBC frames in that sample; leased-pool ownership/local trigger remain unproved.
No second restart or production fix was attempted.

Test-only health and DAO patches, license, exact source fingerprints and pinned
Maven3.9.16/Corretto25 build-image metadata now exist under deploy/opik/backport/.
They have not been applied/compiled/run. Parent added a scoped job inside the
existing CI required aggregate rather than a separately unrequired workflow.
Actual aggregate-shell and Git-scope checks first failed and then passed (9/9).
Those results verify CI gating only, not Java RED or service recovery. Evidence is
in the registered task artifact /private/tmp/ai-test-GET-337-opik-regression.EuodIk.
The remote runner's tests are being prepared before its implementation; parent
will run them serially. Independent test-patch review is active.

If the Opik pin changes, use the existing normal complete clean-release contract
with a necessary new source target. Preserve148's source/image identity and
rollback references; do not introduce a split provenance protocol or relabel148.
Any new image/build must be justified by that new target, not repeat old research,
OCI/import/native work. Live Web/main continue to advance under GET329 ownership.


2026-10-30 14:18 China: all58 CI policy checks passed; initial57/58 failure was
an existing iOS gate fixture missing the new unrelated-job result, now fixed.
New remote runner tests were observed failing for missing implementation only
(10 tests,28 assertion subfailures,errors0); this is not Java defect RED. The
source worker may now implement only the runner; parent still owns execution.

Independent source review found one incorrect cached QueryResponse fingerprint.
The original source claim and research were archived immutably. The fixed public
Raw/Contents/Gitblob agree on6426B/SHA43035745...; the manifest was corrected
without test or production changes, and all three dependency entries were
reverified. Correction supplement SHA8c37c3e3... supersedes cached source/line
claims. No remote Java execution before metadata rereview and actual runner
review. This is encoded in runner byte/SHA256/Gitblob verification tests, rather
than weakening the source gate or expanding AGENTS guidance.


2026-10-30 14:42 China: source-metadata correction rereview passed. The first
runner10/10 GREEN was superseded by independent P1 incomplete-JUnit and P2 unsafe
Git-error findings. Expanded11 unittest cases produced10 assertion subfailures,
errors0, before implementation. The worker is now repairing only those two
boundaries; parent requires new GREEN and focused rereview before remote execution.
The health baseline remains unrun. Existing CI aggregate wiring review passed;
exact public/synthetic selected JUnit XML is now included in the remote artifact.

Documentation checks passed. pnpm11 automatically reused806 cached dependencies
in this new worktree (no downloads) before docs:check, despite no explicit install
command. The receipt was corrected and the old one retained. These active-worktree
dependencies were not cleaned; no old148 installation/build was repeated. Do not
run fresh-worktree pnpm commands again without checking automatic-install behavior.
The byte-exact upstream license contains its original whitespace-only line2; retain
that legal source, with a recorded exact-file exception to the local code whitespace
check. The repository secret, hygiene and action-pin checks passed their scopes.


2026-10-30 14:48 China: the focused runner repair passed11/11 stdlib tests,
including exact health6/DAO5x2 method families, zero skips and safe Git error
output. Final independent rereview passed (38fa37efe180b2b1e196e1632952dd75336475acf1e2416df51089e2d5bd984e).
Runner SHA08a78a87caa6c22ac223c7214386c79e26d80bc59892d7c9d467c0b5f5fc2ce2;
test SHA47213e9d8820047f18186e70635296e489b6f358e4a6bcaafbfafbd4127ec8de.
Prior false-green/error source and tests remain in immutable local history.
First remote health baseline is now ready for a draft PR after clean commit/base
update. It is not Java RED, a production fix, or deployment authority. Do not
merge this initial test-only draft before the defect is fixed and all gates pass.


2026-10-30 16:23 China: the settled b4 remote baseline (CI41021382879, artifact12961264941)
ran the six frozen health tests after source13 fingerprints and compilation.
Timeout/interruption rejected the late response completion with two actual
AssertionFailedError failures; four other cases passed, errors0/skipped0.
The protected1576 catalogue was unchanged. This is source-level Java RED, not
proof of the resident pool owner or original tail-latency trigger.

This source round adds0003, a health-only production patch for
AbstractClickHouseHealthCheck: acquisition failure preserves the future and
closes a late response; acquired mapping/close stays under one owner. It also
adds0004, an explicit test-only adaptation of the three existing upstream health
test files whose old expectations required cancellation. Frozen0001/0002 bytes
remain unchanged. No DAO production fix, POM/dependency or migration edit exists.

The runner now has an explicit baseline versus health-fixed stage. Baseline
permits only selected new test additions. health-fixed is health-only and locks
one modified production file plus three modified existing test files, each with
exact before/after fingerprints and mode100644. The complete protected catalogue
is retained: only the declared production health-file hash may change before
Maven, and nothing may change during Maven. No schema path is exempted.

The fixed-health profile requires new6 plus existing33 instances, including
read-only/toggle/topology/error cases. Its nested-suite names are derived from
the exact Java source; actual provider XML remains a required acceptance gate.
The parent owns precise raw XML upload and actual stage execution. DAO baseline
can run separately with suite dao/stage baseline in a fresh independent checkout;
its failure remains a real failing gate, never expected-RED-as-success.

Four Python stage/scope/JUnit guard cases were added (16 total). The stage
support was written with those tests before an isolated stage-runner RED was
observed: this round does not claim completed stage-runner TDD or GREEN. Parent
must establish the old baseline result and review/run these new guard cases
serially before a new remote run. Only AST syntax and static fingerprints were
checked by the source worker; no Docker/Maven/install/clone/test/model/service/CI
execution or Git commit was performed. The production health candidate still
needs independent review, actual39-case GREEN, image/runtime proof and the normal
clean complete-release/data/rollback gates.
