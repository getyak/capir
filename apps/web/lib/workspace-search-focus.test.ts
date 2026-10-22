// @vitest-environment happy-dom
//
// Lifecycle and race behavior of the bounded search destination focus
// handoff: exact final-heading targeting, delayed destinations, loading
// surfaces that must never consume an intent, user focus authority, and full
// listener/observer cleanup inside a finite lifetime.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  WORKSPACE_SEARCH_FOCUS_ATTR,
  beginWorkspaceSearchFocusHandoff,
  workspaceSearchFocusTargetProps,
} from "./workspace-search-focus";

const PERSON = "/workspace/people/11111111-1111-4111-8111-111111111111";
let workspace: HTMLDivElement;

function markedHeading(href: string, text = "Person heading"): HTMLHeadingElement {
  const element = document.createElement("h1");
  element.textContent = text;
  vi.spyOn(element, "getClientRects").mockReturnValue([new DOMRect(0, 10, 200, 30)] as unknown as DOMRectList);
  for (const [name, value] of Object.entries(workspaceSearchFocusTargetProps(href))) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function control(label = "Other control"): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  vi.spyOn(button, "getClientRects").mockReturnValue([new DOMRect(0, 10, 100, 30)] as unknown as DOMRectList);
  document.body.append(button);
  return button;
}

function sleep(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  window.history.replaceState(null, "", PERSON);
  workspace = document.createElement("div");
  workspace.id = "workspace-content";
  document.body.append(workspace);
});

afterEach(() => {
  for (const node of [...document.body.children]) node.remove();
  vi.restoreAllMocks();
});

it("keeps a normal slow navigation eligible beyond two seconds", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  await sleep(2150);
  const target = markedHeading(PERSON); workspace.append(target);
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
});

it("skips hidden and inert copies and focuses the visible settled heading", async () => {
  const hidden = markedHeading(PERSON); hidden.hidden = true;
  const inert = markedHeading(PERSON); inert.setAttribute("inert", "");
  const target = markedHeading(PERSON); workspace.append(hidden, inert, target);
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
});

it("waits for a marker or visibility attribute to become ready", async () => {
  const target = markedHeading(PERSON); target.hidden = true;
  target.removeAttribute(WORKSPACE_SEARCH_FOCUS_ATTR); workspace.append(target);
  beginWorkspaceSearchFocusHandoff({ href: PERSON }); await sleep();
  expect(document.activeElement).toBe(document.body);
  target.setAttribute(WORKSPACE_SEARCH_FOCUS_ATTR, PERSON); target.hidden = false;
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
});

it("preserves a painted control that owned focus before arming", async () => {
  const chosen = control(); chosen.focus();
  workspace.append(markedHeading(PERSON));
  beginWorkspaceSearchFocusHandoff({ href: PERSON }); await sleep();
  expect(document.activeElement).toBe(chosen);
});

it("cancels a third committed programmatic route even if the selected route later returns", async () => {
  window.history.replaceState(null, "", "/workspace/people");
  const handoff = beginWorkspaceSearchFocusHandoff({ href: PERSON, fromHref: "/workspace/people" });
  handoff.observeLocation("/workspace/settings");
  window.history.replaceState(null, "", PERSON); handoff.observeLocation(PERSON);
  workspace.append(markedHeading(PERSON)); await sleep();
  expect(document.activeElement).toBe(document.body);
});

