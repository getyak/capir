#!/usr/bin/env python3
"""Package only the current same-job fixed54 source; never build/import an image.

CLI context must be emitted by a fresh successful regression run. It is not an
upgrade path for old receipts. Actual execution is GitHub-hosted Linux/arm64.
Pure validators are importable without subprocess, network or filesystem writes.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PATCH_DIR = ROOT / "deploy/opik/backport"
_spec = importlib.util.spec_from_file_location("opik_package_regression_admission",
                                               Path(__file__).with_name("test-opik-backport.py"))
if _spec is None or _spec.loader is None:
    raise RuntimeError("Regression admission module is unavailable")
REGRESSION = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(REGRESSION)
REVISION = REGRESSION.REVISION
VERSION = "2.2.45"
POM_PATH = "apps/opik-backend/pom.xml"
RESOURCE_PREFIX = "apps/opik-backend/src/main/resources/"
DEPENDENCY_GOAL = "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:build-classpath"
CLASSPATH_TOOL = {
    "maven-dependency-plugin-3.8.1.jar": {
        "bytes": 207950, "sha256": "9fc3d435085983b16bc53903f9413aede9de30e20c57c0cece94614f328b14b5",
    },
    "maven-dependency-plugin-3.8.1.pom": {
        "bytes": 17998, "sha256": "4ad37e717dc713cec048b143f0de8fdd37d037f7d15be63f130cf96430caa808",
    },
}
REQUIRED_CLASSES = {
    "com/comet/opik/OpikApplication.class",
    "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.class",
    "com/comet/opik/utils/AsyncUtils.class",
    "com/comet/opik/domain/DatasetItemVersionDAOImpl.class",
    "com/comet/opik/infrastructure/bundle/LiquibaseBundle.class",
}
MAX_JSON = 32 * 1024 * 1024
MAX_JAR = 1024 * 1024 * 1024
MAX_ENTRY = 128 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _regular(path, limit=MAX_JSON):
    path = Path(path)
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
            raise ValueError("Expected a bounded regular file")
        return path
    except OSError:
        raise ValueError("Expected a readable regular file") from None


def _hash_file(path, limit=MAX_JAR):
    path = _regular(path, limit)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(path):
    try:
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Duplicate JSON key")
                result[key] = value
            return result
        return json.loads(_regular(path).read_bytes(), object_pairs_hook=unique)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("Unreadable bounded JSON evidence") from None


def _write(path, value):
    with Path(path).open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value or ":" in value:
        raise ValueError("Unsafe relative catalogue path")
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Unsafe relative catalogue path")
    return value


def _directory(value):
    path = Path(value)
    try:
        if not path.is_absolute() or path.is_symlink() or not path.is_dir() or path.resolve(strict=True) != path:
            raise ValueError("Directory must be an existing canonical absolute path")
    except OSError:
        raise ValueError("Directory is unavailable") from None
    if any(c in str(path) for c in (",", "\n", "\r", "\0")):
        raise ValueError("Unsupported bind path")
    return path


def _owner(path):
    value = path.stat()
    return {"uid": value.st_uid, "gid": value.st_gid, "mode": format(stat.S_IMODE(value.st_mode), "04o")}


def _catalogue(value):
    if not isinstance(value, dict) or not value:
        raise ValueError("Empty source catalogue")
    for path, digest in value.items():
        _relative(path)
        if not _digest(digest):
            raise ValueError("Invalid source hash")
    return value


def _expected_changes():
    _, added, _ = REGRESSION._stage_selection("all", "responses-fixed")
    modified = set().union(*REGRESSION.FIXED_PATCH_PATHS.values())
    production = modified - REGRESSION.UPSTREAM_TEST_PATHS
    return added, modified, production


def validate_fixed54_evidence(*, receipt_dir, report_dir, expected, context):
    """Validate receipt/material bindings; run_package separately requires the actual build-image proof."""
    receipt_dir, report_dir = _directory(receipt_dir), _directory(report_dir)
    receipt_path = receipt_dir / "receipt.json"
    if not _digest(context.get("fixed_receipt_sha256")) or _hash_file(receipt_path) != context["fixed_receipt_sha256"]:
        raise ValueError("Fixed receipt binding mismatch")
    receipt = _json(receipt_path)
    if (receipt.get("schema") != "capri.opik.regression-run.v1"
            or receipt.get("suite") != "all" or receipt.get("patch_stage") != "responses-fixed"
            or receipt.get("stage") != "complete" or receipt.get("passed") is not True
            or receipt.get("classification") != "selected_tests_passed"
            or type(receipt.get("maven_exit_code")) is not int or receipt["maven_exit_code"] != 0
            or receipt.get("upstream_revision") != REVISION):
        raise ValueError("Require a completed successful fixed54 run")
    for key in ("github_run_id", "github_run_attempt", "github_job", "capir_revision",
                "source_directory", "source_bind_owner", "maven_repository", "cache_bind_owner",
                "source_index_sha256", "not_before_ns"):
        if key not in context or key not in receipt or receipt[key] != context[key]:
            raise ValueError("Missing or changed fresh-run context: " + key)
    if (not str(context["github_run_id"]).isdigit() or not str(context["github_run_attempt"]).isdigit()
            or not re.fullmatch(r"[A-Za-z0-9_-]+", str(context["github_job"]))
            or not re.fullmatch(r"[0-9a-f]{40}", str(context["capir_revision"]))
            or not _digest(context["source_index_sha256"])
            or type(context["not_before_ns"]) is not int or context["not_before_ns"] <= 0):
        raise ValueError("Malformed fresh-run context")
    for directory_key, owner_key in (("source_directory", "source_bind_owner"), ("maven_repository", "cache_bind_owner")):
        directory = _directory(context[directory_key])
        if _owner(directory) != context[owner_key] or context[owner_key].get("mode") != "0700":
            raise ValueError("Fresh source/cache ownership changed")
    if context["source_bind_owner"] != context["cache_bind_owner"]:
        raise ValueError("Private source and task cache owners differ")
    for key in ("manifest_sha256", "patch_sha256", "modified_source_fingerprints", "source_fingerprints"):
        if key not in expected or receipt.get(key) != expected[key]:
            raise ValueError("Changed tested provenance: " + key)
    if receipt["patch_sha256"] != {**REGRESSION.PATCH_HASHES, **REGRESSION.FIXED_PATCH_HASHES,
                                  **REGRESSION.INTEGRATION_PATCH_HASHES}:
        raise ValueError("Fixed54 patch set changed")
    fingerprints = receipt["source_fingerprints"]
    if (not isinstance(fingerprints, list) or len(fingerprints) != 13
            or len({entry.get("path") for entry in fingerprints}) != 13
            or any(entry.get("hash_verified") is not True for entry in fingerprints)
            or receipt.get("source_fingerprints_stage") != "verified_upstream_baseline_before_patches"
            or _json(receipt_dir / "source-fingerprints.json") != fingerprints):
        raise ValueError("Incomplete tested source fingerprint evidence")
    added, modified, production = _expected_changes()
    wanted = {path: ("A" if path in added else "M") for path in added | modified}
    rows = receipt.get("applied_production_changes", []) + receipt.get("applied_test_changes", [])
    if (len(rows) != 11 or {r.get("path"): r.get("status") for r in rows} != wanted
            or any(row.get("mode") != "100644" for row in rows)
            or {row.get("path") for row in receipt.get("applied_production_changes", [])} != production):
        raise ValueError("Tested actual index scope or modes changed")
    applied = receipt.get("applied_source_sha256")
    if not isinstance(applied, dict) or set(applied) != set(wanted) or any(not _digest(v) for v in applied.values()):
        raise ValueError("Missing exact eleven tested source hashes")
    for path in modified:
        if applied[path] != receipt["modified_source_fingerprints"][path]["after"]["sha256"]:
            raise ValueError("Modified-source hash disagrees with the frozen after claim")
    before = _catalogue(_json(receipt_dir / "protected-source-before.json"))
    patched = _catalogue(_json(receipt_dir / "protected-source-patched.json"))
    after = _catalogue(_json(receipt_dir / "protected-source-after.json"))
    if len(before) != 1576 or patched != after or len([p for p in before if "/liquibase/" in p]) != 229:
        raise ValueError("Incomplete protected1576/schema229 evidence")
    REGRESSION.validate_protected_catalogue(before=before, after=patched,
                                            modifications=receipt["modified_source_fingerprints"])
    for filename, key in (("maven.log", "maven_log_sha256"), ("toolchain-versions.log", "toolchain_versions_sha256")):
        if not _digest(receipt.get(key)) or _hash_file(receipt_dir / filename) != receipt[key]:
            raise ValueError("Changed actual log evidence")
    selected = receipt.get("selected_surefire")
    if _json(receipt_dir / "selected-surefire.json") != selected:
        raise ValueError("Changed selected Surefire receipt")
    _, _, classes = REGRESSION._stage_selection("all", "responses-fixed")
    parsed = REGRESSION.evaluate_test_results(report_dir=report_dir, expected_classes=classes,
                                             not_before_ns=context["not_before_ns"], maven_exit_code=0)
    if (not parsed["passed"] or parsed["tests"] != 54
            or any(parsed[key] != 0 for key in ("failures", "errors", "skipped"))):
        raise ValueError("Require all fresh fixed54 raw JUnit instances")
    if not isinstance(selected, dict):
        raise ValueError("Selected Surefire receipt missing")
    for key in ("passed", "maven_exit_code", "tests", "failures", "errors", "skipped"):
        if selected.get(key) != parsed[key]:
            raise ValueError("Raw JUnit and selected counts disagree")
    if selected.get("admission_errors"):
        raise ValueError("Selected Surefire admission failed")
    for key in ("suites", "container_suites"):
        left, right = selected.get(key), parsed[key]
        if not isinstance(left, list) or len(left) != len(right):
            raise ValueError("Incomplete raw-report binding")
        if {r["class"]: r for r in left} != {r["class"]: r for r in right}:
            raise ValueError("Raw report hashes, methods or outcomes changed")
    return {"passed": True, "tests": 54, "receipt_sha256": context["fixed_receipt_sha256"]}


def validate_source_catalogue(*, source_dir, expected):
    source = _directory(source_dir)
    expected = _catalogue(expected)
    try:
        actual = REGRESSION._protected_catalogue(source)
    except OSError:
        raise ValueError("Protected source tree is unreadable") from None
    if actual != expected:
        raise ValueError("Protected source, POM or resource tree changed")
    return True


def derive_project_pom(*, original, version):
    if not isinstance(original, bytes) or len(original) > 2 * 1024 * 1024:
        raise ValueError("Original POM must be bounded bytes")
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError("Unsafe derived project version")
    if b"<!DOCTYPE" in original.upper() or b"<!ENTITY" in original.upper():
        raise ValueError("POM external definitions are forbidden")
    try:
        root = ET.fromstring(original)
    except ET.ParseError:
        raise ValueError("Invalid original POM") from None
    namespace = "{http://maven.apache.org/POM/4.0.0}"
    if root.tag != namespace + "project":
        raise ValueError("Unexpected Maven project root")
    versions = root.findall(namespace + "version")
    if len(versions) != 1 or versions[0].text != "1.0-SNAPSHOT":
        raise ValueError("Require one original root project version")
    # Expat gives byte offsets, allowing the unique direct-root text to change
    # without reserializing dependencies, plugins, namespaces or comments.
    from xml.parsers import expat
    parser = expat.ParserCreate(namespace_separator="|")
    depth, start, span = 0, None, None

    def begin(name, attrs):
        nonlocal depth, start
        depth += 1
        if depth == 2 and name == "http://maven.apache.org/POM/4.0.0|version":
            tag_end = original.find(b">", parser.CurrentByteIndex)
            if tag_end < 0:
                raise ValueError("Malformed root version tag")
            start = tag_end + 1

    def end(name):
        nonlocal depth, span
        if depth == 2 and name == "http://maven.apache.org/POM/4.0.0|version":
            span = (start, parser.CurrentByteIndex)
        depth -= 1

    parser.StartElementHandler, parser.EndElementHandler = begin, end
    try:
        parser.Parse(original, True)
    except expat.ExpatError:
        raise ValueError("Invalid POM byte structure") from None
    if span is None or original[span[0]:span[1]] != b"1.0-SNAPSHOT":
        raise ValueError("Ambiguous root version byte range")
    return original[:span[0]] + version.encode("ascii") + original[span[1]:]


def _zip_entries(archive):
    seen, total = set(), 0
    infos = archive.infolist()
    if len(infos) > 250000:
        raise ValueError("Unbounded JAR entry count")
    for info in infos:
        name = info.filename
        _relative(name[:-1] if info.is_dir() else name)
        if name in seen or info.flag_bits & 1:
            raise ValueError("Duplicate or encrypted JAR entry")
        seen.add(name)
        kind = stat.S_IFMT(info.external_attr >> 16)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR and not info.is_dir()):
            raise ValueError("Non-regular JAR entry")
        if info.file_size > MAX_ENTRY:
            raise ValueError("Unbounded JAR entry")
        total += info.file_size
        if total > MAX_EXPANDED:
            raise ValueError("Unbounded expanded JAR")
        yield info


def catalogue_release_jar(*, jar_path, migration_sources, required_entries, dependency_graph=None):
    jar_path = _regular(jar_path, MAX_JAR)
    if not isinstance(migration_sources, dict) or len(migration_sources) != 229:
        raise ValueError("Require the complete229 source resource map")
    for name, data in migration_sources.items():
        _relative(name)
        if not name.startswith("liquibase/") or not isinstance(data, bytes):
            raise ValueError("Unexpected source migration resource")
    entries, resources, manifest = {}, {}, None
    try:
        with zipfile.ZipFile(jar_path) as archive:
            for info in _zip_entries(archive):
                digest, size = hashlib.sha256(), 0
                content = bytearray() if info.filename in migration_sources or info.filename == "META-INF/MANIFEST.MF" else None
                with archive.open(info) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        size += len(chunk)
                        digest.update(chunk)
                        if content is not None:
                            content.extend(chunk)
                if size != info.file_size:
                    raise ValueError("JAR entry size mismatch")
                entries[info.filename] = {"sha256": digest.hexdigest(), "bytes": size,
                                          "kind": "directory" if info.is_dir() else "file"}
                if info.filename in migration_sources and not info.is_dir():
                    resources[info.filename] = bytes(content)
                if info.filename == "META-INF/MANIFEST.MF":
                    manifest = bytes(content)
    except (OSError, zipfile.BadZipFile, RuntimeError):
        raise ValueError("Unreadable safe JAR catalogue") from None
    missing_classes = sorted(set(required_entries) - set(entries))
    if missing_classes:
        raise ValueError("Missing required application JAR entries: " + ", ".join(missing_classes[:5]))
    missing_resources = sorted(set(migration_sources) - set(resources))
    if missing_resources:
        raise ValueError("Missing application migration resources: " + ", ".join(missing_resources[:5]))
    changed_resources = sorted(name for name in migration_sources if resources[name] != migration_sources[name])
    if changed_resources:
        raise ValueError("Changed application migration resource bytes: " + ", ".join(changed_resources[:5]))
    foreign_namespace = sorted(name for name, entry in entries.items()
                               if name.startswith("liquibase/") and entry["kind"] == "file"
                               and name not in migration_sources)
    if foreign_namespace and dependency_graph is None:
        raise ValueError("Liquibase namespace entries require explicit dependency provenance: "
                         + ", ".join(foreign_namespace[:5]))
    attributes = {}
    if manifest is not None:
        section = manifest.replace(b"\r\n", b"\n").replace(b"\n ", b"").split(b"\n\n", 1)[0]
        for line in section.split(b"\n"):
            if not line:
                continue
            if b": " not in line:
                raise ValueError("Malformed main JAR manifest")
            key, value = line.split(b": ", 1)
            key = key.lower()
            if key in attributes:
                raise ValueError("Duplicate main JAR manifest attribute")
            attributes[key] = value
    if attributes.get(b"main-class") != b"com.comet.opik.OpikApplication":
        raise ValueError("Unexpected main JAR manifest")
    result = {"sha256": _hash_file(jar_path), "bytes": jar_path.stat().st_size,
              "entries": entries, "migration_resources": len(resources),
              "source_migration_entries": sorted(migration_sources),
              "classes": [name for name in entries if name.endswith(".class")],
              "services": [name for name in entries if name.startswith("META-INF/services/") and entries[name]["kind"] == "file"]}
    if dependency_graph is not None:
        # Admission and provenance share one dependency ZIP scan. The caller
        # persists this separately rather than rescanning a large runtime graph.
        result["_dependency_provenance"] = _dependency_origins(dependency_graph, result)
    return result


def _verify_graph(graph):
    if not isinstance(graph, dict) or set(graph) != {"project", "dependencies"}:
        raise ValueError("Invalid runtime graph")
    project = graph["project"]
    if (not isinstance(project, dict) or set(project) != {"groupId", "artifactId", "packaging", "version"}
            or project["groupId"] != "com.comet.opik" or project["artifactId"] != "opik-backend"
            or project["packaging"] != "jar"):
        raise ValueError("Runtime project coordinate changed")
    dependencies = graph["dependencies"]
    if not isinstance(dependencies, list) or not dependencies:
        raise ValueError("Runtime dependencies are missing")
    coordinates, files = set(), set()
    for index, row in enumerate(dependencies):
        if (not isinstance(row, dict) or set(row) != {"coordinate", "file", "sha256", "bytes", "order"}
                or type(row["order"]) is not int or row["order"] != index or not _digest(row["sha256"])
                or type(row["bytes"]) is not int or row["bytes"] < 0):
            raise ValueError("Invalid ordered runtime artifact record")
        fields = row["coordinate"].split(":") if isinstance(row["coordinate"], str) else []
        if len(fields) != 5 or not all(fields[i] for i in (0, 1, 2, 4)) or fields[2] != "jar":
            raise ValueError("Invalid resolved runtime coordinate")
        path = Path(row["file"])
        if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
            raise ValueError("Runtime artifact is not a canonical regular path")
        if row["coordinate"] in coordinates or str(path) in files:
            raise ValueError("Duplicate runtime coordinate or file")
        coordinates.add(row["coordinate"])
        files.add(str(path))
        if _hash_file(path) != row["sha256"] or path.stat().st_size != row["bytes"]:
            raise ValueError("Actual resolved runtime artifact hash changed")
    return graph


def compare_runtime_graph(*, before, after, version):
    _verify_graph(before)
    _verify_graph(after)
    expected_project = {**before["project"], "version": version}
    if before["project"]["version"] != "1.0-SNAPSHOT" or after["project"] != expected_project:
        raise ValueError("Only the root project version may be derived")
    if before["dependencies"] != after["dependencies"]:
        raise ValueError("Runtime coordinates/order/files/hashes changed")
    return True


def settle_owned_container(*, cid_file, token, environment, command_exit_code, timed_out):
    """Return explicit bounded settlement evidence, never raw Docker output.

    A completed successful CLI plus an empty owned-label inventory covers normal
    --rm, including a retained CID whose container is already absent. A timed-out
    CLI without a confirmed CID can still create later: one empty inventory does
    not resolve that state. Only a CID with both exact labels authorizes removal.
    """
    result = {"settled": False, "reason": "unconfirmed", "command_exit_code": command_exit_code,
              "timed_out": timed_out, "owned_labels_verified": False}
    normal_success = type(command_exit_code) is int and command_exit_code == 0 and timed_out is False
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        result["reason"] = "invalid_operation_token"
        return result

    def inventory():
        try:
            observed = subprocess.run(
                ["docker", "ps", "--all", "--quiet", "--no-trunc",
                 "--filter", "label=capir.task=GET-337", "--filter", "label=capir.package=" + token],
                capture_output=True, check=False, timeout=15, env=environment)
            result["inventory_exit_code"] = observed.returncode
            if observed.returncode != 0:
                return False
            if len(observed.stdout) > 256 * 1024:
                result["inventory_error"] = "unbounded_ids"
                return False
            identities = observed.stdout.decode("ascii").split()
            if (len(set(identities)) != len(identities)
                    or any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in identities)):
                result["inventory_error"] = "invalid_full_ids"
                return False
            result["owned_container_ids"] = identities
            return not identities
        except Exception as error:
            result["inventory_error"] = type(error).__name__
            return False

    cid_file = Path(cid_file)
    try:
        missing = not cid_file.exists() and not cid_file.is_symlink()
        if missing:
            empty = inventory()
            result.update(settled=normal_success and empty,
                          reason=("normal_cli_owned_inventory_empty" if normal_success and empty
                                  else "missing_cid_late_create_unknown" if not normal_success
                                  else "owned_inventory_not_empty_or_unreadable"))
            return result
        if cid_file.is_symlink() or not cid_file.is_file() or cid_file.stat().st_size > 128:
            result["reason"] = "invalid_cid_file"
            inventory()
            return result
        container_id = cid_file.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[0-9a-f]{64}", container_id):
            result["reason"] = "invalid_cid"
            inventory()
            return result
        result["container_id"] = container_id
    except Exception as error:
        result.update(reason="cid_read_unknown", cid_error=type(error).__name__)
        inventory()
        return result
    try:
        labels = subprocess.run(
            ["docker", "inspect", "--format", "{{json .Config.Labels}}", container_id],
            capture_output=True, check=False, timeout=15, env=environment)
        result["inspect_exit_code"] = labels.returncode
    except Exception as error:
        result.update(reason="inspect_unknown", inspect_error=type(error).__name__)
        empty = inventory()
        if normal_success and empty:
            result.update(settled=True, reason="normal_cli_owned_inventory_empty")
        return result
    if labels.returncode != 0:
        empty = inventory()
        if normal_success and empty:
            result.update(settled=True, reason="normal_cli_owned_inventory_empty")
        else:
            result["reason"] = "inspect_unconfirmed"
        return result
    try:
        ownership = json.loads(labels.stdout)
    except (UnicodeError, json.JSONDecodeError):
        ownership = None
    if (not isinstance(ownership, dict) or ownership.get("capir.task") != "GET-337"
            or ownership.get("capir.package") != token):
        result["reason"] = "ownership_unconfirmed"
        inventory()
        return result
    result["owned_labels_verified"] = True
    try:
        removed = subprocess.run(["docker", "rm", "--force", container_id],
                                 capture_output=True, check=False, timeout=30, env=environment)
        result["remove_exit_code"] = removed.returncode
    except Exception as error:
        result.update(reason="remove_unknown", remove_error=type(error).__name__)
        inventory()
        return result
    empty = inventory()
    if removed.returncode != 0:
        result["reason"] = "owned_remove_failed"
    elif not empty:
        result["reason"] = "owned_inventory_not_empty_or_unreadable"
    else:
        result.update(settled=True, reason="owned_remove_and_empty_inventory")
    return result


def record_command_outcome(*, receipt, entry, code, timed_out, log_path, persist):
    entry.update(exit_code=None if timed_out else code,
                 outcome_code=code, timed_out=timed_out)
    if entry["log"] == "maven-package.log":
        receipt["maven_exit_code"] = None if timed_out else code
    persist()
    try:
        digest = _hash_file(log_path)
    except Exception as error:
        entry["log_hash_error_type"] = type(error).__name__
        persist()
        raise
    entry["sha256"] = digest
    persist()


def _expected(manifest, manifest_bytes):
    modifications = REGRESSION._manifest_stage_modifications(manifest, "all", "responses-fixed")
    fingerprints = [
        {key: claim[key] for key in ("path", "bytes", "sha256", "git_blob_sha1")} | {"hash_verified": True}
        for claim in manifest["sources"] + manifest["dependency_sources"]
    ]
    return {"manifest_sha256": _sha(manifest_bytes),
            "patch_sha256": {**REGRESSION.PATCH_HASHES, **REGRESSION.FIXED_PATCH_HASHES,
                             **REGRESSION.INTEGRATION_PATCH_HASHES},
            "source_fingerprints": fingerprints, "modified_source_fingerprints": modifications}


def _git(directory, *args):
    environment = REGRESSION._command_environment()
    environment.update(GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1")
    result = subprocess.run(
        ["git", "-C", str(directory), "-c", "core.hooksPath=/dev/null",
         "-c", "credential.helper=", "-c", "remote.origin.promisor=false", *args],
        capture_output=True, check=False, timeout=60, env=environment)
    if result.returncode:
        raise ValueError("Read-only source Git check failed (exit " + str(result.returncode) + ")")
    return result.stdout


def _source_git(source, context):
    if _git(source, "rev-parse", "HEAD").decode().strip() != REVISION:
        raise ValueError("Actual upstream checkout revision changed")
    index = _git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD")
    if _sha(index) != context["source_index_sha256"] or _git(source, "diff", "--name-only", "-z"):
        raise ValueError("Tested source index or unstaged state changed")
    others = _git(source, "ls-files", "--others", "-z").split(b"\0")
    if any(path and not path.startswith(b"apps/opik-backend/target/") for path in others):
        raise ValueError("Untracked package source input")
    return index


def _proof_files(receipt_dir, report_dir):
    files = {}
    for name in ("receipt.json", "source-fingerprints.json", "selected-surefire.json",
                 "protected-source-before.json", "protected-source-patched.json",
                 "protected-source-after.json", "maven.log", "toolchain-versions.log"):
        files["receipt/" + name] = receipt_dir / name
    for path in sorted(report_dir.glob("*.xml")):
        files["raw/" + path.name] = _regular(path)
    return files


class _CommandFailure(RuntimeError):
    def __init__(self, kind, code, timed_out=False):
        self.kind = kind
        self.code = code
        self.timed_out = timed_out
        super().__init__("Package " + kind + " failed (exit " + str(code) + ")")


class _UnsettledWriter(RuntimeError):
    def __init__(self, kind, code, timed_out, reason):
        self.kind, self.code, self.timed_out = kind, code, timed_out
        super().__init__("Owned package writer settlement is unknown: " + reason)


def _ensure_classpath_tool(cache):
    relative = "org/apache/maven/plugins/maven-dependency-plugin/3.8.1"
    parent = cache
    for component in PurePosixPath(relative).parts:
        parent = parent / component
        if parent.exists() or parent.is_symlink():
            if parent.is_symlink() or not parent.is_dir():
                raise ValueError("Symlinked or non-directory classpath tool path")
        else:
            parent.mkdir(mode=0o700)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    observed = {}
    for filename, claim in CLASSPATH_TOOL.items():
        path = parent / filename
        url = "https://repo.maven.apache.org/maven2/" + relative + "/" + filename
        reused = path.exists() or path.is_symlink()
        if not reused:
            # Public fixed URLs only, after all admission/remote gates. No proxy,
            # credentials, arbitrary URL input, or replacement of an existing file.
            with opener.open(url, timeout=30) as response:
                if response.geturl() != url or response.status != 200:
                    raise ValueError("Unexpected public build-tool response")
                data = response.read(claim["bytes"] + 1)
            if len(data) != claim["bytes"] or _sha(data) != claim["sha256"]:
                raise ValueError("Public classpath tool fingerprint mismatch")
            temporary = parent / (".get337-tool-" + uuid.uuid4().hex)
            created = False
            try:
                descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                created = True
                with os.fdopen(descriptor, "wb") as output:
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass  # Verify the racing existing file; never overwrite it.
            finally:
                if created and temporary.exists():
                    temporary.unlink()
        if (_regular(path, claim["bytes"]).stat().st_size != claim["bytes"]
                or path.resolve(strict=True) != path or _hash_file(path) != claim["sha256"]):
            raise ValueError("Existing classpath build-tool artifact is not the fixed public artifact")
        observed[filename] = {**claim, "url": url, "file": str(path), "reused": reused,
                              "verified_before_goal_execution": True}
    return observed


def _runtime_graph(classpath_path, cache, version):
    text = _regular(classpath_path).read_text(encoding="utf-8").strip()
    if not text or "\n" in text or "\r" in text:
        raise ValueError("Invalid runtime classpath output")
    dependencies = []
    for index, value in enumerate(text.split(":")):
        prefix = "/maven-repository/"
        if not value.startswith(prefix):
            raise ValueError("Runtime artifact is outside the task Maven repository")
        relative = _relative(value[len(prefix):])
        parts = PurePosixPath(relative).parts
        if len(parts) < 4 or not parts[-1].endswith(".jar"):
            raise ValueError("Unexpected runtime repository layout")
        artifact, resolved_version = parts[-3], parts[-2]
        stem = artifact + "-" + resolved_version
        filename = parts[-1][:-4]
        if filename == stem:
            classifier = ""
        elif filename.startswith(stem + "-"):
            classifier = filename[len(stem) + 1:]
        else:
            raise ValueError("Runtime filename does not match its resolved coordinate")
        path = cache / relative
        _regular(path, MAX_JAR)
        if path.resolve(strict=True) != path:
            raise ValueError("Symlinked runtime Maven artifact")
        dependencies.append({
            "coordinate": ":".join((".".join(parts[:-3]), artifact, "jar", classifier, resolved_version)),
            "file": str(path), "sha256": _hash_file(path), "bytes": path.stat().st_size, "order": index,
        })
    graph = {"project": {"groupId": "com.comet.opik", "artifactId": "opik-backend",
                          "packaging": "jar", "version": version}, "dependencies": dependencies}
    return _verify_graph(graph)


def _dependency_origins(graph, packaged):
    # Source migration identity is already byte-checked. Extra files sharing
    # its namespace require exact entries in the hash-bound runtime artifacts.
    _verify_graph(graph)
    source_entries = packaged.get("source_migration_entries")
    if (not isinstance(source_entries, list) or len(source_entries) != 229
            or len(set(source_entries)) != 229
            or any(not name.startswith("liquibase/") or name not in packaged["entries"] for name in source_entries)):
        raise ValueError("Complete application migration identity is missing from the JAR catalogue")
    source_entries = set(source_entries)
    foreign_entries = {
        name: entry for name, entry in packaged["entries"].items()
        if name.startswith("liquibase/") and entry["kind"] == "file" and name not in source_entries
    }
    origins, services, licenses = defaultdict(list), defaultdict(list), defaultdict(list)
    namespace_origins = defaultdict(list)
    tracked = {
        "com/clickhouse/client/api/Client.class",
        "com/clickhouse/client/api/query/QueryResponse.class",
        "com/clickhouse/client/api/internal/ClickHouseLZ4InputStream.class",
        "net/jpountz/lz4/LZ4Factory.class", "reactor/core/publisher/Mono.class",
    }
    for row in graph["dependencies"]:
        try:
            with zipfile.ZipFile(row["file"]) as archive:
                for info in _zip_entries(archive):
                    name = info.filename
                    if info.is_dir() or not (name.endswith(".class") or name.startswith("META-INF/services/")
                                              or ("LICENSE" in name.upper() or "NOTICE" in name.upper())
                                              or name in foreign_entries):
                        continue
                    digest = hashlib.sha256()
                    with archive.open(info) as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(chunk)
                    record = {"coordinate": row["coordinate"], "order": row["order"],
                              "sha256": digest.hexdigest(), "bytes": info.file_size,
                              "artifact_sha256": row["sha256"], "artifact_bytes": row["bytes"]}
                    if name in foreign_entries:
                        namespace_origins[name].append(record)
                    if name.endswith(".class"):
                        origins[name].append(record)
                    elif name.startswith("META-INF/services/"):
                        services[name].append(record)
                    elif "LICENSE" in name.upper() or "NOTICE" in name.upper():
                        licenses[name].append(record)
        except (OSError, zipfile.BadZipFile, RuntimeError):
            raise ValueError("Unable to catalogue actual dependency JAR provenance") from None
        if _hash_file(row["file"]) != row["sha256"] or Path(row["file"]).stat().st_size != row["bytes"]:
            raise ValueError("Actual dependency artifact changed during provenance collection")
    proven_namespace = {}
    for name, entry in foreign_entries.items():
        matching = [origin for origin in namespace_origins[name]
                    if origin["sha256"] == entry["sha256"] and origin["bytes"] == entry["bytes"]]
        if not matching:
            raise ValueError("Unresolved or changed dependency Liquibase namespace entry: " + name)
        proven_namespace[name] = {"packaged": entry, "matching_dependency_origins": matching}
    return {
        "source_migration_entries": sorted(source_entries),
        "liquibase_dependency_entries": proven_namespace,
        "duplicate_classes": {name: records for name, records in origins.items() if len(records) > 1},
        "services": dict(services), "license_notice_entries": dict(licenses),
        "codec_client_classes": {
            name: {"dependency_origins": origins.get(name, []), "packaged": packaged["entries"].get(name)}
            for name in sorted(tracked)
        },
        "class_loading_status": "Byte catalogues only; no claim of loaded-class, native selection or resident provenance.",
    }


def run_package(*, source_dir, fixed_receipt_dir, report_dir, output_dir, manifest_path, context):
    # These local refusals precede even a read-only external command and never
    # acquire or delete an existing output directory.
    output = Path(output_dir)
    if (not output.is_absolute() or output.exists() or output.is_symlink()
            or output.parent.resolve(strict=True) != output.parent
            or not output.parent.is_dir() or ".." in output.parts):
        raise ValueError("Package output must be an absolute new exclusive path")
    source, receipts, reports = _directory(source_dir), _directory(fixed_receipt_dir), _directory(report_dir)
    manifest_path = _regular(manifest_path)
    manifest_bytes = manifest_path.read_bytes()
    manifest = _json(manifest_path)
    if (manifest.get("schema") != "capri.opik.backport-tests.v1"
            or manifest.get("upstream", {}).get("revision") != REVISION
            or manifest.get("upstream", {}).get("version") != VERSION):
        raise ValueError("Pinned package manifest changed")
    expected = _expected(manifest, manifest_bytes)
    validate_fixed54_evidence(receipt_dir=receipts, report_dir=reports, expected=expected, context=context)
    receipt = _json(receipts / "receipt.json")
    cache = _directory(context["maven_repository"])
    if source != Path(context["source_directory"]) or cache != source.parent / "maven-repository":
        raise ValueError("Package must reuse the exact tested task source and Maven repository")
    if reports != source / "apps/opik-backend/target/surefire-reports":
        raise ValueError("Package raw reports are not from the tested source")
    for protected in (source, receipts, reports, cache, ROOT):
        if output == protected or output in protected.parents or protected in output.parents:
            raise ValueError("Package output overlaps a protected input")
    protected = _catalogue(_json(receipts / "protected-source-after.json"))
    validate_source_catalogue(source_dir=source, expected=protected)
    for path, digest in receipt["applied_source_sha256"].items():
        if _hash_file(source / _relative(path)) != digest:
            raise ValueError("An actual tested production/test source changed")
    for claim in manifest["sources"]:
        path = claim["path"]
        adjusted = expected["modified_source_fingerprints"].get(path, {}).get("after", claim)
        REGRESSION.verify_source_fingerprint(path=source / path, claim={"path": path, **adjusted})
    pom = _regular(source / POM_PATH)
    original_pom = pom.read_bytes()
    derived_pom = derive_project_pom(original=original_pom, version=VERSION)
    backend = source / "apps/opik-backend"
    reduced_pom = backend / "dependency-reduced-pom.xml"
    jar_path = backend / ("target/opik-backend-" + VERSION + ".jar")
    if reduced_pom.exists() or reduced_pom.is_symlink() or jar_path.exists() or jar_path.is_symlink():
        raise ValueError("Preexisting package output inside the tested source")
    REGRESSION.verify_patch_locks(patch_dir=PATCH_DIR, suite="all", stage="responses-fixed")
    if _hash_file(PATCH_DIR / "manifest.json") != _sha(manifest_bytes):
        raise ValueError("Package manifest is not the current committed input")
    fixed_image = receipt.get("build_image", {})
    user = str(source.stat().st_uid) + ":" + str(source.stat().st_gid)
    if (fixed_image.get("reference") != REGRESSION.IMAGE
            or fixed_image.get("architecture") != "arm64"
            or fixed_image.get("selected_platform_manifest") != REGRESSION.PLATFORM_DIGESTS["arm64"]
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(fixed_image.get("id", "")))
            or fixed_image.get("source_bind_owner") != context["source_bind_owner"]
            or fixed_image.get("cache_bind_owner") != context["cache_bind_owner"]
            or fixed_image.get("requested_container_user") != user
            or fixed_image.get("maven_config") != "/maven-repository"
            or fixed_image.get("jvm_user_home") != "/maven-repository"):
        raise ValueError("Fresh tested build-image identity/ownership is missing or changed")
    tested_docker_config = _directory(source.parent / "docker-config")
    if (_owner(tested_docker_config) != context["source_bind_owner"]
            or _json(tested_docker_config / "config.json") != {"auths": {}}):
        raise ValueError("Require the existing private credential-free fixed54 Docker config")
    REGRESSION._require_remote_execution()
    if platform.machine() not in ("arm64", "aarch64"):
        raise ValueError("Actual package execution requires GitHub Linux arm64")
    for environment_key, context_key in (("GITHUB_RUN_ID", "github_run_id"),
                                          ("GITHUB_RUN_ATTEMPT", "github_run_attempt"),
                                          ("GITHUB_JOB", "github_job")):
        if os.environ.get(environment_key) != context[context_key]:
            raise ValueError("Package is not in the fixed54 job/run attempt")
    # All receipt/file/catalogue/old-output refusals have now happened locally.
    if (_git(ROOT, "rev-parse", "HEAD").decode().strip() != context["capir_revision"]
            or _git(ROOT, "status", "--porcelain", "--untracked-files=all")):
        raise ValueError("Capir package source must be clean and match its recorded checkout")
    source_index = _source_git(source, context)
    environment = REGRESSION._command_environment()
    environment.update(DOCKER_CONFIG=str(tested_docker_config), DOCKER_HOST="unix:///var/run/docker.sock")
    observed = subprocess.run(
        ["docker", "image", "inspect", "--format",
         '{"id":{{json .Id}},"architecture":{{json .Architecture}},"os":{{json .Os}},"repo_digests":{{json .RepoDigests}}}',
         REGRESSION.IMAGE], capture_output=True, check=False, timeout=30, env=environment)
    if observed.returncode:
        raise _CommandFailure("build-image readback", observed.returncode)
    try:
        actual_image = json.loads(observed.stdout)
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("Malformed actual build-image identity") from None
    if (actual_image.get("id") != fixed_image["id"] or actual_image.get("architecture") != "arm64"
            or actual_image.get("os") != "linux"):
        raise ValueError("Actual package image differs from the fixed54 image")
    files = _proof_files(receipts, reports)
    evidence_hashes = {name: _hash_file(path) for name, path in files.items()}
    migration_sources = {
        path[len(RESOURCE_PREFIX):]: _regular(source / path).read_bytes()
        for path in protected if path.startswith(RESOURCE_PREFIX + "liquibase/")
    }
    if len(migration_sources) != 229:
        raise ValueError("Complete source migration resources are missing")
    output.mkdir(mode=0o700)
    package_receipt = {
        "schema": "capri.opik.package.v1", "passed": False, "phase": "preserve_fixed54",
        "classification": "package_or_provenance_failure", "maven_exit_code": None,
        "upstream_revision": REVISION, "version": VERSION, "capir_revision": context["capir_revision"],
        "github_run_id": context["github_run_id"], "github_run_attempt": context["github_run_attempt"],
        "github_job": context["github_job"], "fixed_receipt_sha256": context["fixed_receipt_sha256"],
        "manifest_sha256": _sha(manifest_bytes), "patch_sha256": expected["patch_sha256"],
        "source_directory": str(source), "maven_repository": str(cache),
        "source_bind_owner": _owner(source), "cache_bind_owner": _owner(cache),
        "build_image": {"reference": REGRESSION.IMAGE, **actual_image,
                        "selected_platform_manifest": REGRESSION.PLATFORM_DIGESTS["arm64"]},
        "commands": [], "image_or_import_or_activation": False,
    }
    result_path = output / "package-receipt.json"

    def update():
        # Exclusively owned receipt is the one intentional mutable phase record.
        temporary = output / "package-receipt.next.json"
        _write(temporary, package_receipt)
        temporary.replace(result_path)

    docker_config = output / "docker-config"
    token = uuid.uuid4().hex
    derived_active = False
    writers_settled = True
    try:
        if _owner(output) != context["source_bind_owner"]:
            raise ValueError("Private package evidence bind owner differs from source")
        _write(output / "package-context.json", context)
        _write(output / "protected-fixed54.json", protected)
        for name, path in files.items():
            target = output / "prerequisite" / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(path, target)
            if _hash_file(target) != evidence_hashes[name]:
                raise ValueError("Fixed54 evidence archive copy mismatch")
        _write(output / "prerequisite-hashes.json", evidence_hashes)
        (output / "original-pom.xml").write_bytes(original_pom)
        (output / "derived-pom.xml").write_bytes(derived_pom)
        docker_config.mkdir(mode=0o700)
        _write(docker_config / "config.json", {"auths": {}})
        environment.update(DOCKER_CONFIG=str(docker_config), DOCKER_HOST="unix:///var/run/docker.sock")
        common = [
            "docker", "run", "--rm", "--init", "--pull=never", "--platform=linux/arm64",
            "--user", user, "--network=bridge", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--cpus=2", "--memory=3g", "--pids-limit=512",
            "--label", "capir.task=GET-337", "--label", "capir.package=" + token,
            "--mount", "type=bind,src=" + str(source) + ",dst=/workspace",
            "--mount", "type=bind,src=" + str(cache) + ",dst=/maven-repository",
            "--mount", "type=bind,src=" + str(output) + ",dst=/package-evidence",
            "--workdir", "/workspace/apps/opik-backend",
            "--env", "MAVEN_CONFIG=/maven-repository",
            "--env", "JAVA_TOOL_OPTIONS=-Duser.home=/maven-repository",
            "--env", "MAVEN_OPTS=-Xmx1G -XX:MaxMetaspaceSize=265m",
        ]

        def container(arguments, log_name, timeout=1800):
            nonlocal writers_settled
            cid = output / (log_name + ".cid")
            package_receipt["commands"].append({"arguments": arguments, "log": log_name})
            update()
            code = None
            timed_out = False
            try:
                with (output / log_name).open("xb") as log:
                    writers_settled = False
                    package_receipt.update(writers_settled=False, source_state="writer_possible")
                    update()
                    try:
                        result = subprocess.run(common + ["--cidfile", str(cid), REGRESSION.IMAGE] + arguments,
                                                stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
                                                check=False, env=environment)
                        code = result.returncode
                    except subprocess.TimeoutExpired:
                        code = 124
                        timed_out = True
                record_command_outcome(receipt=package_receipt, entry=package_receipt["commands"][-1],
                                       code=code, timed_out=timed_out, log_path=output / log_name,
                                       persist=update)
                if code:
                    raise _CommandFailure(log_name, code, timed_out)
            finally:
                try:
                    settlement = settle_owned_container(cid_file=cid, token=token, environment=environment,
                                                         command_exit_code=code, timed_out=timed_out)
                except Exception as error:
                    settlement = {"settled": False, "reason": "settlement_exception",
                                  "error_type": type(error).__name__}
                package_receipt["commands"][-1]["settlement"] = settlement
                writers_settled = isinstance(settlement, dict) and settlement.get("settled") is True
                package_receipt.update(writers_settled=writers_settled,
                                       source_state="settled" if writers_settled else "blocked_unknown")
                if not writers_settled:
                    package_receipt.update(passed=False, phase="blocked_unsettled_container",
                                           classification="container_settlement_unknown",
                                           failed_command=log_name, failed_command_outcome=code,
                                           command_timeout=timed_out)
                update()
                if not writers_settled:
                    reason = settlement.get("reason", "missing_settlement") if isinstance(settlement, dict) else "missing_settlement"
                    raise _UnsettledWriter(log_name, code, timed_out, reason)

        container(["java", "-version"], "java-version.log", 60)
        container(["mvn", "--version"], "maven-version.log", 60)
        if (not re.search(r'version "25(?:\.|")', (output / "java-version.log").read_text())
                or "Apache Maven 3.9.16" not in (output / "maven-version.log").read_text()):
            raise ValueError("Actual package toolchain version changed")
        maven = ["mvn", "-B", "-ntp", "-Dspotless.skip=true", "-Dmaven.repo.local=/maven-repository"]
        classpath_args = ["-DincludeScope=runtime", "-Dmdep.pathSeparator=:", "-Dmdep.regenerateFile=true"]
        package_receipt["phase"] = "runtime_before_derivation"
        package_receipt["classpath_build_tool"] = _ensure_classpath_tool(cache)
        update()
        container(maven + classpath_args + ["-Dmdep.outputFile=/package-evidence/runtime-before.classpath",
                                            DEPENDENCY_GOAL], "runtime-before.log")
        before_graph = _runtime_graph(output / "runtime-before.classpath", cache, "1.0-SNAPSHOT")
        _write(output / "runtime-before.json", before_graph)
        validate_source_catalogue(source_dir=source, expected=protected)
        _source_git(source, context)
        package_receipt["phase"] = "derive_project_version_and_clean_package"
        package_receipt["pom_derivation"] = {"original_sha256": _sha(original_pom),
                                             "derived_sha256": _sha(derived_pom), "only_root_version": VERSION}
        package_receipt["target_policy"] = "Fresh standard Maven clean package only after verified fixed54 archive"
        update()
        if pom.read_bytes() != original_pom:
            raise ValueError("POM changed before the explicit derivation")
        pom.write_bytes(derived_pom)
        derived_active = True
        derived_catalogue = {**protected, POM_PATH: _sha(derived_pom)}
        validate_source_catalogue(source_dir=source, expected=derived_catalogue)
        container(maven + ["-DskipTests=true", "clean", "package"], "maven-package.log")
        package_receipt["maven_exit_code"] = 0
        if reduced_pom.exists() or reduced_pom.is_symlink():
            _regular(reduced_pom, 2 * 1024 * 1024)
            data = reduced_pom.read_bytes()
            (output / "dependency-reduced-pom.xml").write_bytes(data)
            if _hash_file(output / "dependency-reduced-pom.xml") != _sha(data) or reduced_pom.read_bytes() != data:
                raise ValueError("Generated shade POM preservation failed")
            package_receipt["generated_shade_pom"] = {"sha256": _sha(data), "bytes": len(data),
                                                     "source_path": "apps/opik-backend/dependency-reduced-pom.xml"}
            reduced_pom.unlink()
        validate_source_catalogue(source_dir=source, expected=derived_catalogue)
        container(maven + classpath_args + ["-Dmdep.outputFile=/package-evidence/runtime-after.classpath",
                                            DEPENDENCY_GOAL], "runtime-after.log")
        after_graph = _runtime_graph(output / "runtime-after.classpath", cache, VERSION)
        _ensure_classpath_tool(cache)
        compare_runtime_graph(before=before_graph, after=after_graph, version=VERSION)
        _write(output / "runtime-after.json", after_graph)
        package_receipt["phase"] = "jar_and_resource_admission"
        update()
        catalogue = catalogue_release_jar(jar_path=jar_path, migration_sources=migration_sources,
                                           required_entries=REQUIRED_CLASSES, dependency_graph=after_graph)
        dependency_provenance = catalogue.pop("_dependency_provenance")
        with zipfile.ZipFile(jar_path) as archive:
            properties = archive.read("META-INF/maven/com.comet.opik/opik-backend/pom.properties").decode("utf-8")
            if re.findall(r"(?m)^version=([^\r\n]*)", properties) != [VERSION]:
                raise ValueError("Assembled Maven project version is not the derived version")
        _write(output / "jar-catalogue.json", catalogue)
        _write(output / "dependency-class-origins.json", dependency_provenance)
        target_jar = output / jar_path.name
        shutil.copyfile(jar_path, target_jar)
        if _hash_file(target_jar) != catalogue["sha256"]:
            raise ValueError("Preserved complete main JAR hash changed")
        shutil.copyfile(source / "LICENSE", output / "LICENSE.upstream")
        _write(output / "target-jars.json", {
            path.name: {"sha256": _hash_file(path), "bytes": path.stat().st_size}
            for path in sorted((backend / "target").glob("*.jar"))
        })
        validate_source_catalogue(source_dir=source, expected=derived_catalogue)
        if _git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD") != source_index:
            raise ValueError("Index changed during packaging")
        for path, digest in receipt["applied_source_sha256"].items():
            if _hash_file(source / path) != digest:
                raise ValueError("A tested production/test source changed during packaging")
        for name, digest in evidence_hashes.items():
            if _hash_file(output / "prerequisite" / name) != digest:
                raise ValueError("Archived fixed54 evidence changed during package")
            if name.startswith("receipt/") and _hash_file(files[name]) != digest:
                raise ValueError("Original fixed54 receipt material was overwritten")
        if not writers_settled:
            raise RuntimeError("Cannot restore POM while an owned writer may remain")
        if pom.read_bytes() != derived_pom:
            raise ValueError("POM changed beyond the root version derivation")
        pom.write_bytes(original_pom)
        derived_active = False
        validate_source_catalogue(source_dir=source, expected=protected)
        _source_git(source, context)
        package_receipt.update(passed=True, phase="complete", classification="jar_package_verified",
                               jar={"filename": target_jar.name, "runtime_path": "/opt/opik/" + target_jar.name,
                                    "sha256": catalogue["sha256"], "bytes": catalogue["bytes"]},
                               source_pom_restored=True, runtime_graph_unchanged=True,
                               source_catalogue_sha256=_sha(json.dumps(protected, sort_keys=True).encode()),
                               loaded_class_or_resident_acceptance=False)
        update()
        return 0
    except Exception as error:
        package_receipt.update(passed=False, error_type=type(error).__name__,
                               error=str(error)[:400])
        if isinstance(error, _CommandFailure):
            package_receipt["failed_command"] = error.kind
            package_receipt["failed_command_outcome"] = error.code
            package_receipt["command_timeout"] = error.timed_out
            if error.kind == "maven-package.log":
                package_receipt["maven_exit_code"] = None if error.timed_out else error.code
        elif isinstance(error, _UnsettledWriter):
            package_receipt.update(classification="container_settlement_unknown", source_state="blocked_unknown",
                                   failed_command=error.kind, failed_command_outcome=error.code,
                                   command_timeout=error.timed_out)
            if error.kind == "maven-package.log":
                package_receipt["maven_exit_code"] = None if error.timed_out else error.code
        update()
        return error.code if isinstance(error, (_CommandFailure, _UnsettledWriter)) and error.code else 1
    finally:
        # Restore only this helper's known, byte-exact POM derivation. Never
        # overwrite a third-party/source drift with the original snapshot.
        if not writers_settled:
            package_receipt.update(passed=False, writers_settled=False, source_state="blocked_unknown",
                                   phase="blocked_unsettled_container", source_pom_restore="blocked_writer_unknown")
            update()
        elif derived_active and pom.is_file() and not pom.is_symlink() and pom.read_bytes() == derived_pom:
            pom.write_bytes(original_pom)
            package_receipt["source_pom_restored"] = True
            update()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--fixed-receipt-dir", required=True, type=Path)
    parser.add_argument("--report-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=PATCH_DIR / "manifest.json")
    parser.add_argument("--context", required=True, type=Path,
                        help="Fresh runner-emitted package-context.json; no legacy receipt fallback")
    args = parser.parse_args()
    try:
        return run_package(source_dir=args.source_dir, fixed_receipt_dir=args.fixed_receipt_dir,
                           report_dir=args.report_dir, output_dir=args.output_dir,
                           manifest_path=args.manifest, context=_json(args.context))
    except Exception as error:
        print(json.dumps({"passed": False, "classification": "package_preflight_refused",
                          "error_type": type(error).__name__, "error": str(error)[:400]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
