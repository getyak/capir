"""Explicit build-only Lombok defaults; no Docker, Maven or network at import."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time


SCHEMA = "capri.opik.compile-profile.v1"
PROFILE_ID = "opik-dd403-official-docker-build-v1"
PROOF_SCHEMA = "capri.opik.compile-observation.v1"
UPSTREAM = "dd40343a223ec8d0ab11eafc5f88cbf18532c0ac"
SOURCE_CONFIG = "apps/opik-backend/lombok.config"
TARGET = "/workspace/" + SOURCE_CONFIG
OVERRIDE = b"config.stopBubbling = true\n"
OVERRIDE_SHA = "cef77f6e12c36c1efc67602e98e6012c742c9a2ccc552dc0df3334b670a024ef"
MARKER = b"CAPIR_OPIK_COMPILE_PROFILE_V1 "


def catalogue_sha(catalogue):
    if (not isinstance(catalogue, dict) or not catalogue
            or any(not isinstance(path, str) or not isinstance(digest, str)
                   or re.fullmatch(r"[0-9a-f]{64}", digest) is None
                   for path, digest in catalogue.items())):
        raise ValueError("Invalid compile source catalogue")
    return hashlib.sha256(json.dumps(catalogue, sort_keys=True).encode()).hexdigest()


def _path(value):
    path = Path(value)
    if (not path.is_absolute() or ".." in path.parts
            or any(c in str(path) for c in (",", "\n", "\r", "\0"))):
        raise ValueError("Compile profile requires an unaliased absolute path")
    try:
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError("Compile profile symlink path")
    except OSError:
        raise ValueError("Unreadable compile profile path") from None
    return path


def _directory(value, *, owner=None):
    path = _path(value)
    try:
        info = path.stat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
                or info.st_uid != os.getuid() or info.st_gid != os.getgid()
                or (owner and (info.st_uid, info.st_gid) != (owner["uid"], owner["gid"]))):
            raise ValueError("Compile profile directory ownership or mode changed")
    except OSError:
        raise ValueError("Compile profile directory unavailable") from None
    return path


def _read_regular(value, *, limit, owner=None, mode=None):
    path = _path(value)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                    or before.st_size > limit
                    or (owner and (before.st_uid, before.st_gid) != (owner["uid"], owner["gid"]))
                    or (mode is not None and stat.S_IMODE(before.st_mode) != mode)):
                raise ValueError("Compile profile requires a bounded regular owned file")
            data = stream.read(limit + 1)
            after = os.fstat(stream.fileno())
            current = path.stat()
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode", "st_nlink")
        if (len(data) > limit or any(getattr(before, key) != getattr(after, key)
                                    or getattr(before, key) != getattr(current, key) for key in fields)):
            raise ValueError("Compile profile file changed during read")
    except OSError:
        raise ValueError("Compile profile file unavailable") from None
    return data, before


def _metadata(*, source_dir, receipt_dir, protected_catalogue, upstream_revision):
    if upstream_revision != UPSTREAM:
        raise ValueError("Compile profile requires the pinned upstream revision")
    source = _directory(source_dir)
    source_info = source.stat()
    owner = {"uid": source_info.st_uid, "gid": source_info.st_gid}
    receipts = _directory(receipt_dir, owner=owner)
    original, _ = _read_regular(source / SOURCE_CONFIG, limit=1024 * 1024, owner=owner)
    original_sha = hashlib.sha256(original).hexdigest()
    if protected_catalogue.get(SOURCE_CONFIG) != original_sha:
        raise ValueError("Original Lombok configuration differs from protected source")
    directory = _directory(receipts / "compile-profile", owner=owner)
    override = directory / "lombok.config"
    material, info = _read_regular(override, limit=len(OVERRIDE), owner=owner, mode=0o400)
    if material != OVERRIDE:
        raise ValueError("Compile override is not the exact official-default profile")
    return {
        "schema": SCHEMA, "profile_id": PROFILE_ID, "upstream_revision": UPSTREAM,
        "source_config_path": SOURCE_CONFIG, "source_config_sha256": original_sha,
        "source_catalogue_sha256": catalogue_sha(protected_catalogue),
        "effective_catalogue_sha256": catalogue_sha({**protected_catalogue, SOURCE_CONFIG: OVERRIDE_SHA}),
        "override_path": str(override), "override_sha256": OVERRIDE_SHA, "override_bytes": len(OVERRIDE),
        "override_owner": {"uid": info.st_uid, "gid": info.st_gid, "mode": "0400"},
        "target": TARGET, "mount_read_only": True,
    }


def prepare(*, source_dir, receipt_dir, protected_catalogue, upstream_revision):
    """Create one retained evidence file, never modify the protected source."""
    receipts = _directory(receipt_dir)
    directory = _path(receipts / "compile-profile")
    try:
        directory.mkdir(mode=0o700)
        descriptor = os.open(directory / "lombok.config",
                             os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o400)
            output.write(OVERRIDE)
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        raise ValueError("Refuse an existing or unavailable compile-profile output") from None
    return _metadata(source_dir=source_dir, receipt_dir=receipt_dir,
                     protected_catalogue=protected_catalogue, upstream_revision=upstream_revision)


def validate_host(profile, *, source_dir, receipt_dir, protected_catalogue, upstream_revision):
    expected = _metadata(source_dir=source_dir, receipt_dir=receipt_dir,
                         protected_catalogue=protected_catalogue, upstream_revision=upstream_revision)
    if (not isinstance(profile, dict) or profile.get("mount_read_only") is not True
            or {key: value for key, value in profile.items() if key != "execution_proof"} != expected):
        raise ValueError("Compile profile differs from its actual protected inputs")
    return expected


def _execution_identity(token, phase):
    if (not isinstance(token, str) or re.fullmatch(r"[0-9a-f]{32}", token) is None
            or not isinstance(phase, str) or re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", phase) is None):
        raise ValueError("Invalid compile execution identity")


def _proof_expected(profile, token, phase):
    _execution_identity(token, phase)
    owner = profile["override_owner"]
    return {
        "schema": PROOF_SCHEMA, "profile_id": PROFILE_ID, "run_token": token, "phase": phase,
        "target": TARGET, "sha256": OVERRIDE_SHA, "bytes": len(OVERRIDE), "file_type": "regular",
        "uid": owner["uid"], "gid": owner["gid"], "mode": "0400", "mount_read_only": True,
    }


def observe(*, log_path, profile, token, phase, not_before_ns, not_after_ns=None):
    """Read the same-container pre-exec marker; callers retain the full log hash."""
    expected = _proof_expected(profile, token, phase)
    path = _path(log_path)
    try:
        with path.open("rb") as stream:
            line = stream.readline(8193)
    except OSError:
        raise ValueError("Compile observation log unavailable") from None
    if len(line) > 8192 or not line.startswith(MARKER) or not line.endswith(b"\n"):
        raise ValueError("Missing first-line pre-Maven compile observation")

    def unique(pairs):
        value = {}
        for key, entry in pairs:
            if key in value:
                raise ValueError("Duplicate compile observation field")
            value[key] = entry
        return value

    try:
        proof = json.loads(line[len(MARKER):], object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("Unreadable compile observation") from None
    if (not isinstance(proof, dict) or proof.get("mount_read_only") is not True
            or {key: value for key, value in proof.items() if key != "observed_at_ns"} != expected
            or any(type(proof.get(key)) is not int for key in ("uid", "gid", "bytes"))):
        raise ValueError("Effective compile mount or file observation changed")
    observed = proof.get("observed_at_ns")
    upper = time.time_ns() if not_after_ns is None else not_after_ns
    if (type(not_before_ns) is not int or type(upper) is not int
            or type(observed) is not int or not 0 < not_before_ns <= observed <= upper):
        raise ValueError("Compile observation is outside the actual execution/report interval")
    return proof


def validate(profile, *, source_dir, receipt_dir, protected_catalogue, upstream_revision,
             token, phase, log_path, not_before_ns, not_after_ns=None):
    validate_host(profile, source_dir=source_dir, receipt_dir=receipt_dir,
                  protected_catalogue=protected_catalogue, upstream_revision=upstream_revision)
    proof = observe(log_path=log_path, profile=profile, token=token, phase=phase,
                    not_before_ns=not_before_ns, not_after_ns=not_after_ns)
    if profile.get("execution_proof") != proof:
        raise ValueError("Compile receipt/context lacks its exact same-container observation")
    return proof


def mount_argument(profile):
    return "type=bind,src=" + profile["override_path"] + ",dst=" + TARGET + ",readonly"


# Only fixed public strings and already validated decimal UID/GID, token and
# phase arguments enter this wrapper. No dynamic command is shell-interpolated.
_WRAPPER = r'''export LC_ALL=C
token=$1; phase=$2; target=$3; expected_uid=$4; expected_gid=$5
shift 5
test -f "$target" && test ! -L "$target"
test "$(stat -c %F "$target")" = 'regular file'
uid=$(stat -c %u "$target"); gid=$(stat -c %g "$target")
test "$uid" = "$expected_uid"
test "$gid" = "$expected_gid"
test "$(stat -c %a "$target")" = '400'
bytes=$(wc -c < "$target" | tr -d '[:space:]')
test "$bytes" = '27'
digest=$(sha256sum "$target"); digest=${digest%% *}
test "$digest" = 'cef77f6e12c36c1efc67602e98e6012c742c9a2ccc552dc0df3334b670a024ef'
awk -v target="$target" '$5 == target { count++; n=split($6, options, ","); for(i=1;i<=n;i++) if(options[i]=="ro") readonly=1 } END { if(count!=1 || !readonly) exit 1 }' /proc/self/mountinfo
observed=$(date +%s%N)
case "$observed" in ''|*[!0-9]*) exit 78 ;; esac
printf 'CAPIR_OPIK_COMPILE_PROFILE_V1 {"bytes":27,"file_type":"regular","gid":%s,"mode":"0400","mount_read_only":true,"observed_at_ns":%s,"phase":"%s","profile_id":"opik-dd403-official-docker-build-v1","run_token":"%s","schema":"capri.opik.compile-observation.v1","sha256":"cef77f6e12c36c1efc67602e98e6012c742c9a2ccc552dc0df3334b670a024ef","target":"/workspace/apps/opik-backend/lombok.config","uid":%s}\n' "$gid" "$observed" "$phase" "$token" "$uid"
exec "$@"
'''


def command(profile, *, token, phase, arguments):
    _execution_identity(token, phase)
    owner = profile["override_owner"]
    if any(type(owner.get(key)) is not int or owner[key] < 0 for key in ("uid", "gid")):
        raise ValueError("Invalid compile bind UID/GID")
    if not arguments or any(not isinstance(value, str) or "\0" in value for value in arguments):
        raise ValueError("Compile wrapper requires an explicit argument vector")
    return ["/bin/sh", "-eu", "-c", _WRAPPER, "opik-compile-profile", token, phase,
            TARGET, str(owner["uid"]), str(owner["gid"]), *arguments]
