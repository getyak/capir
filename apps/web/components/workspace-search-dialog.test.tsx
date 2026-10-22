// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const directory = vi.hoisted(() => ({ people: [] as unknown[], sessions: [] as unknown[] }));
const navigation = vi.hoisted(() => ({ pathname: "/workspace/people" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/lib/workspace-directory-cache", () => ({
  readCachedWorkspaceDirectory: () => null,
  loadWorkspaceDirectory: () => Promise.resolve({ people: { people: directory.people }, sessions: { sessions: directory.sessions } }),
  subscribeWorkspaceDirectoryInvalidation: () => () => {},
  isWorkspaceDirectoryAbort: () => false,
}));
vi.mock("@/lib/workspace-refresh", () => ({ subscribeWorkspaceRefresh: () => () => {}, coordinatorScopeIsCurrent: () => true }));
// Models Link's documented onNavigate boundary (SPA navigation only, never for
// modified or new-tab activations); live browser acceptance must additionally
// prove the actual compiled App Router Link path.
vi.mock("next/link", () => ({
  default: ({ href, onNavigate, onClick, children, ...props }: ComponentProps<"a"> & { href: string; onNavigate?: () => void }) => <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
    event.preventDefault();
    onNavigate?.();
    window.history.pushState(null, "", href);
  }}>{children}</a>,
}));
import { workspaceSearchFocusTargetProps } from "@/lib/workspace-search-focus";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { WorkspaceGlobalSearchDialog } from "./workspace-search";
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
let root: Root, stage: HTMLDivElement, workspace: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  directory.people = []; directory.sessions = [];
  navigation.pathname = "/workspace/people";
  window.history.replaceState(null, "", navigation.pathname);
  stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage);
  workspace = document.createElement("div"); workspace.id = "workspace-content"; document.body.append(workspace);
});
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); workspace.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openSearch(): Promise<HTMLButtonElement> {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  return trigger;
}
async function typeQuery(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(document.querySelector("[data-search-result]")).not.toBeNull());
}
function resultLink(href: string): HTMLAnchorElement {
  const link = [...document.querySelectorAll<HTMLAnchorElement>("[data-search-result]")].find((node) => node.getAttribute("href") === href);
  expect(link, `missing search result ${href}`).toBeTruthy();
  return link!;
}
function destination(href: string, text = "Destination heading"): HTMLHeadingElement {
  const heading = document.createElement("h1");
  heading.textContent = text;
  vi.spyOn(heading, "getClientRects").mockReturnValue([new DOMRect(0, 10, 200, 30)] as unknown as DOMRectList);
  for (const [name, value] of Object.entries(workspaceSearchFocusTargetProps(href))) heading.setAttribute(name, String(value));
  return heading;
}
function settle(ms = 30): Promise<void> {
  return act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
it("closes a filled search in one Escape and returns focus to its trigger", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  input.focus(); input.value = "林";
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});
it("leaves IME candidate cancellation with the input method", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  await act(async () => stage.querySelector("button")!.click());
  const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
  await act(async () => document.querySelector<HTMLInputElement>("[role=dialog] input")!.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
});

it("labels its modal and closes through the accessible close control", async () => {
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  const trigger = stage.querySelector("button")!;
  await act(async () => trigger.click());
  const dialog = document.querySelector("[role=dialog]")!;
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
  const description = document.getElementById(dialog.getAttribute("aria-describedby")!);
  expect(title?.textContent).toBe("搜索人物与对话");
  expect(description?.textContent).toContain("当前账号");
  expect(document.activeElement).toBe(dialog.querySelector("input"));
  await act(async () => (dialog.querySelector("[aria-label=关闭搜索]") as HTMLButtonElement).click());
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  await act(async () => trigger.click());
  expect(document.querySelector("[role=dialog] input")).toHaveProperty("value", "");
});

it("hands an accepted same-tab result to the selected final destination heading after close", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  const trigger = await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  expect(document.querySelector("[role=dialog]")).toBeNull();
  // The destination commits late; the bounded handoff waits for its heading.
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  await act(async () => { workspace.append(heading); });
  await vi.waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.activeElement).not.toBe(trigger);
});

it("hands a same-address result to the already settled heading without a new render", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  workspace.append(heading);
  window.history.replaceState(null, "", `/workspace/people/${PERSON_ID}`);
  const trigger = await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.activeElement).not.toBe(trigger);
});

it("hands a session result to its final heading on a delayed destination", async () => {
  directory.sessions = [{ session_id: SESSION_ID, title: "林氏周会", state: "active", expires_at: "2099-01-01T00:00:00.000Z" }];
  await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/sessions/${SESSION_ID}`).click());
  const heading = destination(`/workspace/sessions/${SESSION_ID}`);
  await act(async () => { workspace.append(heading); });
  await vi.waitFor(() => expect(document.activeElement).toBe(heading));
});

it("keeps modified and new-tab activations on their browser behavior without a handoff", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  const trigger = await openSearch();
  await typeQuery("林");
  const link = resultLink(`/workspace/people/${PERSON_ID}`);
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })));
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  await act(async () => { workspace.append(destination(`/workspace/people/${PERSON_ID}`)); });
  await settle();
  expect(document.activeElement).toBe(trigger);
});

it("cancels a pending destination handoff when the credential scope expires", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  await act(async () => { window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)); });
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  await act(async () => { workspace.append(heading); });
  await settle();
  expect(document.activeElement).not.toBe(heading);
});

it("cancels the old selection when Search reopens before the close callback settles", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  const trigger = await openSearch(); await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")!;
  await settle(); expect(document.activeElement).toBe(input);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await settle();
  const heading = destination(`/workspace/people/${PERSON_ID}`); workspace.append(heading);
  await settle(); expect(document.activeElement).toBe(trigger);
});

it("invalidates the old binding in layout before a destination mutation can consume it", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch(); await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  await act(async () => {
    // root.render alone only schedules a concurrent update. Commit the binding
    // before publishing the new destination, as React's production layout
    // phase does before a MutationObserver microtask can read committed DOM.
    flushSync(() => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "new-binding" })));
    workspace.append(heading);
  });
  await settle(); expect(document.activeElement).not.toBe(heading);
});

it("cancels on a third committed programmatic route before returning to the target", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch(); await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  navigation.pathname = "/workspace/settings";
  window.history.replaceState(null, "", navigation.pathname);
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  navigation.pathname = `/workspace/people/${PERSON_ID}`;
  window.history.replaceState(null, "", navigation.pathname);
  const heading = destination(navigation.pathname); workspace.append(heading);
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  await settle(); expect(document.activeElement).not.toBe(heading);
});

it("cannot rearm from Radix's delayed close callback after its owner unmounts", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch(); await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  await act(async () => root.unmount());
  root = createRoot(stage);
  const heading = destination(`/workspace/people/${PERSON_ID}`); workspace.append(heading);
  await settle(); expect(document.activeElement).not.toBe(heading);
});

it.each(["?session=other", "#other-section"])("cancels a same-path canonical URL commit with %s", async suffix => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch(); await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  navigation.pathname = `/workspace/people/${PERSON_ID}`;
  window.history.replaceState(null, "", navigation.pathname + suffix);
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  window.history.replaceState(null, "", navigation.pathname);
  const heading = destination(navigation.pathname); workspace.append(heading);
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope" })));
  await settle(); expect(document.activeElement).not.toBe(heading);
});
