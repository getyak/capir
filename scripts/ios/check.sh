#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_path="$repository_root/apps/ios/TalentSignal.xcodeproj"
scheme_name="TalentSignal"
ios_automation_lock_file="${IOS_AUTOMATION_LOCK_FILE:-/tmp/ios-automation.xcodebuild.lock}"
ios_automation_lock_timeout="${IOS_AUTOMATION_LOCK_TIMEOUT_SECONDS:-7200}"
ios_automation_lock_owned="false"
ios_backend_url="${TS_IOS_BACKEND_URL:-}"
ios_fixture_database_url=""

# CI chooses the tier explicitly; local verification retains release coverage.
ios_ui_test_scope="${IOS_UI_TEST_SCOPE:-full}"
ios_check_release_build="${IOS_CHECK_RELEASE_BUILD:-true}"
ios_fail_fast="${IOS_FAIL_FAST:-false}"
case "$ios_ui_test_scope" in quick|smoke|full) ;; *)
  echo "IOS_UI_TEST_SCOPE must be quick, smoke or full." >&2; exit 2 ;;
esac
for flag in "$ios_check_release_build" "$ios_fail_fast"; do
  case "$flag" in true|false) ;; *) echo "iOS check flags must be true or false." >&2; exit 2 ;; esac
done
ios_simulator_arch="$(uname -m)"

check_script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# On a developer Mac the reusable session helper owns device selection and the
# machine-wide lock. Routing is decided only by the helper is-owner check, so an
# inconsistent inherited environment can never silently fall back to the
# standalone lock. CI (true/1) and non-Darwin hosts keep the standalone path.
ios_ci="false"
if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
  ios_ci="true"
fi

ios_host_is_darwin="false"
if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
  ios_host_is_darwin="true"
fi

if [ "$ios_ci" != "true" ] && [ -n "${DEV_IOS_SESSION_BIN:-}" ] && [ ! -x "${DEV_IOS_SESSION_BIN}" ]; then
  echo "DEV_IOS_SESSION_BIN is set but not executable: ${DEV_IOS_SESSION_BIN}" >&2
  exit 2
fi

ios_session_helper=""
if [ "$ios_ci" != "true" ] && [ "$ios_host_is_darwin" = "true" ]; then
  if [ -n "${DEV_IOS_SESSION_BIN:-}" ]; then
    ios_session_helper="${DEV_IOS_SESSION_BIN}"
  elif command -v dev-ios-session >/dev/null 2>&1; then
    ios_session_helper="$(command -v dev-ios-session)"
  elif [ -x "${HOME:-}/.local/bin/dev-ios-session" ]; then
    ios_session_helper="${HOME:-}/.local/bin/dev-ios-session"
  fi
fi

ios_session_profile="${DEV_IOS_PROFILE:-primary}"
ios_session_reason="${DEV_IOS_REASON:-}"
ios_session_lock_held="false"

if [ -n "$ios_session_helper" ]; then
  ios_session_status_args=(is-owner --profile "$ios_session_profile")
  if [ -n "$ios_session_reason" ]; then
    ios_session_status_args+=(--reason "$ios_session_reason")
  fi
  if "$ios_session_helper" "${ios_session_status_args[@]}" >/dev/null 2>&1; then
    ios_session_lock_held="true"
  else
    ios_session_run_args=(
      run
      --profile "$ios_session_profile"
      --timeout "$ios_automation_lock_timeout"
    )
    if [ -n "$ios_session_reason" ]; then
      ios_session_run_args+=(--reason "$ios_session_reason")
    fi
    exec "$ios_session_helper" "${ios_session_run_args[@]}" -- "$check_script_path" "$@"
  fi
fi

if [ -n "$ios_backend_url" ]; then
  ios_fixture_database_url="${DATABASE_URL:-}"
  if [ -z "$ios_fixture_database_url" ]; then
    echo "DATABASE_URL is required with TS_IOS_BACKEND_URL so canonical iOS fixtures cannot target an implicit database." >&2
    exit 2
  fi
