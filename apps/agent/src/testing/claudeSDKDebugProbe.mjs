// Pinned SDK process transport only: synthetic stderr, no CLI/model/network.
import { mkdir, readFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const root = process.argv[2];
const sdkRoot = dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')));
async function contains(path, marker) {
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const child = join(path, entry.name);
    if (entry.isDirectory() ? await contains(child, marker)
      : entry.isFile() && (await readFile(child, 'utf8')).includes(marker)) return true;
  }
  return false;
}
const results = [];
for (const withCallback of [false, true]) {
  const run = join(root, withCallback ? 'with' : 'without');
  await mkdir(run, { recursive: true });
  const ready = join(run, 'ready');
  const marker = `SYNTHETIC_PRIVATE_STDERR_${withCallback ? 'WITH' : 'WITHOUT'}`;
  const code = `process.stderr.write(String.fromCharCode(${[...marker + '\n'].map(char => char.charCodeAt(0)).join(',')}),()=>require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready'));setInterval(()=>{},1000);`;
  const abortController = new AbortController();
  let callbackObserved = false;
  const stream = query({ prompt: 'Synthetic process transport only', options: {
    cwd: run, env: { PATH: process.env.PATH, HOME: run, CLAUDE_CONFIG_DIR: join(run, 'configuration') },
    debugFile: join(run, 'sdk-debug.log'), settingSources: [], abortController,
    pathToClaudeCodeExecutable: join(sdkRoot, 'extractFromBunfs.js'),
    executable: process.execPath, executableArgs: ['-e', code, '--'],
    ...(withCallback ? { stderr() { callbackObserved = true; } } : {}),
  } });
  const consume = (async () => { try { for await (const _frame of stream) {} } catch {} })();
  let childEmitted = false;
  let hostPersistedBeforeCleanup = false;
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(childEmitted = await access(ready).then(() => true, () => false))) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    // Give the SDK's synchronous data listener and debug writer a bounded turn.
    await new Promise(resolve => setTimeout(resolve, 100));
    hostPersistedBeforeCleanup = await contains(process.env.CLAUDE_CONFIG_DIR, marker);
  } finally {
    abortController.abort(); stream.close(); await consume; await stream.return?.();
  }
  results.push({ withCallback, childEmitted, callbackObserved, hostPersistedBeforeCleanup,
    hostPersistedAfterCleanup: await contains(process.env.CLAUDE_CONFIG_DIR, marker) });
}
process.stdout.write(JSON.stringify(results));
