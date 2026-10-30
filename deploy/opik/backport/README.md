# Opik health response ownership backport

GET-337: [Fix recurring Opik connection pool failures](https://linear.app/getyak/issue/GET-337/fix-recurring-opik-connection-pool-failures)

The exact upstream baseline is
`dd40343a223ec8d0ab11eafc5f88cbf18532c0ac` (Opik 2.2.45).
The remote baseline run 41021382879, artifact 12961264941, compiled that source
and ran all six frozen health cases: **two assertion failures, zero errors and
zero skips**. Timeout and interruption both discarded the late future response;
the other four ownership/error cases passed. This is a reproduced source defect,
not proof of the resident JVM's pool state or the original latency trigger.

The health-only production patch is now a candidate. It has not been compiled,
run, built into an image, or deployed. DAO production code is unchanged and its
baseline has not yet run.

## Patch roles

1. `0001-health-ownership-tests.patch`: frozen new health tests and their real
   QueryResponse transport fixture. Its bytes are unchanged.
2. `0002-dataset-query-ownership-tests.patch`: frozen new DAO copy/edit tests.
   Its bytes are unchanged. Applied only by DAO/all baseline selection.
3. `0003-health-late-response-fix.patch`: one production file,
   AbstractClickHouseHealthCheck. Acquisition failure preserves the future and
   closes any late response; acquired responses retain single ownership through
   mapping/close. Interrupted waiters still restore their interrupt flag.
4. `0004-upstream-health-contract-tests.patch`: explicit adaptations of the
   three existing upstream health test files. Five old cancellation assertions
   now require no future cancellation, and two obsolete method names are updated.
   Existing success, error, topology, toggle, read-only and interrupt assertions
   remain. This patch is separate from the frozen new regressions.

The production change follows
[upstream OPIK-8576](https://github.com/comet-ml/opik/pull/8606).
It keeps the abandoned-response helper inside the health class, avoiding the
later upstream DAO/AsyncUtils architecture. Cleanup diagnostics retain the probe
name and exception class, not exception messages, SQL, headers or payloads.
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

The fixed health stage requires all 39 instances across the new class, both
nested existing abstract-health classes, existence checks and traces-topology
checks. Method families and multiplicities are explicit; skips remain forbidden.
A possible empty outer nested-suite XML is only a structural container and never
counts as a passed test. All required nonempty leaf suites must still be present.
If real Surefire XML differs from this source-derived profile, preserve it and
fail admission for review; do not silently accept missing methods.

The fixed stage is rejected for DAO/all. No DAO production patch is authorized.

The runner verifies every original source fingerprint before applying patches.
The fixed stage additionally permits exactly one modified production path and
three modified existing test paths, all mode 100644 with explicit before/after
byte, SHA-256 and Git blob fingerprints. All patch hashes are locked in code.
All other production/schema files remain in the full protected catalogue;
the expected catalogue changes only the one declared health-file hash. It is
checked again after Maven. No protected file is simply omitted from comparison.

## Remote execution

Actual execution remains limited to GitHub-hosted Linux Actions. Each invocation
requires distinct absolute new work/receipt directories, the fixed public
upstream commit, the locked Maven/Corretto image, private bind-owner UID:GID and
task-owned cache. Source/dependency fingerprints, actual index paths/modes,
toolchain/image identity and fresh raw/parsed JUnit evidence remain separate.

The parent owns workflow integration and serial execution. For example, use
separate directories for these two invocations:

```sh
python3 scripts/prompts/test-opik-backport.py \
  --work-dir "$RUNNER_TEMP/opik-health-fixed-source" \
  --receipt-dir "$RUNNER_TEMP/opik-health-fixed-receipts" \
  --suite health --stage health-fixed
python3 scripts/prompts/test-opik-backport.py \
  --work-dir "$RUNNER_TEMP/opik-dao-baseline-source" \
  --receipt-dir "$RUNNER_TEMP/opik-dao-baseline-receipts" \
  --suite dao --stage baseline
```

Do not convert an expected baseline failure into a success gate: the DAO command
preserves Maven's real failure status. Retain its artifact, inspect the actual
assertions, then decide the next separately tested source change. A failing DAO
baseline leaves CI failing; it does not grant merge or deployment authority.

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

Every Liquibase resource must remain byte-for-byte unchanged. Preserve all
existing MySQL, ClickHouse, MinIO, Redis and ZooKeeper volumes and unrelated Capir
PostgreSQL data. No startup/migration script or live service is used for source
verification. A future resident change requires a normal clean complete release,
exact image/source provenance, fresh relevant backups, rollback references and
real readback. Preserve the prepared backend148 identity.

`LICENSE.upstream` retains the exact Apache-2.0 license and Comet ML notice.
All newly authored Java tests retain their SPDX header. Preserve that legal
material when distributing a candidate.