fi

cd "$repository_root"

acquire_ios_automation_lock() {
  local waited=0
  local waiting_reported="false"
  local owner_pid=""

  if [ "$ios_session_lock_held" = "true" ]; then
    echo "Using the outer dev-ios-session lock owned by pid ${DEV_IOS_SESSION_PID:-unknown}." >&2
    return 0
  fi

  until /usr/bin/shlock -f "$ios_automation_lock_file" -p "$$"; do
    if [ "$waiting_reported" != "true" ]; then
      owner_pid="$(sed -n '1p' "$ios_automation_lock_file" 2>/dev/null || true)"
      echo "Waiting for the active iOS build (pid ${owner_pid:-unknown})..." >&2
      waiting_reported="true"
    fi
    if [ "$waited" -ge "$ios_automation_lock_timeout" ]; then
      echo "Timed out waiting for the machine-wide iOS build lock." >&2
      exit 75
    fi
    sleep 1
    waited=$((waited + 1))
  done

  ios_automation_lock_owned="true"
  export IOS_AUTOMATION_LOCK_HELD="true"
}

release_ios_automation_lock() {
  local current_owner=""
  if [ "$ios_automation_lock_owned" = "true" ]; then
    current_owner="$(sed -n '1p' "$ios_automation_lock_file" 2>/dev/null || true)"
    if [ "$current_owner" = "$$" ]; then
      rm -f -- "$ios_automation_lock_file"
    fi
    ios_automation_lock_owned="false"
  fi
}

ios_derived_data_owned="false"
ios_derived_data="${IOS_DERIVED_DATA_PATH:-}"
if [ -z "$ios_derived_data" ]; then
  ios_derived_data="$(mktemp -d "${TMPDIR:-/tmp}/talent-signal-ios-check.XXXXXX")"
  ios_derived_data_owned="true"
fi

cleanup_ios_derived_data() {
  if [ "$ios_derived_data_owned" = "true" ] &&
    [ -n "$ios_derived_data" ] &&
    [ -d "$ios_derived_data" ]; then
    rm -rf -- "$ios_derived_data"
  fi
  release_ios_automation_lock
  return 0
}
trap cleanup_ios_derived_data EXIT

acquire_ios_automation_lock

python3 "$(dirname "$check_script_path")/test_dev_ios_session.py"

node scripts/ios/check-localization.mjs

ios_build_api_url="${IOS_BUILD_TEST_API_BASE_URL:-https://api.example.invalid}"
ios_build_config="$ios_derived_data/Environment.check.xcconfig"
TALENT_SIGNAL_API_BASE_URL="$ios_build_api_url" \
  node scripts/ios/configure-build-environment.mjs \
  --configuration Release \
  --output "$ios_build_config"
ios_build_api_base64url="$(
  sed -n 's/^TALENT_SIGNAL_API_BASE_URL_BASE64URL = //p' "$ios_build_config"
)"
if [ -z "$ios_build_api_base64url" ]; then
  echo "Generated iOS build environment is missing its encoded API URL." >&2
  exit 2
fi

verify_compiled_environment() {
  local ios_compiled_info_plist="$ios_derived_data/Build/Products/$1-iphonesimulator/TalentSignal.app/Info.plist"
  ios_compiled_api_base64url="$(
    plutil -extract TalentSignalAPIBaseURLBase64URL raw -o - "$ios_compiled_info_plist"
  )"
  if [ "$ios_compiled_api_base64url" != "$ios_build_api_base64url" ]; then
    echo "Compiled iOS Info.plist does not contain the selected API URL." >&2
    exit 2
  fi
  ios_compiled_api_url="$(
    node -e \
      'process.stdout.write(Buffer.from(process.argv[1], "base64url").toString("utf8"))' \
      "$ios_compiled_api_base64url"
  )"
  if [ "$ios_compiled_api_url" != "$ios_build_api_url" ]; then
    echo "Compiled iOS API URL does not match the selected build environment." >&2
    exit 2
  fi
}

