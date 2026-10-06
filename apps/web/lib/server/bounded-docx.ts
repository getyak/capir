import "server-only";

import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

const inflate = promisify(inflateRaw);
export const MAX_EXPANDED_DOCX_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 1_024;

function reject(): never {
  throw new Error("DOCX archive exceeds the supported parsing boundary.");
}

/**
 * Preflight the exact ZIP32 entries Mammoth will read, without trusting their
 * advertised expanded sizes. No files are written. Reject encrypted, ZIP64,
 * split and self-extracting archives instead of guessing at their offsets.
 * ZIP layout: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * Bounded async inflate: https://nodejs.org/api/zlib.html#class-options
 */
export async function assertBoundedDocxArchive(bytes: Uint8Array): Promise<void> {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65_557); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50 &&
        offset + 22 + data.readUInt16LE(offset + 20) === data.length) {
      end = offset;
      break;
    }
  }
  if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) reject();
  const count = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directory = data.readUInt32LE(end + 16);
  if (!count || count > MAX_ENTRIES || data.readUInt16LE(end + 8) !== count ||
      directory + directorySize !== end) reject();

  let cursor = directory;
  let expanded = 0;
  let firstLocal = data.length;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) reject();
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const compressed = data.readUInt32LE(cursor + 20);
    const declared = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const local = data.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || data.readUInt16LE(cursor + 34) !== 0 ||
        (flags & 0x2041) !== 0 || (method !== 0 && method !== 8) ||
        declared > MAX_EXPANDED_DOCX_BYTES - expanded ||
        local + 30 > directory || data.readUInt32LE(local) !== 0x04034b50 ||
        data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method) reject();

    // ZIP64 extension fields can override the offsets interpreted by readers.
    const extraStart = cursor + 46 + nameLength;
    for (let extra = extraStart; extra < extraStart + extraLength;) {
      if (extra + 4 > extraStart + extraLength) reject();
      const id = data.readUInt16LE(extra);
      const size = data.readUInt16LE(extra + 2);
      if (id === 1 || extra + 4 + size > extraStart + extraLength) reject();
      extra += 4 + size;
    }
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + compressed > directory || start > directory) reject();
    const payload = data.subarray(start, start + compressed);
    const remaining = MAX_EXPANDED_DOCX_BYTES - expanded;
    let actual: number;
    if (method === 0) {
      actual = payload.length;
    } else {
      if (remaining <= 0) reject();
      try {
        // The actual output is bounded even when the ZIP metadata lies.
        actual = (await inflate(payload, { maxOutputLength: remaining })).length;
      } catch {
        reject();
      }
    }
    if (actual !== declared || actual > remaining) reject();
    expanded += actual;
    firstLocal = Math.min(firstLocal, local);
    cursor = next;
  }
  if (cursor !== end || firstLocal !== 0) reject();
}
