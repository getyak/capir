#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

if (unset MACOS_VERSION MACOS_BUILD_NUMBER;
    MACOS_OUTPUT_DIR="$temporary/output" "$root/scripts/macos/package.sh") >/dev/null 2>&1; then
  echo 'Packaging accepted missing product version and build number' >&2
  exit 1
fi
[[ ! -e "$temporary/output" ]] || { echo 'Invalid input created build output' >&2; exit 1; }

if MACOS_VERSION=0.1.92 MACOS_BUILD_NUMBER=0 MACOS_OUTPUT_DIR="$temporary/output" \
  "$root/scripts/macos/package.sh" >/dev/null 2>&1; then
  echo 'Packaging accepted build number zero' >&2
  exit 1
fi
[[ ! -e "$temporary/output" ]] || { echo 'Invalid build created build output' >&2; exit 1; }

printf 'Mac package version input tests passed\n'