if [ "$ios_check_release_build" = "true" ]; then
  echo "iOS stage: Release build ($ios_simulator_arch)"
  xcodebuild \
    -jobs "${IOS_XCODE_JOBS:-4}" \
    -project "$project_path" \
    -scheme "$scheme_name" \
    -configuration Release \
    -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$ios_derived_data" \
    "ARCHS=$ios_simulator_arch" \
    ONLY_ACTIVE_ARCH=YES \
    CODE_SIGNING_ALLOWED=NO \
    "TALENT_SIGNAL_API_BASE_URL_BASE64URL=$ios_build_api_base64url" \
    clean build

  verify_compiled_environment Release
fi

simulator_id="${IOS_SIMULATOR_ID:-}"
if [ -z "$simulator_id" ]; then
  simulator_id="$(
    xcrun simctl list devices available -j |
      ruby -rjson -e '
        devices = JSON.parse(STDIN.read).fetch("devices")
        ios_runtimes = devices.keys.grep(/iOS/).sort.reverse
        phones = ios_runtimes.flat_map { |runtime| devices.fetch(runtime) }
                           .select { |device| device.fetch("name").start_with?("iPhone") }
        # Prefer a numbered modern iPhone so the standalone path matches the
        # local Primary iPhone profile instead of an older compact device.
        phone = phones.find { |device| device.fetch("name").match?(/\AiPhone \d/) } ||
                phones.first
        abort("No available iPhone simulator found") unless phone
        print phone.fetch("udid")
      '
  )"
fi

# A long-lived Simulator can retain wedged accessibility and automation
# services after interrupted UI runs. Reboot it by default so the release gate
# starts from an observable device baseline. Inside a validated local session
# the default is false so a borrowed, prebooted device is never interrupted;
# set IOS_REBOOT_SIMULATOR=true to reboot the chosen device explicitly. This
# only ever affects the selected device, never any other simulator.
ios_default_reboot="true"
if [ "$ios_session_lock_held" = "true" ]; then
  ios_default_reboot="false"
fi
ios_reboot_simulator="${IOS_REBOOT_SIMULATOR:-$ios_default_reboot}"

if [ "$ios_reboot_simulator" = "true" ]; then
  xcrun simctl shutdown "$simulator_id" >/dev/null 2>&1 || true
fi
xcrun simctl boot "$simulator_id" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$simulator_id" -b

# Keep the gate deterministic when a previous manual accessibility audit left
# the shared Simulator at a non-default Dynamic Type size or appearance. Tests
# that exercise AX5 and dark mode pass those settings as launch arguments, so
# this baseline does not weaken their coverage.
if [ "${IOS_PRESERVE_SIMULATOR_UI:-false}" != "true" ]; then
  xcrun simctl ui "$simulator_id" content_size large
  xcrun simctl ui "$simulator_id" appearance light
fi

# Test state must not inherit language, protected persistence, or launch state
# from an interrupted prior run. Preserve the app container only for an
# intentional live-debug session.
if [ "${IOS_PRESERVE_APP_DATA:-false}" != "true" ]; then
  xcrun simctl uninstall "$simulator_id" com.talentsignal.app >/dev/null 2>&1 || true
fi

ios_fixture_server_pid=""
ios_response_loss_proxy_pid=""
ios_text_signal_proxy_pid=""
ios_backend_started="false"
ios_check_project="talent-signal-ios-check-$$"

signal_ios_process_tree() {
  local signal_name="$1"
  local process_id="$2"
  local child_id
  while IFS= read -r child_id; do
    if [ -n "$child_id" ]; then
      signal_ios_process_tree "$signal_name" "$child_id"
    fi
  done < <(pgrep -P "$process_id" 2>/dev/null || true)
  kill "-$signal_name" "$process_id" >/dev/null 2>&1 || true
}

