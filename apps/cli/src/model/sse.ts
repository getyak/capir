import { fail, LIMIT } from './types.js';
export interface ServerEvent {
  event: string;
  data: string;
}
/** CR and LF are handled independently; a CR dispatches its line and suppresses one following LF. EOF never dispatches a pending event. */
export async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let data: string[] = [];
  let name = '';
  let skipLF = false;
  let total = 0;
  let eventBytes = 0;
  let lineBytes = 0;
  const complete = (): ServerEvent | null => {
    if (line === '') {
      const result = data.length ? { event: name || 'message', data: data.join('\n') } : null;
      data = [];
      name = '';
      eventBytes = 0;
      return result;
    }
    if (line.startsWith(':'))
      return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' '))
      value = value.slice(1);
    if (field === 'data')
      data.push(value);
    else if (field === 'event')
      name = value;
    return null;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const read = await reader.read();
      if (read.done) {
        decoder.decode();
        return;
      }
      total += read.value.length;
      if (total > LIMIT.body)
        fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Received generation body exceeds 8 MiB.', 5);
      let text: string;
      try {
        text = decoder.decode(read.value, { stream: true });
      }
      catch {
        fail('CAPIR_MODEL_PROTOCOL', 'Provider returned invalid UTF-8.', 3);
      }
      for (const c of text) {
        if (c === '\n' && skipLF) {
          skipLF = false;
          continue;
        }
        skipLF = false;
        if (c === '\r' || c === '\n') {
          const evt = complete();
          line = '';
          lineBytes = 0;
          skipLF = c === '\r';
          if (evt)
            yield evt;
        }
        else {
          const bytes = Buffer.byteLength(c);
          lineBytes += bytes;
          eventBytes += bytes;
          if (lineBytes > LIMIT.event || eventBytes > LIMIT.event)
            fail('CAPIR_MODEL_PROTOCOL', 'Provider SSE event exceeds 256 KiB.', 3);
          line += c;
        }
      }
    }
  }
  finally {
    await reader.cancel().catch(() => { });
    reader.releaseLock();
  }
}
