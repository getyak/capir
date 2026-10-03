#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
mkdir -p "$temporary/bin" "$temporary/assets" "$temporary/remote"
git init --bare --initial-branch=main "$temporary/origin.git" >/dev/null
git clone --quiet "$temporary/origin.git" "$temporary/worktree"
git -C "$temporary/worktree" config user.name 'Mac release test'
git -C "$temporary/worktree" config user.email 'mac-release@example.invalid'
printf 'verified code\n' > "$temporary/worktree/source.txt"
git -C "$temporary/worktree" add source.txt
git -C "$temporary/worktree" commit --quiet -m 'Verified code'
git -C "$temporary/worktree" push --quiet origin main

cat > "$temporary/bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'api repos/getyak/talent-signal/commits/main') printf '%s\n' "$FAKE_MAIN_SHA" ;;
  'release view')
    [[ -f "$FAKE_RELEASE_ASSETS/release-created" ]] || exit 1
    if [[ " $* " == *' --json author '* ]]; then
      printf 'github-actions[bot]\n'
    elif [[ " $* " == *' --json body '* ]]; then
      cat "$FAKE_RELEASE_ASSETS/release-body"
    elif [[ " $* " == *' --json assets '* ]]; then
      for file in "$FAKE_RELEASE_ASSETS"/*; do
        if [[ -f "$file" && "$(basename "$file")" != release-created && "$(basename "$file")" != release-body ]]; then
          basename "$file"
        fi
      done
    fi
    ;;
  'release create')
    tag="$3"; shift 3
    git -C "$FAKE_WORKTREE" tag -a "$tag" -m "Release $tag"
    git -C "$FAKE_WORKTREE" push --quiet origin "$tag"
    touch "$FAKE_RELEASE_ASSETS/release-created"
    while [[ "$#" -gt 0 && "$1" != --* ]]; do
      cp "$1" "$FAKE_RELEASE_ASSETS/$(basename "$1")"
      shift
    done
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --notes) printf '%s\n' "$2" > "$FAKE_RELEASE_ASSETS/release-body"; shift 2 ;;
        *) shift ;;
      esac
    done
    ;;
  'release edit')
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --notes-file) cp "$2" "$FAKE_RELEASE_ASSETS/release-body"; shift 2 ;;
        *) shift ;;
      esac
    done
    ;;
  'release upload')
    [[ ! -e "$FAKE_RELEASE_ASSETS/$(basename "$4")" ]] || exit 1
    cp "$4" "$FAKE_RELEASE_ASSETS/$(basename "$4")"
    ;;
  'release download')
    name=''; destination=''; shift 3
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --pattern) name="$2"; shift 2 ;;
        --dir) destination="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cp "$FAKE_RELEASE_ASSETS/$name" "$destination/$name"
    ;;
  *) echo "Unexpected gh command: $*" >&2; exit 1 ;;
esac
FAKE_GH
chmod +x "$temporary/bin/gh"

export PATH="$temporary/bin:$PATH"
export FAKE_WORKTREE="$temporary/worktree" FAKE_RELEASE_ASSETS="$temporary/remote"
export FAKE_MAIN_SHA="$(git -C "$temporary/worktree" rev-parse HEAD)"
export GH_TOKEN=synthetic GITHUB_REPOSITORY=getyak/talent-signal
export MACOS_OUTPUT_DIR="$temporary/assets" MACOS_VERSION=0.1.92
export MACOS_BUILD_NUMBER=35 MACOS_RELEASE_MODE=signed RELEASE_TAG=v0.1.92
export RELEASE_SHA="$FAKE_MAIN_SHA" RUNNER_TEMP="$temporary"
base='Talent-Signal-0.1.92-35-macOS-universal-signed'
printf 'signed mac dmg' > "$MACOS_OUTPUT_DIR/$base.dmg"
printf 'signed mac zip' > "$MACOS_OUTPUT_DIR/$base.zip"
(cd "$MACOS_OUTPUT_DIR" && shasum -a 256 "$base.dmg" "$base.zip" > "$base-SHA256SUMS.txt")

if ! (cd "$temporary/worktree" && bash -x "$root/scripts/macos/publish-versioned-release.sh") > "$temporary/first.log" 2>&1; then
  tail -30 "$temporary/first.log" >&2
  exit 1
fi
[[ -f "$FAKE_RELEASE_ASSETS/$base.dmg" ]] || { echo 'Mac release was not published' >&2; exit 1; }
grep -Fq '<!-- talent-signal-macos-distribution -->' "$FAKE_RELEASE_ASSETS/release-body"
printf 'iOS release notes\n' > "$FAKE_RELEASE_ASSETS/release-body"
(cd "$temporary/worktree" && "$root/scripts/macos/publish-versioned-release.sh") >/dev/null
grep -Fq 'iOS release notes' "$FAKE_RELEASE_ASSETS/release-body"
grep -Fq '<!-- talent-signal-macos-distribution -->' "$FAKE_RELEASE_ASSETS/release-body"

export MACOS_BUILD_NUMBER=36
other='Talent-Signal-0.1.92-36-macOS-universal-signed'
printf 'different signed mac dmg' > "$MACOS_OUTPUT_DIR/$other.dmg"
printf 'different signed mac zip' > "$MACOS_OUTPUT_DIR/$other.zip"
(cd "$MACOS_OUTPUT_DIR" && shasum -a 256 "$other.dmg" "$other.zip" > "$other-SHA256SUMS.txt")
if (cd "$temporary/worktree" && "$root/scripts/macos/publish-versioned-release.sh") >/dev/null 2>&1; then
  echo 'A second Mac build was accepted under the same product tag' >&2
  exit 1
fi
export MACOS_BUILD_NUMBER=35

printf 'changed zip' > "$MACOS_OUTPUT_DIR/$base.zip"
(cd "$MACOS_OUTPUT_DIR" && shasum -a 256 "$base.dmg" "$base.zip" > "$base-SHA256SUMS.txt")
if (cd "$temporary/worktree" && "$root/scripts/macos/publish-versioned-release.sh") >/dev/null 2>&1; then
  echo 'A changed published Mac asset was accepted under the same version' >&2
  exit 1
fi
printf 'Shared Mac release publication tests passed\n'