list_ios_process_tree() {
  local process_id="$1"
  local child_id
  while IFS= read -r child_id; do
    if [ -n "$child_id" ]; then
      list_ios_process_tree "$child_id"
    fi
  done < <(pgrep -P "$process_id" 2>/dev/null || true)
  printf '%s\n' "$process_id"
}

stop_ios_helper() {
  local process_id="$1"
  local attempt
  local tree_id
  local all_stopped
  local -a process_tree=()
  [ -n "$process_id" ] || return 0

  while IFS= read -r tree_id; do
    if [ -n "$tree_id" ]; then
      process_tree+=("$tree_id")
    fi
  done < <(list_ios_process_tree "$process_id")
  signal_ios_process_tree TERM "$process_id"
  for ((attempt = 0; attempt < 100; attempt += 1)); do
    all_stopped="true"
    for tree_id in "${process_tree[@]}"; do
      if kill -0 "$tree_id" >/dev/null 2>&1; then
        all_stopped="false"
        break
      fi
    done
    if [ "$all_stopped" = "true" ]; then
      wait "$process_id" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 0.1
  done
  for tree_id in "${process_tree[@]}"; do
    kill -KILL "$tree_id" >/dev/null 2>&1 || true
  done
  wait "$process_id" >/dev/null 2>&1 || true
}

cleanup_ios_helpers() {
  for helper_pid in \
    "$ios_fixture_server_pid" \
    "$ios_response_loss_proxy_pid" \
    "$ios_text_signal_proxy_pid"; do
    stop_ios_helper "$helper_pid"
  done
  if [ "$ios_backend_started" = "true" ]; then
    docker compose \
      --project-directory "$repository_root" \
      -p "$ios_check_project" \
      down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  cleanup_ios_derived_data
}
trap cleanup_ios_helpers EXIT

