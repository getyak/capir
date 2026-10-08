import { withReturnSession } from "./session-return-navigation";

// Carry only the directory's search state, never an arbitrary return URL.
export function readPeopleDirectoryQuery(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

export function peopleDirectoryHref(query: string, returnSessionId: string | null) {
  return withReturnSession(
    `/workspace/people${query ? `?query=${encodeURIComponent(query)}` : ""}`,
    returnSessionId,
  );
}

export function personMemoryHref(id: string, query: string, returnSessionId: string | null) {
  return withReturnSession(
    `/workspace/people/${encodeURIComponent(id)}${query ? `?directory_query=${encodeURIComponent(query)}` : ""}`,
    returnSessionId,
  );
}
