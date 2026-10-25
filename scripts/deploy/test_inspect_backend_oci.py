"""Synthetic OCI fixtures only: these tests do not build or run the backend."""

import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("inspect_backend_oci.py")
REVISION = "a" * 40
OCI = "application/vnd.oci.image."


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


class Fixture:
    def __init__(self, *, architecture="arm64", revision=REVISION, raw=False,
                 diff_id=None, payload=b"synthetic layer contents"):
        layer_tar = io.BytesIO()
        with tarfile.open(fileobj=layer_tar, mode="w") as archive:
            member = tarfile.TarInfo("example")
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        self.uncompressed = layer_tar.getvalue()
        self.layer = self.uncompressed if raw else gzip.compress(self.uncompressed, mtime=0)
        self.files = {}
        self.layer_descriptor = self.blob(self.layer, OCI + ("layer.v1.tar" if raw else "layer.v1.tar+gzip"))
        self.config = {
            "os": "linux", "architecture": architecture,
            "config": {"Labels": {"org.opencontainers.image.revision": revision},
                       "Env": ["TOKEN=PRIVATE_FIXTURE_MARKER"]},
            "rootfs": {"type": "layers", "diff_ids": [diff_id or digest(self.uncompressed)]},
        }
        self.manifest = {"schemaVersion": 2, "mediaType": OCI + "manifest.v1+json",
                         "config": self.blob(encoded(self.config), OCI + "config.v1+json"),
                         "layers": [self.layer_descriptor]}
        self.index = {"schemaVersion": 2, "mediaType": OCI + "index.v1+json",
                      "manifests": []}
        self.refresh_manifest()

    def blob(self, data, media_type):
        descriptor = {"mediaType": media_type, "digest": digest(data), "size": len(data)}
        self.files["blobs/sha256/" + descriptor["digest"].split(":")[1]] = data
        return descriptor

    def refresh_manifest(self):
        self.index["manifests"] = [self.blob(encoded(self.manifest), OCI + "manifest.v1+json")]

    def write(self, path, *, duplicate=None, unsafe_member=None, pax_headers=None):
        files = {**self.files, "oci-layout": encoded({"imageLayoutVersion": "1.0.0"}),
                 "index.json": encoded(self.index)}
        with tarfile.open(path, "w", pax_headers=pax_headers) as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if duplicate:
                member = tarfile.TarInfo(duplicate)
                member.size = len(files[duplicate])
                archive.addfile(member, io.BytesIO(files[duplicate]))
            if unsafe_member:
                member = tarfile.TarInfo(unsafe_member)
                member.type = tarfile.SYMTYPE
                member.linkname = "/outside"
                archive.addfile(member)


class InspectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name) / "image.tar"
        self.output = Path(self.temp.name) / "inspection.json"

    def run_cli(self, fixture, **write_options):
        fixture.write(self.archive, **write_options)
        return subprocess.run([sys.executable, str(SCRIPT), str(self.archive),
                               "--revision", REVISION, "--output", str(self.output)],
                              capture_output=True, text=True)

    def assert_rejected(self, fixture, reason, **write_options):
        result = self.run_cli(fixture, **write_options)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason, result.stderr)
        self.assertFalse(self.output.exists())
        self.assertNotIn("PRIVATE_FIXTURE_MARKER", result.stdout + result.stderr)

    def test_gzip_archive_reports_source_platform_digests_and_distinct_byte_counts(self):
        fixture = Fixture()
        result = self.run_cli(fixture)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(self.output.read_text())
        self.assertEqual(report["source_revision"], REVISION)
        self.assertEqual(report["platform"], "linux/arm64")
        self.assertEqual(report["image_config_digest"], fixture.manifest["config"]["digest"])
        self.assertEqual(report["oci_archive_sha256"], hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.assertEqual(report["oci_archive_bytes"], self.archive.stat().st_size)
        self.assertEqual(report["compressed_layer_bytes"], len(fixture.layer))
        self.assertEqual(report["uncompressed_layer_tar_bytes"], 10240)
        self.assertEqual(report["layer_count"], 1)
        self.assertFalse(report["deployment_approved"])
        self.assertIn("import peak", report["byte_measurement_scope"])
        self.assertNotIn("PRIVATE_FIXTURE_MARKER", self.output.read_text() + result.stdout + result.stderr)

    def test_raw_layer_is_also_verified(self):
        result = self.run_cli(Fixture(raw=True))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.output.read_text())["compressed_layer_bytes"], 10240)

    def test_wrong_architecture_is_rejected(self):
        self.assert_rejected(Fixture(architecture="amd64"), "platform")

    def test_wrong_revision_label_is_rejected(self):
        self.assert_rejected(Fixture(revision="b" * 40), "revision")

    def test_corrupt_compressed_digest_is_rejected(self):
        fixture = Fixture()
        name = "blobs/sha256/" + fixture.layer_descriptor["digest"].split(":")[1]
        fixture.files[name] = b"!" + fixture.files[name][1:]
        self.assert_rejected(fixture, "digest")

    def test_missing_referenced_blob_is_rejected(self):
        fixture = Fixture()
        del fixture.files["blobs/sha256/" + fixture.manifest["config"]["digest"].split(":")[1]]
        self.assert_rejected(fixture, "missing")

    def test_declared_size_must_equal_blob_size(self):
        fixture = Fixture()
        fixture.manifest["layers"][0]["size"] += 1
        fixture.refresh_manifest()
        self.assert_rejected(fixture, "size")

    def test_uncompressed_diff_id_must_match_config(self):
        self.assert_rejected(Fixture(diff_id="sha256:" + "0" * 64), "diff_id")

    def test_unknown_compression_is_rejected(self):
        fixture = Fixture()
        fixture.manifest["layers"][0]["mediaType"] = OCI + "layer.v1.tar+zstd"
        fixture.refresh_manifest()
        self.assert_rejected(fixture, "layer media type")

    def test_multiple_runtime_candidates_cannot_be_silently_selected(self):
        fixture = Fixture()
        fixture.index["manifests"].append(copy.deepcopy(fixture.index["manifests"][0]))
        self.assert_rejected(fixture, "one runtime manifest")

    def test_nested_index_is_rejected_instead_of_traversed(self):
        fixture = Fixture()
        fixture.index["manifests"][0]["mediaType"] = OCI + "index.v1+json"
        self.assert_rejected(fixture, "manifest media type")

    def test_attestation_is_not_treated_as_runtime(self):
        fixture = Fixture()
        fixture.index["manifests"][0]["annotations"] = {"vnd.docker.reference.type": "attestation-manifest"}
        self.assert_rejected(fixture, "attestation")

    def test_descriptor_platform_cannot_disagree_with_config(self):
        fixture = Fixture()
        fixture.index["manifests"][0]["platform"] = {"os": "linux", "architecture": "amd64"}
        self.assert_rejected(fixture, "platform")

    def test_duplicate_archive_members_are_rejected(self):
        self.assert_rejected(Fixture(), "duplicate", duplicate="index.json")

    def test_archive_links_and_parent_paths_are_rejected(self):
        for name in ["link", "../outside"]:
            with self.subTest(name=name):
                self.assert_rejected(Fixture(), "archive member", unsafe_member=name)

    def test_json_depth_is_bounded(self):
        fixture = Fixture()
        fixture.index["extra"] = [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
        self.assert_rejected(fixture, "JSON depth")

    def test_extended_tar_metadata_is_bounded_before_tarfile_allocates_it(self):
        self.assert_rejected(Fixture(), "tar metadata byte limit",
                             pax_headers={"comment": "x" * (4 * 1024**2 + 1)})

    def test_malformed_sparse_metadata_cannot_escape_through_parser_errors(self):
        marker = "PRIVATE_PAX_FIXTURE_MARKER"
        result = self.run_cli(Fixture(), pax_headers={"GNU.sparse.map": marker})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())
        # Fixed assertion messages keep even a failing regression run from
        # repeating the synthetic payload captured from the child process.
        combined = result.stdout + result.stderr
        self.assertFalse("Traceback" in combined, "unexpected parser traceback")
        self.assertFalse(marker in combined, "parser payload must stay out of logs")
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr,
                         "OCI inspection failed: unreadable or malformed archive\n")

    def test_decompression_budget_applies_cumulatively_across_layers(self):
        spec = importlib.util.spec_from_file_location("inspector", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        fixture = Fixture(payload=b"x" * 4096)
        fixture.manifest["layers"].append(copy.deepcopy(fixture.layer_descriptor))
        fixture.config["rootfs"]["diff_ids"] *= 2
        fixture.manifest["config"] = fixture.blob(encoded(fixture.config), OCI + "config.v1+json")
        fixture.refresh_manifest()
        fixture.write(self.archive)
        with self.assertRaisesRegex(module.InspectionError, "uncompressed byte limit"):
            module.inspect_archive(self.archive, REVISION, max_uncompressed_bytes=15000)


if __name__ == "__main__":
    unittest.main()
