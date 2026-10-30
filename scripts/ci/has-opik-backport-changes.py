#!/usr/bin/env python3
"""Select the pinned Opik regression; ambiguous scope requires the check."""

import os
import re
import subprocess
import sys


def required(base, head):
    if os.environ.get("EVENT_NAME") == "workflow_dispatch":
        return True
    if any(not re.fullmatch(r"(?:[0-9a-f]{40}|HEAD)", ref) for ref in (base, head)):
        return True
    for ref in (base, head):
        if subprocess.run(
            ["git", "cat-file", "-e", f"{ref}^{{commit}}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode:
            return True
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "-z", "--diff-filter=ACDMRTUXB", base, head, "--"],
        capture_output=True,
    )
    if result.returncode or not result.stdout:
        return True
    exact = {
        ".github/workflows/ci.yml",
        "scripts/ci/has-opik-backport-changes.py",
        "scripts/ci/opik-ci-gate.test.mjs",
        "scripts/ci/opik-ci-scope.test.mjs",
        "scripts/prompts/start-opik.sh",
        "scripts/prompts/test-opik-backport.py",
        "scripts/prompts/package-opik-backport.py",
        "scripts/prompts/test_opik_backport.py",
    }
    return any(
        path.startswith("deploy/opik/") or path in exact
        or re.fullmatch(r"scripts/prompts/test_opik[^/]*\.py", path) is not None
        for path in map(os.fsdecode, result.stdout.rstrip(b"\0").split(b"\0"))
    )


if __name__ == "__main__":
    print("true" if required(sys.argv[1] if len(sys.argv) > 1 else "", sys.argv[2] if len(sys.argv) > 2 else "HEAD") else "false")
