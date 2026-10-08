import { describe, expect, it } from "vitest";
import { peopleDirectoryHref, personDirectoryEntryId, personMemoryHref, readPeopleDirectoryQuery } from "./people-directory-navigation";

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

describe("People return location", () => {
  const rawId = "7258D22F-42E3-4D40-BA4D-683A0CC76F7D";
  const canonical = "7258d22f-42e3-4d40-ba4d-683a0cc76f7d";

  it("appends the stable Person fragment only after query/session construction", () => {
    const href = peopleDirectoryHref("林 & 陈", "session-a", rawId);
    expect(href).toBe(
      `/workspace/people?query=%E6%9E%97+%26+%E9%99%88&session=session-a#person-${canonical}`,
    );
    expect(href.indexOf("#")).toBeGreaterThan(href.indexOf("session=session-a"));
    expect(peopleDirectoryHref("", null, rawId)).toBe(
      `/workspace/people#person-${canonical}`,
    );
  });

  it("uses one normalization for directory entry IDs and the return fragment", () => {
    expect(personDirectoryEntryId(rawId)).toBe(`person-${canonical}`);
    expect(personDirectoryEntryId(canonical)).toBe(`person-${canonical}`);
    expect(peopleDirectoryHref("", null, rawId).endsWith(`#${personDirectoryEntryId(canonical)}`)).toBe(true);
  });

  it("keeps ordinary directory URLs for absent or arbitrary Person returns", () => {
    const ordinary = "/workspace/people?query=%E6%9E%97&session=session-a";
    const arbitrary: unknown[] = [
      "person-a",
      "person/injection?x=1#evil",
      "https://example.test/#x",
      `${canonical}extra`,
      "11111111-1111-9111-8111-111111111111",
      "  ",
      "",
      null,
      undefined,
      7,
      [canonical],
    ];
    for (const value of arbitrary) {
      expect(personDirectoryEntryId(value)).toBeNull();
      expect(peopleDirectoryHref("林", "session-a", value as string)).toBe(ordinary);
    }
  });

  it("keeps the full unrestricted query and session together with the fragment", () => {
    const query = `https://example.test/?next=/outside&name=林 ${"长".repeat(170)}`;
    const detail = new URL(personMemoryHref(canonical, query, "session-a"), "https://capri.test");
    const back = new URL(
      peopleDirectoryHref(detail.searchParams.get("directory_query")!, "session-a", rawId),
      detail,
    );
    expect(back.origin).toBe(detail.origin);
    expect(back.pathname).toBe("/workspace/people");
    expect(back.searchParams.get("query")).toBe(query);
    expect(back.searchParams.get("session")).toBe("session-a");
    expect(back.hash).toBe(`#person-${canonical}`);
    expect(back.searchParams.has("next")).toBe(false);
    // Without a canonical Person return the same round trip stays ordinary.
    const plain = new URL(
      peopleDirectoryHref(detail.searchParams.get("directory_query")!, "session-a"),
      detail,
    );
    expect(plain.hash).toBe("");
  });
});
