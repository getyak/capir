#!/usr/bin/env python3
"""Read-only verification of the single-platform backend OCI tar (Python 3.9+).

No extraction, image loading, layer execution, or Docker/auth configuration reads.
The producer disables provenance/SBOM; extra manifests (including attestations)
and nested indexes fail closed rather than being guessed at or silently skipped.
"""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import zlib


OCI = "application/vnd.oci.image."
CHUNK = 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024**3
MAX_UNCOMPRESSED_BYTES = 32 * 1024**3
MAX_MEMBERS = 2048
MAX_LAYERS = 256
MAX_JSON_BYTES = 4 * 1024**2
MAX_TOTAL_JSON_BYTES = 16 * 1024**2
MAX_JSON_DEPTH = 24
MAX_JSON_NODES = 100000
SHA256 = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")


class InspectionError(ValueError):
    """A safe, value-free diagnostic; never include document content here."""


def require(condition, message):
    if not condition:
        raise InspectionError(message)


def object_value(value):
    require(isinstance(value, dict), "expected JSON object")
    return value


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def decode_json(data):
    # Bound nesting before handing the document to the recursive JSON decoder.
    depth = 0
    quoted = False
    escaped = False
    for char in data:
        if quoted:
            if escaped:
                escaped = False
            elif char == 92:
                escaped = True
            elif char == 34:
                quoted = False
        elif char == 34:
            quoted = True
        elif char in (91, 123):
            depth += 1
            require(depth <= MAX_JSON_DEPTH, "JSON depth limit exceeded")
        elif char in (93, 125):
            depth -= 1
    try:
        value = json.loads(data, object_pairs_hook=unique_keys,
                           parse_constant=lambda _: (_ for _ in ()).throw(
                               InspectionError("invalid JSON constant")))
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, InspectionError):
            raise
        raise InspectionError("invalid JSON document") from None
    pending = [value]
    count = 0
    while pending:
        item = pending.pop()
        count += 1
        require(count <= MAX_JSON_NODES, "JSON node limit exceeded")
        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return object_value(value)


def hash_stream(stream):
    result = hashlib.sha256()
    count = 0
    while True:
        chunk = stream.read(CHUNK)
        if not chunk:
            return result.hexdigest(), count
        result.update(chunk)
        count += len(chunk)


def bounded_tar_info():
    # tarfile consumes PAX/GNU extension headers before yielding a member. Bound
    # reads at its member-processing entry point, including hidden headers.
    # Patched Python versions bypass public frombuf() for _frombuf(), but both
    # paths call _proc_member() before allocating extension payloads. Delegating
    # after these checks preserves upstream parsing (including dircheck).
    class BoundedTarInfo(tarfile.TarInfo):
        header_count = 0
        metadata_bytes = 0

        def _proc_member(self, archive):
            cls = type(self)
            cls.header_count += 1
            require(cls.header_count <= MAX_MEMBERS, "tar header count limit exceeded")
            require(self.type != tarfile.GNUTYPE_SPARSE and not self.issparse(),
                    "unsupported sparse archive member")
            if self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE,
                             tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK):
                cls.metadata_bytes += self.size
                require(0 <= self.size <= MAX_JSON_BYTES and cls.metadata_bytes <= MAX_JSON_BYTES,
                        "tar metadata byte limit exceeded")
            return super()._proc_member(archive)

    return BoundedTarInfo


