#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version_script="$repository_root/scripts/ci/product-release-version.sh"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

origin="$temporary_directory/origin.git"
worktree="$temporary_directory/worktree"

git init --bare --initial-branch=main "$origin" >/dev/null
git clone --quiet "$origin" "$worktree"
git -C "$worktree" config user.name "Version policy test"
git -C "$worktree" config user.email "version-policy@example.invalid"
mkdir -p "$worktree/apps/ios/TalentSignal.xcodeproj"
printf '%s\n' 'MARKETING_VERSION = 0.1.0;' \
  > "$worktree/apps/ios/TalentSignal.xcodeproj/project.pbxproj"
git -C "$worktree" add apps/ios/TalentSignal.xcodeproj/project.pbxproj
git -C "$worktree" commit --quiet -m "Initial iOS version"
git -C "$worktree" push --quiet origin main

assert_output_contains() {
  local expected="$1"
  shift
  local output
  output="$(cd "$worktree" && "$version_script" "$@")"
  if ! grep -Fqx "$expected" <<< "$output"; then
    printf 'Expected output line %q, received:\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

assert_fails() {
  if (cd "$worktree" && "$version_script" "$@") >/dev/null 2>&1; then
    printf 'Expected version command to fail: %s\n' "$*" >&2
    exit 1
  fi
}

assert_output_contains "Release version: 0.1.1"

git -C "$worktree" tag -a v0.1.1 -m "Release v0.1.1"
git -C "$worktree" push --quiet origin v0.1.1
git -C "$worktree" tag -a v0.1.1-rc.1 -m "Ignored prerelease tag"
git -C "$worktree" push --quiet origin v0.1.1-rc.1
assert_output_contains "Release version: 0.1.1"
assert_output_contains "Release version: 0.1.1" "0.1.1"
assert_fails "1.2.3"

printf '%s\n' '// next product revision' >> "$worktree/apps/ios/TalentSignal.xcodeproj/project.pbxproj"
git -C "$worktree" add apps/ios/TalentSignal.xcodeproj/project.pbxproj
git -C "$worktree" commit --quiet -m "Next product revision"
git -C "$worktree" push --quiet origin main
assert_output_contains "Release version: 0.1.2"

assert_output_contains "Release version: 1.2.3" "1.2.3"
assert_fails "0.1.1"
assert_fails "1.2"

git -C "$worktree" tag -a v0.1.2 -m "Release v0.1.2"
git -C "$worktree" tag -a v0.1.3 -m "Duplicate release v0.1.3"
assert_fails

printf 'Product version policy tests passed\n'
