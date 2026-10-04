import { fail } from './types.js';
export function readInput(signal: AbortSignal, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    const cleanup = () => { process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', error); signal.removeEventListener('abort', abort); process.stdin.pause(); };
    const error = (e: unknown) => { cleanup(); reject(e); };
    const abort = () => { cleanup(); process.stdin.destroy(); reject(signal.reason); };
    const data = (chunk: Buffer) => { try {
      bytes += chunk.length;
      if (bytes > limit)
        fail('CAPIR_MODEL_INPUT_LIMIT', 'Input exceeds 128 KiB; send less text.');
      text += decoder.decode(chunk, { stream: true });
    }
    catch {
      error(Object.assign(new Error('Input must be valid UTF-8 and within 128 KiB.'), { input: true }));
      process.stdin.destroy();
    } };
    const end = () => { try {
      text += decoder.decode();
      cleanup();
      resolve(text);
    }
    catch {
      error(Object.assign(new Error('Input must be valid UTF-8.'), { input: true }));
    } };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    process.stdin.on('data', data);
    process.stdin.once('end', end);
    process.stdin.once('error', error);
    process.stdin.resume();
  });
}
