#!/usr/bin/env python3
"""GET-337 package admission contracts, stdlib only; no Java/Docker/network.

Prospective package-opik-backport.py public API:
- validate_fixed54_evidence(receipt_dir, report_dir, expected, context)
    -> {"passed": True, "tests": 54}; receipt/material verification only.
- validate_source_catalogue(source_dir, expected) -> True; rehash the complete
    protected tree, excluding only backend target/ and src/test/ as the runner does.
- derive_project_pom(original: bytes, version: str) -> bytes; change only the
    direct project/version text, preserving every other original byte.
- catalogue_release_jar(jar_path, migration_sources, required_entries)
    -> {"sha256": ..., "entries": {name: {"sha256": ..., "bytes": ...}},
        "migration_resources": 229}.
- compare_runtime_graph(before, after, version) -> True; permit only the root
    project version derivation; ordered dependency coordinates/files/hashes stay exact.
- run_package(source_dir, fixed_receipt_dir, report_dir, output_dir,
              manifest_path, context) -> exit code; refuse invalid/preexisting
    inputs before any subprocess or output acquisition.

The expected receipt claims come from a trusted current manifest/patchset, never
from the receipt being judged. Future runner-produced context must record actual
job/run attempt/checked-out Capir revision, source/index and task-m2 ownership.
Old receipts must not be assigned these missing facts retrospectively.

Fixtures are public synthetic JSON/XML and real small ZIP/JAR files. The 1576-key
catalogue is a receipt fixture, not an asserted checkout of upstream. The separate
filesystem validator is tested on a complete small protected tree. Class bytes
are opaque catalogue fixtures, never executable or claimed as compiled Java.
Missing implementation/API is an explicit assertion failure, not an import error.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import warnings
import xml.etree.ElementTree as ET
import zipfile


SCRIPT = Path(__file__).with_name("package-opik-backport.py")
BACKPORT = Path(__file__).resolve().parents[2] / "deploy" / "opik" / "backport"
REVISION = "dd40343a223ec8d0ab11eafc5f88cbf18532c0ac"
PATCHES = {
    "0001-health-ownership-tests.patch": "0f13a0f7e2dce83c8595b1008f47c094bf0727e550549f41f26a992a0c114ed7",
    "0002-dataset-query-ownership-tests.patch": "1868137a4eb4ef7039d737d4916cd8e4e4d5c67dbf460237b8bb481f6f268855",
    "0003-health-late-response-fix.patch": "9d989e9d304094d1595b44afac3e39ccb533e3acfccd82fb3398fe4a709f002c",
    "0004-upstream-health-contract-tests.patch": "01d5e68c611ec5a5172a09ee0dd77d1919066718cf90e8500330ebf99c829e71",
    "0005-dataset-query-response-fix.patch": "aa7f49d6b2b1a59a157550366cba9815b79390dc65bbaffa3075fdb847ca2d83",
    "0006-http-pool-integration-tests.patch": "8085881a877988024414ef6af8c3eb95c40f16fad2f7e45680827c4b29cb6bef",
    "0007-dataset-cancel-handoff-tests.patch": "1762d37fdb01c641f8f31a644617d7c0650d9837b14b7190b225855e4c3b8def",
}
HEALTH = "com.comet.opik.infrastructure.db.healthchecks.Get337ClickHouseHealthCheckOwnershipTest"
DAO = "com.comet.opik.domain.Get337DatasetItemVersionResponseOwnershipTest"
HTTP = "com.comet.opik.infrastructure.db.healthchecks.Get337ClickHouseHttpPoolLifecycleTest"
HANDOFF = "com.comet.opik.domain.Get337DatasetQueryHandoffOwnershipTest"
OUTER = "com.comet.opik.infrastructure.db.healthchecks.AbstractClickHouseHealthCheckTest"
# Literal stems/multiplicities independently reviewed in frozen0001/2/4/6/7.
METHODS = {
    HEALTH: {
        "timedOutProbeClosesTheResponseThatArrivesAfterTheDeadline": 1,
        "interruptedProbePreservesInterruptAndClosesItsLateResponse": 1,
        "successfulProbeClosesItsAcquiredResponseExactlyOnce": 1,
        "failedAcquisitionReportsTheOriginalFailure": 1,
        "mappingFailureClosesTheAcquiredResponseExactlyOnce": 1,
        "closeFailureReportsUnhealthyWithoutClosingTheSameResponseAgain": 1,
    },
    DAO: {
        "cancellationBeforeDeliveryClosesTheLateQueryResponse": 2,
        "deliveredResponseIsClosedOnceBeforeReportingTheWrittenCount": 2,
        "queryFailurePropagatesWithoutSubmittingAnotherWrite": 2,
        "writtenRowsMappingFailureClosesItsResponseExactlyOnce": 2,
        "cleanupFailureDoesNotTurnACompletedWriteIntoAFailedOrRetriedWrite": 2,
    },
    HTTP: {
        "realSdkReaderRoundTripsTheCompleteNativeCompressedSelectOneResponse": 1,
        "unreadRealResponseHoldsTheOnlyLeaseUntilItsPublicClose": 1,
        "timedOutProductionProbeReleasesItsLateRealResponseForTheNextProbe": 1,
    },
    HANDOFF: {"cancellationAfterDeliveryClosesResponseBeforeTheQueuedMapperRuns": 2},
    OUTER + "$ClickHouseHealthCheckTests": {
        "check__whenQuerySucceeds__thenHealthy": 1,
        "check__whenQueryFails__thenUnhealthy": 1,
        "check__whenQueryInterrupted__thenUnhealthyAndRestoresInterruptFlag": 1,
    },
    OUTER + "$ClickHouseReadOnlyFreeFormSqlHealthCheckTests": {
        "check__whenToggleOff__thenHealthyWithoutTouchingClient": 1,
        "check__whenToggleOnAndQuerySucceeds__thenHealthyAndProbeCarriesNoPerCallSettings": 1,
    },
    "com.comet.opik.infrastructure.db.healthchecks.ClickHouseExistenceHealthCheckTest": {
        "check__whenDisabled__thenHealthyWithoutTouchingClient": 2,
        "check__whenEnabledAndResourcePresent__thenHealthy": 2,
        "check__whenEnabledAndCountIsZero__thenUnhealthy": 2,
        "check__whenEnabledAndNoRows__thenUnhealthy": 2,
        "check__whenEnabledAndQueryFails__thenUnhealthyWithoutCancellingQuery": 2,
        "check__whenEnabledAndInterrupted__thenUnhealthyAndRestoresInterruptFlag": 2,
    },
    "com.comet.opik.infrastructure.db.healthchecks.ClickHouseTracesTopologyHealthCheckTest": {
        "check__whenWrapEnabledAndTracesIsDistributedOverTracesLocal__thenHealthy": 1,
        "check__whenWrapDisabledAndTracesIsAMergeTree__thenHealthy": 3,
        "check__whenWrapEnabledButTracesIsNotWrapped__thenUnhealthyNamingTheObservedEngine": 1,
        "check__whenWrapEnabledButTracesLocalCannotTakeMutations__thenUnhealthy": 3,
        "check__whenWrapEnabledAndTracesIsDistributedButTracesLocalIsMissing__thenUnhealthy": 1,
        "check__whenWrapDisabledButTracesIsDistributed__thenUnhealthy": 1,
        "check__whenWrapDisabledAndTracesIsNeitherDistributedNorAMergeTree__thenUnhealthy": 1,
        "check__whenTracesIsMissingEntirely__thenUnhealthyRegardlessOfTheFlag": 2,
        "check__whenQueryFails__thenUnhealthyWithoutCancellingQuery": 2,
        "check__whenInterrupted__thenRestoresTheInterruptFlag": 1,
    },
}
MAIN = "apps/opik-backend/src/main/java/"
PRODUCTION = {
    MAIN + "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.java",
    MAIN + "com/comet/opik/utils/AsyncUtils.java",
    MAIN + "com/comet/opik/domain/DatasetItemVersionDAO.java",
}
TEST_ROOT = "apps/opik-backend/src/test/java/"
NEW_TESTS = {
    TEST_ROOT + "com/comet/opik/infrastructure/db/healthchecks/Get337ClickHouseHealthCheckOwnershipTest.java",
    TEST_ROOT + "com/comet/opik/testutil/Get337QueryResponseFixture.java",
    TEST_ROOT + "com/comet/opik/domain/Get337DatasetItemVersionResponseOwnershipTest.java",
    TEST_ROOT + "com/comet/opik/infrastructure/db/healthchecks/Get337ClickHouseHttpPoolLifecycleTest.java",
    TEST_ROOT + "com/comet/opik/domain/Get337DatasetQueryHandoffOwnershipTest.java",
}
LEGACY_TESTS = {
    TEST_ROOT + "com/comet/opik/infrastructure/db/healthchecks/" + name + ".java"
    for name in ("AbstractClickHouseHealthCheckTest", "ClickHouseExistenceHealthCheckTest",
                 "ClickHouseTracesTopologyHealthCheckTest")
}
REQUIRED_CLASSES = {
    "com/comet/opik/OpikApplication.class",
    "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.class",
    "com/comet/opik/utils/AsyncUtils.class",
    "com/comet/opik/domain/DatasetItemVersionDAOImpl.class",
    "com/comet/opik/infrastructure/bundle/LiquibaseBundle.class",
}
POM = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <!-- The project coordinate alone is derived. -->
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.comet.opik</groupId>
  <artifactId>opik-backend</artifactId>
  <version>1.0-SNAPSHOT</version>
  <properties><nested.version>1.0-SNAPSHOT</nested.version></properties>
  <dependencies><dependency><groupId>com.clickhouse</groupId><artifactId>client-v2</artifactId><version>0.10.0</version></dependency></dependencies>
  <repositories><repository><id>public-fixture</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-shade-plugin</artifactId><version>3.6.1</version></plugin></plugins></build>
</project>
"""
DERIVED_POM = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <!-- The project coordinate alone is derived. -->
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.comet.opik</groupId>
  <artifactId>opik-backend</artifactId>
  <version>2.2.45</version>
  <properties><nested.version>1.0-SNAPSHOT</nested.version></properties>
  <dependencies><dependency><groupId>com.clickhouse</groupId><artifactId>client-v2</artifactId><version>0.10.0</version></dependency></dependencies>
  <repositories><repository><id>public-fixture</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-shade-plugin</artifactId><version>3.6.1</version></plugin></plugins></build>
