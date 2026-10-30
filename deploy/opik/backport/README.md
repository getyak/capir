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
The other six DAO instances passed. Run 41033225919, artifact 12967141149,
then passed all 49 fixed health/DAO instances with zero failures, errors or skips
and Maven exit 0. Independent review checked the raw XML and exact protected
source catalogue. PR #498 merged as `353297697054392efefc9d393984645a19ad4339`.
No patched image or resident repair is established by that source result.

The new test-only baseline ran in CI 41039992804, artifact 12969528485, from
PR #501 head `1379144e18a53d0a6bf5c75168259c5330fc7ee1`. All 21 instances
executed: nine assertion failures, zero errors and zero skips, Maven exit 1.
Both real HTTP controls passed. The HTTP regression failed at the final second
healthy-probe assertion after its connection-timeout/server-request checks;
both DAO handoff instances failed at the paused-close assertion after delivery
and barrier entry. The original health two and DAO four failures remained.
All 1576 protected entries were unchanged before, after patching and after
Maven. This is meaningful pinned-source and real HTTP-boundary RED; it does not
establish the resident incident's cause. The failed baseline remains retained.

The subsequent fixed-stage run 41041631471, artifact 12971105806, from head
`8c2c268eb570be6731b7c8a29cb12f92f7ac8182` passed all 54 instances with zero
failures, errors or skips and Maven exit 0. Its nine raw XML files contain eight
nonempty leaves; independent review checked the unchanged frozen tests and the
three allowed production modifications. These are immutable historical results.
Every later candidate still needs its own fresh run and latest applicable CI;
the manifest's observed history never grants admission by itself.

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
6. `0006-http-pool-integration-tests.patch`: three tests using the real SDK and
   Apache HTTP pool against an owned loopback server. First validate the complete
   native-compressed SELECT response with the real reader, then prove an unread
   response retains the sole lease until public close, then test a health timeout
   followed by late delivery and a second probe. The factory-derived client
   preserves async/native LZ4 configuration while explicitly overriding pool
   size, lease deadline, retries and its observed executor. This is not an
   unchanged production factory instance or a real ClickHouse server.
7. `0007-dataset-cancel-handoff-tests.patch`: two actual DAO operation instances.
   A narrowly owned public scheduler hook holds the delivered response before
   its mapper runs. Cancel, observe cleanup while held, release the mapper and
   verify no duplicate close, signal or query. No production test hook or private
   scheduler/pool reflection is used.

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
| all | baseline | 0001, 0002, 0006, 0007 | Health six, DAO ten, HTTP three and handoff two: 21 total |
| health | health-fixed | 0001, 0003, 0004 | Frozen health six and 33 existing upstream instances |
| all | responses-fixed | 0001–0007 | Health 39, DAO ten, HTTP three and handoff two: 54 total |

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

The parent owns workflow integration and serial execution. The test-only
`all/baseline` was collected in a fresh checkout and independently reviewed at
the exact failure sites above. Both HTTP controls passed; compilation, fixture,
parsing or unrelated deadline failures cannot establish the intended RED. That
failed job remains failed. The final required job now selects:

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

The original tests use real production classes and futures/responses with a
controlled Client query boundary. Patch 0006 additionally exercises the actual
SDK/HTTP pool; patch 0007 adds the scheduler cancellation boundary. Both new
patches compiled and ran in the test-only baseline. Their fixed-stage execution
also passed in the historical 54-instance run above. They cannot establish
the host incident's root cause, R2DBC safety, a resident shaded JAR or live
recovery. Those gates remain separate. Existing upstream tests with the old
cancellation contract are explicitly adapted rather than ignored.

For the two query operations, consumption remains on boundedElastic. The resource
is owned by usingWhen before the scheduled mapper runs; cancellation in that
window runs cleanup independently of mapper execution. Cleanup runs inline and
absorbs only its own Exception, so successful written-row counts and original
acquisition/mapping errors are preserved. SQL, context, instrumentation, edit
count mapping and ZeroRowsRetryPolicy remain unchanged. This structural argument
does not replace the actual execution of the new handoff and HTTP tests. The
retained 49-instance GREEN cannot satisfy the extended 54-instance contract.

Every Liquibase resource must remain byte-for-byte unchanged. Preserve all
existing MySQL, ClickHouse, MinIO, Redis and ZooKeeper volumes and unrelated Capir
PostgreSQL data. No startup/migration script or live service is used for source
verification. A future resident change requires a normal clean complete release,
exact image/source provenance, fresh relevant backups, rollback references and
real readback. Preserve the prepared backend148 identity.

