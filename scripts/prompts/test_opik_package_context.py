#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Producer-side package context contracts, using stdlib and real temporary Git.

Prospective runner API:
    capture_package_context(capir_dir, source_dir, maven_repository,
                            applied_paths, not_before_ns) -> dict

The helper captures current metadata; it does not certify an upstream revision,
the fixed54 profile, an eleven-path patch scope, or successful regression tests.
Those gates and final receipt/context publication belong to run_backport and the
package validator. These small repositories make none of those production claims.

Only CI environment and platform.system are synthetic, to enter the remote guard.
Git commands, file bytes, realpaths, modes, uid/gid and index hashes are real.
The external-cache refusal is a combined path/mode/ownership boundary, not an
independent uid-only experiment. No chown, mocked stat or privileged fixture.
Import/API absence is an assertion failure, not an error or a skipped test.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("test-opik-backport.py")
MAIN = "apps/opik-backend/src/main/java/SyntheticContext.java"
ADDED = "apps/opik-backend/src/test/java/SyntheticContextFixture.java"


def sha(data):
    return hashlib.sha256(data).hexdigest()


class OpikPackageContextProducerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-context-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.loaded = None

    def api(self):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Producer runner is missing")
            spec = importlib.util.spec_from_file_location("get337_context_runner", SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            self.addCleanup(sys.modules.pop, spec.name, None)
            try:
                spec.loader.exec_module(module)
            except Exception as error:
                self.fail("Producer runner failed safe import: " + type(error).__name__)
            self.loaded = module
        function = getattr(self.loaded, "capture_package_context", None)
        self.assertTrue(callable(function),
                        "Missing producer API capture_package_context; parent must observe RED")
        return function

    def command_environment(self):
        # No inherited credentials, Git configuration, agent, proxy or repository overrides.
        return {
            "PATH": os.environ.get("PATH", os.defpath),
            "LANG": "C", "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1",
        }

    def git(self, directory, *arguments):
        completed = subprocess.run(
            ["git", "-C", str(directory), "-c", "remote.origin.promisor=false",
             "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false",
             "-c", "core.filemode=true", "-c", "commit.gpgsign=false",
             "-c", "user.name=GET337 context fixture",
             "-c", "user.email=get337-context@example.invalid", *arguments],
            capture_output=True, check=False, timeout=10, env=self.command_environment(),
        )
        self.assertEqual(completed.returncode, 0, "Synthetic Git command failed")
        return completed.stdout

    def repository(self, directory, files):
        directory.mkdir(mode=0o700)
        self.git(directory, "init", "--quiet")
        for relative, content in files.items():
            path = directory / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.git(directory, "add", ".")
        self.git(directory, "commit", "--quiet", "-m", "Synthetic context baseline")

    def fixture(self, name):
        home = self.root / name
        home.mkdir(mode=0o700)
        capir, source, cache = home / "capir", home / "upstream", home / "maven-repository"
        self.repository(capir, {"README.fixture": b"Synthetic clean Capir checkout.\n"})
        self.repository(source, {MAIN: b"class SyntheticContext { int value = 1; }\n"})
        cache.mkdir(mode=0o700)
        (source / MAIN).write_bytes(b"class SyntheticContext { int value = 2; }\n")
        added = source / ADDED
        added.parent.mkdir(parents=True, exist_ok=True)
        added.write_bytes(b"// Synthetic file, not a compiled or fixed54 test.\n")
        self.git(source, "add", MAIN, ADDED)
        return {
            "capir_dir": capir, "source_dir": source, "maven_repository": cache,
            "applied_paths": [MAIN, ADDED], "not_before_ns": time.time_ns(),
        }

    def ci_environment(self, fixture):
        return {
            **self.command_environment(),
            "GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_OS": "Linux",
            "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_RUN_ID": "337421",
            "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "synthetic_context_unit",
            "GITHUB_SHA": self.git(fixture["capir_dir"], "rev-parse", "HEAD").decode().strip(),
            "GITHUB_WORKSPACE": str(fixture["capir_dir"]),
        }

    def capture(self, function, fixture, environment):
        # This is metadata-unit coverage, never evidence of a real Actions runner.
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.object(self.loaded.platform, "system", return_value="Linux"):
            return function(**fixture)

    def owner(self, path):
        metadata = path.stat()
        return {"uid": metadata.st_uid, "gid": metadata.st_gid,
                "mode": format(stat.S_IMODE(metadata.st_mode), "04o")}

    def test_captures_actual_clean_head_private_binds_index_and_applied_bytes(self):
        function = self.api()
        fixture = self.fixture("positive")
        environment = self.ci_environment(fixture)
        source = fixture["source_dir"]
        before_index = self.git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD")
        self.assertTrue(before_index, "Fixture must contain actual staged changes")
        self.assertEqual(self.git(fixture["capir_dir"], "status", "--porcelain",
                                 "--untracked-files=all"), b"")
        context = self.capture(function, fixture, environment)
        expected = {
            "github_run_id": environment["GITHUB_RUN_ID"],
            "github_run_attempt": environment["GITHUB_RUN_ATTEMPT"],
            "github_job": environment["GITHUB_JOB"],
            "capir_revision": environment["GITHUB_SHA"],
            "source_directory": str(source.resolve(strict=True)),
            "source_bind_owner": self.owner(source),
            "maven_repository": str(fixture["maven_repository"].resolve(strict=True)),
            "cache_bind_owner": self.owner(fixture["maven_repository"]),
            "source_index_sha256": sha(before_index),
            "applied_source_sha256": {path: sha((source / path).read_bytes())
                                      for path in fixture["applied_paths"]},
            "not_before_ns": fixture["not_before_ns"],
        }
        self.assertIsInstance(context, dict)
        for key, value in expected.items():
            with self.subTest(field=key):
                self.assertEqual(context.get(key), value)
        self.assertEqual(context["source_bind_owner"], context["cache_bind_owner"])
        self.assertEqual(context["source_bind_owner"]["mode"], "0700")
        self.assertEqual(type(context["not_before_ns"]), int)
        self.assertEqual(self.git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD"),
                         before_index, "Metadata capture must not change the real index")
        # A second valid state must be freshly sampled, not a constant/supplied hash claim.
        (source / ADDED).write_bytes(b"// Different actual staged synthetic bytes.\n")
        self.git(source, "add", ADDED)
        fresh = self.capture(function, fixture, environment)
        fresh_index = self.git(source, "diff", "--cached", "--raw", "--no-renames", "-z", "HEAD")
        self.assertNotEqual(sha(fresh_index), sha(before_index))
        self.assertEqual(fresh["source_index_sha256"], sha(fresh_index))
        self.assertEqual(fresh["applied_source_sha256"][ADDED], sha((source / ADDED).read_bytes()))
        self.assertNotEqual(fresh["applied_source_sha256"][ADDED],
                            context["applied_source_sha256"][ADDED])

    def test_refuses_missing_job_wrong_github_sha_and_dirty_capir(self):
        function = self.api()
        for scenario in ("missing-job", "invalid-job", "wrong-sha", "unstaged", "staged", "untracked"):
            with self.subTest(scenario=scenario):
                fixture = self.fixture("ci-" + scenario)
                environment = self.ci_environment(fixture)
                if scenario == "missing-job":
                    del environment["GITHUB_JOB"]
                elif scenario == "invalid-job":
                    environment["GITHUB_JOB"] = "not a valid job id"
                elif scenario == "wrong-sha":
                    actual = environment["GITHUB_SHA"]
                    environment["GITHUB_SHA"] = ("0" if actual[0] != "0" else "1") + actual[1:]
                elif scenario in ("unstaged", "staged"):
                    (fixture["capir_dir"] / "README.fixture").write_bytes(b"Changed fixture.\n")
                    if scenario == "staged":
                        self.git(fixture["capir_dir"], "add", "README.fixture")
                else:
                    (fixture["capir_dir"] / "untracked.fixture").write_bytes(b"Untracked.\n")
                with self.assertRaises((ValueError, RuntimeError, OSError)):
                    self.capture(function, fixture, environment)

    def test_refuses_nonprivate_or_aliased_binds_and_unsafe_or_missing_applied_files(self):
        function = self.api()
        scenarios = ("source-mode", "cache-mode", "external-cache", "relative-source",
                     "source-symlink", "cache-symlink", "ancestor-symlink",
                     "missing-file", "file-symlink", "ancestor-file-symlink",
                     "absolute-file", "parent-file")
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                fixture = self.fixture("fs-" + scenario)
                environment = self.ci_environment(fixture)
                source, cache = fixture["source_dir"], fixture["maven_repository"]
                if scenario in ("source-mode", "cache-mode"):
                    (source if scenario == "source-mode" else cache).chmod(0o755)
                elif scenario == "external-cache":
                    # Real external stat; path/mode/owner are not independently isolated here.
                    external = Path(source.anchor).resolve(strict=True)
                    self.assertNotEqual(stat.S_IMODE(external.stat().st_mode), 0o700)
                    fixture["maven_repository"] = external
                elif scenario == "relative-source":
                    fixture["source_dir"] = source.relative_to(self.root)
                elif scenario in ("source-symlink", "cache-symlink"):
                    key = "source_dir" if scenario == "source-symlink" else "maven_repository"
                    alias = source.parent / ("alias-" + key)
                    alias.symlink_to(fixture[key], target_is_directory=True)
                    fixture[key] = alias
                elif scenario == "ancestor-symlink":
                    alias = self.root / "alias-work"
                    alias.symlink_to(source.parent, target_is_directory=True)
                    fixture["source_dir"] = alias / source.name
                    fixture["maven_repository"] = alias / cache.name
                elif scenario == "missing-file":
                    (source / ADDED).unlink()
                elif scenario == "file-symlink":
                    target = source.parent / "external.fixture"
                    target.write_bytes((source / ADDED).read_bytes())
                    (source / ADDED).unlink()
                    (source / ADDED).symlink_to(target)
                elif scenario == "ancestor-file-symlink":
                    real = source / "real-apps"
                    (source / "apps").rename(real)
                    (source / "apps").symlink_to(real, target_is_directory=True)
                elif scenario == "absolute-file":
                    fixture["applied_paths"] = [str(source / MAIN), ADDED]
                else:
                    target = source.parent / "outside.fixture"
                    target.write_bytes(b"Not a source-relative input.\n")
                    fixture["applied_paths"] = [MAIN, "../outside.fixture"]
                with self.assertRaises((ValueError, RuntimeError, OSError)):
                    self.capture(function, fixture, environment)


if __name__ == "__main__":
    unittest.main()
