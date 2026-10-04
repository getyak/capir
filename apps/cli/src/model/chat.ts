import { createInterface } from 'node:readline';
import { CapirCliError } from '../errors.js';
import { generate, type RequestOptions } from './provider.js';
import { sanitize, SafeText, writeOutput, OutputAborted } from './output.js';
import { LIMIT, fail, type Message, type SelectedProfile } from './types.js';
/** A bounded queue is necessary: readline.pause() alone does not stop already emitted pasted lines. */
export async function runChat(selected: SelectedProfile, key: string, options: RequestOptions, timeoutSeconds: number, signal: AbortSignal, cancel: () => void): Promise<number> {
  const history: Message[] = [];
  let historyBytes = 0;
  const queue: string[] = [];
  let queuedBytes = 0;
  let ended = false;
  let queueFailure: CapirCliError | undefined;
  let wake: (() => void) | undefined;
  let lineBytes = 0;
  const rawGuard = (chunk: Buffer | string) => {
    for (const c of Buffer.from(chunk)) {
      if (c === 10 || c === 13)
        lineBytes = 0;
      else if (++lineBytes > LIMIT.input) {
        queueFailure = new CapirCliError('CAPIR_MODEL_INPUT_LIMIT', 2, 'Chat input line exceeds 128 KiB.');
        ended = true;
        rl.close();
        wake?.();
        break;
      }
    }
  };
  process.stdin.on('data', rawGuard);
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true, historySize: 0, crlfDelay: Infinity });
  const abort = () => { ended = true; rl.close(); wake?.(); };
  rl.on('line', line => { const bytes = Buffer.byteLength(line); if (queue.length >= 64 || queuedBytes + bytes > LIMIT.input) {
    queueFailure = new CapirCliError('CAPIR_MODEL_INPUT_LIMIT', 2, 'Pending chat input exceeds its budget; restart with fewer pasted lines.');
    ended = true;
    rl.close();
  }
  else {
    queue.push(line);
    queuedBytes += bytes;
  } wake?.(); });
  rl.once('close', () => { ended = true; wake?.(); });
  rl.on('SIGINT', cancel);
  signal.addEventListener('abort', abort, { once: true });
  const notice = (text: string) => writeOutput(sanitize(text, key) + '\n', signal, process.stderr);
  const prompt = () => writeOutput('capir> ', signal, process.stderr);
  try {
    await notice(`Chat: ${selected.name} / ${options.model}. /help /model /reset /exit. History stays in memory.`);
    await prompt();
    while (true) {
      signal.throwIfAborted();
      if (queueFailure)
        throw queueFailure;
      if (!queue.length) {
        if (ended)
          return 0;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
        continue;
      }
      const input = queue.shift()!;
      queuedBytes -= Buffer.byteLength(input);
      if (input === '/exit')
        return 0;
      if (input === '/reset') {
        history.length = 0;
        historyBytes = 0;
        await notice('Conversation reset.');
        await prompt();
        continue;
      }
      if (input === '/model') {
        await notice(`Profile ${selected.name}; provider ${selected.profile.provider}; model ${options.model}.`);
        await prompt();
        continue;
      }
      if (input === '/help') {
        await notice('/reset clears history; /model displays configuration; /exit closes. Failed turns are never saved or retried.');
        await prompt();
        continue;
      }
      if (!input.trim()) {
        await prompt();
        continue;
      }
      if (input.startsWith('/')) {
        await notice('Unknown chat command; use /help.');
        await prompt();
        continue;
      }
      const inputBytes = Buffer.byteLength(input) + Buffer.byteLength(options.system);
      if (inputBytes > LIMIT.input || history.length / 2 >= LIMIT.turns || historyBytes + inputBytes >= LIMIT.context) {
        await notice('CAPIR_MODEL_CONTEXT_LIMIT: Context budget reached; use /reset or send less text.');
        await prompt();
        continue;
      }
      rl.pause();
      // Keep raw terminal bytes readable so Ctrl-C can abort an in-flight turn.
      // readline may still emit pasted lines; the bounded queue serializes them.
      process.stdin.resume();
      const turn = new AbortController();
      const timer = setTimeout(() => turn.abort(new CapirCliError('CAPIR_MODEL_TIMEOUT', 3, 'Request deadline exceeded; no automatic retry.')), timeoutSeconds * 1000);
      const combined = AbortSignal.any([signal, turn.signal]);
      const safe = new SafeText(key);
      let answer = '';
      const textLimit = Math.min(LIMIT.text, LIMIT.context - historyBytes - inputBytes);
      let answerBytes = 0;
      const emit = async (text: string) => { const clean = safe.push(text); answerBytes += Buffer.byteLength(clean); if (answerBytes > textLimit)
        fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Sanitized response exceeds the context budget; turn not saved.', 5); answer += clean; if (options.stream && clean)
        await writeOutput(clean, combined); };
      try {
        await generate(selected.profile, key, { ...options, textLimit: Math.min(LIMIT.text, LIMIT.context - historyBytes - inputBytes) }, [...history, { role: 'user', content: input }], emit, combined);
        const tail = safe.finish();
        answerBytes += Buffer.byteLength(tail);
        if (answerBytes > textLimit)
          fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Sanitized response exceeds the context budget; turn not saved.', 5);
        answer += tail;
        if (options.stream) {
          if (tail)
            await writeOutput(tail, combined);
        }
        else
          await writeOutput(answer, combined);
        if (!answer.endsWith('\n'))
          await writeOutput('\n', combined);
        history.push({ role: 'user', content: input }, { role: 'assistant', content: answer });
        historyBytes += Buffer.byteLength(input) + Buffer.byteLength(answer);
      }
      catch (error) {
        if (signal.aborted)
          throw signal.reason;
        if (error instanceof OutputAborted)
          throw error;
        if (process.stdout.destroyed)
          throw combined.reason ?? error;
        const cause = combined.aborted ? combined.reason : error;
        const failure = cause instanceof CapirCliError ? cause : new CapirCliError('CAPIR_MODEL_TRANSPORT', 3, 'Model request failed; no automatic retry.');
        let tail = safe.finish();
        if (Buffer.byteLength(answer) + Buffer.byteLength(tail) > textLimit)
          tail = '';
        answer += tail;
        if (options.stream) {
          if (tail)
            await writeOutput(tail, signal);
          if (answer && !answer.endsWith('\n'))
            await writeOutput('\n', signal);
        }
        await notice(`${failure.code}: ${failure.message}${answer ? ' Partial response; turn not saved.' : ''}`);
        if (failure.exitCode === 4 || failure.exitCode === 130)
          return failure.exitCode;
      }
      finally {
        clearTimeout(timer);
        rl.resume();
      }
      await prompt();
    }
  }
  finally {
    signal.removeEventListener('abort', abort);
    process.stdin.off('data', rawGuard);
    rl.off('SIGINT', cancel);
    rl.close();
    process.stdin.pause();
  }
}
