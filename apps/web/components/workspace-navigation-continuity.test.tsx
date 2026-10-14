// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ pathname: "/workspace", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
import {
  WorkspaceNavigationContinuityProvider,
  useRememberWorkspaceNavigationHref,
  useWorkspaceNavigationHref,
} from "./workspace-navigation-continuity";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";

const SCOPE_A = "a".repeat(64), SCOPE_B = "b".repeat(64);
const SESSION = "11111111-1111-4111-8111-111111111111";
let host: HTMLDivElement, root: Root;
function Destinations() {
  const remember = useRememberWorkspaceNavigationHref();
  return <>
    <a data-destination="conversation" href={useWorkspaceNavigationHref("/workspace")}>Conversation</a>
    <a data-destination="people" href={useWorkspaceNavigationHref("/workspace/people")}>People</a>
    <a data-destination="time" href={useWorkspaceNavigationHref("/workspace/meetings")}>Time</a>
    <button onClick={() => remember("/workspace/people?query=committed")}>Remember committed search</button>
    <button onClick={() => { remember("/workspace/people?query=first"); remember("/workspace/people?query=last"); }}>Rapid search</button>
  </>;
}
async function render(scope: string | null = SCOPE_A) {
  await act(async () => root.render(createElement(WorkspaceNavigationContinuityProvider, { scope }, createElement(Destinations))));
}
function href(name: string) { return host.querySelector(`a[data-destination="${name}"]`)!.getAttribute("href"); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  location.pathname = "/workspace"; location.search = "";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("mounted scoped navigation continuity", () => {
  it("returns to the exact Session, directory search, and calendar location after switching", async () => {
    location.pathname = `/workspace/sessions/${SESSION}`; await render();
    location.pathname = "/workspace/people"; location.search = "query=Lin"; await render();
    location.pathname = "/workspace/meetings"; location.search = "day=2026-10-13&view=week&tz=Asia%2FShanghai&upcoming=30"; await render();
    location.pathname = "/workspace/today"; location.search = ""; await render();
    expect(href("conversation")).toBe(`/workspace/sessions/${SESSION}`);
    expect(href("people")).toBe("/workspace/people?query=Lin");
    expect(href("time")).toBe("/workspace/meetings?day=2026-10-13&view=week&tz=Asia%2FShanghai&upcoming=30");
  });

  it("retains a committed visible People search on ordinary rerenders and maps detail search to the list", async () => {
    location.pathname = "/workspace/people"; location.search = "query=old"; await render();
    await act(async () => host.querySelector("button")!.click()); await render();
    expect(href("people")).toBe("/workspace/people?query=committed");
    location.pathname = `/workspace/people/${SESSION}`; location.search = "directory_query=selected"; await render();
    expect(href("people")).toBe("/workspace/people?query=selected");
    location.pathname = "/workspace/today"; location.search = ""; await render();
    expect(href("people")).toBe("/workspace/people?query=selected");
  });

  it("clears old account locators synchronously and does not recover them when that account returns", async () => {
    location.pathname = `/workspace/sessions/${SESSION}`; await render();
    location.pathname = "/workspace/today"; await render();
    await render(SCOPE_B); expect(href("conversation")).toBe("/workspace");
    await render(SCOPE_A); expect(href("conversation")).toBe("/workspace");
    await render(null); await act(async () => host.querySelector("button")!.click());
    expect(href("people")).toBe("/workspace/people");
  });

  it("fences both URL observation and explicit setters after session expiry", async () => {
    location.pathname = `/workspace/sessions/${SESSION}`; await render();
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    location.pathname = "/workspace/people"; location.search = "query=stale"; await render();
    await act(async () => host.querySelector("button")!.click());
    expect(href("conversation")).toBe("/workspace"); expect(href("people")).toBe("/workspace/people");
    await render(SCOPE_B);
    location.search = "query=new-account"; await render(SCOPE_B);
    expect(href("people")).toBe("/workspace/people?query=new-account");
  });

  it("keeps the last rapid change without reading or writing browser storage", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    await render(); await act(async () => host.querySelectorAll("button")[1]!.click());
    expect(href("people")).toBe("/workspace/people?query=last");
  });

  it("uses canonical navigation without a provider", async () => {
    await act(async () => root.render(createElement(Destinations)));
    expect(href("conversation")).toBe("/workspace"); expect(href("people")).toBe("/workspace/people");
    await act(async () => host.querySelector("button")!.click());
    expect(href("people")).toBe("/workspace/people");
  });
});
