/** Read-only literal discovery. This parser grants no identity, write, source
 * or Wiki authority and cannot reset the existing Run/tool/token budget. */
import { types } from "node:util";
import { z } from "zod";

export const SAVED_MEMORY_SEARCH_MAX_TERMS = 8;
export const SAVED_MEMORY_SEARCH_TERM_SCALARS = 120;
export const SAVED_MEMORY_SEARCH_TERMS_UTF8 = 2048;
export const SAVED_MEMORY_SEARCH_MAX_PAGE = 20;
export const SAVED_MEMORY_SEARCH_CURSOR_MAX = 1024;
const utf8 = new TextEncoder();
function plainInput(value: unknown): unknown {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const keys = Reflect.ownKeys(value), out: Record<string, unknown> = Object.create(null);
    if (keys.length > 3) return undefined;
    for (const key of keys) {
      if (typeof key !== "string" || !["terms", "limit", "cursor"].includes(key)) return undefined;
      const slot = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in slot) || !slot.enumerable) return undefined;
      out[key] = slot.value;
    }
    const terms = out.terms;
    if (!Array.isArray(terms) || types.isProxy(terms) || Object.getPrototypeOf(terms) !== Array.prototype) return undefined;
    const size = Object.getOwnPropertyDescriptor(terms, "length")?.value;
    if (!Number.isSafeInteger(size) || size < 1 || size > SAVED_MEMORY_SEARCH_MAX_TERMS || Reflect.ownKeys(terms).length !== size + 1) return undefined;
    const copy: unknown[] = [];
    for (let i = 0; i < size; i++) {
      const slot = Object.getOwnPropertyDescriptor(terms, String(i));
      if (!slot || !("value" in slot) || !slot.enumerable) return undefined;
      copy.push(slot.value);
    }
    out.terms = copy; return out;
  } catch { return undefined; }
}
function literal(value: string): boolean {
  if (!value.trim() || value.includes("\0")) return false;
  let scalars = 0;
  for (let i = 0; i < value.length; i++, scalars++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return scalars <= SAVED_MEMORY_SEARCH_TERM_SCALARS;
}
export const SavedMemorySearchInputSchema = z.preprocess(plainInput, z.object({
  terms: z.array(z.string().min(1).max(240).refine(literal)).min(1).max(SAVED_MEMORY_SEARCH_MAX_TERMS),
  limit: z.number().int().min(1).max(SAVED_MEMORY_SEARCH_MAX_PAGE).default(10),
  cursor: z.string().min(1).max(SAVED_MEMORY_SEARCH_CURSOR_MAX).regex(/^[A-Za-z0-9_.-]+$/).optional(),
}).strict().refine(value => value.terms.reduce((sum, term) => sum + utf8.encode(term).byteLength, 0) <= SAVED_MEMORY_SEARCH_TERMS_UTF8));
export type SavedMemorySearchInput = z.output<typeof SavedMemorySearchInputSchema>;
