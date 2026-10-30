#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Compile-profile admission through the existing fixed54 package boundary.

These tests compose the existing raw54 XML/catalogue fixture and call the real
validate_fixed54_evidence API. There is no prospective-function/import-error
oracle. The old implementation admits the missing/mismatched compile profile;
the parent must observe those actual assertion failures before production edits.

Real private temporary files provide override/source bytes, modes, link types
and ownership. Container observations and raw54 are explicitly synthetic receipt
fixtures, not evidence that Docker, Maven, Java or an official image ran here.
No production source, historical receipt or frozen Java patch is rewritten.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest


SOURCE_CONFIG = "apps/opik-backend/lombok.config"
TARGET = "/workspace/apps/opik-backend/lombok.config"
PROFILE_ID = "opik-dd403-official-docker-build-v1"
PROFILE_SCHEMA = "capri.opik.compile-profile.v1"
PROOF_SCHEMA = "capri.opik.compile-observation.v1"
OVERRIDE = b"config.stopBubbling = true\n"
OVERRIDE_SHA = "cef77f6e12c36c1efc67602e98e6012c742c9a2ccc552dc0df3334b670a024ef"
SOURCE_BYTES = b"# Synthetic source config: it must remain untouched.\nlombok.anyConstructor.addConstructorProperties = true\n"
MARKER = b"CAPIR_OPIK_COMPILE_PROFILE_V1 "


def sha(data):
    return hashlib.sha256(data).hexdigest()


def catalogue_sha(catalogue):
    return sha(json.dumps(catalogue, sort_keys=True).encode())


def proof_line(proof):
    return MARKER + json.dumps(proof, sort_keys=True, separators=(",", ":")).encode() + b"\n"


