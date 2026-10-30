# GET-337: Match the official Opik compile context

## Outcome and boundary

Build and test the existing three-file response-ownership backport under an
explicit compile context matching the pinned official Docker build's absence
of project Lombok configuration. A fresh real binary comparison must then show
whether unrelated application-class changes have converged. This is not a
claim that Lombok configuration is the only cause of the previous binary delta.

The upstream source remains `dd40343a223ec8d0ab11eafc5f88cbf18532c0ac`.
Frozen Java patches 0001-0007, the 1576-entry host-source catalogue, all 229
migration resources, original Lombok configuration, Java sources, dependency
POM and old actual reports remain unchanged. No binary editing, mixed JAR,
source-config rename, container activation, model request or database operation
belongs to this slice. The parent alone owns tests, Git, CI and deployment.

## Evidence and uncertainty

- The previous actual package (artifact 12983535559) independently passed all
  54 tests and full JAR/resource admission. That result remains valid within
  its recorded scope and must not be rewritten as a failed test/package.
- The parent compared that JAR to the resident baseline and found 344 changed
  application classes: four correspond to the three modified Java families;
  340 further class differences remain outside those source families. A
  representative check found added ConstructorProperties metadata in seven of
  eight inspected classes; it did not establish semantic equivalence for all
  340 classes.
  `get337-candidate-to-resident-jar-full-delta.json` is retained with SHA256
  `79c63c8d4c03af821acd43817e5fca15f6b771d52a31eb528763dd5996a4345d`.
- The exact pinned official Dockerfile copies only pom.xml, spotless.xml and
  src into `/opt/opik-backend`, then versions:set and clean package. It copies
  lombok.config only into the later runtime stage. Parent-fetched Dockerfile
  bytes have SHA256
  `3e24c206895aaf4f33d8c00d99d47a193b019e58848ba3aa77eaf30646eae6ee`.
  The current full-source bind at `/workspace` exposes project lombok.config
  to compilation. This concrete input difference requires an explicit profile.
- Lombok documents directory-based configuration, stopBubbling, and the
  default false value of anyConstructor.addConstructorProperties:
  <https://projectlombok.org/features/configuration> and
  <https://projectlombok.org/features/constructor>. These primary references
  were verified by the parent; this writer made no network requests.
- Official packaging flags/layout and external toolchains are not declared
  equivalent merely by hiding one configuration file. A new actual full
  binary delta is still required before runtime compatibility is accepted.

## Chosen compile profile

Use a build-only read-only bind at the exact container path
`/workspace/apps/opik-backend/lombok.config`. The external private evidence file
contains exactly 27 bytes, `config.stopBubbling = true` plus one LF, with SHA256
`cef77f6e12c36c1efc67602e98e6012c742c9a2ccc552dc0df3334b670a024ef`.
It disables upward configuration discovery while retaining Lombok defaults;
it does not edit, remove or rename the protected host configuration.

Create the file exclusively as
`<fixed54-receipt-dir>/compile-profile/lombok.config`. The directory is 0700;
the file is 0400, regular, singly linked, current-owner UID/GID matching the
private source bind, with no symlink ancestor or path alias. Preserve this
small public-input evidence after completion and failure. No extra cleanup
policy or deletion of the source tree is introduced.

The regression receipt and its newly produced package context both require an
identical `compile_profile` object. Existing legacy receipts without it cannot
be upgraded, backfilled or admitted. Its contract is:

- schema `capri.opik.compile-profile.v1`, profile_id
  `opik-dd403-official-docker-build-v1`, and the exact upstream revision;
- source_config_path `apps/opik-backend/lombok.config` and its SHA256, equal
  to the original entry in patched/after protected-source catalogues and the
  actual unchanged regular host file;
- source_catalogue_sha256 and effective_catalogue_sha256, using SHA256 of
  `json.dumps(catalogue, sort_keys=True).encode()`. The effective map differs
  from the complete protected map only at the one config path;
- override_path, override_sha256, override_bytes 27 and override_owner with
  exact source UID/GID and mode 0400;
- target fixed above, mount_read_only true, and the actual execution_proof.

The package's existing exact original-to-versioned POM derivation is a separate
allowed input change. Each package command must record its applicable original
or derived-POM source/effective catalogue hashes. Do not label the derived-POM
compile map as byte-identical to the fixed54 map. Profile ID, config defaults,
override bytes and the unchanged host source-config identity remain identical
across fresh54 and package.

## Same-container observation