`LICENSE.upstream` retains the exact Apache-2.0 license and Comet ML notice.
All newly authored Java tests retain their SPDX header. Preserve that legal
material when distributing a candidate.

## Building an immutable JAR

The package milestone is separate from an image, import, activation or resident
recovery. The same Actions job first runs fresh fixed54, then passes its actual
producer context to [the package helper](../../../scripts/prompts/package-opik-backport.py).
Historical manifest observations never authorize this step. The context binds
the clean checked-out Capir revision, job/run attempt, private source and Maven
repository owners, actual staged index and applied-file hashes, start time and
final regression receipt hash. Old receipts without these facts are rejected.

### Explicit official-default compile profile

The pinned official Docker build copies pom.xml, spotless.xml and src before
compilation; it copies lombok.config only into the later runtime stage. A full
source bind exposes that configuration during our build and is not the same
compile context. Both new regression and package containers therefore use
`opik-dd403-official-docker-build-v1`: one build-only read-only bind containing
exactly `config.stopBubbling = true` plus LF at the project Lombok config path.
The protected original configuration remains unchanged on the host.

The [shared profile helper](../../../scripts/prompts/opik_compile_profile.py)
preserves the private 0400 override in the fresh regression receipt directory.
The original full source catalogue and the effective one-config-overlay
catalogue have distinct hashes. A wrapper in each actual Maven container
observes the effective regular file, exact bytes/hash, owner/mode and read-only
mount before exec. Its first-line log proof binds the container ownership
token, phase and observation time. Fresh54 receipt and same-job package context
must carry the exact matching profile/proof; legacy no-profile receipts cannot
be upgraded. The package archives this input evidence, emits its own container
proofs and records the applicable catalogue when deriving only the root POM
version. Known command outcomes and writer settlement precede proof parsing.
The [profile admission tests](../../../scripts/prompts/test_opik_compile_profile.py)
cover missing, changed and self-consistently rebound claims through the real
fixed54 validator.

This profile is an explicit compile-input correction, not proof of binary
equivalence. The previous actual package remains admitted in its recorded
scope. A new real fixed54/package run and independent full application-class
comparison must explain all changes beyond the three declared Java source
families before accepting runtime compatibility. No class post-processing,
mixed JAR or resident change follows from a unit fixture or profile ID alone.

Before deriving the release version, the helper preserves and rehashes all raw
fixed54 reports and receipt material. The source POM's sole root project-version
derivation is explicit; dependencies, plugins and all other bytes stay fixed.
Standard clean/package regenerates the owned target using the same pinned
toolchain and m2. Ordered runtime coordinates and actual artifact hashes must
agree before and after; complete JAR entries, required classes and all 229
source migration resources receive separate admission. The shaded Liquibase
dependency shares the `liquibase/` namespace: its classes and library resources
are separate from application migrations and require matching paths, bytes and
hashes in the actual resolved dependency JARs. Extra namespace entries without
that explicit graph remain rejected. The boundary is covered by the
[namespace tests](../../../scripts/prompts/test_opik_package_namespace.py).
This does not prove loaded classes or the resident JAR.

Some pinned dependencies carry empty Maven metadata directories with the exact
observed Unix attributes `0xffff0010`. Only that verified empty, stored directory
shape under `META-INF/maven/` is compatible; its header and decoded emptiness
are checked from the same opened archive, and dependency provenance records
the original metadata. Files,
symlinks, special types and other unknown directory shapes remain rejected.
The [ZIP metadata tests](../../../scripts/prompts/test_opik_package_zip_metadata.py)
cover the observed shape and malformed variants. This is not a general ZIP
mode normalization or a filesystem extraction path.

Owned-container settlement is a source-mutation boundary. A cleanup attempt,
client exit, missing CID or failed inspect is insufficient on its own. Confirm
the exact owned resources are gone; an unresolved writer blocks further
commands and source POM restoration. Preserve unknown outcomes rather than
overwriting a potentially active source. The deterministic contract lives in
[cleanup tests](../../../scripts/prompts/test_opik_package_cleanup.py) and the
helper, rather than duplicate runtime-state prose.

CI retains the original regression receipt and the package output, including
the archived raw reports when clean/package consumes the original target.
Actual results belong to each invocation's artifacts. A package does not change
the Compose pin or run a service. A later reviewed image and coherent clean
Capir release must preserve the runtime, all stores, rollback references and
actual Engine identity; config and manifest digests are distinct identities.
