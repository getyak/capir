#!/usr/bin/env python3
"""Retain bounded native test diagnostics without changing test conclusions."""
import json
import pathlib
import subprocess
import sys


def invoke(arguments):
    try:
        result = subprocess.run(arguments, capture_output=True, timeout=60, check=False)
    except (subprocess.TimeoutExpired, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


def export(results, output):
    output.mkdir(parents=True, exist_ok=True)
    for result in sorted(results.glob("*.xcresult"))[-3:]:
        summary = None
        for kind in ("summary", "tests"):
            data = invoke(["xcrun", "xcresulttool", "get", "test-results", kind,
                           "--path", str(result)])
            if data is not None:
                (output / (result.stem + "-" + kind + ".json")).write_bytes(data)
                if kind == "summary":
                    try:
                        summary = json.loads(data)
                    except (ValueError, UnicodeError):
                        pass
        # --only-failures omits metadata attached to successful activities inside
        # a failed test. Export all attachments for exact failed test IDs instead.
        failures = summary.get("testFailures", []) if isinstance(summary, dict) else []
        if not isinstance(failures, list):
            failures = []
        identifiers = []
        for failure in failures:
            identifier = failure.get("testIdentifierString") if isinstance(failure, dict) else None
            if isinstance(identifier, str) and 0 < len(identifier) <= 512 and identifier not in identifiers:
                identifiers.append(identifier)
        for index, identifier in enumerate(identifiers[:3]):
            invoke(["xcrun", "xcresulttool", "export", "attachments", "--test-id", identifier,
                    "--path", str(result), "--output-path",
                    str(output / (result.stem + "-failed-test-" + str(index + 1)))])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: export-test-diagnostics.py RESULTS_DIRECTORY OUTPUT_DIRECTORY")
    export(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
