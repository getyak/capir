#!/usr/bin/env python3
"""Run pinned Opik baseline or explicit backport stages on GitHub-hosted runners.

Pure admission helpers are importable by local stdlib tests. Actual fetch,
Docker and Maven execution is guarded by run_backport and never runs at import.
A failed command/report is not automatically classified as Java regression RED.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import subprocess
import sys
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET


PATCH_DIR = Path(__file__).resolve().parents[2] / "deploy" / "opik" / "backport"
UPSTREAM = "https://github.com/comet-ml/opik.git"
REVISION = "dd40343a223ec8d0ab11eafc5f88cbf18532c0ac"
CLICKHOUSE_REVISION = "6b9cb69f3e35e8857abd1fbd26e00ee54a43a766"
IMAGE = (
    "maven:3.9.16-amazoncorretto-25-al2023@"
    "sha256:1a15a026421093fa86053b17b116ede95acfa28346e5cf3e154943bc01db7119"
)
PLATFORM_DIGESTS = {
    "amd64": "sha256:c02b9533db6aec9026c1c3c7669bf6ea64a0fb1f1bc3cddca43dbf7caeadc27b",
    "arm64": "sha256:92babffc1a92a5bd15ddba0fed9b3b7686cc373d0d5f32753a4f9d118dcbe203",
}
PATCH_HASHES = {
    "0001-health-ownership-tests.patch":
        "0f13a0f7e2dce83c8595b1008f47c094bf0727e550549f41f26a992a0c114ed7",
    "0002-dataset-query-ownership-tests.patch":
        "1868137a4eb4ef7039d737d4916cd8e4e4d5c67dbf460237b8bb481f6f268855",
}
INTEGRATION_PATCH_HASHES = {
    "0006-http-pool-integration-tests.patch":
        "8085881a877988024414ef6af8c3eb95c40f16fad2f7e45680827c4b29cb6bef",
    "0007-dataset-cancel-handoff-tests.patch":
        "1762d37fdb01c641f8f31a644617d7c0650d9837b14b7190b225855e4c3b8def",
}
FIXED_PATCH_HASHES = {
    "0003-health-late-response-fix.patch":
        "9d989e9d304094d1595b44afac3e39ccb533e3acfccd82fb3398fe4a709f002c",
    "0004-upstream-health-contract-tests.patch":
        "01d5e68c611ec5a5172a09ee0dd77d1919066718cf90e8500330ebf99c829e71",
    "0005-dataset-query-response-fix.patch":
        "aa7f49d6b2b1a59a157550366cba9815b79390dc65bbaffa3075fdb847ca2d83",
}
HEALTH_FIXED_PATCHES = (
    "0003-health-late-response-fix.patch", "0004-upstream-health-contract-tests.patch",
)
TEST_ROOT = "apps/opik-backend/src/test/java/"
HEALTH_FIX_SOURCE = (
    "apps/opik-backend/src/main/java/com/comet/opik/infrastructure/db/healthchecks/"
    "AbstractClickHouseHealthCheck.java"
)
DAO_FIX_SOURCE = "apps/opik-backend/src/main/java/com/comet/opik/domain/DatasetItemVersionDAO.java"
ASYNC_FIX_SOURCE = "apps/opik-backend/src/main/java/com/comet/opik/utils/AsyncUtils.java"
PRODUCTION_FIX_PATHS = {HEALTH_FIX_SOURCE, DAO_FIX_SOURCE, ASYNC_FIX_SOURCE}
UPSTREAM_TEST_ROOT = TEST_ROOT + "com/comet/opik/infrastructure/db/healthchecks/"
UPSTREAM_TEST_PATHS = {
    UPSTREAM_TEST_ROOT + name + ".java" for name in (
        "AbstractClickHouseHealthCheckTest", "ClickHouseExistenceHealthCheckTest",
        "ClickHouseTracesTopologyHealthCheckTest",
    )
}
FIXED_PATCH_PATHS = {
    "0003-health-late-response-fix.patch": {HEALTH_FIX_SOURCE},
    "0004-upstream-health-contract-tests.patch": UPSTREAM_TEST_PATHS,
    "0005-dataset-query-response-fix.patch": {DAO_FIX_SOURCE, ASYNC_FIX_SOURCE},
}
HEALTH_PATH = TEST_ROOT + (
    "com/comet/opik/infrastructure/db/healthchecks/Get337ClickHouseHealthCheckOwnershipTest.java"
)
FIXTURE_PATH = TEST_ROOT + "com/comet/opik/testutil/Get337QueryResponseFixture.java"
DAO_PATH = TEST_ROOT + "com/comet/opik/domain/Get337DatasetItemVersionResponseOwnershipTest.java"
HTTP_PATH = TEST_ROOT + "com/comet/opik/infrastructure/db/healthchecks/Get337ClickHouseHttpPoolLifecycleTest.java"
HANDOFF_PATH = TEST_ROOT + "com/comet/opik/domain/Get337DatasetQueryHandoffOwnershipTest.java"
INTEGRATION_PATCH_PATHS = {
    "0006-http-pool-integration-tests.patch": {HTTP_PATH},
    "0007-dataset-cancel-handoff-tests.patch": {HANDOFF_PATH},
}
HEALTH_CLASS = (
    "com.comet.opik.infrastructure.db.healthchecks.Get337ClickHouseHealthCheckOwnershipTest"
)
DAO_CLASS = "com.comet.opik.domain.Get337DatasetItemVersionResponseOwnershipTest"
HTTP_CLASS = "com.comet.opik.infrastructure.db.healthchecks.Get337ClickHouseHttpPoolLifecycleTest"
HANDOFF_CLASS = "com.comet.opik.domain.Get337DatasetQueryHandoffOwnershipTest"
UPSTREAM_HEALTH_CLASS = "com.comet.opik.infrastructure.db.healthchecks.AbstractClickHouseHealthCheckTest"
UPSTREAM_HEALTH_METHODS = {
    UPSTREAM_HEALTH_CLASS + "$ClickHouseHealthCheckTests": {
        "check__whenQuerySucceeds__thenHealthy": 1,
        "check__whenQueryFails__thenUnhealthy": 1,
        "check__whenQueryInterrupted__thenUnhealthyAndRestoresInterruptFlag": 1,
    },
    UPSTREAM_HEALTH_CLASS + "$ClickHouseReadOnlyFreeFormSqlHealthCheckTests": {
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
METHOD_MULTIPLICITIES = {
    HEALTH_CLASS: {
        "timedOutProbeClosesTheResponseThatArrivesAfterTheDeadline": 1,
        "interruptedProbePreservesInterruptAndClosesItsLateResponse": 1,
        "successfulProbeClosesItsAcquiredResponseExactlyOnce": 1,
        "failedAcquisitionReportsTheOriginalFailure": 1,
        "mappingFailureClosesTheAcquiredResponseExactlyOnce": 1,
        "closeFailureReportsUnhealthyWithoutClosingTheSameResponseAgain": 1,
    },
    DAO_CLASS: {
        "cancellationBeforeDeliveryClosesTheLateQueryResponse": 2,
        "deliveredResponseIsClosedOnceBeforeReportingTheWrittenCount": 2,
        "queryFailurePropagatesWithoutSubmittingAnotherWrite": 2,
        "writtenRowsMappingFailureClosesItsResponseExactlyOnce": 2,
        "cleanupFailureDoesNotTurnACompletedWriteIntoAFailedOrRetriedWrite": 2,
    },
    HTTP_CLASS: {
        "realSdkReaderRoundTripsTheCompleteNativeCompressedSelectOneResponse": 1,
        "unreadRealResponseHoldsTheOnlyLeaseUntilItsPublicClose": 1,
        "timedOutProductionProbeReleasesItsLateRealResponseForTheNextProbe": 1,
    },
    HANDOFF_CLASS: {
        "cancellationAfterDeliveryClosesResponseBeforeTheQueuedMapperRuns": 2,
    },
}
METHOD_MULTIPLICITIES.update(UPSTREAM_HEALTH_METHODS)
BACKEND_SOURCES = {
    "pom.xml", "Dockerfile", "spotless.xml", "lombok.config",
    "src/main/java/com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.java",
    "src/main/java/com/comet/opik/infrastructure/db/healthchecks/ClickHouseHealthCheck.java",
    "src/main/java/com/comet/opik/domain/DatasetItemVersionDAO.java",
    "src/main/java/com/comet/opik/infrastructure/db/ZeroRowsRetryPolicy.java",
    "src/main/java/com/comet/opik/utils/AsyncUtils.java",
    "src/main/java/com/comet/opik/api/DatasetItemEdit.java",
}
DEPENDENCY_SOURCES = {
    "client-v2/src/main/java/com/clickhouse/client/api/query/QueryResponse.java",
    "client-v2/src/main/java/com/clickhouse/client/api/transport/internal/TransportResponse.java",
    "client-v2/src/main/java/com/clickhouse/client/api/metrics/OperationMetrics.java",
}
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_REPORT_BYTES = 8 * 1024 * 1024


def _selection(suite):
    if suite == "health":
        return list(PATCH_HASHES)[:1], {HEALTH_PATH, FIXTURE_PATH}, {HEALTH_CLASS}
    if suite == "all":
        return (list(PATCH_HASHES) + list(INTEGRATION_PATCH_HASHES),
                {HEALTH_PATH, FIXTURE_PATH, DAO_PATH, HTTP_PATH, HANDOFF_PATH},
                {HEALTH_CLASS, DAO_CLASS, HTTP_CLASS, HANDOFF_CLASS})
    if suite == "dao":
        return list(PATCH_HASHES), {HEALTH_PATH, FIXTURE_PATH, DAO_PATH}, {DAO_CLASS}
    raise ValueError("Unknown suite; expected health, dao or all")


def _stage_selection(suite, stage):
    names, paths, classes = _selection(suite)
    if stage == "baseline":
        return names, paths, classes
    if stage == "health-fixed" and suite == "health":
        return names + list(HEALTH_FIXED_PATCHES), paths, classes | set(UPSTREAM_HEALTH_METHODS)
    if stage == "responses-fixed" and suite == "all":
        ordered = list(PATCH_HASHES) + list(FIXED_PATCH_HASHES) + list(INTEGRATION_PATCH_HASHES)
        return ordered, paths, classes | set(UPSTREAM_HEALTH_METHODS)
    raise ValueError("Fixed stages require health/health-fixed or all/responses-fixed")


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _relative(path):
    value = str(path)
    parsed = PurePosixPath(value)
    if not value or parsed.is_absolute() or ".." in parsed.parts or "\\" in value or "\0" in value:
        raise ValueError("Unsafe relative source path")
    return value


def verify_source_fingerprint(*, path, claim):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Source fingerprint requires a regular, non-symlink file")
    size = claim.get("bytes")
    if type(size) is not int or size < 0 or size > MAX_SOURCE_BYTES:
        raise ValueError("Invalid source byte claim")
    for key, length in (("sha256", 64), ("git_blob_sha1", 40)):
        if not re.fullmatch(r"[0-9a-f]{" + str(length) + r"}", str(claim.get(key, ""))):
            raise ValueError("Invalid source " + key + " claim")
    if path.stat().st_size != size:
        raise ValueError("Source byte count mismatch: " + str(claim.get("path", path.name)))
    with path.open("rb") as source:
        data = source.read(MAX_SOURCE_BYTES + 1)
    blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
    actual = {"bytes": len(data), "sha256": _sha256(data), "git_blob_sha1": blob}
    if any(actual[key] != claim[key] for key in actual):
        raise ValueError("Source fingerprint mismatch: " + str(claim.get("path", path.name)))
    return {"path": str(claim.get("path", path.name)), **actual, "hash_verified": True}


def verify_patch_locks(*, patch_dir, suite, stage="baseline"):
    names, _, _ = _stage_selection(suite, stage)
    hashes = {**PATCH_HASHES, **FIXED_PATCH_HASHES, **INTEGRATION_PATCH_HASHES}
    result = {}
    for name in names:
        path = Path(patch_dir) / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SOURCE_BYTES:
            raise ValueError("Patch lock requires a regular bounded file: " + name)
        digest = _sha256(path.read_bytes())
        if digest != hashes[name]:
            raise ValueError("Patch hash lock mismatch: " + name)
        result[name] = digest
    return result


def _command_environment():
    # No inherited tokens, SSH agent, Git config, Docker context or proxy settings.
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
    }


def _git(source_dir, *arguments):
    command = [
        "git", "-C", str(source_dir),
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.autocrlf=false",
        "-c", "core.filemode=true",
        "-c", "credential.helper=",
        *arguments,
    ]
    result = subprocess.run(
        command, capture_output=True, check=False, timeout=300, env=_command_environment()
    )
    if result.returncode:
        safe_kinds = {
            "init", "remote", "sparse-checkout", "fetch", "checkout", "rev-parse",
            "status", "diff", "ls-files", "apply", "show",
        }
        kind = next((argument for argument in arguments if argument in safe_kinds), "operation")
        raise ValueError(
            "Public-source Git " + kind + " failed (exit " + str(result.returncode) + ")"
        )
    return result.stdout


def _fingerprint_bytes(data):
    return {"bytes": len(data), "sha256": _sha256(data),
            "git_blob_sha1": hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()}


def _manifest_stage_modifications(manifest, suite, stage):
    selected, _, _ = _stage_selection(suite, stage)
    expected_stages = {
        "baseline": {"suites": ["health", "dao", "all"], "fixed_patches": []},
        "health-fixed": {"suites": ["health"], "fixed_patches": list(HEALTH_FIXED_PATCHES)},
        "responses-fixed": {"suites": ["all"], "fixed_patches": list(FIXED_PATCH_HASHES)},
    }
    if manifest.get("stages") != expected_stages:
        raise ValueError("Manifest stage authorization differs from the fixed runner contract")
    integration = manifest.get("integration_patches", {})
    if set(integration) != set(INTEGRATION_PATCH_HASHES):
        raise ValueError("Unexpected integration test patch catalogue")
    for name, digest in INTEGRATION_PATCH_HASHES.items():
        entry = integration[name]
        if (entry.get("sha256") != digest
                or set(entry.get("new_test_paths", [])) != INTEGRATION_PATCH_PATHS[name]
                or set(entry.get("new_test_sources", {})) != INTEGRATION_PATCH_PATHS[name]):
            raise ValueError("Integration test patch hash/path contract mismatch")
    entries = manifest.get("fixed_patches", {})
    if set(entries) != set(FIXED_PATCH_HASHES):
        raise ValueError("Unexpected fixed patch catalogue")
    modifications = {}
    for name, digest in FIXED_PATCH_HASHES.items():
        entry = entries[name]
        changes = entry.get("changes", {})
        if entry.get("sha256") != digest or set(changes) != FIXED_PATCH_PATHS[name]:
            raise ValueError("Fixed patch hash/path contract mismatch")
        for path, claim in changes.items():
            if set(claim) != {"before", "after"}:
                raise ValueError("Unexpected modified-file fingerprint contract")
            if name in selected:
                if path in modifications:
                    raise ValueError("Overlapping fixed patch source paths")
                modifications[path] = claim
    return modifications


def validate_applied_tests(*, source_dir, expected_paths):
    return _validate_applied_changes(source_dir=source_dir, expected_paths=expected_paths, modifications={})


def validate_applied_stage(*, source_dir, suite, stage, modifications):
    names, paths, _ = _stage_selection(suite, stage)
    required = set().union(*(FIXED_PATCH_PATHS[name] for name in names if name in FIXED_PATCH_PATHS))
    if set(modifications) != required:
        raise ValueError("Modified paths do not equal the explicitly selected stage")
    return _validate_applied_changes(source_dir=source_dir, expected_paths=paths, modifications=modifications)


def _validate_applied_changes(*, source_dir, expected_paths, modifications):
    source_dir = Path(source_dir)
    expected = {_relative(path) for path in expected_paths}
    if not expected or any(not p.startswith(TEST_ROOT) or not p.endswith(".java") for p in expected):
        raise ValueError("Expected scope must contain only explicit Java test paths")
    health_scope = set().union(*(FIXED_PATCH_PATHS[name] for name in HEALTH_FIXED_PATCHES))
    responses_scope = set().union(*FIXED_PATCH_PATHS.values())
    if modifications and set(modifications) not in (health_scope, responses_scope):
        raise ValueError("Modified source scope is not an exact fixed backport stage")
    if _git(source_dir, "diff", "--name-only", "-z"):
        raise ValueError("Unstaged source/index drift")
    # Deliberately do not exclude ignored paths: hidden extra compilation inputs are still inputs.
    if _git(source_dir, "ls-files", "--others", "-z"):
        raise ValueError("Untracked or ignored-untracked input after test patch")
    fields = _git(source_dir, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD").split(b"\0")
    if fields[-1:] == [b""]:
        fields.pop()
    if len(fields) % 2:
        raise ValueError("Malformed actual Git index diff")
    rows = []
    for offset in range(0, len(fields), 2):
        metadata = fields[offset].decode("ascii").split()
        path = fields[offset + 1].decode("utf-8", "surrogateescape")
        if len(metadata) != 5 or metadata[1] != "100644":
            raise ValueError("Patch must preserve regular mode-100644 files")
        status = metadata[4]
        if status == "A" and metadata[0] == ":000000" and path in expected:
            pass
        elif status == "M" and metadata[0] == ":100644" and path in modifications:
            before = _fingerprint_bytes(_git(source_dir, "show", "HEAD:" + path))
            if before != modifications[path]["before"]:
                raise ValueError("Modified-file baseline fingerprint mismatch: " + path)
            verify_source_fingerprint(path=source_dir / path, claim={"path": path, **modifications[path]["after"]})
        else:
            raise ValueError("Unapproved actual index status/path in the selected stage")
        actual_path = source_dir / path
        if actual_path.is_symlink() or not actual_path.is_file():
            raise ValueError("Unexpected or non-regular patch path: " + path)
        if stat.S_IMODE(actual_path.stat().st_mode) & 0o111:
            raise ValueError("Executable test input: " + path)
        rows.append({"path": path, "status": status, "mode": "100644"})
    complete = expected | set(modifications)
    if {row["path"] for row in rows} != complete or len(rows) != len(complete):
        raise ValueError("Actual applied paths do not equal the complete selected stage")
    return rows


def validate_protected_catalogue(*, before, after, modifications):
    expected = dict(before)
    for path, claim in modifications.items():
        if path.startswith(TEST_ROOT):
            continue
        if path not in PRODUCTION_FIX_PATHS or before.get(path) != claim["before"]["sha256"]:
            raise ValueError("Unexpected protected production-source baseline/change")
        expected[path] = claim["after"]["sha256"]
    if after != expected:
        raise ValueError("Protected source/schema closure differs beyond the exact fixed fingerprint")
    return True


def evaluate_test_results(*, report_dir, expected_classes, not_before_ns, maven_exit_code):
    result = {
        "passed": False, "maven_exit_code": maven_exit_code,
        "tests": 0, "failures": 0, "errors": 0, "skipped": 0,
        "suites": [], "container_suites": [], "admission_errors": [],
    }
    problems = result["admission_errors"]
    if not expected_classes or not set(expected_classes).issubset(METHOD_MULTIPLICITIES):
        problems.append("Unknown selected JUnit class contract")
        return result
    directory = Path(report_dir)
    if directory.is_symlink() or not directory.is_dir():
        problems.append("Fresh selected Surefire reports are missing")
        return result
    reports = sorted(directory.glob("*.xml"))
    seen = set()
    if not reports:
        problems.append("No selected JUnit XML was produced")
    for report in reports:
        try:
            if report.is_symlink() or report.stat().st_mtime_ns < not_before_ns:
                raise ValueError("Stale or symlink JUnit report")
            with report.open("rb") as report_input:
                data = report_input.read(MAX_REPORT_BYTES + 1)
            if len(data) > MAX_REPORT_BYTES or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError("Unbounded or externally defined JUnit XML")
            root = ET.fromstring(data)
            name = root.get("name", "")
            children = {name for name in UPSTREAM_HEALTH_METHODS if name.startswith(UPSTREAM_HEALTH_CLASS + "$")}
            container = name == UPSTREAM_HEALTH_CLASS and children.issubset(expected_classes)
            if root.tag != "testsuite" or (name not in expected_classes and not container) or name in seen:
                raise ValueError("Unexpected, duplicate or unsupported selected JUnit suite")
            counts = {}
            for key in ("tests", "failures", "errors", "skipped"):
                value = root.get(key, "")
                if not value.isdigit():
                    raise ValueError("Invalid JUnit count: " + key)
                counts[key] = int(value)
            cases = root.findall("testcase")
            if container:
                if cases or any(counts.values()) or result["container_suites"]:
                    raise ValueError("Nested-suite container must be empty and appear at most once")
                result["container_suites"].append({"class": name, "report_sha256": _sha256(data)})
                continue
            seen.add(name)
            actual = {"tests": len(cases), "failures": 0, "errors": 0, "skipped": 0}
            expected_methods = METHOD_MULTIPLICITIES[name]
            method_counts = dict.fromkeys(expected_methods, 0)
            names = set()
            case_results = []
            for case in cases:
                case_name = case.get("name", "")
                if case.get("classname") != name or not case_name or case_name in names:
                    raise ValueError("Unexpected or duplicate selected JUnit testcase")
                names.add(case_name)
                # Surefire may append a signature or parameter display. The Java stem is fixed.
                method = re.split(r"[\(\[]", case_name, maxsplit=1)[0].strip()
                if method not in expected_methods:
                    raise ValueError("Unknown selected JUnit test method")
                method_counts[method] += 1
                outcomes = [(tag, case.findall(tag)) for tag in ("failure", "error", "skipped")]
                total = sum(len(entries) for _, entries in outcomes)
                if total > 1:
                    raise ValueError("Ambiguous JUnit testcase outcome")
                item = {"name": case_name, "outcome": "success"}
                for tag, entries in outcomes:
                    if entries:
                        actual[{"failure": "failures", "error": "errors", "skipped": "skipped"}[tag]] += 1
                        item.update(
                            outcome=tag, type=entries[0].get("type", ""),
                            message=entries[0].get("message", "")[:1024],
                            detail=(entries[0].text or "")[:4096],
                        )
                case_results.append(item)
            if counts != actual:
                raise ValueError("JUnit counters do not match actual selected testcases")
            if counts["tests"] != sum(expected_methods.values()) or counts["skipped"] != 0:
                raise ValueError("Selected JUnit suite must execute every expected instance without skips")
            if method_counts != expected_methods:
                raise ValueError("Selected JUnit method multiplicities do not match the fixed test contract")
            row = {"class": name, "report_sha256": _sha256(data), **counts, "cases": case_results}
            result["suites"].append(row)
            for key in actual:
                result[key] += counts[key]
            if counts["errors"] or counts["failures"]:
                problems.append("Selected tests reported failures/errors: " + name)
        except (OSError, ValueError, ET.ParseError) as error:
            problems.append(report.name + ": " + str(error))
    if seen != set(expected_classes):
        problems.append("Selected JUnit suite set is incomplete or unexpected")
    if maven_exit_code != 0:
        problems.append("Maven did not exit zero")
    result["passed"] = not problems and result["tests"] > 0
    return result


def _require_remote_execution():
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("CI") != "true"
        or os.environ.get("RUNNER_OS") != "Linux"
        or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        or platform.system() != "Linux"
        or not os.environ.get("GITHUB_RUN_ID", "").isdigit()
        or not os.environ.get("GITHUB_RUN_ATTEMPT", "").isdigit()
    ):
        raise RuntimeError("Actual execution requires a remote GitHub-hosted Linux Actions job")


def _new_directory(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts or path.exists() or path.is_symlink():
        raise ValueError("Require an absolute, new, exclusive directory")
    if not path.parent.is_dir() or path.parent.resolve() != path.parent:
        raise ValueError("Directory parent must already exist without symlink traversal")
    path.mkdir(mode=0o700)
    return path


def _write_json(path, value):
    with Path(path).open("w", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")


def fetch_upstream(*, work_dir):
    _require_remote_execution()
    source = Path(work_dir) / "upstream"
    source.mkdir(mode=0o700)
    _git(source, "init", "--quiet")
    _git(source, "remote", "add", "origin", UPSTREAM)
    _git(source, "sparse-checkout", "init", "--no-cone")
    _git(source, "sparse-checkout", "set", "--no-cone", "/apps/opik-backend/", "/LICENSE")
    _git(source, "-c", "protocol.version=2", "fetch", "--depth=1", "--filter=blob:none", "origin", REVISION)
    _git(source, "checkout", "--detach", "FETCH_HEAD")
    if _git(source, "rev-parse", "HEAD").decode().strip() != REVISION:
        raise ValueError("Fetched upstream revision does not equal the fixed commit")
    if _git(source, "status", "--porcelain=v1", "--untracked-files=all"):
        raise ValueError("Fresh upstream checkout is not clean")
    return source


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Fixed public source redirects are not accepted")


def _verify_sources(source, work_dir, manifest):
    backend_prefix = "apps/opik-backend/"
    claims = manifest.get("sources", [])
    dependencies = manifest.get("dependency_sources", [])
    if {row.get("path") for row in claims} != {backend_prefix + p for p in BACKEND_SOURCES}:
        raise ValueError("Backend source fingerprint catalogue changed")
    if len(claims) != len(BACKEND_SOURCES):
        raise ValueError("Duplicate backend source claim")
    if {row.get("path") for row in dependencies} != DEPENDENCY_SOURCES or len(dependencies) != 3:
        raise ValueError("Dependency source fingerprint catalogue changed")
    results = []
    for claim in claims:
        relative = _relative(claim["path"])
        expected_url = "https://raw.githubusercontent.com/comet-ml/opik/" + REVISION + "/" + relative
        if claim.get("url") != expected_url:
            raise ValueError("Backend source URL is not the fixed official commit")
        record = verify_source_fingerprint(path=source / relative, claim=claim)
        canonical = _git(source, "rev-parse", "HEAD:" + relative).decode().strip()
        if canonical != record["git_blob_sha1"]:
            raise ValueError("Fresh source does not match the exact Git tree blob")
        results.append(record)
    dependency_dir = Path(work_dir) / "dependency-sources"
    dependency_dir.mkdir(mode=0o700)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    for claim in dependencies:
        relative = _relative(claim["path"])
        url = (
            "https://raw.githubusercontent.com/ClickHouse/clickhouse-java/"
            + CLICKHOUSE_REVISION + "/" + relative
        )
        if claim.get("url") != url or claim.get("revision") != CLICKHOUSE_REVISION:
            raise ValueError("Dependency source is not the fixed official ClickHouse commit")
        request = urllib.request.Request(url, headers={"User-Agent": "capir-get337-source-verification"})
        with opener.open(request, timeout=30) as response:
            data = response.read(MAX_SOURCE_BYTES + 1)
        if len(data) > MAX_SOURCE_BYTES:
            raise ValueError("Dependency source exceeds the bounded source limit")
        target = dependency_dir / Path(relative).name
        with target.open("xb") as output:
            output.write(data)
        results.append(verify_source_fingerprint(path=target, claim=claim))
    return results


def _protected_catalogue(source):
    # Include new files under production paths, rather than only paths tracked before Maven.
    backend = source / "apps" / "opik-backend"
    paths = [source / "LICENSE"]
    for path in backend.rglob("*"):
        relative = path.relative_to(backend)
        if relative.parts[0] == "target" or relative.as_posix().startswith("src/test/"):
            continue
        if path.is_symlink():
            raise ValueError("Symlink in protected source catalogue")
        if path.is_file():
            paths.append(path)
    result = {}
    for path in paths:
        if path.is_symlink():
            raise ValueError("Symlink in protected source catalogue")
        result[path.relative_to(source).as_posix()] = _sha256(path.read_bytes())
    return result


def _logged_command(arguments, *, environment, log_path, timeout):
    with Path(log_path).open("wb") as output:
        completed = subprocess.run(
            arguments, stdout=output, stderr=subprocess.STDOUT,
            check=False, timeout=timeout, env=environment,
        )
    return completed.returncode


def run_maven(*, source_dir, work_dir, receipt_dir, suite, manifest, stage="baseline"):
    _require_remote_execution()
    work_dir, receipt_dir, source_dir = Path(work_dir), Path(receipt_dir), Path(source_dir)
    _, _, classes = _stage_selection(suite, stage)
    image_claim = manifest.get("runner", {}).get("build_image_resolution", {})
    if image_claim.get("index_digest") != IMAGE.split("@", 1)[1]:
        raise ValueError("Manifest build image does not match the locked image digest")
    architecture = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64"}.get(platform.machine())
    if not architecture:
        raise ValueError("Unsupported remote runner architecture")
    expected_platform = next(
        (row for row in image_claim.get("platforms", [])
         if row.get("platform", {}).get("architecture") == architecture
         and row.get("platform", {}).get("os") == "linux"), None
    )
    if not expected_platform or expected_platform.get("digest") != PLATFORM_DIGESTS[architecture]:
        raise ValueError("No pinned build-image platform claim")
    docker_config = work_dir / "docker-config"
    docker_config.mkdir(mode=0o700)
    _write_json(docker_config / "config.json", {"auths": {}})
    environment = _command_environment()
    environment.update(DOCKER_CONFIG=str(docker_config), DOCKER_HOST="unix:///var/run/docker.sock")
    pull_code = _logged_command(
        ["docker", "pull", "--platform", "linux/" + architecture, IMAGE],
        environment=environment, log_path=receipt_dir / "build-image-pull.log", timeout=600,
    )
    if pull_code:
        raise RuntimeError("Pinned public build-image pull failed: " + str(pull_code))
    inspection = subprocess.run(
        ["docker", "image", "inspect", IMAGE],
        capture_output=True, check=False, timeout=30, env=environment,
    )
    if inspection.returncode:
        raise RuntimeError("Unable to inspect the pinned build image")
    image = json.loads(inspection.stdout)[0]
    if image.get("Architecture") != architecture or image.get("Os") != "linux":
        raise ValueError("Actual build image platform mismatch")
    identity = {
        "reference": IMAGE, "id": image.get("Id"), "architecture": architecture,
        "repo_digests": image.get("RepoDigests", []),
        "selected_platform_manifest": expected_platform["digest"],
    }
    cache = work_dir / "maven-repository"
    cache.mkdir(mode=0o700)
    source_owner = source_dir.stat()
    cache_owner = cache.stat()
    container_user = str(source_owner.st_uid) + ":" + str(source_owner.st_gid)
    identity.update({
        "source_bind_owner": {"uid": source_owner.st_uid, "gid": source_owner.st_gid,
                              "mode": format(stat.S_IMODE(source_owner.st_mode), "04o")},
        "cache_bind_owner": {"uid": cache_owner.st_uid, "gid": cache_owner.st_gid,
                             "mode": format(stat.S_IMODE(cache_owner.st_mode), "04o")},
        "requested_container_user": container_user,
        "maven_config": "/maven-repository",
        "jvm_user_home": "/maven-repository",
    })
    _write_json(receipt_dir / "build-image.json", identity)
    if (source_owner.st_uid, source_owner.st_gid) != (cache_owner.st_uid, cache_owner.st_gid):
        raise ValueError("Private source and Maven cache bind owners differ")
    if any(stat.S_IMODE(owner.st_mode) != 0o700 for owner in (source_owner, cache_owner)):
        raise ValueError("Source and Maven cache binds must retain private mode 0700")
    reports = source_dir / "apps/opik-backend/target/surefire-reports"
    if reports.exists():
        raise ValueError("Surefire report directory existed before this Maven invocation")
    for path in (source_dir, cache):
        if any(character in str(path) for character in (",", "\n", "\r")):
            raise ValueError("Unsupported mount path")
    token = uuid.uuid4().hex
    common = [
        "docker", "run", "--rm", "--init", "--pull=never",
        "--user", container_user,
        "--network=bridge", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--cpus=2", "--memory=3g", "--pids-limit=512",
        "--label", "capir.task=GET-337", "--label", "capir.run=" + token,
        "--mount", "type=bind,src=" + str(source_dir) + ",dst=/workspace",
        "--mount", "type=bind,src=" + str(cache) + ",dst=/maven-repository",
        "--workdir", "/workspace/apps/opik-backend",
        "--env", "MAVEN_OPTS=-Xmx1G -XX:MaxMetaspaceSize=265m",
        "--env", "MAVEN_CONFIG=/maven-repository",
        "--env", "JAVA_TOOL_OPTIONS=-Duser.home=/maven-repository",
    ]

    def container(arguments, log_name, timeout):
        cid_file = work_dir / (log_name + ".cid")
        try:
            return _logged_command(
                common + ["--cidfile", str(cid_file), IMAGE] + arguments,
                environment=environment, log_path=receipt_dir / log_name, timeout=timeout,
            )
        finally:
            # Only this invocation's exact container ID and ownership labels can be cleaned.
            if cid_file.is_file():
                container_id = cid_file.read_text().strip()
                if re.fullmatch(r"[0-9a-f]{64}", container_id):
                    observed = subprocess.run(
                        ["docker", "inspect", "--format", "{{json .Config.Labels}}", container_id],
                        capture_output=True, check=False, timeout=15, env=environment,
                    )
                    if observed.returncode == 0:
                        labels = json.loads(observed.stdout)
                        if (isinstance(labels, dict) and labels.get("capir.task") == "GET-337"
                                and labels.get("capir.run") == token):
                            subprocess.run(
                                ["docker", "rm", "--force", container_id],
                                capture_output=True, check=False, timeout=30, env=environment,
                            )
    versions_code = container(
        ["/bin/sh", "-c", "java -version && mvn --version"], "toolchain-versions.log", 60
    )
    if versions_code:
        raise RuntimeError("Build-container toolchain readback failed")
    selectors = ",".join(sorted({name.split("$", 1)[0].rsplit(".", 1)[-1] for name in classes}))
    started_ns = time.time_ns()
    code = container(
        ["mvn", "-B", "-ntp", "-Dspotless.skip=true", "-Dtest=" + selectors,
         "-DfailIfNoTests=true", "-Dmaven.repo.local=/maven-repository",
         "-DforkCount=1", "-DreuseForks=true", "-DargLine=-Xmx768m", "test"],
        "maven.log", 1800,
    )
    return {"maven_exit_code": code, "not_before_ns": started_ns, "report_dir": reports,
            "build_image": identity,
            "toolchain_versions_sha256": _sha256((receipt_dir / "toolchain-versions.log").read_bytes()),
            "maven_log_sha256": _sha256((receipt_dir / "maven.log").read_bytes())}


def run_backport(*, work_dir, receipt_dir, suite="health", stage="baseline"):
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Actual execution is remote GitHub Actions only")
    # Lock rejection precedes all public-source fetch and Maven/container activity.
    patches = verify_patch_locks(patch_dir=PATCH_DIR, suite=suite, stage=stage)
    _require_remote_execution()
    work_dir, receipt_dir = Path(work_dir), Path(receipt_dir)
    if work_dir == receipt_dir or work_dir in receipt_dir.parents or receipt_dir in work_dir.parents:
        raise ValueError("Work and receipt directories must be separate fresh siblings")
    # Check both before claiming either; mkdir remains exclusive if another writer races.
    for path in (work_dir, receipt_dir):
        if path.exists() or path.is_symlink():
            raise ValueError("Refusing to reuse or delete a preexisting path")
    work_dir = _new_directory(work_dir)
    receipt_dir = _new_directory(receipt_dir)
    receipt = {
        "schema": "capri.opik.regression-run.v1", "suite": suite, "patch_stage": stage, "passed": False,
        "classification": "infrastructure_or_provenance_failure", "maven_exit_code": None,
        "upstream_revision": REVISION, "patch_sha256": patches,
        "github_run_id": os.environ["GITHUB_RUN_ID"],
        "github_run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
    }
    result_path = receipt_dir / "receipt.json"
    _write_json(result_path, receipt)
    try:
        manifest_path = PATCH_DIR / "manifest.json"
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        if (manifest.get("schema") != "capri.opik.backport-tests.v1"
                or manifest.get("upstream", {}).get("revision") != REVISION
                or manifest.get("upstream", {}).get("repository") != "https://github.com/comet-ml/opik"):
            raise ValueError("Manifest upstream revision changed")
        receipt["manifest_sha256"] = _sha256(manifest_bytes)
        modifications = _manifest_stage_modifications(manifest, suite, stage)
        source = fetch_upstream(work_dir=work_dir)
        receipt["stage"] = "source_fingerprint_verification"
        receipt["source_fingerprints"] = _verify_sources(source, work_dir, manifest)
        receipt["source_fingerprints_stage"] = "verified_upstream_baseline_before_patches"
        _write_json(receipt_dir / "source-fingerprints.json", receipt["source_fingerprints"])
        protected = _protected_catalogue(source)
        _write_json(receipt_dir / "protected-source-before.json", protected)
        locked_dir = work_dir / "locked-patches"
        locked_dir.mkdir(mode=0o700)
        verify_patch_locks(patch_dir=PATCH_DIR, suite=suite, stage=stage)
        for name, digest in patches.items():
            data = (PATCH_DIR / name).read_bytes()
            if _sha256(data) != digest:
                raise ValueError("Patch hash changed before apply")
            target = locked_dir / name
            with target.open("xb") as output:
                output.write(data)
            _git(source, "apply", "--index", str(target))
        _, expected_paths, classes = _stage_selection(suite, stage)
        changes = validate_applied_stage(
            source_dir=source, suite=suite, stage=stage, modifications=modifications
        )
        receipt["integration_test_fingerprints"] = [
            verify_source_fingerprint(path=source / path, claim={"path": path, **claim})
            for name in patches if name in INTEGRATION_PATCH_HASHES
            for path, claim in manifest["integration_patches"][name]["new_test_sources"].items()
        ]
        receipt["applied_test_changes"] = [row for row in changes if row["path"].startswith(TEST_ROOT)]
        receipt["applied_production_changes"] = [row for row in changes if not row["path"].startswith(TEST_ROOT)]
        receipt["modified_source_fingerprints"] = modifications
        applied_hashes = {row["path"]: _sha256((source / row["path"]).read_bytes()) for row in changes}
        initial_index = _git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD")
        patched_protected = _protected_catalogue(source)
        validate_protected_catalogue(before=protected, after=patched_protected, modifications=modifications)
        _write_json(receipt_dir / "protected-source-patched.json", patched_protected)
        receipt["stage"] = "maven"
        _write_json(result_path, receipt)
        execution = run_maven(
            source_dir=source, work_dir=work_dir, receipt_dir=receipt_dir, suite=suite,
            manifest=manifest, stage=stage
        )
        receipt["maven_exit_code"] = execution["maven_exit_code"]
        receipt["build_image"] = execution["build_image"]
        receipt["toolchain_versions_sha256"] = execution["toolchain_versions_sha256"]
        receipt["maven_log_sha256"] = execution["maven_log_sha256"]
        evaluation = evaluate_test_results(
            report_dir=execution["report_dir"], expected_classes=classes,
            not_before_ns=execution["not_before_ns"], maven_exit_code=execution["maven_exit_code"],
        )
        _write_json(receipt_dir / "selected-surefire.json", evaluation)
        receipt["selected_surefire"] = evaluation
        after = _protected_catalogue(source)
        _write_json(receipt_dir / "protected-source-after.json", after)
        untracked_after = _git(source, "ls-files", "--others", "-z").split(b"\0")
        unexpected_after = [path for path in untracked_after if path and
                            not path.startswith(b"apps/opik-backend/target/")]
        if (
            after != patched_protected
            or unexpected_after
            or _git(source, "rev-parse", "HEAD").decode().strip() != REVISION
            or _git(source, "diff", "--name-only", "-z")
            or _git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD") != initial_index
            or any(_sha256((source / path).read_bytes()) != digest
                   for path, digest in applied_hashes.items())
        ):
            raise ValueError("Source, schema, index or selected tests changed during Maven")
        receipt["passed"] = evaluation["passed"]
        receipt["classification"] = "selected_tests_passed" if evaluation["passed"] else "maven_or_test_failure"
        receipt["stage"] = "complete"
        _write_json(result_path, receipt)
        code = receipt["maven_exit_code"]
        return code if code else (0 if receipt["passed"] else 1)
    except Exception as error:
        receipt.update(passed=False, classification="infrastructure_or_provenance_failure",
                       error_type=type(error).__name__, error=str(error)[:2000])
        _write_json(result_path, receipt)
        code = receipt.get("maven_exit_code")
        return code if code else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--receipt-dir", required=True, type=Path)
    parser.add_argument("--suite", choices=("health", "dao", "all"), default="health")
    parser.add_argument("--stage", choices=("baseline", "health-fixed", "responses-fixed"), default="baseline")
    arguments = parser.parse_args()
    try:
        return run_backport(
            work_dir=arguments.work_dir, receipt_dir=arguments.receipt_dir,
            suite=arguments.suite, stage=arguments.stage
        )
    except Exception as error:
        # Preflight refusal does not acquire or write a preexisting receipt directory.
        print(json.dumps({"passed": False, "classification": "preflight_refused",
                          "error_type": type(error).__name__, "error": str(error)[:2000]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