class Archive:
    def __init__(self, archive, archive_size):
        self.archive = archive
        self.members = {}
        self.json_bytes = 0
        for count, member in enumerate(archive, 1):
            require(count <= MAX_MEMBERS, "archive member count limit exceeded")
            name = member.name
            while name.startswith("./"):
                name = name[2:]
            require(name and not name.startswith("/") and ".." not in name.split("/"),
                    "unsafe archive member path")
            require(member.isdir() or (member.isfile() and not member.issparse()),
                    "unsupported archive member type")
            require(name not in self.members, "duplicate archive member")
            require(0 <= member.size <= archive_size and
                    member.offset_data + member.size <= archive_size,
                    "invalid archive member size")
            self.members[name] = member

    def stream(self, name):
        member = self.members.get(name)
        require(member is not None and member.isfile(), "missing referenced archive member")
        return self.archive.extractfile(member)

    def json(self, name):
        member = self.members.get(name)
        require(member is not None and member.isfile(), "missing JSON archive member")
        require(member.size <= MAX_JSON_BYTES, "JSON byte limit exceeded")
        self.json_bytes += member.size
        require(self.json_bytes <= MAX_TOTAL_JSON_BYTES, "total JSON byte limit exceeded")
        with self.stream(name) as stream:
            return decode_json(stream.read(MAX_JSON_BYTES + 1))

    def blob(self, descriptor):
        descriptor = object_value(descriptor)
        digest = descriptor.get("digest")
        size = descriptor.get("size")
        require(isinstance(digest, str) and SHA256.fullmatch(digest), "invalid sha256 digest")
        require(type(size) is int and 0 <= size <= MAX_ARCHIVE_BYTES, "invalid declared blob size")
        # External URLs and inline data are deliberately not followed.
        require("urls" not in descriptor and "data" not in descriptor,
                "external or inline blob descriptors are unsupported")
        name = "blobs/sha256/" + digest[7:]
        member = self.members.get(name)
        require(member is not None and member.isfile(), "missing referenced blob")
        require(member.size == size, "declared blob size mismatch")
        with self.stream(name) as stream:
            actual_digest, actual_size = hash_stream(stream)
        require(actual_size == size, "actual blob size mismatch")
        require(actual_digest == digest[7:], "blob digest mismatch")
        return name


