# GET-337 — Prove response ownership at the real HTTP and scheduler boundaries

## Outcome and authority

Extend the reviewed response backport with observable evidence at two boundaries:
an actual SDK/Apache HTTP lease, and cancellation after DAO response delivery
before its scheduled mapper runs. Keep these results separate from a real
ClickHouse server, the resident shaded JAR and the host's recurring HTTP 503.

This follow-up depends on source PR #498. Its current base is the clean pushed
head `a5f81d57a6a6ea54cd2e2228c2948f7332a80ed5`; update to the latest merged main
before publishing this follow-up PR. The source backport has actual 49-case
GREEN and independent review; all latest applicable CI including iOS passed; #498 merged as
`353297697054392efefc9d393984645a19ad4339`. GET-337 remains In Progress through image integration and resident
recovery. This plan does not narrow that outcome to passing unit tests.

No new business account, model request, image, contact, Memory request or save
is authorized. No production database, provider, native connection or service
is used by these tests. Real Java, Maven, Docker and loopback tests run only on
the isolated GitHub runner, never on the shared Mac.

## Source and ownership

- Worktree: `/Users/cubxxw/.codex/worktrees/get-337-pool-integration/talent-signal`.
- Branch: `codex/get-337-pool-integration`.
- Existing test artifact: `/private/tmp/ai-test-GET-337-opik-regression.EuodIk`.
- `branch_value_audit` owns only test patch 0006; `opik_durable_research` owns
  test patch 0007 and, when explicitly assigned, the Python admission tests.
- Parent owns this plan, tests, CI, serialized execution, independent
  review, publication, clean release and acceptance. Do not overwrite other
  agents' files or another chat's source, account or resident service. The explicitly
  assigned source worker owns only the runner and manifest until freezing them.
- Frozen patches 0001–0005 and all production/POM/dependency/migration bytes
  retain their reviewed identities. No local dependency installation is needed.

## Evidence and design

Actual baseline health has six cases with two expected failures; independent
baseline DAO has ten with four expected failures, both zero errors/skips.
Fixed-source CI 41033225919 / artifact 12967141149 verifies all 49 health/DAO
instances with zero failures, errors or skips. Its 1576-file protected catalogue
changes only the three expected production files; all 230 Liquibase files are
unchanged. Independent review is preserved under `runtime/release-148af253`.

Resolved classpath is reactor-core 3.8.5 and reactor-test 3.8.0; the declared test
dependency is not proof of the resolved core. SDK/client/data are 0.10.0.
Preserve classpath-versus-loaded-class-versus-resident-JAR distinctions.

The read-only HTTP design and official source hashes are recorded in
`get337-http-pool-integration-design.json` and its companion Markdown in the
local release148 evidence directory. The production factory forces async and
native LZ4 but cannot inject a one-connection pool. Test 0006 copies its public
configuration into the real SDK, explicitly overriding only pool size, acquire
deadline, retries and a transparent observed executor. This is a factory-derived
client, not an unchanged factory instance. It preserves the real health class,
query format and compression.

The three HTTP cases must first prove valid compressed wire data with the real
reader, then prove a real unread response blocks a second lease until public
close, then use bounded latches to observe deadline, late response and the
actual operation Runnable finishing before a second probe. No private pool
reflection, fake response, sleep/retry stack, invalid body, early cleanup or
changed client may manufacture recovery. A nonhealthy second probe must first
prove connection-acquisition timeout and one server request before the main
healthy assertion is judged.

Patch 0007 drives each real DAO operation with the existing synthetic I/O
fixture. A public scheduler hook, scoped to the completing thread and one armed
task, holds the mapper's actual Runnable before delegation. Cancel while held,
observe one close, release and await actual completion, then verify no double
close, value, error or repeated query. Finally restores only the owned hook and
resources. Do not add a test-only production hook or replace the DAO with a
helper-only test.

## Milestones and expected gates

1. Freeze the two test-only patches and add admission counterexamples before
   extending runner/manifest selection. Parent observes meaningful assertion
   failures, not missing imports or toolchain errors.
2. The baseline `all` stage applies 0001, 0002, 0006 and 0007: five new Java
   files, no production or legacy-test changes, 21 expected instances. The nine
   predicted failures are the old health two, DAO four, HTTP lifecycle one and
   scheduler handoff two. This is a prediction, not an observed result. Both
   HTTP controls must actually pass; compilation, setup, timeout, control,
   unknown-case or skipped results do not establish behavioral RED.