</project>
"""


def sha(data):
    return hashlib.sha256(data).hexdigest()


class OpikPackageAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-package-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.loaded = None

    def api(self, name):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Package implementation is absent; parent must observe guard RED first")
            spec = importlib.util.spec_from_file_location("get337_opik_package", SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            try:
                spec.loader.exec_module(module)
            except Exception as error:
                self.fail("Package module failed safe import: " + type(error).__name__)
            self.loaded = module
        function = getattr(self.loaded, name, None)
        self.assertTrue(callable(function), "Missing package admission API: " + name)
        return function

    def write_json(self, path, value):
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

    def evidence(self):
        receipts = self.root / "fixed54-receipts"
        reports = self.root / "surefire-reports"
        source = self.root / "upstream"
        cache = self.root / "maven-repository"
        for path in (receipts, reports, source, cache):
            path.mkdir(mode=0o700)
        source_config_path = "apps/opik-backend/lombok.config"
        source_config_bytes = (b"# Synthetic source config: it must remain untouched.\n"
                               b"lombok.anyConstructor.addConstructorProperties = true\n")
        source_config = source / source_config_path
        source_config.parent.mkdir(parents=True, mode=0o700)
        source_config.write_bytes(source_config_bytes)
        source_config.chmod(0o644)
        manifest_bytes = (BACKPORT / "manifest.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        manifest_path = self.root / "manifest.json"
        manifest_path.write_bytes(manifest_bytes)
        owner = {"uid": source.stat().st_uid, "gid": source.stat().st_gid, "mode": "0700"}
        cache_owner = {"uid": cache.stat().st_uid, "gid": cache.stat().st_gid, "mode": "0700"}
        context = {
            "github_run_id": "337001", "github_run_attempt": "2", "github_job": "opik-package",
            "capir_revision": "c" * 40, "source_directory": str(source),
            "source_bind_owner": owner, "maven_repository": str(cache),
            "cache_bind_owner": cache_owner, "source_index_sha256": "3" * 64,
            "not_before_ns": time.time_ns() - 1_000_000_000,
        }
        suites = []
        for classname, methods in METHODS.items():
            cases = [method if count == 1 else method + "(Operation)[" + str(index) + "]"
                     for method, count in methods.items() for index in range(1, count + 1)]
            root = ET.Element("testsuite", name=classname, tests=str(len(cases)),
                              failures="0", errors="0", skipped="0")
            for name in cases:
                ET.SubElement(root, "testcase", name=name, classname=classname)
            path = reports / ("TEST-" + classname + ".xml")
            ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
            suites.append({"class": classname, "tests": len(cases), "failures": 0,
                           "errors": 0, "skipped": 0, "report_sha256": sha(path.read_bytes()),
                           "cases": [{"name": name, "outcome": "success"} for name in cases]})
        selected = {"passed": True, "maven_exit_code": 0, "tests": 54, "failures": 0,
                    "errors": 0, "skipped": 0, "suites": suites,
                    "container_suites": [], "admission_errors": []}
        original = {path: "1" * 64 for path in PRODUCTION}
        patched = {path: "2" * 64 for path in PRODUCTION}
        for index in range(229):
            path = "apps/opik-backend/src/main/resources/liquibase/fixture-" + str(index) + ".xml"
            original[path] = patched[path] = sha(("synthetic migration " + str(index)).encode())
        original["apps/opik-backend/pom.xml"] = patched["apps/opik-backend/pom.xml"] = sha(POM)
        original["LICENSE"] = patched["LICENSE"] = sha(b"Apache-2.0 public fixture\n")
        original[source_config_path] = patched[source_config_path] = sha(source_config_bytes)
        for index in range(1341):
            path = "apps/opik-backend/fixture-protected-" + str(index) + ".txt"
            original[path] = patched[path] = sha(("protected " + str(index)).encode())
        self.assertEqual(len(original), 1576)
        modifications = {path: claim for entry in manifest["fixed_patches"].values()
                         for path, claim in entry["changes"].items()}
        # Catalogue fixture preserves the real modified-file claims; it attests no local upstream tree.
        for path in PRODUCTION:
            original[path] = modifications[path]["before"]["sha256"]
            patched[path] = modifications[path]["after"]["sha256"]
        fingerprints = [{key: value for key, value in claim.items()
                         if key in ("path", "bytes", "sha256", "git_blob_sha1")}
                        | {"hash_verified": True}
                        for claim in manifest["sources"] + manifest["dependency_sources"]]
        self.write_json(receipts / "selected-surefire.json", selected)
        self.write_json(receipts / "source-fingerprints.json", fingerprints)
        self.write_json(receipts / "protected-source-before.json", original)
        self.write_json(receipts / "protected-source-patched.json", patched)
        self.write_json(receipts / "protected-source-after.json", patched)
        # Synthetic same-container observation fixture, not an executed compiler.
        # The real source config remains in the complete protected catalogue;
        # only a separate read-only build mount provides the effective config.
        profile_directory = receipts / "compile-profile"
        profile_directory.mkdir(mode=0o700)
        override = profile_directory / "lombok.config"
        override_bytes = b"config.stopBubbling = true\n"
        override.write_bytes(override_bytes)
        override.chmod(0o400)
        override_hash = sha(override_bytes)
        profile_id = "opik-dd403-official-docker-build-v1"
        container_token = "9" * 32
        execution_proof = {
            "schema": "capri.opik.compile-observation.v1", "profile_id": profile_id,
            "run_token": container_token, "phase": "fixed54_test",
            "observed_at_ns": context["not_before_ns"] + 1,
            "target": "/workspace/apps/opik-backend/lombok.config",
            "sha256": override_hash, "bytes": len(override_bytes), "file_type": "regular",
            "uid": owner["uid"], "gid": owner["gid"], "mode": "0400", "mount_read_only": True,
        }
        compile_profile = {
            "schema": "capri.opik.compile-profile.v1", "profile_id": profile_id,
            "upstream_revision": REVISION, "source_config_path": source_config_path,
            "source_config_sha256": sha(source_config_bytes),
            "source_catalogue_sha256": sha(json.dumps(patched, sort_keys=True).encode()),
            "effective_catalogue_sha256": sha(json.dumps(
                {**patched, source_config_path: override_hash}, sort_keys=True).encode()),
            "override_path": str(override), "override_sha256": override_hash,
            "override_bytes": len(override_bytes),
            "override_owner": {"uid": owner["uid"], "gid": owner["gid"], "mode": "0400"},
            "target": execution_proof["target"], "mount_read_only": True,
            "execution_proof": execution_proof,
        }
        context["compile_profile"] = copy.deepcopy(compile_profile)
        profile_marker = (b"CAPIR_OPIK_COMPILE_PROFILE_V1 "
                          + json.dumps(execution_proof, sort_keys=True, separators=(",", ":")).encode()
                          + b"\n")
        (receipts / "maven.log").write_bytes(profile_marker + b"Public synthetic fixed54 test log\n")
        (receipts / "toolchain-versions.log").write_bytes(b"Public synthetic Maven 3.9.16; Java 25 readback\n")
        # Public frozen patch bodies supply the five new source identities.
        # This remains JSON evidence; it does not assert a local upstream checkout.
        new_source_hashes = {}
        for patch_name in ("0001-health-ownership-tests.patch", "0002-dataset-query-ownership-tests.patch",
                           "0006-http-pool-integration-tests.patch", "0007-dataset-cancel-handoff-tests.patch"):
            current_path, chunks = None, []
            for line in (BACKPORT / patch_name).read_bytes().splitlines(keepends=True):
                if line.startswith(b"diff --git "):
                    if current_path is not None:
                        new_source_hashes[current_path] = sha(b"".join(chunks))
                    current_path, chunks = None, []
                elif line.startswith(b"+++ b/"):
                    current_path = line[6:].strip().decode("utf-8")
                elif current_path is not None and line.startswith(b"+"):
                    chunks.append(line[1:])
            if current_path is not None:
                new_source_hashes[current_path] = sha(b"".join(chunks))
        self.assertEqual(set(new_source_hashes), NEW_TESTS)
        applied_hashes = {path: claim["after"]["sha256"] for path, claim in modifications.items()}
        applied_hashes.update(new_source_hashes)
        self.assertEqual(set(applied_hashes), PRODUCTION | LEGACY_TESTS | NEW_TESTS)
        receipt = {
            "schema": "capri.opik.regression-run.v1", "suite": "all", "patch_stage": "responses-fixed",
            "passed": True, "stage": "complete", "classification": "selected_tests_passed",
            "maven_exit_code": 0, "upstream_revision": REVISION,
            "manifest_sha256": sha(manifest_bytes), "patch_sha256": dict(PATCHES),
            "github_run_id": context["github_run_id"], "github_run_attempt": context["github_run_attempt"],
            "github_job": context["github_job"], "capir_revision": context["capir_revision"],
            "source_directory": context["source_directory"], "source_bind_owner": owner,
            "maven_repository": context["maven_repository"], "cache_bind_owner": cache_owner,
            "source_index_sha256": "3" * 64,
            "not_before_ns": context["not_before_ns"],
            "applied_source_sha256": applied_hashes,
            "source_fingerprints_stage": "verified_upstream_baseline_before_patches",
            "source_fingerprints": fingerprints, "modified_source_fingerprints": modifications,
            "applied_production_changes": [{"path": path, "status": "M", "mode": "100644"} for path in sorted(PRODUCTION)],
            "applied_test_changes": ([{"path": path, "status": "M", "mode": "100644"} for path in sorted(LEGACY_TESTS)]
                                     + [{"path": path, "status": "A", "mode": "100644"} for path in sorted(NEW_TESTS)]),
            "selected_surefire": selected,
            "compile_profile": copy.deepcopy(compile_profile),
            "build_image": {"container_run_token": container_token},
            "maven_log_sha256": sha((receipts / "maven.log").read_bytes()),
            "toolchain_versions_sha256": sha((receipts / "toolchain-versions.log").read_bytes()),
        }
        self.write_json(receipts / "receipt.json", receipt)
        context["fixed_receipt_sha256"] = sha((receipts / "receipt.json").read_bytes())
        expected = {
            "manifest_sha256": sha(manifest_bytes), "patch_sha256": dict(PATCHES),
            "source_fingerprints": fingerprints, "modified_source_fingerprints": modifications,
        }
        return {"receipt_dir": receipts, "report_dir": reports, "source": source,
                "manifest_path": manifest_path, "context": context, "expected": expected, "receipt": receipt}

    def rebind(self, fixture):
        self.write_json(fixture["receipt_dir"] / "receipt.json", fixture["receipt"])
        fixture["context"]["fixed_receipt_sha256"] = sha((fixture["receipt_dir"] / "receipt.json").read_bytes())

    def validate(self, fixture):
        return self.api("validate_fixed54_evidence")(
            receipt_dir=fixture["receipt_dir"], report_dir=fixture["report_dir"],
            expected=fixture["expected"], context=fixture["context"])

    def migrations(self):
        return {"liquibase/fixture-" + str(index) + ".xml":
                ("<migration id='" + str(index) + "'/>\n").encode() for index in range(229)}

    def jar_entries(self):
        entries = {name: b"opaque-class-catalogue-fixture:" + name.encode() for name in REQUIRED_CLASSES}
        entries.update(self.migrations())
        entries.update({
            "META-INF/MANIFEST.MF": b"Manifest-Version: 1.0\nMain-Class: com.comet.opik.OpikApplication\n\n",
            "META-INF/LICENSE": b"Apache-2.0 synthetic fixture\n",
            "META-INF/NOTICE": b"Comet ML synthetic notice fixture\n",
            "META-INF/services/synthetic.Service": b"synthetic.Provider\n",
            "com/comet/opik/utils/AsyncUtils$Fixture.class": b"opaque-nested-class-fixture",
        })
        return entries

    def write_jar(self, name, entries, extra=None):
        path = self.root / name
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(path, "w") as archive:
                for key, value in entries.items():
                    archive.writestr(key, value)
                if extra is not None:
                    archive.writestr(*extra)
        return path

    def inspect(self, path):
        return self.api("catalogue_release_jar")(
            jar_path=path, migration_sources=self.migrations(), required_entries=REQUIRED_CLASSES)

    def test_complete_same_job_fixed54_raw_material_is_admitted(self):
        fixture = self.evidence()
        result = self.validate(fixture)
        self.assertTrue(result["passed"])
        self.assertEqual(result["tests"], 54)

    def test_baseline_49_failure_skip_and_wrong_or_missing_context_are_refused(self):
        fixture = self.evidence()
        original = copy.deepcopy(fixture["receipt"])
        original_reports = {path: path.read_bytes() for path in fixture["report_dir"].glob("*.xml")}
        for scenario in ("baseline", "old49", "maven-failure", "failed", "skipped", "incomplete-stage",
                         "different-run", "different-attempt", "different-job", "different-capir",
                         "different-source", "different-m2", "different-owner", "missing-job",
                         "missing-index", "missing-not-before", "missing-applied-source",
                         "missing-source-fingerprints", "wrong-applied-path", "wrong-mode",
                         "unknown-http-method", "missing-http-control"):
            with self.subTest(scenario=scenario):
                for path, data in original_reports.items():
                    path.write_bytes(data)
                receipt = copy.deepcopy(original)
                fixture["receipt"] = receipt
                if scenario == "baseline":
                    receipt["patch_stage"] = "baseline"
                elif scenario == "old49":
                    receipt["selected_surefire"]["tests"] = 49
                    receipt["selected_surefire"]["suites"] = [
                        suite for suite in receipt["selected_surefire"]["suites"] if suite["class"] not in (HTTP, HANDOFF)
                    ]
                    for classname in (HTTP, HANDOFF):
                        (fixture["report_dir"] / ("TEST-" + classname + ".xml")).unlink()
                elif scenario == "maven-failure":
                    receipt["maven_exit_code"] = 17
                    receipt["selected_surefire"]["maven_exit_code"] = 17
                elif scenario in ("failed", "skipped", "unknown-http-method", "missing-http-control"):
                    path = fixture["report_dir"] / ("TEST-" + HTTP + ".xml")
                    xml = ET.fromstring(path.read_bytes())
                    suite = next(suite for suite in receipt["selected_surefire"]["suites"] if suite["class"] == HTTP)
                    first = xml.find("testcase")
                    self.assertIsNotNone(first)
                    if scenario in ("failed", "skipped"):
                        kind, counter = ("failure", "failures") if scenario == "failed" else ("skipped", "skipped")
                        ET.SubElement(first, kind)
                        xml.set(counter, "1")
                        suite[counter] = receipt["selected_surefire"][counter] = 1
                        suite["cases"][0]["outcome"] = kind
                    elif scenario == "unknown-http-method":
                        first.set("name", "unknownHttpControl")
                        suite["cases"][0]["name"] = "unknownHttpControl"
                    else:
                        xml.remove(first)
                        xml.set("tests", "2")
                        suite["tests"] = 2
                        suite["cases"].pop(0)
                        receipt["selected_surefire"]["tests"] = 53
                    ET.ElementTree(xml).write(path, encoding="utf-8", xml_declaration=True)
                    suite["report_sha256"] = sha(path.read_bytes())
                elif scenario == "incomplete-stage":
                    receipt["stage"] = "maven"
                elif scenario.startswith("different-"):
                    key = {"different-run": "github_run_id", "different-attempt": "github_run_attempt",
                           "different-job": "github_job", "different-capir": "capir_revision",
                           "different-source": "source_directory", "different-m2": "maven_repository",
                           "different-owner": "source_bind_owner"}[scenario]
                    receipt[key] = {"uid": 0, "gid": 0, "mode": "0700"} if key == "source_bind_owner" else "wrong"
                elif scenario == "missing-job":
                    del receipt["github_job"]
                elif scenario == "missing-index":
                    del receipt["source_index_sha256"]
                elif scenario == "missing-not-before":
                    del receipt["not_before_ns"]
                elif scenario == "missing-applied-source":
                    del receipt["applied_source_sha256"]
                elif scenario == "missing-source-fingerprints":
                    receipt["source_fingerprints"] = []
                elif scenario == "wrong-applied-path":
                    receipt["applied_production_changes"][0]["path"] = "apps/opik-backend/pom.xml"
                else:
                    receipt["applied_test_changes"][0]["mode"] = "100755"
                self.write_json(fixture["receipt_dir"] / "selected-surefire.json", receipt["selected_surefire"])
                self.rebind(fixture)
                with self.assertRaises(ValueError):
                    self.validate(fixture)

    def test_raw_xml_logs_source_catalogue_and_patch_tamper_cannot_reuse_green(self):
        fixture = self.evidence()
        candidates = [
            fixture["report_dir"] / ("TEST-" + HTTP + ".xml"),
            fixture["receipt_dir"] / "maven.log", fixture["receipt_dir"] / "toolchain-versions.log",
            fixture["receipt_dir"] / "source-fingerprints.json",
            fixture["receipt_dir"] / "protected-source-after.json",
        ]
        for path in candidates:
            with self.subTest(tampered=path.name):
                original = path.read_bytes()
                if path.suffix == ".xml":
                    path.write_bytes(original + b"\n<!-- valid XML, changed raw evidence bytes -->\n")
                elif path.name == "source-fingerprints.json":
                    altered = json.loads(original)
                    altered[0]["sha256"] = "0" * 64
                    self.write_json(path, altered)
                elif path.name == "protected-source-after.json":
                    altered = json.loads(original)
                    altered[next(iter(altered))] = "0" * 64
                    self.write_json(path, altered)
                else:
                    path.write_bytes(original + b"tampered")
                with self.assertRaises(ValueError):
                    self.validate(fixture)
                path.write_bytes(original)
        path = fixture["report_dir"] / ("TEST-" + HANDOFF + ".xml")
        os.utime(path, ns=(fixture["context"]["not_before_ns"] - 1,) * 2)
        with self.assertRaises(ValueError):
            self.validate(fixture)
        os.utime(path, None)
        for key in ("manifest_sha256", "patch_sha256"):
            original = copy.deepcopy(fixture["receipt"][key])
            fixture["receipt"][key] = "0" * 64 if key == "manifest_sha256" else {**PATCHES, next(iter(PATCHES)): "0" * 64}
            self.rebind(fixture)
            with self.subTest(claim=key), self.assertRaises(ValueError):
                self.validate(fixture)
            fixture["receipt"][key] = original
            self.rebind(fixture)

    def test_invalid_prerequisite_or_preexisting_output_precedes_all_external_commands(self):
        execute = self.api("run_package")
        fixture = self.evidence()
        context = fixture["context"]
        remote = {"GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_OS": "Linux",
                  "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_RUN_ID": context["github_run_id"],
                  "GITHUB_RUN_ATTEMPT": context["github_run_attempt"], "GITHUB_JOB": context["github_job"],
                  "GITHUB_SHA": context["capir_revision"]}
        for scenario in ("baseline", "old49", "tampered-log", "existing-output"):
            output = self.root / ("package-" + scenario)
            original_receipt = copy.deepcopy(fixture["receipt"])
            log = fixture["receipt_dir"] / "maven.log"
            original_log = log.read_bytes()
            if scenario in ("baseline", "old49"):
                if scenario == "baseline":
                    fixture["receipt"]["patch_stage"] = "baseline"
                else:
                    fixture["receipt"]["selected_surefire"]["tests"] = 49
                self.rebind(fixture)
            elif scenario == "tampered-log":
                log.write_bytes(original_log + b"tampered")
            else:
                output.mkdir()
                (output / "keep").write_bytes(b"preexisting output must survive")
            with self.subTest(scenario=scenario), mock.patch.dict(os.environ, remote), \
                    mock.patch("platform.system", return_value="Linux"), \
                    mock.patch("subprocess.run", side_effect=AssertionError("No external command before admission")) as external:
                with self.assertRaises(ValueError):
                    execute(source_dir=fixture["source"], fixed_receipt_dir=fixture["receipt_dir"],
                            report_dir=fixture["report_dir"], output_dir=output,
                            manifest_path=fixture["manifest_path"], context=context)
                external.assert_not_called()
            if scenario == "existing-output":
                self.assertEqual((output / "keep").read_bytes(), b"preexisting output must survive")
            else:
                self.assertFalse(output.exists(), "Admission failure must not acquire an output directory")
            fixture["receipt"] = original_receipt
            self.rebind(fixture)
            log.write_bytes(original_log)

    def test_complete_source_catalogue_rejects_changed_missing_added_or_symlinked_input(self):
        validate = self.api("validate_source_catalogue")
        source = self.root / "source-catalogue"
        names = ("LICENSE", "apps/opik-backend/pom.xml",
                 "apps/opik-backend/src/main/java/com/comet/opik/utils/AsyncUtils.java",
                 "apps/opik-backend/src/main/resources/liquibase/fixture.xml")
        expected = {}
        for name in names:
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
            expected[name] = sha(path.read_bytes())
        self.assertTrue(validate(source_dir=source, expected=expected))
        for scenario in ("changed", "missing", "added", "symlink"):
            victim = source / names[-1]
            original = victim.read_bytes()
            extra = source / "apps/opik-backend/unlisted-resource.txt"
            if scenario == "changed":
                victim.write_bytes(b"unexpected schema change")
            elif scenario == "missing":
                victim.unlink()
            elif scenario == "added":
                extra.write_bytes(b"unexpected copy resource")
            else:
                victim.unlink()
                victim.symlink_to(source / "LICENSE")
            with self.subTest(scenario=scenario), \
                    mock.patch("subprocess.run", side_effect=AssertionError("Source rejection must be local")) as external:
                with self.assertRaises(ValueError):
                    validate(source_dir=source, expected=expected)
                external.assert_not_called()
            if victim.is_symlink():
                victim.unlink()
            victim.write_bytes(original)
            if extra.exists():
                extra.unlink()

    def test_derived_pom_changes_only_direct_project_version_and_preserves_all_other_bytes(self):
        derive = self.api("derive_project_pom")
        self.assertEqual(derive(original=POM, version="2.2.45"), DERIVED_POM)
        self.assertIn(b"<version>0.10.0</version>", DERIVED_POM)
        for original, version in (
            (POM.replace(b"<version>1.0-SNAPSHOT</version>\n", b"", 1), "2.2.45"),
            (POM.replace(b"<version>1.0-SNAPSHOT</version>", b"<version>1.0-SNAPSHOT</version><version>other</version>", 1), "2.2.45"),
            (b"<!DOCTYPE project [<!ENTITY unsafe SYSTEM 'file:///not-read'>]>" + POM, "2.2.45"),
            (POM, "2.2.45\n<dependency/>"),
        ):
            with self.subTest(original_bytes=len(original), version=version), self.assertRaises(ValueError):
                derive(original=original, version=version)

    def test_real_jar_complete_catalogue_includes_229_resources_required_and_nested_classes(self):
        entries = self.jar_entries()
        path = self.write_jar("opik-backend-2.2.45.jar", entries)
        result = self.inspect(path)
        self.assertEqual(result["sha256"], sha(path.read_bytes()))
        self.assertEqual(set(result["entries"]), set(entries))
        self.assertEqual(result["migration_resources"], 229)
        for name, value in entries.items():
            with self.subTest(entry=name):
                self.assertEqual(result["entries"][name]["sha256"], sha(value))
                self.assertEqual(result["entries"][name]["bytes"], len(value))

    def test_jar_duplicate_traversal_absolute_and_symlink_entries_are_refused(self):
        inspect = self.api("catalogue_release_jar")
        for scenario, name in (("duplicate", "META-INF/NOTICE"), ("traversal", "../escape"),
                               ("internal-traversal", "safe/../escape"), ("absolute", "/escape"),
                               ("backslash", "safe\\escape"), ("symlink", "linked-entry")):
            entries = self.jar_entries()
            if scenario == "symlink":
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                extra = (info, b"../../escape")
            else:
                extra = (name, b"unsafe extra")
            path = self.write_jar("unsafe-" + scenario + ".jar", entries, extra=extra)
            with self.subTest(scenario=scenario), self.assertRaises(ValueError):
                inspect(jar_path=path, migration_sources=self.migrations(), required_entries=REQUIRED_CLASSES)

    def test_jar_requires_exact_schema_resources_bundle_and_every_modified_class(self):
        for scenario in ("missing-main", "missing-health", "missing-dao", "missing-helper", "missing-bundle",
                         "missing-migration", "extra-migration", "changed-migration"):
            entries = self.jar_entries()
            victim = {
                "missing-main": "com/comet/opik/OpikApplication.class",
                "missing-health": "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.class",
                "missing-dao": "com/comet/opik/domain/DatasetItemVersionDAOImpl.class",
                "missing-helper": "com/comet/opik/utils/AsyncUtils.class",
                "missing-bundle": "com/comet/opik/infrastructure/bundle/LiquibaseBundle.class",
                "missing-migration": "liquibase/fixture-0.xml",
                "changed-migration": "liquibase/fixture-0.xml",
            }
            if scenario == "extra-migration":
                entries["liquibase/unreviewed.sql"] = b"unreviewed DDL"
            elif scenario == "changed-migration":
                entries[victim[scenario]] = b"changed DDL"
            else:
                del entries[victim[scenario]]
            path = self.write_jar(scenario + ".jar", entries)
            with self.subTest(scenario=scenario), self.assertRaises(ValueError):
                self.inspect(path)

    def test_runtime_graph_allows_only_project_version_and_rehashes_ordered_artifacts(self):
        compare = self.api("compare_runtime_graph")
        artifacts = []
        for index, coordinate in enumerate(("com.clickhouse:client-v2:jar::0.10.0", "io.projectreactor:reactor-core:jar::3.8.5")):
            path = self.root / ("runtime-" + str(index) + ".jar")
            path.write_bytes(("public runtime fixture " + str(index)).encode())
            artifacts.append({"coordinate": coordinate, "file": str(path),
                              "sha256": sha(path.read_bytes()), "bytes": path.stat().st_size, "order": index})
        before = {"project": {"groupId": "com.comet.opik", "artifactId": "opik-backend",
                              "packaging": "jar", "version": "1.0-SNAPSHOT"},
                  "dependencies": artifacts}
        after = copy.deepcopy(before)
        after["project"]["version"] = "2.2.45"
        self.assertTrue(compare(before=before, after=after, version="2.2.45"))
        for scenario in ("coordinate", "hash", "file", "added", "missing", "duplicate", "order",
                         "wrong-project", "wrong-version"):
            changed = copy.deepcopy(after)
            if scenario in ("coordinate", "hash", "file"):
                key = {"coordinate": "coordinate", "hash": "sha256", "file": "file"}[scenario]
                changed["dependencies"][0][key] = "0" * 64 if key == "sha256" else "changed"
            elif scenario == "added":
                changed["dependencies"].append({**artifacts[0], "coordinate": "unexpected:artifact:jar::1", "order": 2})
            elif scenario == "missing":
                changed["dependencies"].pop()
            elif scenario == "duplicate":
                changed["dependencies"].append(copy.deepcopy(artifacts[0]))
            elif scenario == "order":
                changed["dependencies"].reverse()
            elif scenario == "wrong-project":
                changed["project"]["artifactId"] = "another-project"
            else:
                changed["project"]["version"] = "2.2.86"
            with self.subTest(scenario=scenario), self.assertRaises(ValueError):
                compare(before=before, after=changed, version="2.2.45")
        Path(artifacts[0]["file"]).write_bytes(b"changed actual runtime artifact")
        with self.assertRaises(ValueError):
            compare(before=before, after=after, version="2.2.45")


if __name__ == "__main__":
    unittest.main()