Every actual Maven container receives the exact read-only file bind. A fixed
shell wrapper in that same container checks the effective file is regular and
not a symlink, reads its actual SHA256, byte count, UID/GID and mode, and checks
`/proc/self/mountinfo` for one exact target mount with read-only mount options.
Only after all checks pass does it emit a bounded machine-readable observation
and exec the intended Java/Maven argument vector. A separate probe container or
requested `readonly` argument alone is insufficient proof.

For the fresh54 Maven test command, the first Maven-log line is
`CAPIR_OPIK_COMPILE_PROFILE_V1 ` followed by compact sorted JSON. The proof has
schema `capri.opik.compile-observation.v1`, the profile ID, a 32-lowercase-hex
container run token, phase `fixed54_test`, observed_at_ns, the fixed target,
actual SHA256/bytes/type/UID/GID/mode and mount_read_only true. The token also
appears as build_image.container_run_token and the actual Docker ownership
label. Observation time is not before the host command start and is not after
the earliest raw Surefire report timestamp. The log is already hash-bound by
the fixed54 receipt, which is hash-bound by the fresh same-job package context.

The package revalidates profile/host evidence before acquiring writers. Its
actual containers emit their own observations with the package ownership token
and command-specific phase; each command receipt stores its own parsed proof
and applicable compile-catalogue hashes. It never reuses the test container's
observation as proof that a package container had the effective bind.

Keep known command outcomes persisted before diagnostic/proof parsing. Preserve
all existing writer settlement, timeout classification, source guards and
POM-restoration gates. A malformed proof is a build/provenance failure, not a
reason to clear an unknown writer or restore POM before settlement.

## Milestones and ownership

1. **Completed: meaningful new RED.** Test writer owns only
   `scripts/prompts/test_opik_compile_profile.py`. Reuse the actual existing
   validate_fixed54_evidence entry point and its complete raw54 fixture, add
   a synthetic original config and a real private 0400 external override.
   Replace one dummy catalogue entry to retain 1576 entries. Positive control
   must pass; missing/wrong/self-consistently rebound profile, changed real
   override/type/mode/parent/links, altered original config and false or late
   mount proof must fail. Old code's acceptance must be the RED, not an absent
   proposed helper API. The parent actually observed seven methods, 47 negative
   assertion failures, zero errors and a passing positive control. The log has
   SHA256 `33d3d82c45a314f72b3b3f1fe80e1a4a287b375640d87dd498139edbcdb6510f`;
   `get337-official-compile-profile-red.json` preserves the formal result.
2. **Implemented, parent verification pending.** After explicit parent RED
   authorization, this writer owns
   test-opik-backport.py, package-opik-backport.py, an optional small shared
   opik_compile_profile.py module and backport README. The test writer alone
   may migrate existing evidence fixtures as authorized by the parent, keeping
   old assertions and logic. No production legacy-compatibility branch exists.
   The shared helper and both producer/consumer integrations are written. The
   test writer separately migrated only the two authorized positive fixtures;
   old negative assertions remain. The new module also needs the parent's
   precise CI path-scope coverage so a future module-only edit cannot skip the
   real Opik gate. No test has been run by this implementation writer.
3. Parent serially runs new focused checks, existing stdlib checks, docs and
   source guards, then obtains independent review of exact current bytes.
   Strict new profile enforcement necessarily changes positive synthetic
   fixtures; that is transparent fixture migration, never weakening a guard.
4. One necessary new fresh remote regression/package run uses this profile
   for both stages. Inspect actual same-container observations, 54 raw results,
   original source preservation, exact profile/context/receipt bindings,
   complete shaded JAR, ordered dependency graph and source/resource catalogue.
5. Independently compare the full new candidate to the resident baseline.
   Only the declared three modified Java source families may differ in
   application classes; explain every other entry/resource/dependency delta.
   If the 340 unrelated class differences remain or new unexplained changes
   appear, preserve evidence and re-plan. Never post-process classes to force
   comparison success. Image and live service acceptance remain separate.

## Rejected shortcuts

Do not edit or temporarily rename source lombok.config, assume one annotation
explains all differences, disable full-JAR admission, patch binaries, mix JAR
parts, infer a successful new run from old54 or fixture results, or accept a
requested read-only mount as an actual observed one. Do not repeat the old
unmatched build merely to obtain another identical package. The source change
introduces a real new compile-context question that requires new evidence.

## Recovery point

This plan was authored against package worktree HEAD
`311f341a3809f1b57946a0b918d4ebc74a9126dc`, after the parent's normal merge of
main 6c217. The source profile was implemented only after the parent's actual
RED and explicit follow-up authorization. This writer did not edit old or new
test files, and did not run tests, containers, Maven, install, network or Git work.
The original actual package remains preserved and admitted in its earlier
scope. Parent owns serial verification, independent review and any publication.