class OpikCompileProfileAdmissionTests(unittest.TestCase):
    def fixture(self):
        # Composition, not inheritance: do not discover/re-run the old suite as
        # methods of this new test class or patch its evidence implementation.
        path = Path(__file__).with_name("test_opik_package.py")
        spec = importlib.util.spec_from_file_location("get337_profile_fixture_support", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        support_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(support_module)
        support = support_module.OpikPackageAdmissionTests(methodName="runTest")
        support.setUp()
        self.addCleanup(support.doCleanups)
        fixture = support.evidence()
        source = fixture["source"] / SOURCE_CONFIG
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(SOURCE_BYTES)
        source.chmod(0o644)
        # Keep the established 1576/229 fixture contract. No entry is silently
        # dropped from the protected catalogue: replace one synthetic dummy.
        catalogues = {}
        for name in ("before", "patched", "after"):
            destination = fixture["receipt_dir"] / ("protected-source-" + name + ".json")
            catalogue = json.loads(destination.read_bytes())
            if SOURCE_CONFIG not in catalogue:
                del catalogue["apps/opik-backend/fixture-protected-0.txt"]
            catalogue[SOURCE_CONFIG] = sha(SOURCE_BYTES)
            self.assertEqual(len(catalogue), 1576)
            self.assertEqual(sum("/liquibase/" in key for key in catalogue), 229)
            support.write_json(destination, catalogue)
            catalogues[name] = catalogue
        profile_directory = fixture["receipt_dir"] / "compile-profile"
        profile_directory.mkdir(mode=0o700, exist_ok=True)
        profile_directory.chmod(0o700)
        override = profile_directory / "lombok.config"
        # A future shared-fixture migration may already create this valid file;
        # this new suite still constructs its own exact synthetic contract.
        if override.exists():
            override.chmod(0o600)
        override.write_bytes(OVERRIDE)
        override.chmod(0o400)
        self.assertEqual(sha(OVERRIDE), OVERRIDE_SHA)
        self.assertEqual(len(OVERRIDE), 27)
        owner = fixture["context"]["source_bind_owner"]
        token = "9" * 32
        proof = {
            "schema": PROOF_SCHEMA, "profile_id": PROFILE_ID,
            "run_token": token, "phase": "fixed54_test",
            "observed_at_ns": fixture["context"]["not_before_ns"] + 1,
            "target": TARGET, "sha256": OVERRIDE_SHA, "bytes": 27,
            "file_type": "regular", "uid": owner["uid"], "gid": owner["gid"],
            "mode": "0400", "mount_read_only": True,
        }
        self.assertLessEqual(proof["observed_at_ns"],
                             min(path.stat().st_mtime_ns for path in fixture["report_dir"].glob("*.xml")))
        effective = {**catalogues["patched"], SOURCE_CONFIG: OVERRIDE_SHA}
        profile = {
            "schema": PROFILE_SCHEMA, "profile_id": PROFILE_ID,
            "upstream_revision": support_module.REVISION,
            "source_config_path": SOURCE_CONFIG,
            "source_config_sha256": sha(SOURCE_BYTES),
            "source_catalogue_sha256": catalogue_sha(catalogues["patched"]),
            "effective_catalogue_sha256": catalogue_sha(effective),
            "override_path": str(override), "override_sha256": OVERRIDE_SHA,
            "override_bytes": 27,
            "override_owner": {"uid": owner["uid"], "gid": owner["gid"], "mode": "0400"},
            "target": TARGET, "mount_read_only": True, "execution_proof": proof,
        }
        fixture["profile_fixture_original_log"] = b"Public synthetic fixed54 test log\n"
        fixture["profile_fixture_catalogue"] = catalogues["patched"]
        fixture["profile_fixture_override"] = override
        fixture["profile_fixture_source_config"] = source
        fixture["receipt"].setdefault("build_image", {})["container_run_token"] = token
        self.bind(support, fixture, profile)
        return support, fixture

    def bind(self, support, fixture, profile, *, marker=True, prefix=b""):
        fixture["receipt"]["compile_profile"] = copy.deepcopy(profile)
        fixture["context"]["compile_profile"] = copy.deepcopy(profile)
        log = fixture["profile_fixture_original_log"]
        if marker:
            log = prefix + proof_line(profile["execution_proof"]) + log
        (fixture["receipt_dir"] / "maven.log").write_bytes(log)
        fixture["receipt"]["maven_log_sha256"] = sha(log)
        support.rebind(fixture)

    def validate(self, support, fixture):
        return support.validate(fixture)

    def reject(self, support, fixture):
        with self.assertRaises(ValueError, msg="A prior fixed54 result cannot authorize a missing or different compile context"):
            self.validate(support, fixture)

    def test_matching_profile_preserves_actual_source_and_admits_existing_raw54(self):
        support, fixture = self.fixture()
        before = fixture["profile_fixture_source_config"].read_bytes()
        result = self.validate(support, fixture)
        self.assertTrue(result["passed"])
        self.assertEqual(result["tests"], 54)
        self.assertEqual(fixture["profile_fixture_source_config"].read_bytes(), before)
        self.assertEqual(before, SOURCE_BYTES)
        self.assertEqual(fixture["profile_fixture_override"].read_bytes(), OVERRIDE)

    def test_legacy_raw54_without_profile_and_marker_is_refused(self):
        support, fixture = self.fixture()
        fixture["receipt"].pop("compile_profile")
        fixture["context"].pop("compile_profile")
        fixture["receipt"]["build_image"].pop("container_run_token")
        log = fixture["profile_fixture_original_log"]
        (fixture["receipt_dir"] / "maven.log").write_bytes(log)
        fixture["receipt"]["maven_log_sha256"] = sha(log)
        support.rebind(fixture)
        self.reject(support, fixture)

    def test_receipt_and_context_require_the_same_profile(self):
        for scenario in ("missing-receipt", "missing-context", "different-context"):
            with self.subTest(scenario=scenario):
                support, fixture = self.fixture()
                if scenario == "missing-receipt":
                    fixture["receipt"].pop("compile_profile")
                elif scenario == "missing-context":
                    fixture["context"].pop("compile_profile")
                else:
                    fixture["context"]["compile_profile"]["effective_catalogue_sha256"] = "a" * 64
                support.rebind(fixture)
                self.reject(support, fixture)

    def test_self_consistent_but_wrong_profile_policy_cannot_replace_official_compile_context(self):
        for scenario in ("schema", "profile-id", "upstream", "source-path", "target",
                         "writable-mount", "source-catalogue", "effective-catalogue"):
            with self.subTest(scenario=scenario):
                support, fixture = self.fixture()
                profile = fixture["receipt"]["compile_profile"]
                if scenario == "schema":
                    profile["schema"] = "capri.opik.compile-profile.v0"
                elif scenario == "profile-id":
                    profile["profile_id"] = "full-upstream-config-visible-v1"
                    profile["execution_proof"]["profile_id"] = profile["profile_id"]
                elif scenario == "upstream":
                    profile["upstream_revision"] = "a" * 40
                elif scenario == "source-path":
                    profile["source_config_path"] = "apps/opik-backend/pom.xml"
                elif scenario == "target":
                    profile["target"] = "/workspace/lombok.config"
                    profile["execution_proof"]["target"] = profile["target"]
                elif scenario == "writable-mount":
                    profile["mount_read_only"] = False
                    profile["execution_proof"]["mount_read_only"] = False
                elif scenario == "source-catalogue":
                    profile["source_catalogue_sha256"] = "a" * 64
                else:
                    profile["effective_catalogue_sha256"] = "a" * 64
                self.bind(support, fixture, profile)
                self.reject(support, fixture)

    def test_override_must_be_the_real_private_regular_readonly_bound_file(self):
        scenarios = ("missing", "different-bytes", "policy-broadening", "writable-file",
                     "public-parent", "symlink", "ancestor-symlink", "directory",
                     "hardlink", "other-path", "claimed-owner", "claimed-size", "claimed-hash")
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                support, fixture = self.fixture()
                profile = fixture["receipt"]["compile_profile"]
                override = fixture["profile_fixture_override"]
                if scenario == "missing":
                    override.unlink()
                elif scenario in ("different-bytes", "policy-broadening"):
                    data = OVERRIDE + b"lombok.anyConstructor.addConstructorProperties = true\n"
                    override.chmod(0o600)
                    override.write_bytes(data)
                    override.chmod(0o400)
                    if scenario == "policy-broadening":
                        profile["override_sha256"] = sha(data)
                        profile["override_bytes"] = len(data)
                        profile["execution_proof"].update(sha256=sha(data), bytes=len(data))
                        effective = {**fixture["profile_fixture_catalogue"], SOURCE_CONFIG: sha(data)}
                        profile["effective_catalogue_sha256"] = catalogue_sha(effective)
                elif scenario == "writable-file":
                    override.chmod(0o600)
                elif scenario == "public-parent":
                    override.parent.chmod(0o755)
                elif scenario == "symlink":
                    real = override.with_name("real.config")
                    override.rename(real)
                    override.symlink_to(real)
                elif scenario == "ancestor-symlink":
                    real = override.parent.with_name("real-compile-profile")
                    override.parent.rename(real)
                    override.parent.symlink_to(real, target_is_directory=True)
                elif scenario == "directory":
                    override.unlink()
                    override.mkdir(mode=0o700)
                elif scenario == "hardlink":
                    os.link(override, override.with_name("second-link.config"))
                elif scenario == "other-path":
                    other = override.with_name("other.config")
                    other.write_bytes(OVERRIDE)
                    other.chmod(0o400)
                    profile["override_path"] = str(other)
                elif scenario == "claimed-owner":
                    profile["override_owner"]["uid"] += 1
                    profile["execution_proof"]["uid"] += 1
                elif scenario == "claimed-size":
                    profile["override_bytes"] += 1
                else:
                    profile["override_sha256"] = "a" * 64
                self.bind(support, fixture, profile)
                self.reject(support, fixture)

    def test_source_config_is_still_protected_and_does_not_become_the_override(self):
        for scenario in ("source-bytes", "source-symlink", "source-directory", "source-hash-claim"):
            with self.subTest(scenario=scenario):
                support, fixture = self.fixture()
                profile = fixture["receipt"]["compile_profile"]
                source = fixture["profile_fixture_source_config"]
                if scenario == "source-bytes":
                    source.write_bytes(OVERRIDE)
                elif scenario == "source-symlink":
                    source.unlink()
                    source.symlink_to(fixture["profile_fixture_override"])
                elif scenario == "source-directory":
                    source.unlink()
                    source.mkdir(mode=0o700)
                else:
                    profile["source_config_sha256"] = OVERRIDE_SHA
                self.bind(support, fixture, profile)
                self.reject(support, fixture)

    def test_same_maven_container_must_observe_effective_regular_readonly_config_before_reports(self):
        scenarios = ("proof-schema", "proof-phase", "proof-profile", "proof-target", "proof-type",
                     "proof-hash", "proof-size", "proof-owner", "proof-mode", "proof-ro",
                     "proof-token", "missing-token", "invalid-token", "proof-before-run",
                     "proof-after-xml", "proof-boolean-time", "missing-marker", "marker-after-output")
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                support, fixture = self.fixture()
                profile = fixture["receipt"]["compile_profile"]
                proof = profile["execution_proof"]
                if scenario == "proof-schema":
                    proof["schema"] = "capri.opik.compile-observation.v0"
                elif scenario == "proof-phase":
                    proof["phase"] = "clean_package"
                elif scenario == "proof-profile":
                    proof["profile_id"] = "full-upstream-config-visible-v1"
                elif scenario == "proof-target":
                    proof["target"] = "/workspace/lombok.config"
                elif scenario == "proof-type":
                    proof["file_type"] = "symlink"
                elif scenario == "proof-hash":
                    proof["sha256"] = "a" * 64
                elif scenario == "proof-size":
                    proof["bytes"] += 1
                elif scenario == "proof-owner":
                    proof["gid"] += 1
                elif scenario == "proof-mode":
                    proof["mode"] = "0600"
                elif scenario == "proof-ro":
                    proof["mount_read_only"] = False
                elif scenario == "proof-token":
                    proof["run_token"] = "8" * 32
                elif scenario == "missing-token":
                    fixture["receipt"]["build_image"].pop("container_run_token")
                elif scenario == "invalid-token":
                    proof["run_token"] = "synthetic invalid token"
                    fixture["receipt"]["build_image"]["container_run_token"] = proof["run_token"]
                elif scenario == "proof-before-run":
                    proof["observed_at_ns"] = fixture["context"]["not_before_ns"] - 1
                elif scenario == "proof-after-xml":
                    proof["observed_at_ns"] = min(path.stat().st_mtime_ns
                                                  for path in fixture["report_dir"].glob("*.xml")) + 1
                elif scenario == "proof-boolean-time":
                    proof["observed_at_ns"] = True
                self.bind(support, fixture, profile,
                          marker=scenario != "missing-marker",
                          prefix=b"Synthetic Maven output before proof\n" if scenario == "marker-after-output" else b"")
                self.reject(support, fixture)


if __name__ == "__main__":
    unittest.main()
