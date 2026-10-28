import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the real orchestration without starting Xcode or touching a device.
// Only the expensive/platform boundaries are faked; shell selection, failure
// propagation and native-result preservation remain production behavior.
function check(overrides = {}, { selector = "TalentSignalUITests/Smoke/testFirst", failureSummary } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ios-check-execution-"));
  const [, uiClass, uiMethod] = selector.split("/");
  const write = (path, text) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
    return destination;
  };
  const executable = (name, text) => chmodSync(write(`bin/${name}`, `#!/bin/bash\nset -eu\n${text}\n`), 0o755);
  try {
    write("scripts/ios/check.sh", readFileSync(new URL("./check.sh", import.meta.url), "utf8"));
    write("scripts/ios/check-localization.mjs", "");
    copyFileSync(fileURLToPath(new URL("./configure-build-environment.mjs", import.meta.url)), write("scripts/ios/configure-build-environment.mjs", ""));
    write("scripts/ios/ci-smoke-tests.txt", `${selector}\nTalentSignalUITests/${uiClass}/testSecond\n`);
    write("scripts/ios/ci-quick-tests.txt", `${selector}\n`);
    write(`apps/ios/UITests/${uiClass}.swift`, `final class ${uiClass}: XCTestCase {\n  func ${uiMethod}() {}\n  func testSecond() {}\n}\n`);
    executable("python3", "exit 0");
    executable("curl", "exit 7");
    executable("uname", 'if [ "$1" = -m ]; then echo arm64; else echo Darwin; fi');
    executable("plutil", 'node -e \'console.log(Buffer.from("https://api.example.invalid").toString("base64url"))\'');
    executable("xcodebuild", `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
result=""
previous=""
selector=""
for arg in "$@"; do
  if [ "$previous" = -resultBundlePath ]; then result="$arg"; fi
  case "$arg" in -only-testing:*) selector="\${arg#-only-testing:}" ;; esac
  previous="$arg"
done
if [ -n "$result" ]; then mkdir -p "$result"; echo native-evidence > "$result/evidence"; fi
if [ -n "\${TEST_FAIL_SELECTOR:-}" ] && [ "$selector" = "$TEST_FAIL_SELECTOR" ]; then
  if [ "\${TEST_FAIL_ONCE:-false}" != true ] || [ ! -e "$TEST_COMMANDS.failed-once" ]; then
    touch "$TEST_COMMANDS.failed-once" "$result/failed"
    exit 65
  fi
fi
`);
    executable("xcrun", `
if [ "$1 $2" = "xcresulttool merge" ]; then mkdir -p "$4"; echo merged > "$4/evidence"; fi
if [ "$1 $2 $3" = "xcresulttool get test-results" ]; then
  if [ -n "\${TEST_FAILURE_SUMMARY:-}" ] && [ -f "$6/failed" ]; then
    printf '%s\\n' "$TEST_FAILURE_SUMMARY"
  elif [ "\${TEST_RETRYABLE:-false}" = true ]; then
    echo '{"totalTestCount":1,"passedTests":0,"failedTests":1,"skippedTests":0,"testFailures":[{"testName":"UITests-Runner encountered an error","failureText":"before establishing connection"}]}'
  else
    echo '{"totalTestCount":1,"passedTests":1,"failedTests":0,"skippedTests":0,"testFailures":[]}'
  fi
fi
`);
    symlinkSync(process.execPath, join(root, "bin/node"));
    // shlock is an absolute macOS tool in the production script. On Linux CI
    // supply only this platform boundary; the rest of the script is identical.
    if (!existsSync("/usr/bin/shlock")) {
      const path = join(root, "scripts/ios/check.sh");
      writeFileSync(path, readFileSync(path, "utf8").replaceAll("/usr/bin/shlock", "true"));
    }
    const result = spawnSync("/bin/bash", [join(root, "scripts/ios/check.sh")], {
      encoding: "utf8", timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${root}/bin:/usr/bin:/bin`, CI: "true",
        TS_IOS_BACKEND_URL: "http://127.0.0.1:1",
        DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
        IOS_SIMULATOR_ID: "synthetic-device", IOS_AUTOMATION_LOCK_FILE: `${root}/lock`,
        IOS_DERIVED_DATA_PATH: `${root}/derived`, RESULT_BUNDLE_PATH: `${root}/results.xcresult`,
        TEST_COMMANDS: `${root}/commands`, IOS_UI_TEST_SCOPE: "smoke",
        IOS_CHECK_RELEASE_BUILD: "false", IOS_FAIL_FAST: "true",
        TEST_FAILURE_SUMMARY: failureSummary ? JSON.stringify(failureSummary) : "",
        ...overrides,
      },
    });
    return {
      status: result.status, output: result.stdout + result.stderr,
      commands: existsSync(`${root}/commands`) ? readFileSync(`${root}/commands`, "utf8").trim().split("\n") : [],
      preserved: existsSync(`${root}/results.xcresult/evidence`),
      firstFailurePreserved: existsSync(`${root}/results.parts/infra-failures/002-${uiMethod}.xcresult/failed`),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("quick checks compile once for arm64 and execute only selected journeys", () => {
  const result = check({ IOS_UI_TEST_SCOPE: "quick" });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.commands.filter((line) => line.includes("build-for-testing")).length, 1);
  assert.ok(result.commands.every((line) => line.includes("ARCHS=arm64")));
  assert.ok(result.commands.every((line) => !line.includes("clean build")));
  assert.ok(result.commands.some((line) => line.includes("-only-testing:TalentSignalTests")));
  assert.ok(result.commands.some((line) => line.includes("/testFirst")));
  assert.ok(result.commands.every((line) => !line.includes("/testSecond")));
  assert.equal(result.preserved, true);
});

test("real native tiers retain critical image/contact decisions and exclude live acceptance", () => {
  const tiers = Object.fromEntries(["quick", "smoke"].map((scope) => [scope,
    readFileSync(new URL(`./ci-${scope}-tests.txt`, import.meta.url), "utf8")
      .split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
  ]));
  const prefix = "TalentSignalUITests/ConversationExperienceUITests/";
  const critical = [
    "testProcessingStatusBelongsToItsImageAndHasNoEmptyMessageBubble",
    "testQueuedStatusNaturallyExpiresWithoutAnotherObservation",
    "testUnavailableReviewExplainsRecoveryAndNeverOffersSave",
    "testAddingContactKeepsDetailsPendingAndSavingOneKeepsTheOtherPending",
    "testNameCorrectionRequiresFreshReviewAndASecondConfirm",
  ];
  for (const [scope, selectors] of Object.entries(tiers)) {
    assert.equal(selectors.length, new Set(selectors).size, `${scope} must not execute a journey twice`);
    for (const name of critical) assert.ok(selectors.includes(prefix + name), `${scope} omitted critical native decision: ${name}`);
    for (const selector of selectors) {
      const match = /^TalentSignalUITests\/([A-Za-z0-9_]+)\/(test[A-Za-z0-9_]+)$/u.exec(selector);
      assert.ok(match, `Invalid native selector: ${selector}`);
      const [, klass, method] = match;
      assert.ok(!klass.startsWith("Live"), "Live-account/provider tests require explicit opt-in, not automatic CI");
      const source = readFileSync(new URL(`../../apps/ios/UITests/${klass}.swift`, import.meta.url), "utf8");
      assert.match(source, new RegExp(`final class ${klass}: XCTestCase`, "u"));
      assert.match(source, new RegExp(`\\bfunc ${method}\\s*\\(`, "u"), `${scope} configured an undiscoverable method`);
    }
  }
  assert.ok(tiers.smoke.includes(prefix + "testReviewAtAccessibilitySizeInDarkModeRemainsOperable"),
    "Release smoke must exercise the actual contact card at large text size in dark mode");
  const documentation = readFileSync(new URL("../../docs/operations/ci-cd.md", import.meta.url), "utf8");
  assert.ok(documentation.includes(`execute the ${tiers.quick.length} core`), "Document the actual quick scope");
  assert.ok(documentation.includes(`all ${tiers.smoke.length} journeys`), "Document the actual release smoke scope");
});

test("unit failure stops automatic UI work and preserves its native result", () => {
  const result = check({ TEST_FAIL_SELECTOR: "TalentSignalTests" });
  assert.equal(result.status, 65, result.output);
  assert.ok(result.commands.every((line) => !line.includes("TalentSignalUITests/")));
  assert.equal(result.preserved, true);
});

test("UI failure stops later automatic journeys and preserves results", () => {
  const result = check({ TEST_FAIL_SELECTOR: "TalentSignalUITests/Smoke/testFirst" });
  assert.equal(result.status, 65, result.output);
  assert.ok(result.commands.every((line) => !line.includes("/testSecond")));
  assert.equal(result.preserved, true);
});

test("manual diagnostics retain Release verification and collect later results", () => {
  const result = check({ IOS_CHECK_RELEASE_BUILD: "true", IOS_FAIL_FAST: "false", TEST_FAIL_SELECTOR: "TalentSignalTests" });
  assert.equal(result.status, 65, result.output);
  assert.ok(result.commands.some((line) => line.includes("-configuration Release")));
  assert.ok(result.commands.some((line) => line.includes("/testSecond")));
  assert.equal(result.preserved, true);
});


test("automatic checks keep one bounded simulator retry before stopping", () => {
  const result = check({ TEST_RETRYABLE: "true", TEST_FAIL_SELECTOR: "TalentSignalUITests/Smoke/testFirst" });
  assert.equal(result.status, 65, result.output);
  assert.equal(result.commands.filter((line) => line.includes("/testFirst")).length, 2);
  assert.ok(result.commands.every((line) => !line.includes("/testSecond")));
  assert.equal(result.preserved, true);
});

const launchBusySelector = "TalentSignalUITests/CandidateSignalUITests/testGlobalAgentInputOpensRichNewSessionComposer";
// Actual xcresult summary from run 40751023321, attempt 2, artifact 12848923621.
// Only the ephemeral app address and runner's temporary app path are redacted.
const launchBusySummary = {
  totalTestCount: 1, passedTests: 0, failedTests: 1, skippedTests: 0,
  testFailures: [{
    testName: "testGlobalAgentInputOpensRichNewSessionComposer()",
    failureText: "Failed to get launch progress for <XCUIApplicationImpl: APP_INSTANCE com.talentsignal.app at TEST_APP_PATH>: Simulator device failed to launch com.talentsignal.app. The request was denied by service delegate (SBMainWorkspace) for reason: Busy (\"Application failed preflight checks\"). (Underlying Error: The request to open \"com.talentsignal.app\" failed. The request was denied by service delegate (SBMainWorkspace) for reason: Busy (\"Application failed preflight checks\"). (Underlying Error: The operation couldn’t be completed. Application failed preflight checks))",
  }],
};

test("an exact launch-Busy failure retries the same full journey once and retains its first evidence", () => {
  const result = check({ TEST_FAIL_SELECTOR: launchBusySelector, TEST_FAIL_ONCE: "true" },
    { selector: launchBusySelector, failureSummary: launchBusySummary });
  assert.equal(result.status, 0, result.output);
  const attempts = result.commands.filter((line) => line.includes(`-only-testing:${launchBusySelector}`));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1], "Recovery must keep the same selector, arguments and result destination");
  assert.ok(result.commands.some((line) => line.includes("/testSecond")));
  assert.equal(result.firstFailurePreserved, true);
  assert.equal(result.preserved, true);
});

test("a repeated launch-Busy failure still fails after exactly two attempts", () => {
  const result = check({ TEST_FAIL_SELECTOR: launchBusySelector },
    { selector: launchBusySelector, failureSummary: launchBusySummary });
  assert.equal(result.status, 65, result.output);
  assert.equal(result.commands.filter((line) => line.includes(`-only-testing:${launchBusySelector}`)).length, 2);
  assert.ok(result.commands.every((line) => !line.includes("/testSecond")));
  assert.equal(result.firstFailurePreserved, true);
  assert.equal(result.preserved, true);
});

test("launch-Busy recovery rejects assertions, crashes, missing apps and mixed or unbound failures", () => {
  const failure = launchBusySummary.testFailures[0];
  const changedText = (failureText) => ({ ...launchBusySummary, testFailures: [{ ...failure, failureText }] });
  const cases = [
    ["assertion", changedText("XCTAssertTrue failed - Busy (\"Application failed preflight checks\")")],
    ["crash", changedText("Failed to get launch progress for com.talentsignal.app: application crashed with signal SIGABRT")],
    ["NotFound", changedText(failure.failureText.replaceAll("Busy", "NotFound"))],
    ["different app", changedText(failure.failureText.replaceAll("com.talentsignal.app", "com.example.other"))],
    ["different service", changedText(failure.failureText.replaceAll("SBMainWorkspace", "OtherService"))],
    ["different test", { ...launchBusySummary, testFailures: [{ ...failure, testName: "testSecond()" }] }],
    ["multiple failures", { ...launchBusySummary, totalTestCount: 2, failedTests: 2, testFailures: [failure, failure] }],
    ["already passed", { ...launchBusySummary, totalTestCount: 2, passedTests: 1 }],
    ["skipped", { ...launchBusySummary, totalTestCount: 2, skippedTests: 1 }],
    ...["totalTestCount", "passedTests", "failedTests", "skippedTests"].map((key) => {
      const incomplete = { ...launchBusySummary };
      delete incomplete[key];
      return [`missing ${key}`, incomplete];
    }),
  ];
  for (const [name, failureSummary] of cases) {
    const result = check({ TEST_FAIL_SELECTOR: launchBusySelector }, { selector: launchBusySelector, failureSummary });
    assert.equal(result.status, 65, `${name}: ${result.output}`);
    assert.equal(result.commands.filter((line) => line.includes(`-only-testing:${launchBusySelector}`)).length, 1, name);
    assert.ok(result.commands.every((line) => !line.includes("/testSecond")), name);
    assert.equal(result.firstFailurePreserved, false, name);
    assert.equal(result.preserved, true, name);
  }
});

test("unit failure cannot opt into UI launch-Busy recovery", () => {
  const failureSummary = { ...launchBusySummary, testFailures: [{ ...launchBusySummary.testFailures[0], testName: "TalentSignalTests()" }] };
  const result = check({ TEST_FAIL_SELECTOR: "TalentSignalTests" }, { selector: launchBusySelector, failureSummary });
  assert.equal(result.status, 65, result.output);
  assert.equal(result.commands.filter((line) => line.includes("-only-testing:TalentSignalTests")).length, 1);
  assert.ok(result.commands.every((line) => !line.includes("-only-testing:TalentSignalUITests/")));
  assert.equal(result.preserved, true);
});
