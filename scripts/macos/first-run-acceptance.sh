#!/usr/bin/env bash
# Native acceptance belongs on an empty disposable Mac, never the user's profile.
set -euo pipefail
if [[ "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || \
      "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != macOS ]]; then
  echo 'First-run acceptance requires a disposable GitHub-hosted macOS runner.' >&2
  exit 78
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MACOS_DERIVED_DATA:?Use the native check build-for-testing directory}"
: "${MACOS_FIRST_RUN_RESULT:?Use a new runner-temp result bundle}"
[[ ! -e "$MACOS_FIRST_RUN_RESULT" ]] || { echo 'Refusing to overwrite UI evidence' >&2; exit 1; }
if defaults read com.talentsignal.macos workspace.web.origin >/dev/null 2>&1; then
  echo 'Expected an unconfigured disposable profile; refusing to reset a workspace.' >&2
  exit 1
fi
had_keyboard=false
if previous_keyboard="$(defaults read -g AppleKeyboardUIMode 2>/dev/null)"; then had_keyboard=true; fi
cleanup() {
  local status=$?
  if [[ "$had_keyboard" == true ]]; then
    defaults write -g AppleKeyboardUIMode -int "$previous_keyboard" || status=1
    [[ "$(defaults read -g AppleKeyboardUIMode)" == "$previous_keyboard" ]] || status=1
  else
    defaults delete -g AppleKeyboardUIMode >/dev/null || status=1
    if defaults read -g AppleKeyboardUIMode >/dev/null 2>&1; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
defaults write -g AppleKeyboardUIMode -int 3
# Do not pass release/signing/provider credentials to the test runner or app.
env -i PATH="$PATH" HOME="$HOME" USER="${USER:-runner}" \
  TMPDIR="${TMPDIR:-/tmp}" DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}" \
  TEST_RUNNER_CAPIR_FIRST_RUN_APP_PATH="${MACOS_FIRST_RUN_APP_PATH:-}" \
  TEST_RUNNER_CAPIR_FIRST_RUN_DISPOSABLE_HOST=1 \
  xcodebuild -quiet -project "$ROOT/apps/macos/TalentSignalMac.xcodeproj" \
    -scheme TalentSignalMac -destination 'platform=macOS' \
    -derivedDataPath "$MACOS_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO \
    -parallel-testing-enabled NO \
    -resultBundlePath "$MACOS_FIRST_RUN_RESULT" \
    -only-testing:TalentSignalMacUITests/FirstRunExperienceUITests test-without-building
xcrun xcresulttool get test-results summary --path "$MACOS_FIRST_RUN_RESULT" \
  --format json > "${MACOS_FIRST_RUN_RESULT%.xcresult}-summary.json"
python3 - "${MACOS_FIRST_RUN_RESULT%.xcresult}-summary.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    result = json.load(source)
if result.get('passedTests') != 3 or result.get('failedTests') != 0 or result.get('skippedTests') != 0:
    raise SystemExit('Expected all three native first-run tests, with zero failures or skips.')
print('Native first-run acceptance: 3 passed, 0 failed, 0 skipped.')
PY
