#!/usr/bin/env python3
"""GET-337 command outcomes survive real log-evidence failures; stdlib only.

Contract: record_command_outcome(receipt, entry, code, timed_out, log_path,
persist) records the original process outcome and persists it before a fallible
log hash. Missing logs must still raise ValueError/OSError. A timeout outcome124
is not a known Maven/CLI exit124. persist is the actual caller's zero-argument
receipt writer; this fixture writes real0600 JSON snapshots in a private folder.

No subprocess, Docker, network or package orchestration is mocked or executed.
These are filesystem/state contracts, not full run_package or remote evidence.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("package-opik-backport.py")


class OpikPackageOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-package-outcome-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.loaded = None
        self.snapshots = []
        self.entry = {"arguments": ["mvn", "-DskipTests=true", "clean", "package"],
                      "log": "maven-package.log"}
        self.receipt = {"passed": False, "phase": "derive_project_version_and_clean_package",
                        "maven_exit_code": None, "commands": [self.entry]}

    def api(self):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Package helper is missing")
            name = "get337_package_outcome_subject_" + self.root.name.replace("-", "_")
            spec = importlib.util.spec_from_file_location(name, SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            self.addCleanup(sys.modules.pop, name, None)
            try:
                spec.loader.exec_module(module)
            except Exception as error:
                self.fail("Package helper import failed: " + type(error).__name__)
            self.loaded = module
        function = getattr(self.loaded, "record_command_outcome", None)
        self.assertTrue(callable(function),
                        "Missing record_command_outcome seam; parent must observe an explicit contract RED")
        return function

    def persist(self):
        snapshot = self.root / ("receipt-snapshot-" + str(len(self.snapshots)) + ".json")
        descriptor = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(self.receipt, output, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o600)
        self.snapshots.append(snapshot)

    def invoke(self, *, code, timed_out, log_path):
        return self.api()(receipt=self.receipt, entry=self.entry, code=code,
                          timed_out=timed_out, log_path=log_path, persist=self.persist)

    def assert_original_outcome(self, *, code, timed_out):
        expected_exit = None if timed_out else code
        self.assertIn("exit_code", self.entry, "Known/unknown CLI exit must be explicit before log hashing")
        self.assertEqual(self.entry["exit_code"], expected_exit)
        self.assertEqual(self.entry.get("outcome_code"), code)
        self.assertIs(self.entry.get("timed_out"), timed_out)
        self.assertEqual(self.receipt["maven_exit_code"], expected_exit)
        self.assertIs(self.receipt["passed"], False, "Recording evidence cannot promote package success")
        self.assertTrue(self.snapshots, "Original process outcome must survive in a real persisted receipt")
        for path in self.snapshots:
            with self.subTest(snapshot=path.name):
                snapshot = json.loads(path.read_bytes())
                command = snapshot["commands"][0]
                self.assertIn("exit_code", command)
                self.assertEqual(command["exit_code"], expected_exit)
                self.assertEqual(command.get("outcome_code"), code)
                self.assertIs(command.get("timed_out"), timed_out)
                self.assertEqual(snapshot["maven_exit_code"], expected_exit)
                self.assertIs(snapshot["passed"], False)

    def test_missing_log_preserves_known_maven17_before_propagating_hash_error(self):
        function = self.api()
        missing = self.root / "missing-maven-package.log"
        self.assertFalse(missing.exists())
        with self.assertRaises((ValueError, OSError)):
            function(receipt=self.receipt, entry=self.entry, code=17, timed_out=False,
                     log_path=missing, persist=self.persist)
        self.assert_original_outcome(code=17, timed_out=False)
        self.assertNotIn("sha256", self.entry, "Missing evidence cannot receive a fabricated digest")

    def test_missing_log_preserves_timeout124_without_fabricating_maven_exit(self):
        function = self.api()
        missing = self.root / "missing-timeout.log"
        self.assertFalse(missing.exists())
        with self.assertRaises((ValueError, OSError)):
            function(receipt=self.receipt, entry=self.entry, code=124, timed_out=True,
                     log_path=missing, persist=self.persist)
        self.assert_original_outcome(code=124, timed_out=True)
        self.assertIsNone(self.entry["exit_code"])
        self.assertIsNone(self.receipt["maven_exit_code"])
        self.assertNotIn("sha256", self.entry)

    def test_real_small_log_hash_and_known_zero_are_persisted(self):
        data = b"Synthetic public Maven package log; process exit0.\n"
        log_path = self.root / "maven-package.log"
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        self.invoke(code=0, timed_out=False, log_path=log_path)
        self.assert_original_outcome(code=0, timed_out=False)
        expected = hashlib.sha256(data).hexdigest()
        self.assertEqual(self.entry.get("sha256"), expected)
        latest = json.loads(self.snapshots[-1].read_bytes())
        self.assertEqual(latest["commands"][0].get("sha256"), expected,
                         "The successful digest must also reach the real persisted receipt")


if __name__ == "__main__":
    unittest.main()
