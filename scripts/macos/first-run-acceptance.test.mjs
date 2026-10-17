import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, chmod, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// This boundary is behavioral: the helper must reject the user's machine before
// it can change a global preference or start another native process.
test('first-run acceptance refuses local/self-hosted execution before side effects', async () => {
  const root = await mkdtemp(path.join(process.env.MACOS_INSTALLER_TEST_ROOT ?? tmpdir(), 'first-run-guard.'));
  try {
    const bin = path.join(root, 'bin'); await mkdir(bin);
    const calls = path.join(root, 'unexpected-calls');
    for (const name of ['defaults', 'xcodebuild', 'xcrun']) {
      const file = path.join(bin, name);
      await writeFile(file, '#!/bin/bash\nprintf "%s\\n" "$0" >> "$GET48_GUARD_CALLS"\nexit 91\n');
      await chmod(file, 0o755);
    }
    for (const environment of [{}, {CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'macOS'}]) {
      const result = spawnSync('/bin/bash', ['scripts/macos/first-run-acceptance.sh'], {
        env: {...environment, PATH: `${bin}:/usr/bin:/bin`, HOME: root, RUNNER_TEMP: root, GET48_GUARD_CALLS: calls}, encoding: 'utf8',
      });
      assert.equal(result.status, 78, result.stderr);
      assert.match(result.stderr, /disposable GitHub-hosted macOS/);
    }
    await assert.rejects(readFile(calls), {code: 'ENOENT'});
  } finally { await rm(root, {recursive: true, force: true}); }
});

// All platform commands are synthetic spies. A failing XCTest invocation must
// still leave a readable summary, preserve its exit code and restore the setting.
test('first-run acceptance exports failed evidence and keeps strict result/cleanup gates', async () => {
  const root = await mkdtemp(path.join(process.env.MACOS_INSTALLER_TEST_ROOT ?? tmpdir(), 'first-run-results.'));
  try {
    const bin = path.join(root, 'bin'); await mkdir(bin);
    const scripts = {
      defaults: `#!/bin/bash
state="${root}/keyboard-setting"
case "$1" in
  read) [[ "$2" == -g && -f "$state" ]] && cat "$state" ;;
  write) printf '%s' "$5" > "$state" ;;
  delete) /bin/rm "$state" ;;
  *) exit 90 ;;
esac
`,
      xcodebuild: `#!/bin/bash
# env -i intentionally strips fixture variables too; use only synthetic files.
/bin/mkdir "${root}/result.xcresult"
exit "$(/bin/cat '${root}/xcode-status')"
`,
      xcrun: `#!/bin/bash
/bin/cat '${root}/summary-fixture.json'
`,
    };
    for (const [name, content] of Object.entries(scripts)) {
      const file = path.join(bin, name);
      await writeFile(file, content); await chmod(file, 0o755);
    }
    const passing = {passedTests: 3, failedTests: 0, skippedTests: 0};
    const cases = [
      {status: 65, summary: {passedTests: 2, failedTests: 1, skippedTests: 0,
        testFailures: [{testIdentifierString: 'keyboard', failureText: 'Destination lost focus'}]}, previous: '1', expected: 65},
      {status: 0, summary: {...passing, passedTests: 2, skippedTests: 1}, previous: undefined, expected: 1},
      {status: 0, summary: 'not JSON', previous: '2', expected: 1},
      {status: 0, summary: passing, previous: undefined, expected: 0},
    ];
    for (const scenario of cases) {
      await rm(path.join(root, 'result.xcresult'), {recursive: true, force: true});
      await writeFile(path.join(root, 'xcode-status'), String(scenario.status));
      await writeFile(path.join(root, 'summary-fixture.json'), typeof scenario.summary === 'string' ? scenario.summary : JSON.stringify(scenario.summary));
      if (scenario.previous === undefined) await rm(path.join(root, 'keyboard-setting'), {force: true});
      else await writeFile(path.join(root, 'keyboard-setting'), scenario.previous);
      const result = spawnSync('/bin/bash', ['scripts/macos/first-run-acceptance.sh'], {
        env: {CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS',
          PATH: `${bin}:${process.env.PATH}`, HOME: root, USER: 'synthetic-runner', TMPDIR: root, DEVELOPER_DIR: root,
          MACOS_DERIVED_DATA: root, MACOS_FIRST_RUN_RESULT: path.join(root, 'result.xcresult')}, encoding: 'utf8',
      });
      assert.equal(result.status, scenario.expected, result.stdout + result.stderr);
      const summary = await readFile(path.join(root, 'result-summary.json'), 'utf8');
      if (typeof scenario.summary !== 'string') assert.deepEqual(JSON.parse(summary), scenario.summary);
      if (scenario.status === 65) assert.match(result.stdout, /keyboard Destination lost focus/, result.stderr);
      if (scenario.previous === undefined) await assert.rejects(readFile(path.join(root, 'keyboard-setting')), {code: 'ENOENT'});
      else assert.equal(await readFile(path.join(root, 'keyboard-setting'), 'utf8'), scenario.previous);
    }
  } finally { await rm(root, {recursive: true, force: true}); }
});
