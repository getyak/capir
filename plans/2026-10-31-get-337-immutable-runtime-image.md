# GET-337: Build a minimal immutable Opik runtime image

## Outcome and boundary

Package the independently accepted complete shaded JAR in the exact official
Opik runtime base. The recipe replaces one application file and adds only
`io.capir.opik.*` provenance labels. A subsequent real image inspection must
prove that boundary before a coherent Capir release can consume the image.

This milestone introduces only the image Dockerfile, its versioned input lock
and this plan. It does not recompile Java, add a generic builder or workflow,
change Compose/runtime helpers, build/load/run an image, contact a registry,
start an entrypoint, migrate/provision a database, call a model or mutate any
resident service. Parent owns tests, Git, CI, resource admission, image work,
release integration and live verification. Existing source and evidence stay
intact; no additional permission flow is introduced.

## Accepted input evidence

The exact package is artifact **12997662015**, run **41099210888**, attempt 1,
job `opik-backport`. Workflow head label is
`8942eb8d3f93927cd1bf0d8e42e73fdb4241f4f6`; the actual producing checkout is
`4bf3a18e0bd8928ac3f61a1c9084b56488c8b70c`. They are different facts.
The ZIP is 180610043 bytes, SHA256
`2a63aae7c3d9a8c06dc2d08236788423f772f9e2e5b0e435d06561dfc192e0b1`.
Its complete `opik-backend-2.2.45.jar` is 192567739 bytes, SHA256
`280f348e4e2ac6b8ef53f4a5377742214e9393260b8e067caa24c2d0a1d3687c`.
Reuse these retained bytes; do not download or rebuild them again.

Independent review `get337-official-profile-package-12997662015-independent-review.json`
has SHA256
`31de9a6148ac81ac8389c81becc01c0189276bf57055e0a587ee15ebb5811bce`.
It accepted actual raw54 with no failures/errors/skips; same-container
compile-profile observations; same-job source/index ownership; settled writers;
restored original POM; 311 ordered runtime dependencies; all 102059 JAR entries
and 229 application migration resources. Compared with the saved immutable
base/resident JAR, only four classes in the three modified Java source families
differ. The nested DAO record differs only in LineNumberTable metadata. The
previous 340 unrelated class differences are now byte-identical; Bundle is
whole-class identical. Third-party payload, application resources and manifest
remain unchanged. These are full binary comparisons, not proof of loaded JVM
classes, applied database state, a new image or live recovery.

The base is exactly
`ghcr.io/comet-ml/opik/opik-backend@sha256:2ea3198d94b010404cd7108d41471382aa6e280485f2e1aad038093bb0fafa83`,
platform `linux/arm64`, upstream source
`dd40343a223ec8d0ab11eafc5f88cbf18532c0ac` / version 2.2.45. The parent retained
cold-base inventory `dd208e4076635b169dfbdcf206138e15d55bb51b1a78c38226f054933c4534b1`
and seven non-JAR source comparisons
`018ed107f5b711baf1c612adbbd800dfe7e2105ce997f2a6a4610d4ee1df3730`.
They bridge the selected exact base files to the saved runtime/source. A fresh
builder/image inspection is still needed; historical Docker identities and
resource samples are not new execution admission.

## Recipe and lock

[Dockerfile](../deploy/opik/backport/image/Dockerfile) contains immutable FROM,
one exact-name COPY and explicit provenance LABEL only. COPY installs the
whole JAR at `/opt/opik/opik-backend-2.2.45.jar`, UID/GID 1001:1001, mode 0644.
There is no wildcard, RUN, Maven, OS update, new runtime environment variable,
version suffix, entrypoint override or class-level replacement. Platform is
locked in the input lock and must be supplied explicitly by the parent build
and checked in the resulting image, rather than hardcoded in a FROM flag.

[Input lock](../deploy/opik/backport/image/input-lock.json) binds artifact, run,
attempt, job, both source identities, ZIP/JAR hashes and sizes, base/platform,
manifest/seven frozen patches and accepted proof-file hashes. Paths are public
repository/archive-relative inputs or fixed container destinations, never
private host paths, CIDs, PIDs, credentials, inherited environment or expired
runner Maven/source-directory commands. The lock is source metadata, not an
executable importer or an image acceptance receipt.

The parent adds `io.capir.opik.producer.revision` from the clean committed
Capir recipe checkout and `io.capir.opik.input-lock.sha256` from the exact lock
file when building. Those are distinct from the package checkout and upstream
revision. The lock records recipe SHA; neither recipe nor lock claims its own
final image ID, and the lock does not contain its own hash. Actual OCI digest,
config digest and host Engine identity are recorded externally after creation.

Keep `/opt/opik/original-opik-backend-2.2.45.jar` unchanged: 5575962 bytes,
SHA256 `61df95e2dc395cf1a9fdca871fe23a5fb9d5dffd5e5f474913f61a8daade137c`.
The seven selected startup/configuration files are also retained with exact
metadata/hashes in the lock. All base runtime configuration, organization
labels, Env, User, Cmd, Entrypoint, WorkingDir, Healthcheck and other runtime
settings are inherited. In particular OPIK_VERSION stays 2.2.45.

The exact shaded JAR retains its bundled license material; the repository's
`deploy/opik/backport/LICENSE.upstream` stays with source/distribution evidence.
The recipe does not add a new license file or other payload into the image.

## Milestones

### 1. Source preparation and independent review — active

