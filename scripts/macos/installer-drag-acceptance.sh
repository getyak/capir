#!/usr/bin/env bash
# Never install over a user's app. Actual Finder automation runs only on CI's empty Mac.
set -euo pipefail
if [[ "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || \
      "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != macOS ]]; then
  echo 'Finder drag acceptance requires a disposable GitHub-hosted macOS runner.' >&2
  exit 78
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${RUNNER_TEMP:?}"
: "${MACOS_DERIVED_DATA:?}"
: "${MACOS_INSTALLER_DMG:?}"
: "${MACOS_INSTALLER_DRAG_RESULT:?}"
# A normal platform probe keeps test spies off the developer's actual Applications
# folder. Assignment failure is fatal; unreadable state cannot mean "absent".
existing="$(find -H /Applications -maxdepth 1 -name 'Talent Signal.app' -print -quit)"
[[ -z "$existing" ]] || {
  echo 'Refusing to replace an existing Applications destination.' >&2; exit 1;
}
[[ -f "$MACOS_INSTALLER_DMG" && "$MACOS_INSTALLER_DRAG_RESULT" == *.xcresult && \
   ! -e "$MACOS_INSTALLER_DRAG_RESULT" && ! -e "${MACOS_INSTALLER_DRAG_RESULT%.xcresult}-summary.json" ]] || {
  echo 'Expected a real installer and a new evidence path.' >&2; exit 1;
}
python3 - "$RUNNER_TEMP" "$MACOS_INSTALLER_DMG" "$MACOS_INSTALLER_DRAG_RESULT" "$MACOS_DERIVED_DATA" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve(strict=True)
for raw in sys.argv[2:]:
    path = Path(raw).resolve()
    if not path.is_relative_to(root) or path == root:
        raise SystemExit('Installer, evidence and build inputs must belong to runner temp.')
PY
if defaults read com.talentsignal.macos workspace.web.origin >/dev/null 2>&1; then
  echo 'Expected an unconfigured disposable profile; refusing to reset a workspace.' >&2; exit 1
fi
MOUNT="$(mktemp -d "$RUNNER_TEMP/installer-drag-mount.XXXXXX")"
attached=false
cleanup() {
  local status=$?
  if [[ "$attached" == true ]]; then
    if hdiutil detach -quiet "$MOUNT"; then attached=false
    else echo "Could not detach own Finder acceptance mount: $MOUNT" >&2; status=1; fi
  fi
  if [[ "$attached" == false ]]; then rmdir "$MOUNT" 2>/dev/null || true; fi
  exit "$status"
}
trap cleanup EXIT
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$MOUNT" "$MACOS_INSTALLER_DMG"
attached=true
[[ "$(readlink "$MOUNT/Applications")" == /Applications ]] || {
  echo 'The actual installer target must be Applications.' >&2; exit 1;
}
codesign --verify --deep --strict "$MOUNT/Talent Signal.app"
# Finder and the test runner must not inherit signing, provider or GitHub secrets.
env -i PATH="$PATH" HOME="$HOME" USER="${USER:-runner}" TMPDIR="${TMPDIR:-/tmp}" \
  open "$MOUNT"
test_status=0
env -i PATH="$PATH" HOME="$HOME" USER="${USER:-runner}" \
  TMPDIR="${TMPDIR:-/tmp}" DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}" \
  TEST_RUNNER_CAPIR_INSTALLER_DISPOSABLE_HOST=1 \
  TEST_RUNNER_CAPIR_INSTALLER_MOUNT="$MOUNT" \
  xcodebuild -quiet -project "$ROOT/apps/macos/TalentSignalMac.xcodeproj" \
    -scheme TalentSignalMac -destination 'platform=macOS' \
    -derivedDataPath "$MACOS_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO \
    -parallel-testing-enabled NO -resultBundlePath "$MACOS_INSTALLER_DRAG_RESULT" \
    -only-testing:TalentSignalMacUITests/InstallerDragUITests test-without-building || test_status=$?
summary_status=0
if xcrun xcresulttool get test-results summary --path "$MACOS_INSTALLER_DRAG_RESULT" \
  --format json > "${MACOS_INSTALLER_DRAG_RESULT%.xcresult}-summary.json"; then
  python3 "$ROOT/scripts/macos/verify-installer-drag-summary.py" \
    "${MACOS_INSTALLER_DRAG_RESULT%.xcresult}-summary.json" || summary_status=$?
else summary_status=1; fi
[[ "$test_status" == 0 ]] || exit "$test_status"
[[ "$summary_status" == 0 ]] || exit "$summary_status"
codesign --verify --deep --strict '/Applications/Talent Signal.app'
if [[ "${MACOS_RELEASE_MODE:-preview}" == signed ]]; then
  xcrun stapler validate '/Applications/Talent Signal.app'
  spctl --assess --type execute --verbose '/Applications/Talent Signal.app'
fi