wait_for_url() {
  local url="$1"
  local attempt
  for ((attempt = 0; attempt < 40; attempt += 1)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

free_loopback_port() {
  ruby -rsocket -e '
    server = TCPServer.new("127.0.0.1", 0)
    print server.addr[1]
    server.close
  '
}

if [ -z "$ios_backend_url" ]; then
  if command -v docker >/dev/null 2>&1; then
    POSTGRES_PORT="$(free_loopback_port)"
    BACKEND_PORT="$(free_loopback_port)"
    export POSTGRES_PORT BACKEND_PORT
    export BACKEND_IMAGE="talent-signal-backend-local:$ios_check_project"
    ios_fixture_database_url="postgresql://${POSTGRES_USER:-talent_signal_local}:${POSTGRES_PASSWORD:-talent_signal_local_only}@127.0.0.1:$POSTGRES_PORT/${POSTGRES_DB:-talent_signal_local}"
    ios_backend_started="true"
    docker compose \
      --project-directory "$repository_root" \
      -p "$ios_check_project" \
      up --build --wait
    ios_backend_url="http://127.0.0.1:$BACKEND_PORT"
  else
    ios_backend_url="http://127.0.0.1:4317"
    echo "Docker is unavailable; backend-dependent iOS journeys will skip." >&2
  fi
fi

ios_response_loss_proxy_port="$(free_loopback_port)"
ios_text_signal_proxy_port="$(free_loopback_port)"
ios_pursuit_fixture_port="$(free_loopback_port)"
export TS_IOS_BACKEND_URL="$ios_backend_url"
export TS_IOS_RESPONSE_LOSS_PROXY_URL="http://127.0.0.1:$ios_response_loss_proxy_port"
export TS_IOS_TEXT_SIGNAL_PROXY_URL="http://127.0.0.1:$ios_text_signal_proxy_port"
export TS_IOS_PURSUIT_FIXTURE_URL="http://127.0.0.1:$ios_pursuit_fixture_port"

if curl --fail --silent --show-error "$ios_backend_url/health/live" >/dev/null 2>&1; then
  # The host-side fixture and proxy entry points import the contracts package
  # through its published dist path. Build it here so a fresh checkout cannot
  # depend on artifacts left behind by another repository check.
  pnpm --silent --filter @talent-signal/contracts build

  if ! curl --fail --silent --show-error \
    "$TS_IOS_PURSUIT_FIXTURE_URL/health/live" >/dev/null 2>&1; then
    if [ -n "$ios_fixture_database_url" ]; then
      API_BASE_URL="$ios_backend_url" \
        DATABASE_URL="$ios_fixture_database_url" \
        IOS_PURSUIT_FIXTURE_PORT="$ios_pursuit_fixture_port" \
        pnpm --silent --filter @talent-signal/backend \
        fixture:ios-pursuit-proposal-server &
      ios_fixture_server_pid="$!"
      wait_for_url "$TS_IOS_PURSUIT_FIXTURE_URL/health/live"
    else
      echo "Canonical iOS fixtures are unavailable without an explicit fixture database." >&2
    fi
  fi
  if ! curl --fail --silent --show-error \
    "$TS_IOS_RESPONSE_LOSS_PROXY_URL/__response_loss_proxy/state" >/dev/null 2>&1; then
    UPSTREAM_BASE_URL="$ios_backend_url" \
      RESPONSE_LOSS_PROXY_PORT="$ios_response_loss_proxy_port" \
      pnpm --silent --filter @talent-signal/backend \
      fixture:response-loss-proxy &
    ios_response_loss_proxy_pid="$!"
    wait_for_url "$TS_IOS_RESPONSE_LOSS_PROXY_URL/__response_loss_proxy/state"
  fi
  if ! curl --fail --silent --show-error \
    "$TS_IOS_TEXT_SIGNAL_PROXY_URL/__text_signal_proxy/state" >/dev/null 2>&1; then
    UPSTREAM_BASE_URL="$ios_backend_url" \
      TEXT_SIGNAL_PROXY_PORT="$ios_text_signal_proxy_port" \
      pnpm --silent --filter @talent-signal/backend \
      fixture:text-signal-proxy &
    ios_text_signal_proxy_pid="$!"
    wait_for_url "$TS_IOS_TEXT_SIGNAL_PROXY_URL/__text_signal_proxy/state"
  fi
  curl --fail --silent --show-error \
    --request POST \
    "$TS_IOS_TEXT_SIGNAL_PROXY_URL/__text_signal_proxy/online" >/dev/null
fi

test_arguments=(
  -jobs "${IOS_XCODE_JOBS:-4}"
  -maximum-concurrent-test-simulator-destinations "${IOS_MAX_CONCURRENT_TEST_SIMULATORS:-1}"
  -project "$project_path"
  -scheme "$scheme_name"
  -destination "platform=iOS Simulator,id=$simulator_id"
  -derivedDataPath "$ios_derived_data"
  -parallel-testing-enabled NO
  "ARCHS=$ios_simulator_arch"
  ONLY_ACTIVE_ARCH=YES
  "TS_IOS_BACKEND_URL=$TS_IOS_BACKEND_URL"
  "TS_IOS_EXPECT_REMOTE_CHAT=${TS_IOS_EXPECT_REMOTE_CHAT:-false}"
  "TS_IOS_RESPONSE_LOSS_PROXY_URL=$TS_IOS_RESPONSE_LOSS_PROXY_URL"
  "TS_IOS_TEXT_SIGNAL_PROXY_URL=$TS_IOS_TEXT_SIGNAL_PROXY_URL"
  "TS_IOS_PURSUIT_FIXTURE_URL=$TS_IOS_PURSUIT_FIXTURE_URL"
  "TALENT_SIGNAL_API_BASE_URL_BASE64URL=$ios_build_api_base64url"
)

if [ -n "${IOS_ONLY_TESTING:-}" ]; then
  IFS=',' read -r -a ios_only_tests <<< "$IOS_ONLY_TESTING"
  for ios_only_test in "${ios_only_tests[@]}"; do
    test_arguments+=("-only-testing:$ios_only_test")
  done
  if [ -n "${RESULT_BUNDLE_PATH:-}" ]; then
    mkdir -p "$(dirname "$RESULT_BUNDLE_PATH")"
    test_arguments+=(-resultBundlePath "$RESULT_BUNDLE_PATH")
  fi
  xcodebuild "${test_arguments[@]}" test
  verify_compiled_environment Debug
  exit 0
fi

# Xcode 26's Simulator runner can be killed after several long UI journeys in
# one process even when those journeys pass independently. Build once, execute
# unit tests together, isolate every UI journey in a fresh runner, then merge
# the native result bundles into one auditable full-suite artifact.
echo "iOS stage: Debug build for testing ($ios_simulator_arch)"
xcodebuild "${test_arguments[@]}" build-for-testing
verify_compiled_environment Debug

ios_result_parts_dir=""
ios_result_parts_owned="false"
if [ -n "${RESULT_BUNDLE_PATH:-}" ]; then
  mkdir -p "$(dirname "$RESULT_BUNDLE_PATH")"
  ios_result_parts_dir="${RESULT_BUNDLE_PATH%.xcresult}.parts"
  if [ -e "$RESULT_BUNDLE_PATH" ] || [ -e "$ios_result_parts_dir" ]; then
    echo "Result bundle output already exists: $RESULT_BUNDLE_PATH" >&2
    exit 2
  fi
  mkdir -p "$ios_result_parts_dir"
else
  ios_result_parts_dir="$(mktemp -d "${TMPDIR:-/tmp}/talent-signal-ios-results.XXXXXX")"
  ios_result_parts_owned="true"
fi

cleanup_ios_result_parts() {
  if [ "$ios_result_parts_owned" = "true" ] &&
    [ -n "$ios_result_parts_dir" ] &&
    [ -d "$ios_result_parts_dir" ]; then
    rm -rf -- "$ios_result_parts_dir"
  fi
}
trap 'cleanup_ios_result_parts; cleanup_ios_helpers' EXIT

declare -a ios_result_parts=()
ios_suite_failed="false"
ios_part_index=0

preserve_ios_results() {
  [ -n "${RESULT_BUNDLE_PATH:-}" ] || return 0
  if [ "${#ios_result_parts[@]}" -eq 1 ]; then
    cp -R "${ios_result_parts[0]}" "$RESULT_BUNDLE_PATH"
  elif [ "${#ios_result_parts[@]}" -gt 1 ]; then
    xcrun xcresulttool merge --output-path "$RESULT_BUNDLE_PATH" "${ios_result_parts[@]}"
  else
    echo "No native test results were produced." >&2
    return 2
  fi
}

is_retryable_simulator_failure() {
  local result_path="$1"
  local selector="$2"
  local attachment_dir=""
  [ -d "$result_path" ] || return 1
  if xcrun xcresulttool get test-results summary \
    --path "$result_path" \
    --format json 2>/dev/null |
    ruby -rjson -e '
      result = JSON.parse(STDIN.read)
      failures = result.fetch("testFailures", [])
      only_failure = failures.length == 1 ? failures.first : {}
      ui_selector = ARGV.fetch(0, "").match(/\ATalentSignalUITests\/[A-Za-z0-9_]+\/(test[A-Za-z0-9_]+)\z/)
      failure_text = only_failure.fetch("failureText", "")
      # Run 40751023321 attempt 2: one selected UI case was refused before
      # app launch. Do not turn generic launch errors or assertions into retries.
      launch_busy = ui_selector &&
        result["totalTestCount"] == 1 && result["failedTests"] == 1 &&
        result["passedTests"] == 0 && result["skippedTests"] == 0 &&
        failures.length == 1 && only_failure["testName"] == ui_selector[1] + "()" &&
        failure_text.start_with?("Failed to get launch progress for <XCUIApplicationImpl: ") &&
        failure_text.include?(" com.talentsignal.app at ") &&
        failure_text.include?(">: Simulator device failed to launch com.talentsignal.app.") &&
        failure_text.include?("The request was denied by service delegate (SBMainWorkspace) for reason: Busy (\"Application failed preflight checks\").")
      bootstrap_failure = result.fetch("passedTests", 0).zero? &&
        result.fetch("skippedTests", 0).zero? &&
        only_failure.fetch("testName", "").include?("UITests-Runner encountered an error") &&
        (
          only_failure.fetch("failureText", "").include?("before establishing connection") ||
          only_failure.fetch("failureText", "").include?("Timed out waiting for AX loaded notification")
        )
      query_timeout = failures.length == 1 &&
        only_failure.fetch("failureText", "").include?("Timed out while evaluating UI query")
      accessibility_audit_timeout = failures.length == 1 &&
        only_failure.fetch("failureText", "").include?("com.apple.xcode.xctest.accessibilityAudit") &&
        only_failure.fetch("failureText", "").include?("Audit failed to complete in time")
      exit((bootstrap_failure || launch_busy || query_timeout || accessibility_audit_timeout) ? 0 : 1)
    ' "$selector"; then
    return 0
  fi

  attachment_dir="$(mktemp -d "${TMPDIR:-/tmp}/talent-signal-ios-infra.XXXXXX")"
  if xcrun xcresulttool export attachments \
      --path "$result_path" \
      --output-path "$attachment_dir" >/dev/null 2>&1; then
    local attachment_path=""
    while IFS= read -r attachment_path; do
      if grep -q '"app_name":"backboardd"' "$attachment_path"; then
        rm -rf -- "$attachment_dir"
        return 0
      fi
    done < <(find "$attachment_dir" -type f -name '*.ips' -print)
  fi
  rm -rf -- "$attachment_dir"
  return 1
}

reboot_simulator_for_retry() {
  if [ "${DEV_IOS_BORROWED:-false}" = "true" ]; then
    echo "Refusing to reboot borrowed simulator ${simulator_id} for retry; leaving the prebooted device untouched." >&2
    return 0
  fi
  if [ "$ios_reboot_simulator" != "true" ]; then
    echo "Simulator reboot for retry is disabled (IOS_REBOOT_SIMULATOR=$ios_reboot_simulator); reusing ${simulator_id}." >&2
    return 0
  fi
  xcrun simctl shutdown "$simulator_id" >/dev/null 2>&1 || true
  xcrun simctl boot "$simulator_id" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$simulator_id" -b
}

run_ios_test_part() {
  local selector="$1"
  local part_label="$2"
  local -a part_arguments=("${test_arguments[@]}" "-only-testing:$selector")
  local part_path=""

  ios_part_index=$((ios_part_index + 1))
  part_path="$ios_result_parts_dir/$(printf '%03d' "$ios_part_index")-$part_label.xcresult"
  part_arguments+=(-resultBundlePath "$part_path")

  echo "iOS stage: $selector"
  if xcodebuild "${part_arguments[@]}" test-without-building; then
    :
  elif is_retryable_simulator_failure "$part_path" "$selector"; then
    local infra_failure_dir="$ios_result_parts_dir/infra-failures"
    mkdir -p "$infra_failure_dir"
    mv "$part_path" "$infra_failure_dir/$(basename "$part_path")"
    echo "Retrying isolated iOS test after a retryable Simulator failure: $selector" >&2
    reboot_simulator_for_retry
    if ! xcodebuild "${part_arguments[@]}" test-without-building; then
      ios_suite_failed="true"
    fi
  else
    ios_suite_failed="true"
  fi
  if [ -d "$part_path" ]; then
    ios_result_parts+=("$part_path")
  else
    echo "Missing native results for $selector" >&2
    ios_suite_failed="true"
  fi
  if [ "$ios_suite_failed" = "true" ] && [ "$ios_fail_fast" = "true" ]; then
    echo "Stopping iOS checks after failure: $selector" >&2
    preserve_ios_results
    exit 65
  fi
}

run_ios_test_part "TalentSignalTests" "unit"

declare -a ios_ui_tests=()
ios_ui_test_list="$(mktemp "${TMPDIR:-/tmp}/talent-signal-ios-tests.XXXXXX")"
ruby -e '
  ARGV.each do |path|
    klass = nil
    File.foreach(path) do |line|
      klass = Regexp.last_match(1) if line =~ /final class ([A-Za-z0-9_]+): XCTestCase/
      if klass && line =~ /^\s+func (test[A-Za-z0-9_]+)\s*\(/
        puts "TalentSignalUITests/" + klass + "/" + Regexp.last_match(1)
      end
    end
  end
' "$repository_root"/apps/ios/UITests/*.swift > "$ios_ui_test_list"
while IFS= read -r ios_ui_test; do
  ios_ui_tests+=("$ios_ui_test")
done < "$ios_ui_test_list"
rm -f -- "$ios_ui_test_list"

if [ "${#ios_ui_tests[@]}" -eq 0 ]; then
  echo "No iOS UI tests were discovered." >&2
  exit 2
fi

if [ "$ios_ui_test_scope" != "full" ]; then
  ios_smoke_test_file="$repository_root/scripts/ios/ci-$ios_ui_test_scope-tests.txt"
  declare -a ios_smoke_tests=()

  while IFS= read -r ios_smoke_test; do
    smoke_test_discovered="false"
    if [ -z "$ios_smoke_test" ] || [[ "$ios_smoke_test" == \#* ]]; then
      continue
    fi
    for ios_ui_test in "${ios_ui_tests[@]}"; do
      if [ "$ios_ui_test" = "$ios_smoke_test" ]; then
        smoke_test_discovered="true"
        break
      fi
    done
    if [ "$smoke_test_discovered" != "true" ]; then
      echo "Configured iOS smoke test was not discovered: $ios_smoke_test" >&2
      exit 2
    fi
    ios_smoke_tests+=("$ios_smoke_test")
  done < "$ios_smoke_test_file"

  if [ "${#ios_smoke_tests[@]}" -eq 0 ]; then
    echo "No iOS smoke tests were configured." >&2
    exit 2
  fi
  ios_ui_tests=("${ios_smoke_tests[@]}")
fi

echo "iOS UI test scope: $ios_ui_test_scope (${#ios_ui_tests[@]} journeys)"

for ios_ui_test in "${ios_ui_tests[@]}"; do
  run_ios_test_part "$ios_ui_test" "${ios_ui_test##*/}"
done

ruby -rjson -e '
  totals = {"total" => 0, "passed" => 0, "failed" => 0, "skipped" => 0}
  ARGV.each do |path|
    summary = JSON.parse(
      IO.popen(
        ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", path, "--format", "json"],
        &:read
      )
    )
    totals["total"] += summary.fetch("totalTestCount", 0)
    totals["passed"] += summary.fetch("passedTests", 0)
    totals["failed"] += summary.fetch("failedTests", 0)
    totals["skipped"] += summary.fetch("skippedTests", 0)
  end
  puts "Isolated iOS UI evidence: total=#{totals.fetch("total")} " \
    "passed=#{totals.fetch("passed")} failed=#{totals.fetch("failed")} " \
    "skipped=#{totals.fetch("skipped")}"
' "${ios_result_parts[@]:1}"

preserve_ios_results

if [ "$ios_suite_failed" = "true" ]; then
  exit 65
fi
