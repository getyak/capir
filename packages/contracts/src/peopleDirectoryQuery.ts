/** Complete query admission, shared by browser and server ingress. Result
 * capacity and confirmed-handle authority are owned separately by each route. */
export const PEOPLE_DIRECTORY_QUERY_MAX_SCALARS = 500;
export const PEOPLE_DIRECTORY_QUERY_MAX_UTF8_BYTES = 2048;

export type PeopleDirectoryQueryFailure = "invalid_type" | "too_long" | "invalid_unicode";
export type PeopleDirectoryQueryResult =
  | { ok: true; query: string }
  | { ok: false; reason: PeopleDirectoryQueryFailure };

function invalidText(value: string): PeopleDirectoryQueryFailure | null {
  // Bound the work before normalization or a scalar walk. A well-formed
  // scalar uses at most two UTF16 units; no admitted raw input can exceed this.
  if (value.length > PEOPLE_DIRECTORY_QUERY_MAX_SCALARS * 2) return "too_long";
  let scalars = 0, bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return "invalid_unicode";
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "invalid_unicode";
      index++; bytes += 4;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return "invalid_unicode";
      bytes += unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
    }
    if (++scalars > PEOPLE_DIRECTORY_QUERY_MAX_SCALARS || bytes > PEOPLE_DIRECTORY_QUERY_MAX_UTF8_BYTES) {
      return "too_long";
    }
  }
  return null;
}

/** Reject rather than coerce, truncate, or normalize an oversized raw draft.
 * An absent optional query is the existing ordinary directory read. */
export function parsePeopleDirectoryQuery(value: unknown,
  options: { allowMissing?: boolean } = {}): PeopleDirectoryQueryResult {
  if (value === undefined && options.allowMissing) return { ok: true, query: "" };
  if (typeof value !== "string") return { ok: false, reason: "invalid_type" };
  const rawFailure = invalidText(value);
  if (rawFailure) return { ok: false, reason: rawFailure };
  const query = value.normalize("NFKC").trim();
  const normalizedFailure = invalidText(query);
  return normalizedFailure ? { ok: false, reason: normalizedFailure } : { ok: true, query };
}
