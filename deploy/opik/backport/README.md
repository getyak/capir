# Opik response ownership regression tests

GET-337: [Fix recurring Opik connection pool failures](https://linear.app/getyak/issue/GET-337/fix-recurring-opik-connection-pool-failures)

This directory currently contains **test-only patches** for official Opik commit
`dd40343a223ec8d0ab11eafc5f88cbf18532c0ac` (release 2.2.45).
There is no production fix, dependency upgrade, database change, new service
configuration, image, or completed test/build result here.

The parent delivery owner must observe meaningful RED on this exact baseline
before adding a production patch. A compilation, dependency download, test
discovery, Java-agent, or formatting failure is a harness failure, not RED.

## Apply order and initial slice

Apply patches from the root of an isolated checkout of the exact upstream commit:

1. `0001-health-ownership-tests.patch` adds a test-only transport fixture and six
   tests of the real pinned `ClickHouseHealthCheck` /
   `AbstractClickHouseHealthCheck.executeProbe` implementation.
2. `0002-dataset-query-ownership-tests.patch` uses that fixture and adds five
   parameterized tests for each actual public DAO operation:
   `copyVersionItems` and `editItemsViaSelectInsert`.

Start with patch 0001 and its health test selector if a smaller first RED is
needed. The expected baseline behavioral failures are acceptance of the late
response after health timeout/interruption. Then apply patch 0002. Both DAO
operations should additionally fail the late-response ownership assertion after
subscriber cancellation. The close-failure policy cases should also fail because
the baseline reports cleanup failure as a failed write.

These are predictions from source review, **not observed results**.
There are six health cases and ten parameterized DAO instances.

## Test boundary

The tests use the production health/DAO classes, real CompletableFuture,
QueryResponse, OperationMetrics, Reactor chains, context propagation and the
production ZeroRowsRetryPolicy. Only each Client.query I/O boundary is replaced
with a controlled future. The response fixture implements the small transport
interface; its close counter observes the real QueryResponse.close delegation.
It contains no copy of the production cleanup, cancellation, retry, SQL-building
or pooling implementation.

The normal, failed-acquisition, mapping-failure and close-failure cases protect
single ownership and original error reporting. For successful DAO writes, a
cleanup failure must not cause a failed/retried write; health checks remain
unhealthy when their close fails. Fixture data and identifiers are synthetic.

This first slice does **not** prove an actual HTTP pool recovers, reproduce host
tail latency, test the R2DBC path, or deterministically cover cancellation in the
post-delivery/pre-mapper scheduler window. Do not claim those gates passed.
A later isolated transport/pool integration test should use the actual v2 client
and controlled delayed HTTP responses or disposable ClickHouse, with no resident
network/volumes. The parent owns that follow-up scope and serial execution.

## Remote runner inputs

The exact upstream POM is standalone: it has no parent POM or root reactor.
Use a shallow sparse checkout of `apps/opik-backend` plus root `LICENSE`.
Keep the entire backend source/resource/test directory so existing compilation
and Lombok/MapStruct generation retain their normal inputs.

The compiler configuration requires Java **25** (source and target).
The pinned upstream Dockerfile uses the tag
`maven:3.9.16-amazoncorretto-25-al2023` for building and Corretto **25.0.3**
for its runtime image. The source Dockerfile has no build-image digest. A current
read-only Docker Hub registry resolution produced the immutable multi-platform
index `sha256:1a15a026421093fa86053b17b116ede95acfa28346e5cf3e154943bc01db7119`;
the response-byte hash matches the registry digest header. This is a current
resolution, not proof of the historical builder used for the resident image.
`manifest.json` records the platform child digests and Apache's official Maven
download-checksum URL. No image layer or Maven/JDK binary was downloaded locally.
The remote runner should read back `mvn --version` and `java -version` from its
pinned build container. Compiler plugin
management pins maven-compiler-plugin **3.15.0**. An exact supported Java 25
patch/vendor and downloaded distribution checksum must be recorded by the
runner; this directory does not claim a JDK binary was downloaded or verified.

Dependencies already declared by the pinned POM include JUnit Jupiter,
Mockito core/JUnit extension, AssertJ **3.27.7**, and reactor-test **3.8.0**.
JUnit and Mockito versions come from the imported Dropwizard **5.0.2**
dependency management. No new test dependency or POM edit is required by
these patches.

The following are proposed runner commands, not commands executed here.
Run serially from the backend directory after checking source/patch hashes:

```sh
mvn -B -ntp -Dspotless.skip=true \
  -Dtest=Get337ClickHouseHealthCheckOwnershipTest \
  -DfailIfNoTests=true test
mvn -B -ntp -Dspotless.skip=true \
  -Dtest=Get337DatasetItemVersionResponseOwnershipTest \
  -DfailIfNoTests=true test
```

The Surefire selector limits execution, not compilation: Maven can still compile
the module's existing test sources. Preserve complete compiler errors separately
from expected assertion failures. The skip disables an upstream validate-phase
formatter that would otherwise rewrite files while collecting RED; it is not a
formatting-pass claim. New regression code has not been formatted or compiled
here. Use no inherited production environment, provider/account key, Infisical
injection, Docker socket or production database endpoint. These unit tests never
construct a real HTTP Client or start a database.

Before GREEN, preserve the RED artifact and then add the reviewed production
patch. Existing upstream tests explicitly assert `cancel(true)`; their obsolete
expectations will need an intentional update in that later phase. Do not change
the new failing expectations to make RED pass.

## Source, schema and licensing

`manifest.json` records fetched official source hashes and local patch hashes.
All source URLs are immutable full commits. The tests are newly authored for
GET-337, informed by the public API and the reported
[upstream OPIK-8576 defect](https://github.com/comet-ml/opik/pull/8606);
they are not a claim to reproduce upstream PR test results.

`LICENSE.upstream` preserves the exact upstream Apache-2.0 license and Comet ML
notice. New Java test files use the same SPDX identifier. Preserve upstream
LICENSE/NOTICE material when building or redistributing a candidate.

A future same-schema production backport must leave **every file** beneath
`apps/opik-backend/src/main/resources/liquibase/` byte-for-byte unchanged.
Record that catalogue before and after patching. These test-only patches add
files only under `src/test/java`; they contain no migration or production hunk.
Do not run the resident migration script or startup script to validate them.
