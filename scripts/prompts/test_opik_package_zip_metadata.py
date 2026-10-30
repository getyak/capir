#!/usr/bin/env python3
"""GET-337 narrowly admit observed empty Maven metadata directories.

This is compatibility for one observed older dependency ZIP encoding, not a
claim that0xffff is a ZIP-specified sentinel. Only creator3, exact external_attr
0xffff0010, flag_bits0, ZIP_STORED, empty/CRC0/sizes0, trailing slash and the
META-INF/maven/ subtree qualify. All other ZIP guards remain in force.

Fixtures are small real private ZIP files with actual graph SHA/size. Header
counterexamples change their actual bytes and recompute the artifact hash;
there is no mocked ZipInfo, origin conclusion, archive reader or external I/O.
The public compiler JAR is never a fixture dependency. Class bytes are opaque
synthetic payloads, not executable or claimed to be compiled upstream classes.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("package-opik-backport.py")
COMPAT_ATTR = 0xFFFF0010
MAVEN_DIRS = (
    "META-INF/maven/",
    "META-INF/maven/org.example.get337/",
    "META-INF/maven/org.example.get337/zip-fixture/",
)
COORDINATE = "org.example.get337:zip-fixture:jar::1.0"
REQUIRED_CLASSES = {
    "com/comet/opik/OpikApplication.class",
    "com/comet/opik/infrastructure/db/healthchecks/AbstractClickHouseHealthCheck.class",
    "com/comet/opik/utils/AsyncUtils.class",
    "com/comet/opik/domain/DatasetItemVersionDAOImpl.class",
    "com/comet/opik/infrastructure/bundle/LiquibaseBundle.class",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


class OpikPackageZipMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="get337-zip-metadata-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.loaded = None
        self.sequence = 0
        self.migrations = {
            "liquibase/db-app-state/fixture-" + str(index) + ".sql":
                ("-- synthetic application migration " + str(index) + "\n").encode()
            for index in range(229)
        }

    def api(self, name):
        if self.loaded is None:
            self.assertTrue(SCRIPT.is_file(), "Package helper is missing")
            module_name = "get337_zip_metadata_subject_" + self.root.name.replace("-", "_")
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
        self.assertTrue(callable(function), "Missing ZIP metadata API: " + name)
        return function

    def entry(self, name, data=b"", *, creator=3, attributes=COMPAT_ATTR,
              compression=zipfile.ZIP_STORED):
        info = zipfile.ZipInfo(name)
        info.create_system = creator
        info.external_attr = attributes
        info.compress_type = compression
        return info, data

    def normal_entries(self):
        return [
            self.entry("fixture/", attributes=((stat.S_IFDIR | 0o755) << 16) | 0x10),
            self.entry("fixture/Normal.class", b"opaque synthetic dependency class",
                       attributes=(stat.S_IFREG | 0o644) << 16),
            self.entry("fixture/library.properties", b"fixture=true\n",
                       attributes=(stat.S_IFREG | 0o644) << 16),
        ]

    def jar(self, purpose, entries):
        path = self.root / (purpose + "-" + str(self.sequence) + ".jar")
        self.sequence += 1
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w+b") as output:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
                for info, data in entries:
                    archive.writestr(info, data)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        return path

    def package(self, *, compat_directories=False):
        entries = [self.entry(name, b"opaque application class:" + name.encode(),
                              attributes=(stat.S_IFREG | 0o644) << 16)
                   for name in REQUIRED_CLASSES]
        entries += [self.entry(name, data, attributes=(stat.S_IFREG | 0o644) << 16)
                    for name, data in self.migrations.items()]
        entries += [self.entry("META-INF/MANIFEST.MF",
                               b"Manifest-Version: 1.0\r\nMain-Class: com.comet.opik.OpikApplication\r\n\r\n",
                               attributes=(stat.S_IFREG | 0o644) << 16)]
        entries += self.normal_entries()
        if compat_directories:
            entries += [self.entry(name) for name in MAVEN_DIRS]
        path = self.jar("complete-package", entries)
        try:
            catalogue = self.api("catalogue_release_jar")(
                jar_path=path, migration_sources=self.migrations, required_entries=REQUIRED_CLASSES)
        except ValueError as error:
            self.fail("The exact observed empty-directory metadata must coexist with safe complete entries: "
                      + str(error)[:200])
        self.assertEqual(catalogue["source_migration_entries"], sorted(self.migrations))
        self.assertEqual(catalogue["migration_resources"], 229)
        self.assertEqual(set(catalogue["entries"]), {info.filename for info, _ in entries})
        self.assertTrue(REQUIRED_CLASSES.issubset(catalogue["entries"]))
        return catalogue

    def graph(self, dependency):
        return {
            "project": {"groupId": "com.comet.opik", "artifactId": "opik-backend",
                        "packaging": "jar", "version": "2.2.45"},
            "dependencies": [{"coordinate": COORDINATE, "file": str(dependency),
                              "sha256": sha(dependency.read_bytes()),
                              "bytes": dependency.stat().st_size, "order": 0}],
        }

    def patch_header(self, path, name, *, flag_bits=None, crc=None,
                     compressed_size=None, uncompressed_size=None,
                     local_name_mismatch=False):
        """Mutate only this fixture's real headers, then let ZipFile parse them."""
        data = bytearray(path.read_bytes())
        offset = data.find(b"PK\x01\x02")
        found = False
        while offset >= 0 and data[offset:offset + 4] == b"PK\x01\x02":
            name_size, extra_size, comment_size = struct.unpack_from("<HHH", data, offset + 28)
            current = bytes(data[offset + 46:offset + 46 + name_size]).decode("ascii")
            if current == name:
                local = struct.unpack_from("<I", data, offset + 42)[0]
                self.assertEqual(data[local:local + 4], b"PK\x03\x04")
                if flag_bits is not None:
                    struct.pack_into("<H", data, offset + 8, flag_bits)
                    struct.pack_into("<H", data, local + 6, flag_bits)
                if crc is not None:
                    struct.pack_into("<I", data, offset + 16, crc)
                    struct.pack_into("<I", data, local + 14, crc)
                if compressed_size is not None:
                    struct.pack_into("<I", data, offset + 20, compressed_size)
                    struct.pack_into("<I", data, local + 18, compressed_size)
                if uncompressed_size is not None:
                    struct.pack_into("<I", data, offset + 24, uncompressed_size)
                    struct.pack_into("<I", data, local + 22, uncompressed_size)
                if local_name_mismatch:
                    local_name_size = struct.unpack_from("<H", data, local + 26)[0]
                    self.assertEqual(local_name_size, len(name.encode("ascii")))
                    # Same length and a safe relative name, but different from
                    # the central directory: an empty-marker exception cannot
                    # silently skip local-header validation.
                    index = local + 30 + len("META-INF/mave")
                    self.assertEqual(data[index], ord("n"))
                    data[index] = ord("X")
                found = True
                break
            offset += 46 + name_size + extra_size + comment_size
        self.assertTrue(found, "Fixture central entry must exist")
        path.write_bytes(data)

    def test_observed_empty_maven_directories_preserve_catalogue_and_bound_origin_audit(self):
        packaged = self.package(compat_directories=True)
        dependency = self.jar("observed-metadata-dependency", self.normal_entries()
                              + [self.entry(name) for name in MAVEN_DIRS])
        graph = self.graph(dependency)
        try:
            provenance = self.api("_dependency_origins")(graph, packaged)
        except ValueError as error:
            self.fail("Exact observed empty dependency directories require narrow admission and audit: "
                      + str(error)[:200])
        self.assertIsInstance(provenance, dict)
        records = provenance.get("compatibility_empty_maven_directories")
        self.assertIsInstance(records, list, "Accepted compatibility metadata needs explicit dependency audit")
        self.assertEqual(len(records), len(MAVEN_DIRS))
        self.assertEqual({record.get("path") for record in records}, set(MAVEN_DIRS))
        for record in records:
            with self.subTest(path=record.get("path")):
                self.assertEqual(record.get("coordinate"), COORDINATE)
                self.assertEqual(record.get("artifact_sha256"), graph["dependencies"][0]["sha256"])
                self.assertEqual(record.get("external_attr"), COMPAT_ATTR)
                self.assertEqual(record.get("create_system"), 3)
        for name in MAVEN_DIRS:
            self.assertEqual(packaged["entries"][name]["kind"], "directory")
            self.assertEqual(packaged["entries"][name]["bytes"], 0)
            self.assertEqual(packaged["entries"][name]["sha256"], sha(b""))
        self.assertEqual(packaged["entries"]["fixture/"]["kind"], "directory")
        self.assertEqual(packaged["entries"]["fixture/Normal.class"]["kind"], "file")

    def test_compatibility_refuses_other_creators_types_paths_payloads_or_compression(self):
        packaged = self.package()
        variants = {
            "symlink-even-empty-maven-directory": self.entry(MAVEN_DIRS[0], attributes=((stat.S_IFLNK | 0o777) << 16) | 0x10),
            "special-fifo-even-empty-maven-directory": self.entry(MAVEN_DIRS[0], attributes=((stat.S_IFIFO | 0o600) << 16) | 0x10),
            "non-maven-path": self.entry("META-INF/other/"),
            "maven-prefix-lookalike": self.entry("META-INF/mavenish/"),
            "missing-trailing-slash": self.entry("META-INF/maven"),
            "dos-creator-is-not-this-compatibility": self.entry(MAVEN_DIRS[0], creator=0),
            "darwin-creator-is-not-this-compatibility": self.entry(MAVEN_DIRS[0], creator=19),
            "different-external-attribute": self.entry(MAVEN_DIRS[0], attributes=0xFFFF0000),
            "nonempty-directory": self.entry(MAVEN_DIRS[0], b"not empty"),
            "deflated-empty-directory": self.entry(MAVEN_DIRS[0], compression=zipfile.ZIP_DEFLATED),
            "unsafe-path": self.entry("META-INF/maven/../escape/"),
        }
        for scenario, entry in variants.items():
            with self.subTest(scenario=scenario):
                dependency = self.jar("refused-" + scenario, self.normal_entries() + [entry])
                with self.assertRaises(ValueError):
                    self.api("_dependency_origins")(self.graph(dependency), packaged)

    def test_crc_flags_and_inconsistent_local_header_cannot_use_empty_directory_exception(self):
        packaged = self.package()
        mutations = {
            "crc-not-zero": {"crc": 1},
            "compressed-size-not-zero": {"compressed_size": 1},
            "uncompressed-size-not-zero": {"uncompressed_size": 1},
            "encrypted-flag": {"flag_bits": 1},
            "unknown-data-descriptor-flag": {"flag_bits": 8},
            "unobserved-utf8-flag": {"flag_bits": 0x800},
            "local-filename-mismatch": {"local_name_mismatch": True},
        }
        for scenario, changes in mutations.items():
            with self.subTest(scenario=scenario):
                dependency = self.jar("bad-header-" + scenario,
                                      self.normal_entries() + [self.entry(MAVEN_DIRS[0])])
                self.patch_header(dependency, MAVEN_DIRS[0], **changes)
                with self.assertRaises(ValueError):
                    self.api("_dependency_origins")(self.graph(dependency), packaged)

    def test_opened_archive_cannot_borrow_valid_local_header_from_replaced_path(self):
        # Helper-level same-archive consistency only: the real package also has
        # full-artifact hash guards. This is not a claim that those can be
        # bypassed, an exfiltration scenario or a full-package reproduction.
        entries = self.normal_entries() + [self.entry(MAVEN_DIRS[0])]
        original = self.jar("opened-local-header-invalid", entries)
        with zipfile.ZipFile(original) as fixture:
            directory = fixture.getinfo(MAVEN_DIRS[0])
            local_offset = directory.header_offset
            self.assertEqual(directory.flag_bits, 0)
            self.assertEqual(directory.external_attr, COMPAT_ATTR)
        data = bytearray(original.read_bytes())
        self.assertEqual(data[local_offset:local_offset + 4], b"PK\x03\x04")
        # Only the old local flags are invalid; its central tuple still has
        # exactly the observed allowed0 flags. No reader/ZipInfo is mocked.
        struct.pack_into("<H", data, local_offset + 6, 8)
        original.write_bytes(data)
        replacement = self.jar("replacement-local-header-valid", entries)
        replacement_bytes = replacement.read_bytes()
        with zipfile.ZipFile(original) as opened:
            descriptor = opened.fp.fileno()
            before = os.fstat(descriptor)
            self.assertEqual(opened.getinfo(MAVEN_DIRS[0]).flag_bits, 0)
            self.assertEqual(struct.unpack("<H", os.pread(descriptor, 2, local_offset + 6))[0], 8)
            os.replace(replacement, original)
            after = os.fstat(descriptor)
            current_path = original.stat()
            self.assertEqual((after.st_dev, after.st_ino), (before.st_dev, before.st_ino))
            self.assertNotEqual((current_path.st_dev, current_path.st_ino), (after.st_dev, after.st_ino),
                                "The pathname and opened archive must genuinely refer to different files")
            self.assertEqual(original.read_bytes(), replacement_bytes)
            self.assertEqual(struct.unpack("<H", os.pread(descriptor, 2, local_offset + 6))[0], 8)
            with self.assertRaises(ValueError):
                list(self.api("_zip_entries")(opened))


if __name__ == "__main__":
    unittest.main()
