#!/usr/bin/env python3
"""GET-337 owned-container settlement contracts; stdlib, no Docker execution.

The production seam is settle_owned_container(cid_file, token, environment,
command_exit_code, timed_out). A positive result must be a dict with settled=True.
An uncertain result may be a dict with settled=False or an explicit RuntimeError.
None is not a settlement proof. Other receipt fields are intentionally unspecified.

Each fixture has a real private directory and (where applicable) a real CID file.
Only subprocess Docker I/O is replaced, by a finite label-only inspect / exact
owned remove / doubly filtered full-ID inventory projection. These mocks prove
state-machine decisions, not OS/container settlement or run_package POM bridging.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("package-opik-backport.py")
CID = "a" * 64
TOKEN = "b" * 32
OWNED_LABELS = {"capir.task": "GET-337", "capir.package": TOKEN}


class DockerProjection:
    """Only synthetic safe projections; never delegate an unknown command."""

    def __init__(self, case, environment, *, inspect_code=0, labels=None,
                 remove_code=0, inventory_code=0, inventory=()):
        self.case = case
        self.environment = environment
        self.inspect_code = inspect_code
        self.labels = json.dumps(OWNED_LABELS).encode() if labels is None else labels
        self.remove_code = remove_code
        self.inventory_code = inventory_code
        self.inventory = tuple(inventory)
        self.events = []
        self.removed = []

    def __call__(self, arguments, **kwargs):
        self.case.assertIsInstance(arguments, (list, tuple))
        arguments = list(arguments)
        self.case.assertEqual(arguments[0], "docker", "No real/extraneous external command is allowed")
        self.case.assertEqual(kwargs.get("env"), self.environment)
        self.case.assertIs(kwargs.get("check"), False)
        self.case.assertTrue(kwargs.get("capture_output"), "Do not stream raw Docker output")
        self.case.assertIsInstance(kwargs.get("timeout"), (int, float))
        self.case.assertGreater(kwargs["timeout"], 0)
        self.case.assertNotIn("shell", kwargs)
        self.case.assertLess(len(self.events), 12, "Settlement must not loop indefinitely")
        operation = arguments[1] if len(arguments) > 1 else ""
        if operation == "inspect":
            self.case.assertEqual(arguments, ["docker", "inspect", "--format", "{{json .Config.Labels}}", CID],
                                  "Inspect only the exact CID's label projection")
            self.events.append("inspect")
            code, output = self.inspect_code, self.labels
        elif operation == "rm":
            self.case.assertEqual(arguments, ["docker", "rm", "--force", CID],
                                  "Never remove a foreign/unobserved container")
            self.events.append("remove")
            self.removed.append(arguments[-1])
            code, output = self.remove_code, b""
        elif operation == "ps":
            self._inventory_command(arguments)
            self.events.append("inventory")
            code = self.inventory_code
            output = ("\n".join(self.inventory) + ("\n" if self.inventory else "")).encode()
        else:
            self.case.fail("Only bounded label inspect, exact remove and owned-label ID inventory are allowed")
        return subprocess.CompletedProcess(arguments, code, stdout=output,
                                           stderr=b"synthetic Docker failure" if code else b"")

    def _inventory_command(self, arguments):
        options = arguments[2:]
        filters, flags, output_format = [], [], None
        while options:
            option = options.pop(0)
            if option in ("--filter", "-f"):
                self.case.assertTrue(options, "Filter requires a value")
                filters.append(options.pop(0))
            elif option.startswith("--filter="):
                filters.append(option.split("=", 1)[1])
            elif option == "--format":
                self.case.assertTrue(options, "Format requires a value")
                self.case.assertIsNone(output_format)
                output_format = options.pop(0)
            elif option.startswith("--format="):
                self.case.assertIsNone(output_format)
                output_format = option.split("=", 1)[1]
            else:
                flags.append(option)
        self.case.assertCountEqual(filters, ["label=capir.task=GET-337", "label=capir.package=" + TOKEN],
                                   "Inventory must be scoped to both exact ownership labels")
        self.case.assertEqual(len(flags), len(set(flags)), "Duplicate inventory flags")
        self.case.assertTrue(set(flags).issubset({"--all", "-a", "--quiet", "-q", "--no-trunc"}))
        self.case.assertTrue("--all" in flags or "-a" in flags, "Include exited owned containers")
        self.case.assertIn("--no-trunc", flags, "Inventory identities must be complete")
        if output_format is None:
            self.case.assertTrue("--quiet" in flags or "-q" in flags, "Inventory must contain IDs only")
        else:
            self.case.assertEqual(output_format, "{{.ID}}", "Do not expose arbitrary container fields")


class OpikPackageCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-package-cleanup-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.cid_file = self.root / "owned-command.cid"
        self.environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8",
                            "DOCKER_HOST": "unix:///synthetic-never-opened.sock"}
        self.loaded = None

    def api(self):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Package helper is missing")
            name = "get337_package_cleanup_subject_" + self.root.name.replace("-", "_")
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
        function = getattr(self.loaded, "settle_owned_container", None)
        self.assertTrue(callable(function),
                        "Missing settle_owned_container seam; parent must observe an explicit contract RED")
        return function

    def write_cid(self):
        descriptor = os.open(self.cid_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="ascii") as stream:
            stream.write(CID + "\n")
        self.assertEqual(stat.S_IMODE(self.cid_file.stat().st_mode), 0o600)

    def invoke(self, projection, *, command_exit_code=None, timed_out=True):
        function = self.api()
        with mock.patch.object(self.loaded.subprocess, "run", side_effect=projection):
            return function(cid_file=self.cid_file, token=TOKEN, environment=self.environment,
                            command_exit_code=command_exit_code, timed_out=timed_out)

    def assert_unknown(self, projection, *, command_exit_code=None, timed_out=True):
        try:
            result = self.invoke(projection, command_exit_code=command_exit_code, timed_out=timed_out)
        except RuntimeError:
            return
        except Exception as error:
            self.fail("Unknown settlement must be explicit, not an unchecked " + type(error).__name__)
        self.assertIsInstance(result, dict, "Missing/None cleanup result cannot prove settlement")
        self.assertIs(result.get("settled"), False, "Uncertainty must not be promoted to settled=True")

    def test_inspect_failure_retains_unknown_and_never_removes(self):
        self.write_cid()
        projection = DockerProjection(self, self.environment, inspect_code=1, inventory=())
        self.assert_unknown(projection)
        self.assertIn("inspect", projection.events)
        self.assertEqual(projection.removed, [])

    def test_malformed_or_foreign_labels_are_not_cleanup_authority(self):
        self.write_cid()
        labels = (b"not-json", b"[]", b"null", b"{}",
                  json.dumps({"capir.task": "other-task", "capir.package": TOKEN}).encode(),
                  json.dumps({"capir.task": "GET-337", "capir.package": "c" * 32}).encode())
        for value in labels:
            with self.subTest(labels_shape=value):
                projection = DockerProjection(self, self.environment, labels=value)
                self.assert_unknown(projection)
                self.assertIn("inspect", projection.events)
                self.assertEqual(projection.removed, [], "Foreign or unvalidated labels must never authorize rm")

    def test_owned_remove_failure_is_not_settlement(self):
        self.write_cid()
        projection = DockerProjection(self, self.environment, remove_code=1, inventory=(CID,))
        self.assert_unknown(projection)
        self.assertIn("inspect", projection.events)
        self.assertTrue(projection.removed)
        self.assertEqual(set(projection.removed), {CID})

    def test_remove_exit_zero_still_requires_successful_empty_owned_inventory(self):
        self.write_cid()
        for code, inventory in ((1, ()), (0, (CID,))):
            with self.subTest(inventory_exit=code, nonempty=bool(inventory)):
                projection = DockerProjection(self, self.environment, inventory_code=code, inventory=inventory)
                self.assert_unknown(projection)
                self.assertTrue(projection.removed)
                self.assertEqual(set(projection.removed), {CID})
                self.assertIn("inventory", projection.events)

    def test_exact_owned_remove_plus_confirmed_empty_inventory_is_settled(self):
        self.write_cid()
        projection = DockerProjection(self, self.environment)
        result = self.invoke(projection)
        self.assertIsInstance(result, dict)
        self.assertIs(result.get("settled"), True)
        self.assertEqual(projection.removed, [CID])
        self.assertIn("inventory", projection.events)
        self.assertLess(projection.events.index("inspect"), projection.events.index("remove"))
        self.assertIn("inventory", projection.events[projection.events.index("remove") + 1:])

    def test_successful_cli_missing_cid_is_settled_only_by_empty_owned_inventory(self):
        self.assertFalse(self.cid_file.exists())
        for code, inventory in ((0, ()), (1, ()), (0, (CID,))):
            with self.subTest(inventory_exit=code, nonempty=bool(inventory)):
                projection = DockerProjection(self, self.environment, inventory_code=code, inventory=inventory)
                if code == 0 and not inventory:
                    result = self.invoke(projection, command_exit_code=0, timed_out=False)
                    self.assertIsInstance(result, dict)
                    self.assertIs(result.get("settled"), True)
                else:
                    self.assert_unknown(projection, command_exit_code=0, timed_out=False)
                self.assertIn("inventory", projection.events)
                self.assertNotIn("inspect", projection.events)
                self.assertEqual(projection.removed, [])

    def test_timed_out_missing_cid_cannot_use_one_empty_inventory_as_proof(self):
        self.assertFalse(self.cid_file.exists())
        projection = DockerProjection(self, self.environment)
        self.assert_unknown(projection)
        self.assertEqual(projection.removed, [])
        self.assertNotIn("inspect", projection.events)

    def test_successful_cli_retained_cid_can_confirm_already_removed_owned_container(self):
        # Official CLI v29.5.2 retains a successfully written cidfile. The
        # --rm container may already be absent when the successful CLI returns.
        self.write_cid()
        for code, inventory in ((0, ()), (1, ()), (0, (CID,))):
            with self.subTest(inventory_exit=code, nonempty=bool(inventory)):
                projection = DockerProjection(self, self.environment, inspect_code=1,
                                              inventory_code=code, inventory=inventory)
                if code == 0 and not inventory:
                    result = self.invoke(projection, command_exit_code=0, timed_out=False)
                    self.assertIsInstance(result, dict)
                    self.assertIs(result.get("settled"), True)
                else:
                    self.assert_unknown(projection, command_exit_code=0, timed_out=False)
                self.assertIn("inspect", projection.events)
                self.assertIn("inventory", projection.events)
                self.assertEqual(projection.removed, [], "Absent/unconfirmed CID cannot authorize rm")


if __name__ == "__main__":
    unittest.main()