- [x] Write only the three assigned files using already reviewed package/base
  facts; preserve earlier sources, reports and all real data.
- [ ] Parent independently reviews the exact recipe/input-lock byte binding,
  provenance identities and one-JAR boundary, then runs applicable source/docs
  gates and creates a clean committed producer revision. No image execution
  has occurred at this checkpoint.

### 2. Fresh admission and minimal build — pending

Follow `docs/operations/testflight-local-backend.md` and the parent's reviewed
bounded operation helpers; do not introduce a second general image builder.

1. Recheck all pause markers, run the resource/storage guards, identify existing
   active builders and receipts, and reuse owned work rather than duplicate it.
   Host free space must remain at least 30 GiB after all accounted costs. Measure
   VM free space independently and account for actual candidate layer, export,
   import, checkpoint/metadata and failure-retention costs plus 3 GiB reserve
   and an additional 768 MiB allowance. No old sample or host capacity implies
   VM feasibility. A resource warning invites diagnosis, not blanket process
   termination, a service restart, a repeated trim or global prune.
2. Create a private, task-owned context from the exact clean committed recipe
   and retained whole JAR after fresh byte-count/hash/type checks. The only
   required files are Dockerfile and the JAR; the lock and necessary upstream
   license evidence may accompany them or remain in parent evidence. Never
   copy logs, XML, Docker auth configuration, .env, .git, Maven cache or a source
   checkout into this context. Retain a sanitized context catalogue/receipt.
3. Confirm the selected existing builder's actual `linux/arm64` platform and
   exact base identity/layers before building. Reuse the already present base;
   do not silently download it again, select another builder cache, rebuild the
   JAR or push a registry. `--network=none` alone does not prove FROM resolution
   is offline; record actual base resolution and pull behavior separately.
4. The parent selects `linux/arm64` explicitly, builds the registry-free
   candidate with producer/lock labels, and records the exact command, input
   hashes, builder identity and result. No application entrypoint, startup,
   migration/provision script, database or provider probe runs during build.

### 3. Actual image/OCI verification — pending

The reviewed recipe text is not filesystem-delta evidence. From the actual
candidate, independently verify:

- platform and the exact base RootFS diffID list as an unchanged prefix;
- the final effective filesystem differs only at the exact main JAR path,
  with its locked whole-file hash/size/1001:1001/0644 metadata. Layer tar parent
  directory records may exist only if effective base directory metadata stays
  unchanged; unexplained additional file or metadata deltas require review;
- the original JAR and selected seven runtime files remain unchanged, with no
  whiteout hiding old payload or accidental configuration overwrite;
- inherited runtime Config fields/base labels match, with only the reviewed
  `io.capir.opik.*` provenance labels and ordinary image build creation/history
  metadata added; producer revision and lock hash are exact;
- no entrypoint has run and no migration, store, real trace or provider request
  was executed by this validation stage.

Save the OCI artifact/descriptor/config/layer digest relationships and a
sanitized external image receipt bound to the clean producer revision, exact
recipe/lock/JAR and actual platform/base. If a separate host import is needed,
first measure fresh host and VM expansion/staging costs and use the parent's
reviewed bounded import procedure once. Verify actual host Engine identity and
use never-pull consumption. Do not infer Engine identity from a config digest,
a successful docker-load exit or the eventual tag alone. Do not weaken the
Node-specific OCI inspector to make a Java image look like a Node image; use
correct type-specific inspection with the same integrity/ownership boundaries.

### 4. Coherent release and real acceptance — pending

A new clean Capir release R must explicitly pin the verified candidate image
and retain truthful upstream/package/producer/Engine identities. Do not start
the old prepared148 launcher: its old Opik constant could restore the prior
image. Protect the latest Web/current/rollback sources and all store volumes.
Keep frozen role bindings and old occupied intents; never silently refreeze or
replay an old deployment.

Read actual migration ledgers and startup/provision effects before activation,
and retain fresh relevant backups and recovery references. The 229 unchanged
migration resources and identical Bundle class are compatibility evidence,
not proof that every real database has a matching applied state. The prior
all-five-store coordinated backup/isolated-restore proposal was an agent's
recommendation, not a universal canonical hard gate. Apply the real runbook
and the changes' actual data effects; preserve all volumes and never roll back
data or overwrite newer writes to make a release pass.

The parent alone performs the reviewed coherent R deployment of the affected
Web, both Node APIs, three sidecars and Opik, preserving latest Web ownership
and source pairs/keeper/pointers. Verify exact live revisions, readiness,
dependency/IPC chains, all relevant behavior and required recovery. Use only
already authorized, uniquely tracked deployment probes; this source slice
adds no business account/image/contact/Memory/model authority. Runtime provider
and the recurrence observation window remain separate from image verification.
Only actual relevant live/native/isolated-flow evidence permits issue completion.

## Recovery and completion evidence

This checkpoint is source preparation only. No image build/load/tag, service
operation, network call, Git operation, new test run or entrypoint execution
was performed by this writer. All earlier package/base/binary evidence remains
preserved. The parent owns independent review, clean commit, CI and subsequent
operations under existing authorization.

Completion needs exact source review/CI; a clean producer build; actual complete
image/OCI/config/filesystem and host identity proofs; a correctly pinned R;
coherent affected-service deployment and real acceptance. Source, package,
image, imported host image, deployed revision, loaded JVM and observed user
behavior remain distinct checkpoints.
