#!/usr/bin/env bash
set -euo pipefail

version_override="${1:-}"

tag_exists() {
  local tag="$1"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 ||
    git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1
}

git fetch --tags --force origin

# iOS and macOS may publish independently from the same verified commit. Reuse
# one product tag for that commit even when the other platform published first.
target_sha="$(git rev-parse HEAD)"
same_sha_tag=""
while IFS= read -r candidate; do
  [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  if [[ "$(git rev-list -n 1 "$candidate")" == "$target_sha" ]]; then
    if [[ -n "$same_sha_tag" ]]; then
      printf '::error::Multiple product tags point at this commit: %s and %s\n' "$same_sha_tag" "$candidate" >&2
      exit 1
    fi
    same_sha_tag="$candidate"
  fi
done < <(git tag --list 'v*' --sort=-v:refname)

if [ -n "$version_override" ]; then
  if [[ ! "$version_override" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '::error::version_override must use semantic version format such as 0.2.0\n' >&2
    exit 1
  fi

  next_version="$version_override"
  release_tag="v$next_version"
  if [[ -n "$same_sha_tag" && "$same_sha_tag" != "$release_tag" ]]; then
    printf '::error::This commit already has product tag %s\n' "$same_sha_tag" >&2
    exit 1
  fi
  if tag_exists "$release_tag" && [[ "$same_sha_tag" != "$release_tag" ]]; then
    printf '::error::Tag %s belongs to another commit\n' "$release_tag" >&2
    exit 1
  fi
elif [[ -n "$same_sha_tag" ]]; then
  release_tag="$same_sha_tag"
  next_version="${same_sha_tag#v}"
else
  latest_tag="$(git tag --list 'v*' --sort=-v:refname |
    awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ && !found {print; found=1}')"
  if [ -n "$latest_tag" ]; then
    base_version="${latest_tag#v}"
  else
    base_version="$(
      sed -n -E 's/.*MARKETING_VERSION = ([^;]+);.*/\1/p' \
        apps/ios/TalentSignal.xcodeproj/project.pbxproj |
        head -n 1 |
        tr -d ' '
    )"
  fi

  if [[ "$base_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    major="${BASH_REMATCH[1]}"
    minor="${BASH_REMATCH[2]}"
    patch="${BASH_REMATCH[3]}"
  elif [[ "$base_version" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
    major="${BASH_REMATCH[1]}"
    minor="${BASH_REMATCH[2]}"
    patch=0
  else
    printf '::error::Unable to derive a semantic version from %s\n' "$base_version" >&2
    exit 1
  fi

  for offset in $(seq 1 50); do
    next_version="$major.$minor.$((patch + offset))"
    release_tag="v$next_version"
    if ! tag_exists "$release_tag"; then
      break
    fi
    unset next_version release_tag
  done

  if [ -z "${next_version:-}" ]; then
    printf '::error::Unable to find an unused patch version after 50 attempts\n' >&2
    exit 1
  fi
fi

printf 'Release version: %s\n' "$next_version"
printf 'Release tag: %s\n' "$release_tag"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'release_version=%s\n' "$next_version" >> "$GITHUB_OUTPUT"
  printf 'release_tag=%s\n' "$release_tag" >> "$GITHUB_OUTPUT"
fi
