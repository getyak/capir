#!/usr/bin/env python3
"""GET-337 source migrations and shaded dependency namespace are distinct.

Small real private ZIP/JAR fixtures contain229 synthetic application migrations,
the existing five required application class paths, and dependency-owned
liquibase class/non-class entries. Class payloads are opaque non-executable
fixtures. They do not claim compiled Java or bytes from the public Liquibase JAR.

API contract: the default three-argument catalogue remains fail-closed for extra
liquibase entries. Explicit dependency_graph= is necessary to admit additional
dependency-owned class/resources. Catalogue keeps every entry and returns
source_migration_entries as the sorted229 exact source paths; those source bytes
stay strict. In the complete catalogue/_dependency_origins chain, extra entries
must match actual resolved dependency ZIP bytes/hash/size. Either real origin
gate may reject an unknown/changed entry. No source conclusion, hash, archive
reader or external process is mocked.

Existing missing-class, unsafe/duplicate-ZIP and unknown-DDL guards remain in
test_opik_package.py. This file adds namespace collision coverage only. It does
not use an external downloaded JAR or execute Maven/Docker/network/package jobs.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("package-opik-backport.py")
REQUIRED_CLASSES = {
    "com/comet/opik/OpikApplication.class",
    "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.class",
    "com/comet/opik/utils/AsyncUtils.class",
    "com/comet/opik/domain/DatasetItemVersionDAOImpl.class",
    "com/comet/opik/infrastructure/bundle/LiquibaseBundle.class",
}
# Paths independently observed in the parent's fingerprint-verified public JAR;
# the bytes below are deliberately small synthetic payloads, not that artifact.
DEPENDENCY_CLASS = "liquibase/UpdateSummaryOutputEnum.class"
DEPENDENCY_RESOURCE = "liquibase/banner.txt"


def sha(data):
    return hashlib.sha256(data).hexdigest()


class OpikPackageNamespaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-package-namespace-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.loaded = None
        self.jar_number = 0
        self.migrations = {
            "liquibase/db-app-state/fixture-" + str(index) + ".sql":
                ("-- Synthetic application migration " + str(index) + "\n").encode()
            for index in range(227)
        }
        self.migrations.update({
            "liquibase/db-app-state/fixture-master.xml": b"<synthetic-state/>\n",
            "liquibase/db-app-analytics/fixture-master.xml": b"<synthetic-analytics/>\n",
        })
        self.assertEqual(len(self.migrations), 229)
        self.dependency_entries = {
            DEPENDENCY_CLASS: b"opaque-synthetic-liquibase-class-fixture-not-executable",
            DEPENDENCY_RESOURCE: b"Synthetic Liquibase banner fixture only.\n",
        }
        dependency = self.write_jar("dependency", self.dependency_entries)
        self.graph = {
            "project": {"groupId": "com.comet.opik", "artifactId": "opik-backend",
                        "packaging": "jar", "version": "2.2.45"},
            "dependencies": [{
                "coordinate": "org.example.get337:namespace-fixture:jar::1.0",
                "file": str(dependency), "sha256": sha(dependency.read_bytes()),
                "bytes": dependency.stat().st_size, "order": 0,
            }],
        }

    def api(self, name):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Package helper is missing")
            module_name = "get337_namespace_subject_" + self.root.name.replace("-", "_")
            spec = importlib.util.spec_from_file_location(module_name, SCRIPT)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            self.addCleanup(sys.modules.pop, module_name, None)
            try:
                spec.loader.exec_module(module)
            except Exception as error:
                self.fail("Package helper import failed: " + type(error).__name__)
            self.loaded = module
        function = getattr(self.loaded, name, None)
        self.assertTrue(callable(function), "Missing namespace admission API: " + name)
        return function

    def write_jar(self, purpose, entries):
        path = self.root / (purpose + "-" + str(self.jar_number) + ".jar")
        self.jar_number += 1
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w+b") as output:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
                for name, data in entries.items():
                    archive.writestr(name, data)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        return path

    def package_entries(self):
        return {
            **{name: b"opaque-application-class-fixture:" + name.encode() for name in REQUIRED_CLASSES},
            **self.migrations,
            **self.dependency_entries,
            "META-INF/MANIFEST.MF":
                b"Manifest-Version: 1.0\r\nMain-Class: com.comet.opik.OpikApplication\r\n\r\n",
        }

    def inspect_jar(self, entries, *, with_graph):
        path = self.write_jar("shaded-package", entries)
        arguments = {"jar_path": path, "migration_sources": self.migrations,
                     "required_entries": REQUIRED_CLASSES}
        if with_graph:
            arguments["dependency_graph"] = self.graph
        try:
            return self.api("catalogue_release_jar")(**arguments)
        except TypeError:
            self.fail("Missing explicit dependency_graph catalogue API; parent must observe contract RED")

    def assert_complete_catalogue(self, result, entries):
        self.assertIsInstance(result, dict, "Catalogue must return real entry evidence")
        self.assertEqual(result.get("source_migration_entries"), sorted(self.migrations),
                         "Application migration identity must remain explicit and separate")
        self.assertEqual(result.get("migration_resources"), 229)
        self.assertEqual(set(result["entries"]), set(entries), "Do not drop shaded dependency entries")
        for name, data in entries.items():
            with self.subTest(catalogue_entry=name):
                self.assertEqual(result["entries"][name]["sha256"], sha(data))
                self.assertEqual(result["entries"][name]["bytes"], len(data))

    def catalogue(self, entries):
        try:
            result = self.inspect_jar(entries, with_graph=True)
        except (ValueError, OSError) as error:
            self.fail("Complete source migrations and explicit real dependency graph must admit matching library entries: "
                      + type(error).__name__)
        self.assert_complete_catalogue(result, entries)
        return result

    def test_complete_application_migrations_allow_real_dependency_class_and_nonclass_origins(self):
        packaged = self.catalogue(self.package_entries())
        self.assertTrue(REQUIRED_CLASSES.issubset(packaged["entries"]))
        origins = self.api("_dependency_origins")(self.graph, packaged)
        self.assertIsInstance(origins, dict, "Origin admission must return real dependency evidence")

    def test_unknown_or_changed_dependency_namespace_entries_are_rejected(self):
        for scenario in ("unknown-class", "unknown-resource", "changed-class", "changed-resource"):
            with self.subTest(scenario=scenario):
                entries = self.package_entries()
                if scenario == "unknown-class":
                    entries["liquibase/UnresolvedNamespace.class"] = b"unknown class fixture"
                elif scenario == "unknown-resource":
                    entries["liquibase/unresolved.properties"] = b"unknown=fixture\n"
                else:
                    name = DEPENDENCY_CLASS if scenario == "changed-class" else DEPENDENCY_RESOURCE
                    entries[name] = b"altered bytes absent from the actual dependency ZIP"
                with self.assertRaises(ValueError):
                    packaged = self.inspect_jar(entries, with_graph=True)
                    self.assert_complete_catalogue(packaged, entries)
                    self.api("_dependency_origins")(self.graph, packaged)

    def test_default_catalogue_without_graph_refuses_dependency_class_or_resource(self):
        for scenario in ("class", "resource", "both"):
            with self.subTest(scenario=scenario):
                entries = self.package_entries()
                if scenario == "class":
                    del entries[DEPENDENCY_RESOURCE]
                elif scenario == "resource":
                    del entries[DEPENDENCY_CLASS]
                with self.assertRaises(ValueError):
                    self.inspect_jar(entries, with_graph=False)

    def test_missing_or_changed_application_migration_is_still_rejected(self):
        victim = next(iter(self.migrations))
        for scenario in ("missing", "changed"):
            with self.subTest(scenario=scenario):
                entries = self.package_entries()
                if scenario == "missing":
                    del entries[victim]
                else:
                    entries[victim] = b"-- unreviewed application DDL change\n"
                with self.assertRaises(ValueError):
                    self.inspect_jar(entries, with_graph=True)


if __name__ == "__main__":
    unittest.main()