def inspect_archive(path, revision, *, max_uncompressed_bytes=MAX_UNCOMPRESSED_BYTES):
    require(isinstance(revision, str) and REVISION.fullmatch(revision), "invalid source revision")
    require(type(max_uncompressed_bytes) is int and max_uncompressed_bytes > 0,
            "invalid uncompressed byte limit")
    with Path(path).open("rb") as source:
        initial = os.fstat(source.fileno())
        require(0 < initial.st_size <= MAX_ARCHIVE_BYTES, "archive byte limit exceeded")
        archive_hash, archive_bytes = hash_stream(source)
        require(archive_bytes == initial.st_size, "archive size changed during inspection")
        source.seek(0)
        # r: accepts an uncompressed outer tar only; compression belongs to layers.
        with tarfile.open(fileobj=source, mode="r:", tarinfo=bounded_tar_info()) as tar:
            archive = Archive(tar, archive_bytes)
            require(archive.json("oci-layout").get("imageLayoutVersion") == "1.0.0",
                    "unsupported OCI layout version")
            index = archive.json("index.json")
            require(type(index.get("schemaVersion")) is int and index["schemaVersion"] == 2,
                    "invalid index schema version")
            require(index.get("mediaType", OCI + "index.v1+json") == OCI + "index.v1+json",
                    "unsupported index media type")
            manifests = index.get("manifests")
            require(isinstance(manifests, list) and len(manifests) == 1,
                    "expected exactly one runtime manifest; attestations are unsupported")
            descriptor = object_value(manifests[0])
            require(descriptor.get("mediaType") == OCI + "manifest.v1+json",
                    "unsupported manifest media type; nested indexes are unsupported")
            annotations = object_value(descriptor.get("annotations", {}))
            require("vnd.docker.reference.type" not in annotations,
                    "attestation/reference manifests are unsupported")
            if "platform" in descriptor:
                platform = object_value(descriptor["platform"])
                require(platform.get("os") == "linux" and platform.get("architecture") == "arm64",
                        "descriptor platform must be linux/arm64")
            manifest = archive.json(archive.blob(descriptor))
            require(type(manifest.get("schemaVersion")) is int and manifest["schemaVersion"] == 2,
                    "invalid manifest schema version")
            require(manifest.get("mediaType", OCI + "manifest.v1+json") == OCI + "manifest.v1+json",
                    "unsupported manifest media type")
            require("artifactType" not in manifest and "subject" not in manifest,
                    "artifact/attestation manifests are unsupported")
            config_descriptor = object_value(manifest.get("config"))
            require(config_descriptor.get("mediaType") == OCI + "config.v1+json",
                    "unsupported config media type")
            config = archive.json(archive.blob(config_descriptor))
            require(config.get("os") == "linux" and config.get("architecture") == "arm64",
                    "image config platform must be linux/arm64")
            labels = object_value(object_value(config.get("config")).get("Labels"))
            require(labels.get("org.opencontainers.image.revision") == revision,
                    "image source revision label mismatch")
            layers = manifest.get("layers")
            require(isinstance(layers, list) and 0 < len(layers) <= MAX_LAYERS,
                    "invalid layer count")
            rootfs = object_value(config.get("rootfs"))
            diff_ids = rootfs.get("diff_ids")
            require(rootfs.get("type") == "layers" and isinstance(diff_ids, list) and
                    len(diff_ids) == len(layers), "rootfs diff_ids count mismatch")
            compressed_bytes = 0
            uncompressed_bytes = 0
            for layer, diff_id in zip(layers, diff_ids):
                layer = object_value(layer)
                require(isinstance(diff_id, str) and SHA256.fullmatch(diff_id), "invalid diff_id")
                media_type = layer.get("mediaType")
                require(media_type in (OCI + "layer.v1.tar+gzip", OCI + "layer.v1.tar"),
                        "unsupported layer media type")
                name = archive.blob(layer)
                compressed_bytes += layer["size"]
                require(compressed_bytes <= MAX_ARCHIVE_BYTES, "compressed byte limit exceeded")
                uncompressed_hash = hashlib.sha256()
                with archive.stream(name) as compressed:
                    reader = gzip.GzipFile(fileobj=compressed) if media_type.endswith("+gzip") else compressed
                    try:
                        while True:
                            chunk = reader.read(min(CHUNK, max_uncompressed_bytes - uncompressed_bytes + 1))
                            if not chunk:
                                break
                            uncompressed_bytes += len(chunk)
                            require(uncompressed_bytes <= max_uncompressed_bytes,
                                    "uncompressed byte limit exceeded")
                            uncompressed_hash.update(chunk)
                    finally:
                        if reader is not compressed:
                            reader.close()
                require(uncompressed_hash.hexdigest() == diff_id[7:], "layer diff_id mismatch")
        final = os.fstat(source.fileno())
        require((initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns) ==
                (final.st_size, final.st_mtime_ns, final.st_ctime_ns),
                "archive changed during inspection")
    return {
        "source_revision": revision,
        "platform": "linux/arm64",
        "image_config_digest": config_descriptor["digest"],
        "image_manifest_digest": descriptor["digest"],
        "oci_archive_sha256": archive_hash,
        "oci_archive_bytes": archive_bytes,
        "compressed_layer_bytes": compressed_bytes,
        "uncompressed_layer_tar_bytes": uncompressed_bytes,
        "layer_count": len(layers),
        "byte_measurement_scope": (
            "Archive and layer stream bytes only; not Docker import peak, runtime disk capacity, "
            "WAL budget, or evidence of behavioral acceptance. Raw layer bytes count as compressed_layer_bytes "
            "when a layer is stored without compression."
        ),
        "integrity_scope": "Source label and archive integrity binding only; not a signature or attestation.",
        "deployment_approved": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        require(args.archive.resolve() != args.output.resolve(), "output cannot replace archive")
        require(not args.output.exists(), "output already exists; use a fresh output path")
        report = inspect_archive(args.archive, args.revision)
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(report, output, indent=2)
            output.write("\n")
    except InspectionError as error:
        print("OCI inspection failed: " + str(error), file=sys.stderr)
        return 1
    except (OSError, EOFError, tarfile.TarError, zlib.error, ValueError):
        # Parser/library exception strings can include content or filenames.
        print("OCI inspection failed: unreadable or malformed archive", file=sys.stderr)
        return 1
    print("Verified source-bound linux/arm64 OCI archive; no deployment or runtime acceptance implied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
