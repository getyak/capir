#!/usr/bin/env bash
# Upload missing assets; never replace bytes already published under a product tag.
set -euo pipefail
: "${RELEASE_TAG:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"
[[ "$#" -gt 0 ]] || { echo 'Expected at least one release asset' >&2; exit 1; }

readback="$(mktemp -d "${RUNNER_TEMP:-/tmp}/release-readback.XXXXXX")"
for asset in "$@"; do
  [[ -f "$asset" ]] || { echo "Missing release asset: $asset" >&2; exit 1; }
  name="$(basename "$asset")"
  published_names="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')"
  if ! grep -Fxq "$name" <<< "$published_names"; then
    gh release upload "$RELEASE_TAG" "$asset" --repo "$GITHUB_REPOSITORY"
  fi
  gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$name" --dir "$readback"
  cmp "$asset" "$readback/$name" || { echo "Published asset differs: $name" >&2; exit 1; }
done
