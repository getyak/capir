#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
mkdir "$temporary/bin" "$temporary/remote"
cat > "$temporary/bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail
command="$1 $2"
shift 2
case "$command" in
  'release view')
    for asset in "$FAKE_RELEASE_ASSETS"/*; do
      if [[ -f "$asset" ]]; then basename "$asset"; fi
    done
    ;;
  'release upload')
    tag="$1"; asset="$2"
    cp "$asset" "$FAKE_RELEASE_ASSETS/$(basename "$asset")"
    ;;
  'release download')
    name=''; destination=''
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --pattern) name="$2"; shift 2 ;;
        --dir) destination="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cp "$FAKE_RELEASE_ASSETS/$name" "$destination/$name"
    ;;
  *) echo "Unexpected gh command: $command" >&2; exit 1 ;;
esac
FAKE_GH
chmod +x "$temporary/bin/gh"

export PATH="$temporary/bin:$PATH"
export FAKE_RELEASE_ASSETS="$temporary/remote"
export RELEASE_TAG=v0.1.92 GITHUB_REPOSITORY=getyak/talent-signal GH_TOKEN=synthetic
printf 'first build' > "$temporary/TalentSignal.ipa"
"$root/scripts/ci/ensure-release-assets.sh" "$temporary/TalentSignal.ipa"
"$root/scripts/ci/ensure-release-assets.sh" "$temporary/TalentSignal.ipa"
printf 'changed build' > "$temporary/TalentSignal.ipa"
if "$root/scripts/ci/ensure-release-assets.sh" "$temporary/TalentSignal.ipa" >/dev/null 2>&1; then
  echo 'A published asset was silently replaced' >&2
  exit 1
fi
printf 'Immutable release asset tests passed\n'
