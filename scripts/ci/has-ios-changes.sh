#!/usr/bin/env bash
set -euo pipefail

base_sha="${1:-}"
head_sha="${2:-HEAD}"
path_set="${3:-}"

paths=(
  apps/ios
  fastlane
  scripts/ios
  Gemfile
  Gemfile.lock
)

case "$path_set" in
  "") ;;
  --ci-files|--pr-files)
    # Simulator checks do not exercise signing, upload, or Ruby dependencies.
    # Keep those inputs in the publication classifier below instead.
    paths=(
      apps/ios
      scripts/ios
      .github/workflows/ci.yml
      scripts/ci/has-ios-changes.sh
      scripts/ci/ios-ci-efficiency.test.mjs
      scripts/ci/ios-release-policy.test.mjs
      scripts/ci/testflight-release-receipt.cjs
      ':(exclude,glob)**/*.md'
    )
    ;;
  --release-files)
    paths+=(
      .github/workflows/release-ios.yml
      scripts/ci/has-ios-changes.sh
      scripts/ci/product-release-version.sh
      scripts/ci/ensure-release-assets.sh
      scripts/ci/testflight-release-receipt.cjs
      scripts/ci/wait-for-testflight-build.mjs
    )
    ;;
  *)
    printf 'Unknown path set: %s\n' "$path_set" >&2
    exit 2
    ;;
esac

if [ -z "$base_sha" ] ||
  ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null ||
  ! git cat-file -e "${head_sha}^{commit}" 2>/dev/null; then
  printf 'true\n'
  exit 0
fi

if [ "$path_set" = "--pr-files" ]; then
  # Compare only the PR's changes, not unrelated changes added to its base.
  if ! base_sha="$(git merge-base "$base_sha" "$head_sha")"; then
    printf 'true\n'
    exit 0
  fi
fi

if git diff --quiet "$base_sha" "$head_sha" -- "${paths[@]}"; then
  printf 'false\n'
else
  printf 'true\n'
fi