3. The fixed `responses-fixed/all` stage applies 0001–0007: the same five new
   Java files, three exact production modifications and three exact legacy
   test modifications, 54 required instances. Every selected leaf/method and
   all fresh XML must be present with zero failures/errors/skips and Maven0.
   Full source, migration, before/after fingerprint and post-Maven checks stay
   strict. Preserve the old actual 49 evidence; it cannot satisfy the new54.
4. Parent performs serialized standard-library guard checks, docs checks and
   independent review, then publishes on current merged main. Collect actual
   baseline evidence first and preserve its failure; the final required job
   must run fixed54 successfully, without converting failed tests to a pass.
5. Independently review actual results. Then prepare a traceable immutable
   candidate image and an explicit clean final release under
   `docs/operations/testflight-local-backend.md`, preserving all real stores,
   current/rollback images, source pairs and prior occupied operations.
   Image construction, import, activation, revision readback, sustained pool
   behavior, canonical provider and product acceptance are separate gates.

## Resource and recovery boundary

Check `.agent-pause`, storage guard and host30GiB before work; resident actions
also need independently measured VM reserve and growth. Do not repeat the old
148 download/build/import/native, the one consumed trim, occupied deployment
intents, a provider failure or a deleted account. No global prune, DB rollback,
unrelated process shutdown or new pause removal is authorized here.

Current checkpoint: 0006 and 0007 are test-only, statically inspected patches.
No integration Java has been compiled or executed. Preserve failures and
recover from exact receipts; never infer real HTTP, native or resident success
from a plan, source patch, mock or model explanation.

## 2026-10-30 parent checkpoint

PR #498 is merged; this worktree has fast-forwarded to its merge commit without
replaying a source change. New patch 0006 is frozen at
`8085881a877988024414ef6af8c3eb95c40f16fad2f7e45680827c4b29cb6bef`,
and 0007 at
`1762d37fdb01c641f8f31a644617d7c0650d9837b14b7190b225855e4c3b8def`.
The two tests received independent static review with no confirmed P0/P1/P2.
The baseline21 execution below is the first actual run of these integration tests.

Parent observed the old runner reject the new 21/54 contracts: 24 guard tests
produced 14 assertion failures, zero errors. One earlier tamper fixture used a
symlinked temporary parent and is preserved as a harness failure, not behavioral
RED; the actual resolved-parent run is separate. After the minimal extension,
all 24 stdlib guard tests passed, and all seven CI scope/aggregate tests passed.
The runner still verifies exact paths, file modes, source fingerprints, protected
production/migration catalogues and post-Maven state. The initial workflow at1379144e explicitly selected baseline21 and preserved its failure.
After the actual independent review below, the final candidate selects fixed54;
it cannot merge until that latest applicable CI succeeds.

## Actual HTTP/handoff baseline and final candidate

CI 41039992804 / artifact 12969528485 ran all21: failures9, errors0, skipped0,
Maven1. Both HTTP controls passed. The HTTP failure reached the final second
healthy assertion after proving the public connection-acquisition failure and
one server request. Both handoff instances reached the paused-close assertion
after their response delivery and actual scheduler barrier. Health2 and DAO4
remain the known baseline assertion failures. Only five new regular tests were
applied; all1576 protected entries were identical before/after patching and
after Maven, with no production change. Raw artifact SHA256:
`4f01742c6c4676f756027ff0108678c3327954250d32edf1f38588862fd49060`.

Independent review confirmed those exact sites and controls. The final workflow
now selects responses-fixed/all54; no integration patch or production patch was
changed to obtain this baseline. Its first actual54 result at8c is GREEN (run41041631471/artifact12971105806);
latest applicable CI remains required for subsequent commits. Meaningful baseline RED is not fixed54 GREEN, image provenance, resident
503 attribution, ingestion/recovery or original product acceptance.

## Evidence-metadata correction

Independent final-stage review found one P2: obsolete duplicate baseline21 and
known-gap placeholders contradicted the recorded actual baseline. Remove the
duplicate unexecuted profile and keep a single observed baseline record. Record
the independently verified54 run at8c as immutable historical evidence, with
its source/run/artifact binding. Do not represent it as permission to skip a
subsequent candidate's CI or continually rewrite manifests to self-attest each
new commit. This correction changes evidence metadata and documentation only;
workflow, runner, guard tests and all seven patches stay unchanged.
