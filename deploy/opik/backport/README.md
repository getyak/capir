# Opik response ownership backport

GET-337: [Fix recurring Opik connection pool failures](https://linear.app/getyak/issue/GET-337/fix-recurring-opik-connection-pool-failures)

The exact upstream baseline is
`dd40343a223ec8d0ab11eafc5f88cbf18532c0ac` (Opik 2.2.45).
The remote baseline run 41021382879, artifact 12961264941, compiled that source
and ran all six frozen health cases: **two assertion failures, zero errors and
zero skips**. Timeout and interruption both discarded the late future response;
the other four ownership/error cases passed. This is a reproduced source defect,
not proof of the resident JVM's pool state or the original latency trigger.

The subsequent run 41028979099, artifact 12964489776, passed all 39 health-fixed
instances. Its separate DAO baseline ran ten instances with four assertion
failures, zero errors and zero skips: copy/edit each rejected late response
delivery after cancellation and each turned cleanup failure into a write error.
The other six DAO instances passed. The query-response production candidate below
has not been compiled or run; no patched image or resident repair is established.

## Patch roles

1. `0001-health-ownership-tests.patch`: frozen new health tests and their real
   QueryResponse transport fixture. Its bytes are unchanged.
2. `0002-dataset-query-ownership-tests.patch`: frozen new DAO copy/edit tests.
   Its bytes are unchanged. Applied by DAO/all baseline and responses-fixed.
3. `0003-health-late-response-fix.patch`: one production file,
   AbstractClickHouseHealthCheck. Acquisition failure preserves the future and
   closes any late response; acquired responses retain single ownership through
   mapping/close. Interrupted waiters still restore their interrupt flag.
4. `0004-upstream-health-contract-tests.patch`: explicit adaptations of the
   three existing upstream health test files. Five old cancellation assertions
   now require no future cancellation, and two obsolete method names are updated.
   Existing success, error, topology, toggle, read-only and interrupt assertions
   remain. This patch is separate from the frozen new regressions.
5. `0005-dataset-query-response-fix.patch`: two production files, AsyncUtils and
   DatasetItemVersionDAO. A QueryResponse-only helper suppresses future
   cancellation, closes discarded late responses and owns delivered responses
   through scheduled mapping and cancellation. Only the copy/edit query calls
   use it. Their competing try-with-resources owners are removed.

The production change follows
[upstream OPIK-8576](https://github.com/comet-ml/opik/pull/8606).
The frozen health patch keeps its abandoned-response helper inside the health
class. The new query-only helper adapts the upstream reactive ownership pattern
without changing insert response handling or other AsyncUtils behavior. Cleanup
diagnostics retain static context and exception class, not exception messages,
SQL, headers or payloads.
No POM, dependency, migration, data-model flag or provider changes are included.

## Explicit runner stages

The default `--stage baseline` permits only the selected new test additions.
It never applies a production patch.

| Suite | Stage | Applied patches | Required JUnit instances |
| --- | --- | --- | --- |
| health | baseline | 0001 | Frozen health six |
| dao | baseline | 0001, 0002 | Frozen DAO ten |
| all | baseline | 0001, 0002 | Frozen health six and DAO ten |
| health | health-fixed | 0001, 0003, 0004 | Frozen health six and 33 existing upstream instances |
| all | responses-fixed | 0001, 0002, 0003, 0004, 0005 | Health 39 and frozen DAO ten: 49 total |

The fixed health stage requires all 39 instances across the new class, both
nested existing abstract-health classes, existence checks and traces-topology
checks. Method families and multiplicities are explicit; skips remain forbidden.
A possible empty outer nested-suite XML is only a structural container and never
counts as a passed test. All required nonempty leaf suites must still be present.
If real Surefire XML differs from this source-derived profile, preserve it and
fail admission for review; do not silently accept missing methods.

The health-fixed stage remains health-only. responses-fixed requires suite all;
there is no flag or alias that silently adds production patches to a baseline.

The runner verifies every original source fingerprint before applying patches.
health-fixed permits exactly one modified production path and three modified
existing test paths. responses-fixed permits exactly three production paths
(the health class, AsyncUtils and DatasetItemVersionDAO) and the same three
existing test paths, all mode 100644 with explicit before/after
byte, SHA-256 and Git blob fingerprints. All patch hashes are locked in code.
All other production/schema files remain in the full protected catalogue;
the expected catalogue changes only the selected declared production hashes. It is
checked again after Maven. No protected file is simply omitted from comparison.

## Remote execution

Actual execution remains limited to GitHub-hosted Linux Actions. Each invocation
requires distinct absolute new work/receipt directories, the fixed public
upstream commit, the locked Maven/Corretto image, private bind-owner UID:GID and
task-owned cache. Source/dependency fingerprints, actual index paths/modes,
toolchain/image identity and fresh raw/parsed JUnit evidence remain separate.

The parent owns workflow integration and serial execution. After the new runner
guards and source review pass, the combined candidate invocation is:

```sh
python3 scripts/prompts/test-opik-backport.py \
  --work-dir "$RUNNER_TEMP/opik-responses-fixed-source" \
  --receipt-dir "$RUNNER_TEMP/opik-responses-fixed-receipts" \
  --suite all --stage responses-fixed
```

Baseline and health-fixed remain independently selectable for historical
comparison using fresh directories. No expected baseline failure is converted
to success: every invocation preserves Maven's real exit status. The observed
DAO RED authorized this minimal source change, not merge or deployment.

Maven selectors limit execution, not compilation. The fixed stage selects the
existing outer abstract-health class so JUnit discovers its nested checks.
Spotless apply remains skipped during collection so it cannot rewrite source.
Actual Maven exit codes, exact class/method/count admission and unchanged source
closure are all required. Compilation/download/provider-name issues are
infrastructure/admission failures, not automatically Java RED.

## Evidence and remaining acceptance

`manifest.json` owns immutable source URLs, corrected dependency fingerprints,
the fixed-stage before/after claims, patch roles and observed baseline result.
The source-fingerprint correction and earlier reports remain immutable in the
parent's local evidence history. Fresh verification never trusts a cached
`hash_verified` flag.

The pinned backend POM is standalone and requires Java 25. The official build
tag is Maven 3.9.16/Corretto 25, locked to the recorded OCI index/platform
digests. The runner records actual image identity and version readback; no
local Docker/Maven/build is needed for this source work.

These tests use real production classes and real futures/responses; only each
Client query boundary is controlled. They do not establish actual HTTP pool
recovery, tail-latency handling, R2DBC safety or resident acceptance. Those gates
remain separate. Existing upstream tests with the old cancellation contract are
explicitly adapted rather than ignored.

For the two query operations, consumption remains on boundedElastic. The resource
is owned by usingWhen before the scheduled mapper runs; cancellation in that
window runs cleanup independently of mapper execution. Cleanup runs inline and
absorbs only its own Exception, so successful written-row counts and original
acquisition/mapping errors are preserved. SQL, context, instrumentation, edit
count mapping and ZeroRowsRetryPolicy remain unchanged. This structural argument
does not replace a real post-delivery/pre-mapper cancellation test. That focused
DAO extension and a real SDK/loopback HTTP-pool reproduction remain separate
required stages after the first 49-instance GREEN; neither is implemented here.

Every Liquibase resource must remain byte-for-byte unchanged. Preserve all
existing MySQL, ClickHouse, MinIO, Redis and ZooKeeper volumes and unrelated Capir
PostgreSQL data. No startup/migration script or live service is used for source
verification. A future resident change requires a normal clean complete release,
exact image/source provenance, fresh relevant backups, rollback references and
real readback. Preserve the prepared backend148 identity.

`LICENSE.upstream` retains the exact Apache-2.0 license and Comet ML notice.
All newly authored Java tests retain their SPDX header. Preserve that legal
material when distributing a candidate.
