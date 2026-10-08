import { describe, expect, it } from "vitest";
import { peopleDirectoryHref, personMemoryHref, readPeopleDirectoryQuery } from "./people-directory-navigation";

describe("People return search", () => {
  it("round-trips complete literal search text without promoting it to a navigation URL", () => {
    const query = `https://example.test/?next=/outside&name=林 ${"长".repeat(170)}`;
    const detail = new URL(personMemoryHref("person/id", query, "session-a"), "https://capri.test");
    expect(detail.pathname).toBe("/workspace/people/person%2Fid");
    expect(detail.searchParams.get("directory_query")).toBe(query);
    expect(detail.searchParams.get("session")).toBe("session-a");
    const back = new URL(peopleDirectoryHref(detail.searchParams.get("directory_query")!, "session-a"), detail);
    expect(back.origin).toBe(detail.origin);
    expect(back.pathname).toBe("/workspace/people");
    expect(back.searchParams.get("query")).toBe(query);
    expect(back.searchParams.get("session")).toBe("session-a");
    expect(back.searchParams.has("next")).toBe(false);
  });

  it("keeps direct entry ordinary and refuses ambiguous search values", () => {
    expect(personMemoryHref("person-a", "", null)).toBe("/workspace/people/person-a");
    expect(peopleDirectoryHref("", null)).toBe("/workspace/people");
    expect(readPeopleDirectoryQuery(["林", "沈"])).toBe("");
    expect(readPeopleDirectoryQuery(undefined)).toBe("");
    expect(readPeopleDirectoryQuery("  Ａ 林  ")).toBe("A 林");
  });
});
