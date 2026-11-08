/** Bounded own-data snapshots for the opt-in literal protocol. Capturing an
 * object does not authenticate it. No getter, toJSON or coercion is consulted. */
import { describeMemoryText, MemoryContentError } from "./memoryContent.js";

export const memoryLiteralInvalid = (): never => { throw new MemoryContentError("MEMORY_CONTENT_INVALID"); };
export const memoryLiteralLimit = (): never => { throw new MemoryContentError("MEMORY_CONTENT_LIMIT"); };
export const MEMORY_LITERAL_HASH = /^[a-f0-9]{64}$/u;
export const MEMORY_LITERAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export function captureMemoryLiteralData(value: unknown, maxBytes = 1024 * 1024, maxNodes = 20_000): unknown {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  function visit(input: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 24) return memoryLiteralLimit();
    if (typeof input === "string") {
      bytes += describeMemoryText(input).utf8_bytes;
      if (bytes > maxBytes) return memoryLiteralLimit();
      return input;
    }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (!input || typeof input !== "object" || ancestors.has(input)) return memoryLiteralInvalid();
    ancestors.add(input);
    let slots: Record<string, PropertyDescriptor>, array: boolean;
    try {
      array = Array.isArray(input);
      const prototype = Object.getPrototypeOf(input);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return memoryLiteralInvalid();
      slots = Object.getOwnPropertyDescriptors(input);
    } catch { return memoryLiteralInvalid(); }
    const keys = Reflect.ownKeys(slots);
    if (keys.length > maxNodes) return memoryLiteralLimit();
    let result: unknown;
    if (array) {
      const length = slots.length?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maxNodes
        || keys.length !== length + 1) return memoryLiteralInvalid();
      const items: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const slot = slots[String(i)];
        if (!Object.hasOwn(slots, String(i)) || !slot || !("value" in slot) || !slot.enumerable) return memoryLiteralInvalid();
        items.push(visit(slot.value, depth + 1));
      }
      result = Object.freeze(items);
    } else {
      const row: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string") return memoryLiteralInvalid();
        bytes += describeMemoryText(key).utf8_bytes;
        const slot = slots[key];
        if (!slot || !("value" in slot) || !slot.enumerable) return memoryLiteralInvalid();
        row[key] = visit(slot.value, depth + 1);
      }
      result = Object.freeze(row);
    }
    ancestors.delete(input);
    if (bytes > maxBytes) return memoryLiteralLimit();
    return result;
  }
  try { return visit(value, 0); }
  catch (error) { if (error instanceof MemoryContentError) throw error; return memoryLiteralInvalid(); }
}

export function memoryLiteralRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const captured = captureMemoryLiteralData(value);
  if (!captured || typeof captured !== "object" || Array.isArray(captured)) return memoryLiteralInvalid();
  const row = captured as Record<string, unknown>, allowed = new Set([...required, ...optional]);
  if (Object.keys(row).some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(row, key))) return memoryLiteralInvalid();
  return row;
}

export function freezeMemoryLiteralData<T>(value: T): Readonly<T> {
  // Also isolate constructed outputs from a mistakenly retained mutable input.
  // This is a storage/output ceiling, not a per-request admission budget.
  return captureMemoryLiteralData(value, 8 * 1024 * 1024) as Readonly<T>;
}

/** Key order is deterministic code-unit order, never locale-dependent
 * collation or a caller's getter/toJSON hook. */
export function canonicalMemoryLiteralJson(value: unknown): string {
  const captured = captureMemoryLiteralData(value);
  // Emit sorted entries directly: rebuilding a plain object would cause
  // JSON.stringify to re-enumerate integer-looking keys in numeric order.
  const encode = (node: unknown): string => Array.isArray(node) ? "[" + node.map(encode).join(",") + "]"
    : node !== null && typeof node === "object"
      ? "{" + Object.keys(node).sort().map(key => JSON.stringify(key) + ":" + encode((node as Record<string, unknown>)[key])).join(",") + "}"
      : JSON.stringify(node);
  return encode(captured);
}
