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
