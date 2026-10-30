#!/usr/bin/env python3
"""GET-337 runner admission tests; stdlib only, no Maven/Docker/network.

Expected runner API (implemented only after parent-observed RED):
- evaluate_test_results(report_dir, expected_classes, not_before_ns,
                        maven_exit_code) -> receipt dict with passed/counts/exit.
- validate_applied_tests(source_dir, expected_paths) -> actual staged change rows.
- verify_patch_locks(patch_dir, suite) -> {patch_basename: sha256}.
- verify_source_fingerprint(path, claim) -> fully verified source receipt.
- run_backport(work_dir=..., receipt_dir=..., suite=...) -> exit code.
- PATCH_DIR, fetch_upstream and run_maven are orchestration boundaries.

Tests use real small Git repositories and actual JUnit XML. Only public-source
fetch and Maven execution are forbidden stubs in orchestration guard tests.
Missing runner/APIs are explicit test failures, not import/discovery errors.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import xml.etree.ElementTree as ET


SCRIPT = Path(__file__).with_name("test-opik-backport.py")
BACKPORT = Path(__file__).resolve().parents[2] / "deploy" / "opik" / "backport"
HEALTH_CLASS = (
    "com.comet.opik.infrastructure.db.healthchecks."
    "Get337ClickHouseHealthCheckOwnershipTest"
)
OTHER_CLASS = "com.comet.opik.domain.Get337DatasetItemVersionResponseOwnershipTest"
HTTP_CLASS = "com.comet.opik.infrastructure.db.healthchecks.Get337ClickHouseHttpPoolLifecycleTest"
HANDOFF_CLASS = "com.comet.opik.domain.Get337DatasetQueryHandoffOwnershipTest"
# Reviewed literals from the frozen Java test patches; deliberately independent of runner tables.
HEALTH_METHODS = (
    "timedOutProbeClosesTheResponseThatArrivesAfterTheDeadline",
    "interruptedProbePreservesInterruptAndClosesItsLateResponse",
    "successfulProbeClosesItsAcquiredResponseExactlyOnce",
    "failedAcquisitionReportsTheOriginalFailure",
    "mappingFailureClosesTheAcquiredResponseExactlyOnce",
    "closeFailureReportsUnhealthyWithoutClosingTheSameResponseAgain",
)
DAO_METHODS = (
    "cancellationBeforeDeliveryClosesTheLateQueryResponse",
    "deliveredResponseIsClosedOnceBeforeReportingTheWrittenCount",
    "queryFailurePropagatesWithoutSubmittingAnotherWrite",
    "writtenRowsMappingFailureClosesItsResponseExactlyOnce",
    "cleanupFailureDoesNotTurnACompletedWriteIntoAFailedOrRetriedWrite",
)
# Independent literals from frozen patches 0006/0007, not runner selection tables.
HTTP_METHODS = (
    "realSdkReaderRoundTripsTheCompleteNativeCompressedSelectOneResponse",
    "unreadRealResponseHoldsTheOnlyLeaseUntilItsPublicClose",
    "timedOutProductionProbeReleasesItsLateRealResponseForTheNextProbe",
)
HANDOFF_METHOD = "cancellationAfterDeliveryClosesResponseBeforeTheQueuedMapperRuns"
HEALTH_JAVA = (
    "apps/opik-backend/src/test/java/com/comet/opik/infrastructure/db/"
    "healthchecks/Get337ClickHouseHealthCheckOwnershipTest.java"
)
FIXTURE_JAVA = (
    "apps/opik-backend/src/test/java/com/comet/opik/testutil/"
    "Get337QueryResponseFixture.java"
)
EXPECTED_PATHS = {HEALTH_JAVA, FIXTURE_JAVA}
PATCH_ONE = "0001-health-ownership-tests.patch"
PATCH_TWO = "0002-dataset-query-ownership-tests.patch"
HEALTH_FIX_JAVA = (
    "apps/opik-backend/src/main/java/com/comet/opik/infrastructure/db/healthchecks/"
    "AbstractClickHouseHealthCheck.java"
)
DAO_FIX_JAVA = "apps/opik-backend/src/main/java/com/comet/opik/domain/DatasetItemVersionDAO.java"
ASYNC_FIX_JAVA = "apps/opik-backend/src/main/java/com/comet/opik/utils/AsyncUtils.java"
DAO_TEST_JAVA = (
    "apps/opik-backend/src/test/java/com/comet/opik/domain/"
    "Get337DatasetItemVersionResponseOwnershipTest.java"
)
RESPONSES_PATCH = "0005-dataset-query-response-fix.patch"
HTTP_PATCH = "0006-http-pool-integration-tests.patch"
HANDOFF_PATCH = "0007-dataset-cancel-handoff-tests.patch"
HTTP_JAVA = (
    "apps/opik-backend/src/test/java/com/comet/opik/infrastructure/db/healthchecks/"
    "Get337ClickHouseHttpPoolLifecycleTest.java"
)
HANDOFF_JAVA = "apps/opik-backend/src/test/java/com/comet/opik/domain/Get337DatasetQueryHandoffOwnershipTest.java"
ALL_NEW_PATHS = EXPECTED_PATHS | {DAO_TEST_JAVA, HTTP_JAVA, HANDOFF_JAVA}
RESPONSES_PRODUCTION_PATHS = {HEALTH_FIX_JAVA, DAO_FIX_JAVA, ASYNC_FIX_JAVA}
LEGACY_OUTER = "com.comet.opik.infrastructure.db.healthchecks.AbstractClickHouseHealthCheckTest"
LEGACY_METHOD_COUNTS = {
    LEGACY_OUTER + "$ClickHouseHealthCheckTests": {
        "check__whenQuerySucceeds__thenHealthy": 1,
        "check__whenQueryFails__thenUnhealthy": 1,
        "check__whenQueryInterrupted__thenUnhealthyAndRestoresInterruptFlag": 1,
    },
    LEGACY_OUTER + "$ClickHouseReadOnlyFreeFormSqlHealthCheckTests": {
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
LEGACY_TEST_PATHS = {
    "apps/opik-backend/src/test/java/com/comet/opik/infrastructure/db/healthchecks/" + name + ".java"
    for name in ("AbstractClickHouseHealthCheckTest", "ClickHouseExistenceHealthCheckTest",
                 "ClickHouseTracesTopologyHealthCheckTest")
}


class BackportRunnerAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-runner-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.started_ns = time.time_ns() - 1_000_000_000
        self._loaded = None

    def runner(self):
        if self._loaded is None:
            self.assertTrue(
                SCRIPT.is_file(),
                "Missing runner: write the implementation only after parent observes this RED",
            )
            spec = importlib.util.spec_from_file_location("get337_backport_runner", SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            self._loaded = module
        return self._loaded

    def function(self, name):
        function = getattr(self.runner(), name, None)
        self.assertTrue(callable(function), f"Missing runner admission API: {name}")
        return function

    def xml(self, directory, *, name=HEALTH_CLASS, outcomes=None, counters=None,
            testcase_class=None, filename=None, case_names=None):
        directory.mkdir(parents=True, exist_ok=True)
        outcomes = ["success"] * 6 if outcomes is None else outcomes
        if case_names is None:
            case_names = (
                [f"{method}[{instance}]" for method in DAO_METHODS for instance in (1, 2)]
                if name == OTHER_CLASS else list(HEALTH_METHODS)
            )
        self.assertGreaterEqual(len(case_names), len(outcomes), "Incomplete XML fixture names")
        attributes = {
            "name": name,
            "tests": str(len(outcomes)),
            "failures": str(outcomes.count("failure")),
            "errors": str(outcomes.count("error")),
            "skipped": str(outcomes.count("skipped")),
            "time": "0.025",
        }
        if counters:
            attributes.update({key: str(value) for key, value in counters.items()})
        suite = ET.Element("testsuite", attributes)
        for index, outcome in enumerate(outcomes):
            case = ET.SubElement(suite, "testcase", {
                "name": case_names[index],
                "classname": testcase_class or name,
                "time": "0.001",
            })
            if outcome != "success":
                attributes = {} if outcome == "skipped" else {
                    "type": (
                        "java.lang.AssertionError"
                        if outcome == "failure"
                        else "java.lang.IllegalStateException"
                    ),
                    "message": "Synthetic public-source regression result",
                }
                ET.SubElement(case, outcome, attributes)
        path = directory / (filename or f"TEST-{name}.xml")
        ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)
        return path

    def evaluate(self, reports, code=0, expected_classes=None):
        return self.function("evaluate_test_results")(
            report_dir=reports,
            expected_classes={HEALTH_CLASS} if expected_classes is None else expected_classes,
            not_before_ns=self.started_ns,
            maven_exit_code=code,
        )

    def integration_xml(self, reports):
        pool = self.xml(reports, name=HTTP_CLASS, outcomes=["success"] * 3,
                        case_names=list(HTTP_METHODS))
        handoff = self.xml(reports, name=HANDOFF_CLASS, outcomes=["success"] * 2,
                           case_names=[f"{HANDOFF_METHOD}(Operation)[1]", f"{HANDOFF_METHOD}(Operation)[2]"])
        return pool, handoff

    def git(self, repository, *arguments, input_text=None):
        command = [
            "git", "-C", str(repository),
            "-c", "core.hooksPath=/dev/null",
            "-c", "core.autocrlf=false",
            "-c", "core.filemode=true",
            "-c", "commit.gpgsign=false",
            "-c", "user.name=GET337 unit fixture",
            "-c", "user.email=get337@example.invalid",
            *arguments,
        ]
        result = subprocess.run(
            command, input=input_text, text=True, capture_output=True, check=False,
            env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def repository(self, name, *, existing_health=False):
        repository = self.root / name
        repository.mkdir()
        self.git(repository, "init", "--quiet")
        baseline = {
            "apps/opik-backend/pom.xml": "<project/>\n",
            "apps/opik-backend/src/main/java/Production.java": "class Production {}\n",
            "apps/opik-backend/src/main/resources/liquibase/changelog.xml": "<databaseChangeLog/>\n",
            ".gitignore": "/ignored-*\n",
        }
        if existing_health:
            baseline[HEALTH_JAVA] = "class ExistingHealthTest {}\n"
        for relative, content in baseline.items():
            path = repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        self.git(repository, "add", ".")
        self.git(repository, "commit", "--quiet", "-m", "Synthetic baseline")
        return repository

    def apply_new_tests(self, repository, *, paths=EXPECTED_PATHS):
        # This is an actual Git apply/index transition, not a manufactured diff receipt.
        chunks = []
        for relative in sorted(paths):
            content = "class SyntheticOwnershipTest {}"
            chunks.append(
                f"diff --git a/{relative} b/{relative}\n"
                "new file mode 100644\n"
                "--- /dev/null\n"
                f"+++ b/{relative}\n"
                "@@ -0,0 +1 @@\n"
                f"+{content}\n"
            )
        self.git(repository, "apply", "--index", "-", input_text="".join(chunks))

    def validate_scope(self, repository):
        return self.function("validate_applied_tests")(
            source_dir=repository, expected_paths=EXPECTED_PATHS
        )

    def test_only_successful_selected_suite_with_zero_maven_exit_is_accepted(self):
        # Literal expected instances come from the reviewed test-only patches, not the runner.
        for suite_class, instances in ((HEALTH_CLASS, 6), (OTHER_CLASS, 10)):
            for display in ("method-and-index", "signature-and-index"):
                reports = self.root / suite_class / display
                names = None
                if display == "signature-and-index":
                    names = (
                        [f"{method}(Operation)[{instance}]"
                         for method in DAO_METHODS for instance in (1, 2)]
                        if suite_class == OTHER_CLASS else [method + "()" for method in HEALTH_METHODS]
                    )
                self.xml(reports, name=suite_class, outcomes=["success"] * instances, case_names=names)
                for code, accepted in ((0, True), (17, False)):
                    with self.subTest(suite=suite_class, display=display, maven_exit_code=code):
                        result = self.evaluate(reports, code=code, expected_classes={suite_class})
                        self.assertEqual(result["passed"], accepted)
                        self.assertEqual(result["maven_exit_code"], code)
                        self.assertEqual(result["tests"], instances)
                        self.assertEqual(result["failures"], 0)
                        self.assertEqual(result["errors"], 0)
                        self.assertEqual(result["skipped"], 0)

    def test_source_verification_requires_exact_bytes_sha256_and_git_blob(self):
        source = self.root / "QueryResponse.java"
        original = b"class QueryResponse {}\r\n"
        claim = {
            "path": "client-v2/src/main/java/example/QueryResponse.java",
            "bytes": len(original),
            "sha256": hashlib.sha256(original).hexdigest(),
            "git_blob_sha1": hashlib.sha1(
                b"blob " + str(len(original)).encode("ascii") + b"\0" + original
            ).hexdigest(),
        }
        verify = self.function("verify_source_fingerprint")
        source.write_bytes(original)
        self.assertTrue(verify(path=source, claim=claim)["hash_verified"])

        for scenario in ("wrong-sha256", "wrong-git-blob", "wrong-size", "normalized-text"):
            with self.subTest(scenario=scenario):
                altered_claim = dict(claim)
                source.write_bytes(original)
                if scenario == "wrong-sha256":
                    altered_claim["sha256"] = "0" * 64
                elif scenario == "wrong-git-blob":
                    altered_claim["git_blob_sha1"] = "0" * 40
                elif scenario == "wrong-size":
                    altered_claim["bytes"] += 1
                else:
                    source.write_bytes(original.replace(b"\r\n", b"\n"))
                with self.assertRaises(ValueError):
                    verify(path=source, claim=altered_claim)

    def test_missing_zero_error_failed_skipped_or_unexpected_junit_is_not_green(self):
        for scenario in (
            "missing", "zero", "error", "failure", "all-skipped", "unexpected-suite",
            "extra-suite", "unexpected-testcase", "wrong-count", "malformed",
            "one-success", "partial-skipped", "dao-nine-success", "dao-partial-skipped",
            "unknown-method", "health-wrong-frequency", "dao-unknown-method", "dao-wrong-frequency",
        ):
            with self.subTest(scenario=scenario):
                reports = self.root / scenario
                reports.mkdir()
                if scenario == "zero":
                    self.xml(reports, outcomes=[])
                elif scenario == "error":
                    self.xml(reports, outcomes=["error"])
                elif scenario == "failure":
                    self.xml(reports, outcomes=["failure"])
                elif scenario == "all-skipped":
                    self.xml(reports, outcomes=["skipped"])
                elif scenario == "one-success":
                    self.xml(reports, outcomes=["success"])
                elif scenario == "partial-skipped":
                    self.xml(reports, outcomes=["success"] * 4 + ["skipped"] * 2)
                elif scenario == "dao-nine-success":
                    self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 9)
                elif scenario == "dao-partial-skipped":
                    self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 8 + ["skipped"] * 2)
                elif scenario == "unknown-method":
                    names = list(HEALTH_METHODS)
                    names[0] = "unknownOwnershipMethod"
                    self.xml(reports, case_names=names)
                elif scenario == "health-wrong-frequency":
                    names = list(HEALTH_METHODS)
                    names[-1] = HEALTH_METHODS[0] + "()"
                    self.xml(reports, case_names=names)
                elif scenario in ("dao-unknown-method", "dao-wrong-frequency"):
                    names = [f"{method}[{instance}]" for method in DAO_METHODS for instance in (1, 2)]
                    names[-1] = (
                        "unknownOwnershipMethod[2]" if scenario == "dao-unknown-method"
                        else DAO_METHODS[0] + "[3]"
                    )
                    self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 10, case_names=names)
                elif scenario == "unexpected-suite":
                    self.xml(reports, name=OTHER_CLASS)
                elif scenario == "extra-suite":
                    self.xml(reports)
                    self.xml(reports, name=OTHER_CLASS)
                elif scenario == "unexpected-testcase":
                    self.xml(reports, testcase_class=OTHER_CLASS)
                elif scenario == "wrong-count":
                    self.xml(reports, counters={"tests": 7})
                elif scenario == "malformed":
                    (reports / "TEST-broken.xml").write_text("<testsuite", encoding="utf-8")
                expected = {OTHER_CLASS} if scenario.startswith("dao-") else {HEALTH_CLASS}
                result = self.evaluate(reports, expected_classes=expected)
                self.assertFalse(result["passed"], scenario)
                self.assertEqual(result["maven_exit_code"], 0)

    def test_stale_or_duplicate_selected_reports_cannot_reuse_a_green_result(self):
        for scenario in ("stale", "duplicate"):
            with self.subTest(scenario=scenario):
                reports = self.root / scenario
                report = self.xml(reports)
                if scenario == "stale":
                    old = self.started_ns - 2_000_000_000
                    os.utime(report, ns=(old, old))
                else:
                    self.xml(reports, filename="TEST-duplicate.xml")
                self.assertFalse(self.evaluate(reports)["passed"])

    def test_real_git_apply_accepts_only_expected_new_regular_java_tests(self):
        repository = self.repository("allowed")
        self.apply_new_tests(repository)

        rows = self.validate_scope(repository)

        self.assertEqual({row["path"] for row in rows}, EXPECTED_PATHS)
        self.assertEqual({row["status"] for row in rows}, {"A"})
        self.assertEqual({row["mode"] for row in rows}, {"100644"})

    def test_staged_production_pom_or_migration_change_is_rejected(self):
        forbidden = (
            "apps/opik-backend/src/main/java/Production.java",
            "apps/opik-backend/pom.xml",
            "apps/opik-backend/src/main/resources/liquibase/changelog.xml",
        )
        for index, relative in enumerate(forbidden):
            with self.subTest(path=relative):
                repository = self.repository(f"forbidden-{index}")
                self.apply_new_tests(repository)
                with (repository / relative).open("a", encoding="utf-8") as output:
                    output.write("Unapproved fixture change\n")
                self.git(repository, "add", relative)

                with self.assertRaises(ValueError):
                    self.validate_scope(repository)

    def test_expected_path_must_be_new_nonexecutable_regular_file(self):
        for scenario in ("existing", "executable", "symlink", "missing"):
            with self.subTest(scenario=scenario):
                repository = self.repository(scenario, existing_health=scenario == "existing")
                paths = {FIXTURE_JAVA} if scenario in ("existing", "symlink", "missing") else EXPECTED_PATHS
                self.apply_new_tests(repository, paths=paths)
                health = repository / HEALTH_JAVA
                if scenario == "existing":
                    health.write_text("class ModifiedExistingTest {}\n", encoding="utf-8")
                    self.git(repository, "add", HEALTH_JAVA)
                elif scenario == "executable":
                    health.chmod(0o755)
                    self.git(repository, "update-index", "--chmod=+x", HEALTH_JAVA)
                elif scenario == "symlink":
                    health.parent.mkdir(parents=True, exist_ok=True)
                    health.symlink_to(repository / "apps/opik-backend/pom.xml")
                    self.git(repository, "add", HEALTH_JAVA)

                with self.assertRaises(ValueError):
                    self.validate_scope(repository)

    def test_unstaged_untracked_and_ignored_untracked_changes_are_rejected(self):
        for scenario in ("unstaged", "untracked", "ignored-untracked"):
            with self.subTest(scenario=scenario):
                repository = self.repository(scenario)
                self.apply_new_tests(repository)
                if scenario == "unstaged":
                    (repository / HEALTH_JAVA).write_text("Unstaged drift\n", encoding="utf-8")
                else:
                    name = "ignored-input" if scenario == "ignored-untracked" else "unexpected-input"
                    (repository / name).write_text("Untracked fixture input\n", encoding="utf-8")

                with self.assertRaises(ValueError):
                    self.validate_scope(repository)

    def test_locked_patch_tamper_is_rejected_before_fetch_or_maven(self):
        module = self.runner()
        verify = self.function("verify_patch_locks")
        execute = self.function("run_backport")
        self.function("fetch_upstream")
        self.function("run_maven")
        patch_directory = self.root / "patches"
        patch_directory.mkdir()
        for name in (PATCH_ONE, PATCH_TWO):
            shutil.copyfile(BACKPORT / name, patch_directory / name)
        verified = verify(patch_dir=patch_directory, suite="health")
        self.assertEqual(set(verified), {PATCH_ONE})
        self.assertEqual(
            verified[PATCH_ONE], hashlib.sha256((patch_directory / PATCH_ONE).read_bytes()).hexdigest()
        )
        with (patch_directory / PATCH_ONE).open("a", encoding="utf-8") as output:
            output.write("\n# unapproved test patch modification\n")

        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), \
                mock.patch.object(module, "PATCH_DIR", patch_directory), \
                mock.patch.object(module, "fetch_upstream") as fetch, \
                mock.patch.object(module, "run_maven") as maven:
            with self.assertRaisesRegex(ValueError, r"(?i)patch.*(hash|digest|lock|tamper)"):
                execute(
                    work_dir=self.root / "fresh-work",
                    receipt_dir=self.root / "fresh-receipts",
                    suite="health",
                )
            fetch.assert_not_called()
            maven.assert_not_called()

    def test_actual_maven_boundary_maps_private_bind_owner_and_writable_config_home(self):
        module = self.runner()
        run_maven = self.function("run_maven")
        source = self.root / "source"
        work = self.root / "work"
        receipts = self.root / "receipts"
        for directory in (source, work, receipts):
            directory.mkdir(mode=0o700)
        (source / "apps/opik-backend").mkdir(parents=True, mode=0o700)
        manifest = json.loads((BACKPORT / "manifest.json").read_text(encoding="utf-8"))
        commands = []

        def docker_boundary(arguments, **kwargs):
            self.assertEqual(arguments[0], "docker", "Only Docker process I/O may be substituted")
            commands.append(list(arguments))
            output = b""
            if arguments[:3] == ["docker", "image", "inspect"]:
                output = json.dumps([{
                    "Id": "sha256:" + "f" * 64,
                    "Architecture": "arm64", "Os": "linux", "RepoDigests": [],
                }]).encode("utf-8")
            return subprocess.CompletedProcess(arguments, 0, stdout=output, stderr=b"")

        # Exercise the real remote guard using fixture OS/CI metadata; this is not remote execution proof.
        remote_metadata = {
            "GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_OS": "Linux",
            "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_RUN_ID": "337", "GITHUB_RUN_ATTEMPT": "1",
        }
        with mock.patch.dict(os.environ, remote_metadata), \
                mock.patch.object(module.platform, "system", return_value="Linux"), \
                mock.patch.object(module.platform, "machine", return_value="aarch64"), \
                mock.patch.object(module.subprocess, "run", side_effect=docker_boundary):
            run_maven(source_dir=source, work_dir=work, receipt_dir=receipts,
                      suite="health", manifest=manifest)

        invocations = [command for command in commands if command[:2] == ["docker", "run"]]
        self.assertEqual(len(invocations), 2, "Read versions and run tests through the same ownership contract")
        cache = work / "maven-repository"
        owner = source.stat()
        self.assertEqual(source.stat().st_mode & 0o777, 0o700)
        self.assertEqual(cache.stat().st_mode & 0o777, 0o700)
        self.assertEqual((cache.stat().st_uid, cache.stat().st_gid), (owner.st_uid, owner.st_gid))

        def option_values(command, option):
            return [command[index + 1] for index, value in enumerate(command[:-1]) if value == option] + [
                value.split("=", 1)[1] for value in command if value.startswith(option + "=")
            ]

        for index, command in enumerate(invocations):
            environment = dict(value.split("=", 1) for value in option_values(command, "--env"))
            with self.subTest(invocation=index, contract="private-bind-owner"):
                self.assertEqual(option_values(command, "--user"), [f"{owner.st_uid}:{owner.st_gid}"])
            with self.subTest(invocation=index, contract="maven-config"):
                self.assertEqual(environment.get("MAVEN_CONFIG"), "/maven-repository")
            with self.subTest(invocation=index, contract="jvm-user-home"):
                java_options = " ".join(environment.get(key, "") for key in (
                    "MAVEN_OPTS", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS"
                ))
                self.assertIn("-Duser.home=/maven-repository", java_options.split())
            with self.subTest(invocation=index, contract="writable-task-mount-and-unchanged-isolation"):
                self.assertIn(
                    f"type=bind,src={cache},dst=/maven-repository", option_values(command, "--mount")
                )
                self.assertNotIn("HOME", environment)
                self.assertNotIn("--env-file", command)
                self.assertEqual(option_values(command, "--cap-drop"), ["ALL"])
                self.assertEqual(option_values(command, "--security-opt"), ["no-new-privileges"])

    def test_fixed_stage_is_explicit_health_only_and_dao_baseline_is_separate(self):
        selection = self.function("_stage_selection")
        names, paths, classes = selection("health", "health-fixed")
        self.assertEqual(names, [PATCH_ONE, "0003-health-late-response-fix.patch",
                                 "0004-upstream-health-contract-tests.patch"])
        self.assertEqual(paths, EXPECTED_PATHS)
        self.assertEqual(classes, {HEALTH_CLASS} | set(LEGACY_METHOD_COUNTS))
        names, paths, classes = selection("dao", "baseline")
        self.assertEqual(names, [PATCH_ONE, PATCH_TWO])
        self.assertEqual(classes, {OTHER_CLASS})
        for suite in ("dao", "all"):
            with self.subTest(suite=suite), self.assertRaises(ValueError):
                selection(suite, "health-fixed")

    def test_fixed_stage_requires_exact_modified_paths_modes_and_fingerprints(self):
        repository = self.repository("fixed-stage")
        modifications = {}

        def fingerprint(data):
            return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                    "git_blob_sha1": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}

        for relative in LEGACY_TEST_PATHS | {HEALTH_FIX_JAVA}:
            path = repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"class BeforeFixture {}\n")
            modifications[relative] = {"before": fingerprint(path.read_bytes())}
        self.git(repository, "add", ".")
        self.git(repository, "commit", "--quiet", "-m", "Synthetic fixed-stage baseline")
        self.apply_new_tests(repository)
        for relative, claim in modifications.items():
            path = repository / relative
            path.write_bytes(b"class AfterFixture {}\n")
            claim["after"] = fingerprint(path.read_bytes())
            self.git(repository, "add", relative)

        validate = self.function("validate_applied_stage")
        rows = validate(source_dir=repository, suite="health", stage="health-fixed",
                        modifications=modifications)
        self.assertEqual({row["path"] for row in rows if row["status"] == "A"}, EXPECTED_PATHS)
        self.assertEqual({row["path"] for row in rows if row["status"] == "M"},
                         LEGACY_TEST_PATHS | {HEALTH_FIX_JAVA})
        with self.assertRaises(ValueError):
            self.validate_scope(repository)
        corrupted = json.loads(json.dumps(modifications))
        corrupted[HEALTH_FIX_JAVA]["after"]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            validate(source_dir=repository, suite="health", stage="health-fixed", modifications=corrupted)
        with (repository / "apps/opik-backend/pom.xml").open("a") as output:
            output.write("Unapproved POM mutation\n")
        self.git(repository, "add", "apps/opik-backend/pom.xml")
        with self.assertRaises(ValueError):
            validate(source_dir=repository, suite="health", stage="health-fixed",
                     modifications=modifications)

    def test_fixed_stage_keeps_full_protected_and_migration_closure(self):
        validate = self.function("validate_protected_catalogue")
        migration = "apps/opik-backend/src/main/resources/liquibase/changelog.xml"
        pom = "apps/opik-backend/pom.xml"
        before = {HEALTH_FIX_JAVA: "a" * 64, migration: "b" * 64, pom: "c" * 64}
        after = {**before, HEALTH_FIX_JAVA: "d" * 64}
        modifications = {HEALTH_FIX_JAVA: {"before": {"sha256": "a" * 64},
                                          "after": {"sha256": "d" * 64}}}
        self.assertTrue(validate(before=before, after=after, modifications=modifications))
        for changed in (migration, pom):
            with self.subTest(path=changed), self.assertRaises(ValueError):
                validate(before=before, after={**after, changed: "e" * 64}, modifications=modifications)
        missing = {path: digest for path, digest in after.items() if path != migration}
        with self.assertRaises(ValueError):
            validate(before=before, after=missing, modifications=modifications)

    def test_fixed_health_requires_all_39_instances_and_zero_container_is_not_a_pass(self):
        reports = self.root / "fixed-reports"
        self.xml(reports)
        for suite_class, methods in LEGACY_METHOD_COUNTS.items():
            names = [method if multiplicity == 1 else f"{method}[{index}]"
                     for method, multiplicity in methods.items() for index in range(1, multiplicity + 1)]
            self.xml(reports, name=suite_class, outcomes=["success"] * len(names), case_names=names)
        self.xml(reports, name=LEGACY_OUTER, outcomes=[], case_names=[])
        classes = {HEALTH_CLASS} | set(LEGACY_METHOD_COUNTS)
        result = self.evaluate(reports, expected_classes=classes)
        self.assertTrue(result["passed"])
        self.assertEqual(result["tests"], 39)
        self.assertEqual(result["skipped"], 0)
        incomplete = self.root / "empty-container-only"
        self.xml(incomplete, name=LEGACY_OUTER, outcomes=[], case_names=[])
        self.assertFalse(self.evaluate(incomplete, expected_classes=classes)["passed"])
        self.assertFalse(self.evaluate(incomplete)["passed"])

    def test_responses_fixed_is_explicit_all_only_with_both_regressions_and_legacy_health(self):
        selection = self.function("_stage_selection")
        try:
            names, paths, classes = selection("all", "responses-fixed")
        except ValueError as error:
            self.fail("The reviewed responses-fixed/all stage is not admitted: " + str(error))
        self.assertEqual(names, [PATCH_ONE, PATCH_TWO, "0003-health-late-response-fix.patch",
                                 "0004-upstream-health-contract-tests.patch", RESPONSES_PATCH,
                                 HTTP_PATCH, HANDOFF_PATCH])
        self.assertEqual(paths, ALL_NEW_PATHS)
        self.assertEqual(classes, {HEALTH_CLASS, OTHER_CLASS, HTTP_CLASS, HANDOFF_CLASS} | set(LEGACY_METHOD_COUNTS))
        for suite in ("health", "dao"):
            with self.subTest(suite=suite), self.assertRaises(ValueError):
                selection(suite, "responses-fixed")
        self.assertEqual(selection("all", "baseline")[0], [PATCH_ONE, PATCH_TWO, HTTP_PATCH, HANDOFF_PATCH])
        self.assertEqual(selection("health", "health-fixed")[0],
                         [PATCH_ONE, "0003-health-late-response-fix.patch",
                          "0004-upstream-health-contract-tests.patch"])

    def test_responses_fixed_checks_actual_three_production_paths_and_each_fingerprint(self):
        repository = self.repository("responses-fixed-stage")
        modifications = {}

        def fingerprint(data):
            return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                    "git_blob_sha1": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}

        for relative in LEGACY_TEST_PATHS | RESPONSES_PRODUCTION_PATHS:
            path = repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"class BeforeResponseFixture {}\n")
            modifications[relative] = {"before": fingerprint(path.read_bytes())}
        self.git(repository, "add", ".")
        self.git(repository, "commit", "--quiet", "-m", "Synthetic response-stage baseline")
        self.apply_new_tests(repository, paths=ALL_NEW_PATHS)
        for relative, claim in modifications.items():
            path = repository / relative
            path.write_bytes(b"class AfterResponseFixture {}\n")
            claim["after"] = fingerprint(path.read_bytes())
            self.git(repository, "add", relative)

        validate = self.function("validate_applied_stage")
        try:
            rows = validate(source_dir=repository, suite="all", stage="responses-fixed",
                            modifications=modifications)
        except ValueError as error:
            self.fail("Exact response-stage Git diff was rejected: " + str(error))
        self.assertEqual({row["path"] for row in rows if row["status"] == "A"},
                         ALL_NEW_PATHS)
        self.assertEqual({row["path"] for row in rows if row["status"] == "M"},
                         LEGACY_TEST_PATHS | RESPONSES_PRODUCTION_PATHS)
        self.assertEqual({row["mode"] for row in rows}, {"100644"})
        for relative in RESPONSES_PRODUCTION_PATHS:
            for side, field, value in (("before", "git_blob_sha1", "0" * 40),
                                       ("after", "sha256", "0" * 64)):
                with self.subTest(path=relative, side=side):
                    corrupt = json.loads(json.dumps(modifications))
                    corrupt[relative][side][field] = value
                    with self.assertRaises(ValueError):
                        validate(source_dir=repository, suite="all", stage="responses-fixed",
                                 modifications=corrupt)
        for relative in (DAO_FIX_JAVA, ASYNC_FIX_JAVA):
            with self.subTest(missing_scope=relative), self.assertRaises(ValueError):
                validate(source_dir=repository, suite="all", stage="responses-fixed",
                         modifications={path: claim for path, claim in modifications.items() if path != relative})
        self.git(repository, "update-index", "--chmod=+x", ASYNC_FIX_JAVA)
        with self.assertRaises(ValueError):
            validate(source_dir=repository, suite="all", stage="responses-fixed", modifications=modifications)
        self.git(repository, "update-index", "--chmod=-x", ASYNC_FIX_JAVA)
        for relative in ("apps/opik-backend/pom.xml",
                         "apps/opik-backend/src/main/java/Production.java",
                         "apps/opik-backend/src/main/resources/liquibase/changelog.xml"):
            original = (repository / relative).read_bytes()
            (repository / relative).write_bytes(original + b"Unapproved response-stage edit\n")
            self.git(repository, "add", relative)
            with self.subTest(forbidden=relative), self.assertRaises(ValueError):
                validate(source_dir=repository, suite="all", stage="responses-fixed", modifications=modifications)
            (repository / relative).write_bytes(original)
            self.git(repository, "add", relative)

    def test_responses_fixed_preserves_full_protected_catalogue_and_migrations(self):
        validate = self.function("validate_protected_catalogue")
        protected = {
            "apps/opik-backend/pom.xml": "7" * 64,
            "apps/opik-backend/src/main/resources/liquibase/changelog.xml": "8" * 64,
            "apps/opik-backend/src/main/java/OtherProduction.java": "9" * 64,
        }
        before = {**protected, **dict.fromkeys(RESPONSES_PRODUCTION_PATHS, "a" * 64)}
        after = {**protected, **dict.fromkeys(RESPONSES_PRODUCTION_PATHS, "b" * 64)}
        modifications = {path: {"before": {"sha256": "a" * 64}, "after": {"sha256": "b" * 64}}
                         for path in RESPONSES_PRODUCTION_PATHS}
        try:
            accepted = validate(before=before, after=after, modifications=modifications)
        except ValueError as error:
            self.fail("Exact three-file protected replacement was rejected: " + str(error))
        self.assertTrue(accepted)
        for relative in protected:
            with self.subTest(changed=relative), self.assertRaises(ValueError):
                validate(before=before, after={**after, relative: "f" * 64}, modifications=modifications)
            with self.subTest(removed=relative), self.assertRaises(ValueError):
                validate(before=before, after={p: d for p, d in after.items() if p != relative},
                         modifications=modifications)
        with self.assertRaises(ValueError):
            validate(before=before, after={**after, "apps/opik-backend/src/main/resources/new.sql": "e" * 64},
                     modifications=modifications)
        broadened = {**modifications, "apps/opik-backend/pom.xml": {
            "before": {"sha256": "7" * 64}, "after": {"sha256": "f" * 64}}}
        with self.assertRaises(ValueError):
            validate(before=before, after={**after, "apps/opik-backend/pom.xml": "f" * 64},
                     modifications=broadened)

    def test_responses_fixed_requires_all_54_real_method_instances_and_preserves_maven_exit(self):
        try:
            _, _, selected = self.function("_stage_selection")("all", "responses-fixed")
        except ValueError as error:
            self.fail("Cannot assess the combined fixed JUnit stage: " + str(error))
        expected = {HEALTH_CLASS, OTHER_CLASS, HTTP_CLASS, HANDOFF_CLASS} | set(LEGACY_METHOD_COUNTS)
        self.assertEqual(selected, expected)
        reports = self.root / "responses-fixed-reports"
        health_xml = self.xml(reports)
        dao_xml = self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 10)
        pool_xml, handoff_xml = self.integration_xml(reports)
        legacy_paths = []
        for suite_class, methods in LEGACY_METHOD_COUNTS.items():
            names = [method if count == 1 else f"{method}[{index}]"
                     for method, count in methods.items() for index in range(1, count + 1)]
            legacy_paths.append(self.xml(reports, name=suite_class,
                                         outcomes=["success"] * len(names), case_names=names))
        self.xml(reports, name=LEGACY_OUTER, outcomes=[], case_names=[])
        result = self.evaluate(reports, expected_classes=selected)
        self.assertTrue(result["passed"])
        self.assertEqual((result["tests"], result["errors"], result["failures"], result["skipped"]),
                         (54, 0, 0, 0))
        failed_process = self.evaluate(reports, code=23, expected_classes=selected)
        self.assertFalse(failed_process["passed"])
        self.assertEqual(failed_process["maven_exit_code"], 23)
        for missing in (health_xml, dao_xml, legacy_paths[0], pool_xml, handoff_xml):
            data = missing.read_bytes()
            missing.unlink()
            with self.subTest(missing=missing.name):
                self.assertFalse(self.evaluate(reports, expected_classes=selected)["passed"])
            missing.write_bytes(data)
        old49 = self.root / "retained-49-cannot-satisfy-54"
        old49.mkdir()
        for report in reports.glob("*.xml"):
            if report not in (pool_xml, handoff_xml):
                shutil.copyfile(report, old49 / report.name)
        self.assertFalse(self.evaluate(old49, expected_classes=selected)["passed"])
        self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 9 + ["skipped"])
        self.assertFalse(self.evaluate(reports, expected_classes=selected)["passed"])

    def test_all_baseline_selects_both_integration_boundaries_without_expanding_narrow_stages(self):
        selection = self.function("_stage_selection")
        names, paths, classes = selection("all", "baseline")
        self.assertEqual(names, [PATCH_ONE, PATCH_TWO, HTTP_PATCH, HANDOFF_PATCH])
        self.assertEqual(paths, ALL_NEW_PATHS)
        self.assertEqual(classes, {HEALTH_CLASS, OTHER_CLASS, HTTP_CLASS, HANDOFF_CLASS})
        for suite, patches, expected_paths, expected_classes in (
            ("health", [PATCH_ONE], EXPECTED_PATHS, {HEALTH_CLASS}),
            ("dao", [PATCH_ONE, PATCH_TWO], EXPECTED_PATHS | {DAO_TEST_JAVA}, {OTHER_CLASS}),
        ):
            with self.subTest(narrow_suite=suite):
                self.assertEqual(selection(suite, "baseline"), (patches, expected_paths, expected_classes))
        self.assertEqual(selection("health", "health-fixed"), (
            [PATCH_ONE, "0003-health-late-response-fix.patch", "0004-upstream-health-contract-tests.patch"],
            EXPECTED_PATHS, {HEALTH_CLASS} | set(LEGACY_METHOD_COUNTS),
        ))
        for suite in ("health", "dao"):
            with self.subTest(invalid_fixed_suite=suite), self.assertRaises(ValueError):
                selection(suite, "responses-fixed")

    def test_all_baseline_real_git_admission_requires_five_new_regular_tests_and_no_production_change(self):
        repository = self.repository("integration-baseline-stage")
        self.apply_new_tests(repository, paths=ALL_NEW_PATHS)
        validate = self.function("validate_applied_stage")
        try:
            rows = validate(source_dir=repository, suite="all", stage="baseline", modifications={})
        except ValueError as error:
            self.fail("Exact five-file TEST-ONLY baseline diff was rejected: " + str(error))
        self.assertEqual({row["path"] for row in rows}, ALL_NEW_PATHS)
        self.assertEqual({(row["status"], row["mode"]) for row in rows}, {("A", "100644")})
        for missing in (HTTP_JAVA, HANDOFF_JAVA):
            self.git(repository, "rm", "--cached", "--quiet", missing)
            (repository / missing).unlink()
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                validate(source_dir=repository, suite="all", stage="baseline", modifications={})
            self.apply_new_tests(repository, paths={missing})
        for executable in (HTTP_JAVA, HANDOFF_JAVA):
            self.git(repository, "update-index", "--chmod=+x", executable)
            with self.subTest(executable=executable), self.assertRaises(ValueError):
                validate(source_dir=repository, suite="all", stage="baseline", modifications={})
            self.git(repository, "update-index", "--chmod=-x", executable)
        for forbidden in ("apps/opik-backend/src/main/java/Production.java",
                          "apps/opik-backend/pom.xml",
                          "apps/opik-backend/src/main/resources/liquibase/changelog.xml"):
            path = repository / forbidden
            original = path.read_bytes()
            path.write_bytes(original + b"Unapproved integration-baseline edit\n")
            self.git(repository, "add", forbidden)
            with self.subTest(forbidden=forbidden), self.assertRaises(ValueError):
                validate(source_dir=repository, suite="all", stage="baseline", modifications={})
            path.write_bytes(original)
            self.git(repository, "add", forbidden)
        extra = "apps/opik-backend/src/test/java/com/comet/opik/UnexpectedIntegrationTest.java"
        self.apply_new_tests(repository, paths={extra})
        with self.assertRaises(ValueError):
            validate(source_dir=repository, suite="all", stage="baseline", modifications={})

    def test_all_21_junit_instances_require_both_http_controls_and_both_handoff_instances(self):
        selected = {HEALTH_CLASS, OTHER_CLASS, HTTP_CLASS, HANDOFF_CLASS}

        def complete_reports(name):
            reports = self.root / name
            self.xml(reports)
            self.xml(reports, name=OTHER_CLASS, outcomes=["success"] * 10)
            pool, handoff = self.integration_xml(reports)
            return reports, pool, handoff

        reports, _, _ = complete_reports("integration-baseline-21")
        result = self.evaluate(reports, expected_classes=selected)
        self.assertTrue(result["passed"], result.get("admission_errors"))
        self.assertEqual((result["tests"], result["failures"], result["errors"], result["skipped"]),
                         (21, 0, 0, 0))
        failed_process = self.evaluate(reports, code=27, expected_classes=selected)
        self.assertFalse(failed_process["passed"])
        self.assertEqual(failed_process["maven_exit_code"], 27)
        for scenario in ("missing-wire-control", "missing-lease-control", "missing-lifecycle",
                         "missing-handoff-instance", "skipped-wire-control", "failed-lease-control",
                         "error-lifecycle", "unknown-http-method", "unknown-handoff-method",
                         "stale-http-report", "missing-handoff-report", "unexpected-suite"):
            with self.subTest(scenario=scenario):
                reports, pool, handoff = complete_reports(scenario)
                if scenario in ("missing-wire-control", "missing-lease-control", "missing-lifecycle"):
                    index = {"missing-wire-control": 0, "missing-lease-control": 1, "missing-lifecycle": 2}[scenario]
                    names = [method for offset, method in enumerate(HTTP_METHODS) if offset != index]
                    self.xml(reports, name=HTTP_CLASS, outcomes=["success"] * 2, case_names=names)
                elif scenario == "missing-handoff-instance":
                    self.xml(reports, name=HANDOFF_CLASS, outcomes=["success"],
                             case_names=[HANDOFF_METHOD + "(Operation)[1]"])
                elif scenario in ("skipped-wire-control", "failed-lease-control", "error-lifecycle"):
                    outcomes = {"skipped-wire-control": ["skipped", "success", "success"],
                                "failed-lease-control": ["success", "failure", "success"],
                                "error-lifecycle": ["success", "success", "error"]}[scenario]
                    self.xml(reports, name=HTTP_CLASS, outcomes=outcomes, case_names=list(HTTP_METHODS))
                elif scenario == "unknown-http-method":
                    self.xml(reports, name=HTTP_CLASS, outcomes=["success"] * 3,
                             case_names=[HTTP_METHODS[0], HTTP_METHODS[1], "unknownLifecycle"])
                elif scenario == "unknown-handoff-method":
                    self.xml(reports, name=HANDOFF_CLASS, outcomes=["success"] * 2,
                             case_names=[HANDOFF_METHOD + "(Operation)[1]", "unknownHandoff(Operation)[2]"])
                elif scenario == "stale-http-report":
                    os.utime(pool, ns=(self.started_ns - 1, self.started_ns - 1))
                elif scenario == "missing-handoff-report":
                    handoff.unlink()
                else:
                    self.xml(reports, name="com.comet.opik.UnexpectedIntegrationTest",
                             outcomes=["success"], case_names=["unexpectedMethod"])
                self.assertFalse(self.evaluate(reports, expected_classes=selected)["passed"])

    def test_both_integration_patch_locks_reject_tamper_before_fetch_or_maven(self):
        module = self.runner()
        verify = self.function("verify_patch_locks")
        execute = self.function("run_backport")
        fixture_parent = self.root.resolve(strict=True)
        names = [PATCH_ONE, PATCH_TWO, "0003-health-late-response-fix.patch",
                 "0004-upstream-health-contract-tests.patch", RESPONSES_PATCH, HTTP_PATCH, HANDOFF_PATCH]
        expected_hashes = {
            HTTP_PATCH: "8085881a877988024414ef6af8c3eb95c40f16fad2f7e45680827c4b29cb6bef",
            HANDOFF_PATCH: "1762d37fdb01c641f8f31a644617d7c0650d9837b14b7190b225855e4c3b8def",
        }
        remote_metadata = {
            "GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_OS": "Linux",
            "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_RUN_ID": "337", "GITHUB_RUN_ATTEMPT": "1",
        }
        for stage, expected_names in (("baseline", {PATCH_ONE, PATCH_TWO, HTTP_PATCH, HANDOFF_PATCH}),
                                      ("responses-fixed", set(names))):
            for tampered in (HTTP_PATCH, HANDOFF_PATCH):
                with self.subTest(stage=stage, tampered=tampered):
                    patch_directory = self.root / (stage + "-" + tampered)
                    patch_directory.mkdir()
                    for name in names:
                        original = BACKPORT / name
                        self.assertTrue(original.is_file(), "The frozen input patch must exist: " + name)
                        shutil.copyfile(original, patch_directory / name)
                    with self.subTest(phase="untampered-lock-selection"):
                        locks = verify(patch_dir=patch_directory, suite="all", stage=stage)
                        self.assertEqual(set(locks), expected_names)
                        self.assertEqual({name: locks.get(name) for name in expected_hashes}, expected_hashes)
                    with (patch_directory / tampered).open("a", encoding="utf-8") as output:
                        output.write("\n# unapproved integration test patch bytes\n")
                    with mock.patch.dict(os.environ, remote_metadata), \
                            mock.patch.object(module.platform, "system", return_value="Linux"), \
                            mock.patch.object(module, "PATCH_DIR", patch_directory), \
                            mock.patch.object(module, "fetch_upstream", side_effect=AssertionError("Fetch must not run")) as fetch, \
                            mock.patch.object(module, "run_maven", side_effect=AssertionError("Maven must not run")) as maven:
                        try:
                            execute(work_dir=fixture_parent / (stage + "-work-" + tampered),
                                    receipt_dir=fixture_parent / (stage + "-receipt-" + tampered),
                                    suite="all", stage=stage)
                        except ValueError as error:
                            self.assertRegex(str(error), r"(?i)patch.*(hash|digest|lock|tamper)")
                        except Exception as error:
                            self.fail("Tampered patch reached a different admission boundary: " + type(error).__name__)
                        else:
                            self.fail("Tampered integration patch was not refused at the hash-lock boundary")
                        fetch.assert_not_called()
                        maven.assert_not_called()

    def test_real_git_error_retains_safe_command_exit_without_raw_stderr(self):
        module = self.runner()
        git = self.function("_git")
        result = subprocess.CompletedProcess(
            args=["git", "fetch"], returncode=128, stdout=b"",
            stderr=b"fatal: PRIVATE_HEADER_SENTINEL_337\n",
        )
        with mock.patch.object(module.subprocess, "run", return_value=result):
            with self.assertRaises(ValueError) as raised:
                git(self.root, "fetch", "--depth=1", "origin", "fixed-public-commit")
        summary = str(raised.exception)
        with self.subTest(summary_property="exit"):
            self.assertIn("128", summary)
        with self.subTest(summary_property="safe-subcommand"):
            self.assertIn("fetch", summary.lower())
        with self.subTest(summary_property="no-private-stderr"):
            self.assertNotIn("PRIVATE_HEADER_SENTINEL_337", summary)

    def test_non_github_execution_is_rejected_before_fetch_or_maven(self):
        module = self.runner()
        execute = self.function("run_backport")
        self.function("fetch_upstream")
        self.function("run_maven")

        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \
                mock.patch.object(module, "fetch_upstream") as fetch, \
                mock.patch.object(module, "run_maven") as maven:
            with self.assertRaisesRegex(RuntimeError, r"(?i)github.actions|remote"):
                execute(
                    work_dir=self.root / "fresh-work",
                    receipt_dir=self.root / "fresh-receipts",
                    suite="health",
                )
            fetch.assert_not_called()
            maven.assert_not_called()


if __name__ == "__main__":
    unittest.main()