it.each([`${PERSON}?session=other`, `${PERSON}#other-section`])("rejects a same-path destination with a different navigation identity: %s", async location => {
  const handoff = beginWorkspaceSearchFocusHandoff({ href: PERSON });
  window.history.replaceState(null, "", location); handoff.observeLocation(location);
  workspace.append(markedHeading(PERSON)); await sleep();
  expect(document.activeElement).toBe(document.body);
  window.history.replaceState(null, "", PERSON); handoff.observeLocation(PERSON);
  workspace.append(markedHeading(PERSON)); await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("rejects a changed relationship scope while the original source pathname remains", async () => {
  const from = "/workspace?person=A&context=X";
  window.history.replaceState(null, "", from);
  const handoff = beginWorkspaceSearchFocusHandoff({ href: PERSON, fromHref: from });
  handoff.observeLocation("/workspace?person=B&context=Y");
  window.history.replaceState(null, "", PERSON);
  workspace.append(markedHeading(PERSON)); await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("does not observe body when its workspace root is absent", async () => {
  workspace.remove(); const observe = vi.spyOn(MutationObserver.prototype, "observe");
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  document.body.append(markedHeading(PERSON)); await sleep();
  expect(observe).not.toHaveBeenCalled(); expect(document.activeElement).toBe(document.body);
});

it("focuses the settled heading for the exact selected pathname once, same address included", async () => {
  const target = markedHeading(PERSON);
  workspace.append(target);
  const focus = vi.spyOn(target, "focus");
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  await sleep();
  expect(focus).toHaveBeenCalledTimes(1);
});

it("waits for a delayed destination heading and consumes the intent only there", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  await sleep();
  expect(document.activeElement).toBe(document.body);
  const target = markedHeading(PERSON);
  workspace.append(target);
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
});

it("never consumes the intent on a loading main-content and stays bounded", async () => {
  const loading = document.createElement("main");
  loading.id = "main-content";
  loading.tabIndex = -1;
  workspace.append(loading);
  beginWorkspaceSearchFocusHandoff({ href: PERSON, timeoutMs: 30 });
  await sleep(80);
  expect(document.activeElement).toBe(document.body);
  workspace.append(markedHeading(PERSON));
  await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("ignores headings marked for a different destination", async () => {
  workspace.append(markedHeading("/workspace/people/22222222-2222-4222-8222-222222222222"));
  beginWorkspaceSearchFocusHandoff({ href: PERSON, timeoutMs: 30 });
  await sleep(80);
  expect(document.activeElement).toBe(document.body);
});

it("observes only the narrow workspace content root", async () => {
  const outside = markedHeading(PERSON);
  document.body.append(outside);
  try {
    beginWorkspaceSearchFocusHandoff({ href: PERSON, timeoutMs: 30 });
    await sleep(80);
    expect(document.activeElement).toBe(document.body);
  } finally {
    outside.remove();
  }
});

it("yields to a control the user focuses before the deferred handoff", async () => {
  workspace.append(markedHeading(PERSON));
  const chosen = control();
  try {
    beginWorkspaceSearchFocusHandoff({ href: PERSON });
    chosen.focus();
    await sleep();
    expect(document.activeElement).toBe(chosen);
  } finally {
    chosen.remove();
  }
});

it("cancels instead of stealing when focus moves while the destination is delayed", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  const chosen = control();
  try {
    chosen.focus();
    workspace.append(markedHeading(PERSON));
    await sleep();
    expect(document.activeElement).toBe(chosen);
  } finally {
    chosen.remove();
  }
});

it("cancels on a newer ordinary navigation even when that navigation is blocked", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  const link = document.createElement("a");
  link.href = "/workspace/sessions/33333333-3333-4333-8333-333333333333";
  link.onclick = (event) => event.preventDefault();
  document.body.append(link);
  try {
    link.click();
    workspace.append(markedHeading(PERSON));
    await sleep();
    expect(document.activeElement).toBe(document.body);
  } finally {
    link.remove();
  }
});

it("cancels on popstate before any ready target", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON });
  window.dispatchEvent(new Event("popstate"));
  workspace.append(markedHeading(PERSON));
  await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("cancels when the credential scope expires", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON, cancelOn: ["test:workspace-expired"] });
  window.dispatchEvent(new Event("test:workspace-expired"));
  workspace.append(markedHeading(PERSON));
  await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("drops the intent once the captured binding is no longer current", async () => {
  let current = true;
  workspace.append(markedHeading(PERSON));
  beginWorkspaceSearchFocusHandoff({ href: PERSON, isCurrent: () => current, timeoutMs: 30 });
  current = false;
  await sleep(80);
  expect(document.activeElement).toBe(document.body);
});

it("drops a later arrival after cancellation leaves nothing to focus", async () => {
  beginWorkspaceSearchFocusHandoff({ href: PERSON, timeoutMs: 20 }).cancel();
  await sleep(60);
  workspace.append(markedHeading(PERSON));
  await sleep();
  expect(document.activeElement).toBe(document.body);
});

it("removes every listener and observer once finished or cancelled", async () => {
  const windowAdded: string[] = [];
  const windowRemoved: string[] = [];
  const documentAdded: string[] = [];
  const documentRemoved: string[] = [];
  const addWindow = window.addEventListener.bind(window);
  const removeWindow = window.removeEventListener.bind(window);
  const addDocument = document.addEventListener.bind(document);
  const removeDocument = document.removeEventListener.bind(document);
  vi.spyOn(window, "addEventListener").mockImplementation((...args: Parameters<Window["addEventListener"]>) => {
    windowAdded.push(String(args[0]));
    return addWindow(...(args as Parameters<typeof addWindow>));
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((...args: Parameters<Window["removeEventListener"]>) => {
    windowRemoved.push(String(args[0]));
    return removeWindow(...(args as Parameters<typeof removeWindow>));
  });
  vi.spyOn(document, "addEventListener").mockImplementation((...args: Parameters<Document["addEventListener"]>) => {
    documentAdded.push(String(args[0]));
    return addDocument(...(args as Parameters<typeof addDocument>));
  });
  vi.spyOn(document, "removeEventListener").mockImplementation((...args: Parameters<Document["removeEventListener"]>) => {
    documentRemoved.push(String(args[0]));
    return removeDocument(...(args as Parameters<typeof removeDocument>));
  });
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  workspace.append(markedHeading(PERSON));
  beginWorkspaceSearchFocusHandoff({ href: PERSON, cancelOn: ["test:workspace-expired"] });
  await vi.waitFor(() => expect(document.activeElement).toBe(workspace.querySelector("h1")));
  for (const name of ["popstate", "hashchange", "test:workspace-expired"]) {
    expect(windowAdded.filter((entry) => entry === name)).toHaveLength(1);
    expect(windowRemoved.filter((entry) => entry === name)).toHaveLength(1);
  }
  for (const name of ["focusin", "click"]) {
    expect(documentAdded.filter((entry) => entry === name)).toHaveLength(1);
    expect(documentRemoved.filter((entry) => entry === name)).toHaveLength(1);
  }
  expect(disconnect).toHaveBeenCalled();
});
