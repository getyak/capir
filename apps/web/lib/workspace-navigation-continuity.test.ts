import { describe, expect, it } from "vitest";
import { createWorkspaceNavigationMemory, vetWorkspaceNavigationHref } from "./workspace-navigation-continuity";

const ID = "11111111-1111-4111-8111-111111111111";
describe("workspace navigation locator boundary", () => {
  it.each([
    ["/workspace", "conversation", "/workspace"],
    [`/workspace?draft_session=${ID}`, "conversation", `/workspace?draft_session=${ID}`],
    [`/workspace/sessions/${ID}`, "conversation", `/workspace/sessions/${ID}`],
    ["/workspace/people?query=Lin", "people", "/workspace/people?query=Lin"],
    [`/workspace/people/${ID}?directory_query=Lin&session=${ID}`, "people", `/workspace/people?query=Lin&session=${ID}`],
    ["/workspace/meetings?day=2026-10-13&view=month&range=custom&from=2026-10-01&to=2026-11-01&tz=UTC&kind=schedule&upcoming=7", "meetings", "/workspace/meetings?day=2026-10-13&view=month&range=custom&from=2026-10-01&to=2026-11-01&tz=UTC&kind=schedule&upcoming=7"],
  ])("vets only a bounded locator for %s", (input, destination, href) => {
    expect(vetWorkspaceNavigationHref(input)).toEqual({ destination, href });
  });

  it.each([
    "https://outside.example/workspace/people", "//outside.example/workspace", "/workspace\\people", "/workspace/people/../../login", "/workspace/people%2Fother", "/workspace?token=secret", "/workspace?objective=private", "/workspace/people?query=Lin&query=Chen", "/workspace/people?query=Lin&access_token=secret", "/workspace/people?query=" + "x".repeat(501), "/workspace/people?query=%0Aprivate", "/workspace/meetings?day=2026-02-30", "/workspace/meetings?tz=Invalid%2FZone", "/workspace/meetings?upcoming=365", "/workspace/sessions/not-a-session", `/workspace/people/${ID}?directory_query=Lin&directory_query=Chen`, "/workspace/meetings?item=private+evidence", "/workspace/people#arbitrary-content",
  ])("rejects unsafe or ambiguous locator %s", (input) => {
    expect(vetWorkspaceNavigationHref(input)).toBeNull();
  });

  it("does not replace the directory with an unscoped person detail or the canvas with the Session directory", () => {
    expect(vetWorkspaceNavigationHref(`/workspace/people/${ID}`)).toBeNull();
    expect(vetWorkspaceNavigationHref("/workspace/sessions")).toBeNull();
  });

  it.each([`person_created:${ID}`, `meeting_draft:${ID}`, `schedule:${ID}`, `session_activity:${ID}:2026-10-13`])("preserves actual calendar activity identity %s", item => {
    const href = `/workspace/meetings?item=${encodeURIComponent(item)}&day=2026-10-13&view=timeline`;
    expect(vetWorkspaceNavigationHref(href)).toEqual({ destination: "meetings", href });
  });

  it("keeps at most one vetted locator per destination and never admits an unsafe setter", () => {
    const memory = createWorkspaceNavigationMemory("a".repeat(64));
    memory.remember(`/workspace?draft_session=${ID}`);
    memory.remember("/workspace/meetings?day=2026-10-13&tz=UTC");
    for (let index = 0; index < 100; index += 1) memory.remember(`/workspace/people?query=search${index}`);
    memory.remember("/workspace/people?query=private&token=credential");
    expect(memory.getSnapshot().hrefs).toEqual({ conversation: `/workspace?draft_session=${ID}`, meetings: "/workspace/meetings?day=2026-10-13&tz=UTC", people: "/workspace/people?query=search99" });
    memory.expire(); memory.remember("/workspace/people?query=stale");
    expect(memory.getSnapshot().hrefs).toEqual({});
  });
});
