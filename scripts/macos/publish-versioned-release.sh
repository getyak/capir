#!/usr/bin/env bash
# Attach one verified Mac build to the product-version release for this commit.
set -euo pipefail

: "${MACOS_OUTPUT_DIR:?}"
: "${MACOS_VERSION:?}"
: "${MACOS_BUILD_NUMBER:?}"
: "${MACOS_RELEASE_MODE:?}"
: "${RELEASE_TAG:?}"
: "${RELEASE_SHA:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

[[ "$RELEASE_TAG" == "v$MACOS_VERSION" ]] || { echo 'Product tag/version mismatch' >&2; exit 1; }
[[ "$MACOS_RELEASE_MODE" == signed || "$MACOS_RELEASE_MODE" == preview ]] || { echo 'Invalid Mac release mode' >&2; exit 1; }

base="Talent-Signal-${MACOS_VERSION}-${MACOS_BUILD_NUMBER}-macOS-universal-${MACOS_RELEASE_MODE}"
assets=("$MACOS_OUTPUT_DIR/$base.dmg" "$MACOS_OUTPUT_DIR/$base.zip" "$MACOS_OUTPUT_DIR/$base-SHA256SUMS.txt")
for asset in "${assets[@]}"; do
  [[ -f "$asset" ]] || { echo "Missing Mac release asset: $asset" >&2; exit 1; }
done
(cd "$MACOS_OUTPUT_DIR" && shasum -a 256 -c "$base-SHA256SUMS.txt")

# A release describes exactly one verified source revision. Never label a stale
# build as current, and never extend a same-named tag pointing elsewhere.
current="$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)"
[[ "$current" == "$RELEASE_SHA" ]] || { echo 'Main moved; a later CI run will publish.' >&2; exit 1; }
verify_tag() {
  git fetch --tags --force origin
  if git rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    [[ "$(git rev-list -n 1 "$RELEASE_TAG")" == "$RELEASE_SHA" ]] || {
      echo "Product tag $RELEASE_TAG belongs to another commit" >&2; exit 1;
    }
  fi
}
verify_tag
marker='<!-- talent-signal-macos-distribution -->'
mac_notes="$marker

macOS ${MACOS_VERSION} (${MACOS_BUILD_NUMBER}) · Universal Apple silicon + Intel · macOS 14+."
if [[ "$MACOS_RELEASE_MODE" == preview ]]; then
  mac_notes="$mac_notes

**Mac preview:** ad-hoc signed and not notarized. Gatekeeper may block this download."
else
  mac_notes="$mac_notes

**Mac download:** Developer ID signed, notarized and stapled."
fi
mac_notes="$mac_notes

Verify the SHA256SUMS asset before installing. [Mac installation guide](https://github.com/$GITHUB_REPOSITORY/blob/$RELEASE_SHA/docs/operations/macos-distribution.md)."

if ! gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  # Another platform may create this release after the initial read. If so,
  # reuse that exact-commit release below; never replace its assets.
  gh release create "$RELEASE_TAG" "${assets[@]}" --repo "$GITHUB_REPOSITORY" \
    --target "$RELEASE_SHA" --title "$RELEASE_TAG" --notes "$mac_notes" \
    --generate-notes --prerelease --latest=false || {
      gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null
    }
fi

verify_tag
git rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null 2>&1 || {
  echo "Published release $RELEASE_TAG has no source tag" >&2; exit 1;
}
owner="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json author --jq .author.login)"
[[ "$owner" == 'github-actions[bot]' ]] || { echo "Release $RELEASE_TAG belongs to $owner" >&2; exit 1; }
published_names="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')"
other_mac_builds="$(grep -E '^Talent-Signal-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+-macOS-universal-(signed|preview)\.dmg$' <<< "$published_names" |
  grep -Fvx "$base.dmg" || true)"
[[ -z "$other_mac_builds" ]] || {
  echo "Release $RELEASE_TAG already contains a different Mac build: $other_mac_builds" >&2
  exit 1
}

"$(dirname "$0")/../ci/ensure-release-assets.sh" "${assets[@]}"

# When iOS created the shared release first, preserve its generated notes and
# add the Mac installation/signing state only after all Mac assets read back.
notes_file="$(mktemp "$MACOS_OUTPUT_DIR/release-notes.XXXXXX")"
gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json body --jq .body > "$notes_file"
if ! grep -Fq "$marker" "$notes_file"; then
  printf '\n\n%s\n' "$mac_notes" >> "$notes_file"
  gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --notes-file "$notes_file"
  served_notes="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json body --jq .body)"
  grep -Fq "$marker" <<< "$served_notes" || {
    echo 'Mac release notes did not read back' >&2; exit 1;
  }
fi

printf 'Verified macOS %s (%s) on shared product release %s.\n' \
  "$MACOS_VERSION" "$MACOS_BUILD_NUMBER" "$RELEASE_TAG"
