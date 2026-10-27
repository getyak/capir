#!/usr/bin/env bash
# No product profile or identity: real component AX tests use a separate app.
set -euo pipefail
if [[ "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || \
      "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != macOS ]]; then
  echo 'Native AX acceptance requires a disposable GitHub-hosted macOS runner.' >&2
  exit 78
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MACOS_DERIVED_DATA:?Use the native check DerivedData directory}"
: "${MACOS_NATIVE_AX_RESULT:?Use a new result bundle}"
[[ ! -e "$MACOS_NATIVE_AX_RESULT" ]] || { echo 'Refusing to overwrite AX evidence' >&2; exit 1; }
app="$MACOS_DERIVED_DATA/Build/Products/Debug/TalentSignalAXFixture.app"
status=0
env -i PATH="$PATH" HOME="$HOME" USER="${USER:-runner}" \
  TMPDIR="${TMPDIR:-/tmp}" DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}" \
  TEST_RUNNER_CAPIR_NATIVE_AX_DISPOSABLE_HOST=1 TEST_RUNNER_CAPIR_NATIVE_AX_APP_PATH="$app" \
  xcodebuild -quiet -project "$ROOT/apps/macos/TalentSignalMac.xcodeproj" \
    -scheme TalentSignalAXFixture -destination 'platform=macOS' \
    -derivedDataPath "$MACOS_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO \
    -parallel-testing-enabled NO -resultBundlePath "$MACOS_NATIVE_AX_RESULT" \
    test || status=$?
summary_status=0
if xcrun xcresulttool get test-results summary --path "$MACOS_NATIVE_AX_RESULT" \
  --format json > "${MACOS_NATIVE_AX_RESULT%.xcresult}-summary.json"; then
  python3 - "${MACOS_NATIVE_AX_RESULT%.xcresult}-summary.json" <<'PY' || summary_status=$?
import json,sys
s=json.load(open(sys.argv[1]))
print('Native component AX:',s.get('passedTests'),'passed,',s.get('failedTests'),'failed,',s.get('skippedTests'),'skipped')
for f in s.get('testFailures',[]):print(f.get('testIdentifierString'),f.get('failureText'))
if s.get('passedTests')!=2 or s.get('failedTests')!=0 or s.get('skippedTests')!=0:raise SystemExit(1)
PY
else
  summary_status=1
fi
[[ "$status" == 0 ]] || exit "$status"
exit "$summary_status"
