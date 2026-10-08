import { withReturnSession } from "./session-return-navigation";

const CANONICAL_PERSON_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Carry only the directory's search state, never an arbitrary return URL.
export function readPeopleDirectoryQuery(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

// One normalization for every directory entry ID and return fragment: a
// validated canonical UUID, lowercased. Arbitrary ids or URLs never mint a
// fragment target.
export function personDirectoryEntryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.toLowerCase();
  return CANONICAL_PERSON_ID.test(id) ? `person-${id}` : null;
}

export function peopleDirectoryHref(
  query: string,
  returnSessionId: string | null,
  returnPersonId: string | null = null,
) {
  const href = withReturnSession(
    `/workspace/people${query ? `?query=${encodeURIComponent(query)}` : ""}`,
    returnSessionId,
  );
  // The stable Person fragment is appended only after the existing
  // query/session construction, so return location can never rewrite or
  // replace search state. A missing or non-canonical Person return stays an
  // ordinary directory URL.
  const entryId = personDirectoryEntryId(returnPersonId);
  return entryId ? `${href}#${entryId}` : href;
}

export function personMemoryHref(id: string, query: string, returnSessionId: string | null) {
  return withReturnSession(
    `/workspace/people/${encodeURIComponent(id)}${query ? `?directory_query=${encodeURIComponent(query)}` : ""}`,
    returnSessionId,
  );
}
