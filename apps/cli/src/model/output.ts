/** Remove terminal controls before exact-secret matching, including cross-chunk sequences. */
export class SafeText {
  private state: 'text' | 'esc' | 'csi' | 'osc' | 'osc-esc' = 'text';
  private pending = '';
  constructor(private readonly key: string) { }
  push(text: string, final = false): string {
    for (const c of text) {
      if (this.state === 'osc') {
        if (c === '\x07' || c === '\x9c')
          this.state = 'text';
        else if (c === '\x1b')
          this.state = 'osc-esc';
        continue;
      }
      if (this.state === 'osc-esc') {
        this.state = c === '\\' ? 'text' : 'osc';
        continue;
      }
      if (this.state === 'csi') {
        if (c >= '@' && c <= '~')
          this.state = 'text';
        continue;
      }
      if (this.state === 'esc') {
        this.state = c === '[' ? 'csi' : c === ']' || c === 'P' || c === '^' || c === '_' || c === 'X' ? 'osc' : c >= ' ' && c <= '/' ? 'esc' : 'text';
        continue;
      }
      if (c === '\x1b') {
        this.state = 'esc';
        continue;
      }
      if (c === '\x9b') {
        this.state = 'csi';
        continue;
      }
      if (['\x9d', '\x90', '\x98', '\x9e', '\x9f'].includes(c)) {
        this.state = 'osc';
        continue;
      }
      const code = c.codePointAt(0)!;
      if ((code < 32 && c !== '\n' && c !== '\t') || (code >= 127 && code <= 159))
        continue;
      this.pending += c;
    }
    let out = '';
    while (this.pending.length && (final || this.pending.length >= Math.max(1, this.key.length))) {
      if (this.key && this.pending.startsWith(this.key)) {
        out += '[REDACTED]';
        this.pending = this.pending.slice(this.key.length);
      }
      else {
        const width = this.pending.codePointAt(0)! > 0xffff ? 2 : 1;
        out += this.pending.slice(0, width);
        this.pending = this.pending.slice(width);
      }
    }
    return out;
  }
  finish(): string { return this.push('', true); }
}
export function sanitize(text: string, key = ''): string { const safe = new SafeText(key); return safe.push(text) + safe.finish(); }
export class OutputAborted extends Error {
  constructor(readonly reason: unknown) { super('Output deadline/cancellation interrupted a pending write.'); }
}
export function writeOutput(text: string, signal: AbortSignal, stream: NodeJS.WriteStream = process.stdout): Promise<void> {
  if (signal.aborted)
    return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); stream.destroy(); stream.unref(); reject(new OutputAborted(signal.reason)); };
    signal.addEventListener('abort', abort, { once: true });
    stream.write(text, error => { signal.removeEventListener('abort', abort); if (error)
      reject(error);
    else
      resolve(); });
  });
}
