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
