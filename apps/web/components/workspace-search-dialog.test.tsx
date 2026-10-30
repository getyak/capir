// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const directory = vi.hoisted(() => ({ people: [] as unknown[], sessions: [] as unknown[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
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
    // Suppress happy-dom's actual network/tab navigation for every branch;
    // only model whether Next accepts the SPA onNavigate boundary.
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
    onNavigate?.();
    window.history.pushState(null, "", href);
  }}>{children}</a>,
}));
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { WorkspaceGlobalSearchDialog } from "./workspace-search";
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
let root: Root, stage: HTMLDivElement, workspace: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  directory.people = []; directory.sessions = [];
  window.history.replaceState(null, "", "/workspace/people");
  stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage);
  workspace = document.createElement("div"); workspace.id = "workspace-content"; document.body.append(workspace);
});
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); workspace.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  // happy-dom does not lay out elements; the fixture models one painted final title.
  vi.spyOn(heading, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList);
  heading.tabIndex = -1;
  heading.setAttribute("data-workspace-focus-href", href);
  return heading;
}
function settle(ms = 30): Promise<void> {
  return act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

/** Keep the real Radix Presence/FocusScope mounted through production's exit
 * animation. happy-dom has no CSS animations; only its live animation name and
 * final animationend are fixtures, not the Dialog or autofocus behavior. */
function retainSearchExitAnimation(): void {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((node, pseudo) => {
    const computed = original(node, pseudo);
    if (!(node instanceof HTMLElement) || node.dataset.slot !== "dialog-content") return computed;
    return new Proxy(computed, { get(target, prop) {
      if (prop === "animationName") return node.dataset.state === "open" ? "surface-in" : "veil-out";
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }});
  });
  vi.stubGlobal("getComputedStyle", window.getComputedStyle);
}

async function finishSearchExit(content: HTMLElement): Promise<void> {
  expect(content.dataset.state).toBe("closed");
  await act(async () => {
    const ended = new Event("animationend", { bubbles: true });
    Object.defineProperty(ended, "animationName", { value: "veil-out" });
    content.dispatchEvent(ended);
  });
  await settle();
  expect(document.querySelector("[data-slot=dialog-content]")).toBeNull();
}

async function reopenBeforeSearchExit(href = `/workspace/people/${PERSON_ID}`): Promise<{ trigger: HTMLButtonElement; content: HTMLElement; oldHeading: HTMLHeadingElement }> {
  retainSearchExitAnimation();
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  directory.sessions = [{ session_id: SESSION_ID, title: "林氏周会", state: "active", expires_at: "2099-01-01T00:00:00.000Z" }];
  const trigger = await openSearch();
  await typeQuery("林");
  const selected = resultLink(href);
  await act(async () => { selected.focus(); selected.click(); });
  const content = document.querySelector<HTMLElement>("[data-slot=dialog-content]")!;
  expect(content, "real Presence retains Content during its exit").not.toBeNull();
  expect(content.dataset.state).toBe("closed");
  Object.defineProperty(trigger, "offsetParent", { configurable: true, get: () => stage });
  await act(async () => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })));
  expect(document.querySelector("[data-slot=dialog-content]")).toBe(content);
  expect(content.dataset.state).toBe("open");
  expect(content.querySelector("input")).toHaveProperty("value", "");
  const oldHeading = destination(href, "Previous selection");
  workspace.append(oldHeading);
  return { trigger, content, oldHeading };
}

it.each([
  ["Person navigation", `/workspace/people/${PERSON_ID}`],
  ["same-address Session", `/workspace/sessions/${SESSION_ID}`],
])("focuses the empty input when reopening retained Content after %s", async (_scenario, href) => {
  if (href.includes("/sessions/")) window.history.replaceState(null, "", href);
  const { content } = await reopenBeforeSearchExit(href);
  const input = content.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  await settle();
  expect(document.activeElement).toBe(input);
});

it("does not retake result focus when an already open search rerenders", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch();
  await typeQuery("林");
  const link = resultLink(`/workspace/people/${PERSON_ID}`);
  await act(async () => link.focus());
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "scope", label: "Updated search trigger" })));
  expect(document.activeElement).toBe(link);
});

it.each(["Escape", "close control", "ctrlKey", "metaKey", "shiftKey", "altKey", "_blank"] as const)("forgets an earlier selection when reopened during exit then dismissed with %s", async (activation) => {
  const { trigger, content, oldHeading } = await reopenBeforeSearchExit();
  if (activation === "Escape") {
    await act(async () => content.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  } else if (activation === "close control") {
    await act(async () => content.querySelector<HTMLButtonElement>("[aria-label=关闭搜索]")!.click());
  } else {
    await typeQuery("林");
    const link = resultLink(`/workspace/people/${PERSON_ID}`);
    if (activation === "_blank") link.target = "_blank";
    const modifiers = activation === "_blank" ? {} : { [activation]: true };
    await act(async () => { link.focus(); link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers })); });
  }
  await finishSearchExit(content);
  expect(document.activeElement).toBe(trigger);
  expect(document.activeElement).not.toBe(oldHeading);
});

it("uses only a newly accepted result after reopening the same closing Content", async () => {
  const { content, oldHeading } = await reopenBeforeSearchExit();
  await typeQuery("林");
  const href = `/workspace/sessions/${SESSION_ID}`;
  await vi.waitFor(() => expect(document.querySelector(`[href="${href}"]`)).not.toBeNull());
  const newHeading = destination(href, "New selection");
  workspace.append(newHeading);
  await act(async () => { const link = resultLink(href); link.focus(); link.click(); });
  await finishSearchExit(content);
  expect(document.activeElement).toBe(newHeading);
  expect(document.activeElement).not.toBe(oldHeading);
});
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

it.each(["ctrlKey", "metaKey", "shiftKey", "altKey", "_blank"] as const)("keeps %s activation on browser behavior without a handoff", async (activation) => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  const trigger = await openSearch();
  await typeQuery("林");
  const link = resultLink(`/workspace/people/${PERSON_ID}`);
  if (activation === "_blank") link.target = "_blank";
  const modifiers = activation === "_blank" ? {} : { [activation]: true };
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers })));
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

it("cancels the destination handoff before an account replacement commits", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "new-scope" })));
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  await act(async () => { workspace.append(heading); });
  await settle();
  expect(document.activeElement).not.toBe(heading);
});

it("cancels a delayed destination handoff when its search owner unmounts", async () => {
  directory.people = [{ id: PERSON_ID, display_label: "林夏" }];
  await openSearch();
  await typeQuery("林");
  await act(async () => resultLink(`/workspace/people/${PERSON_ID}`).click());
  await act(async () => root.render(null));
  const heading = destination(`/workspace/people/${PERSON_ID}`);
  await act(async () => { workspace.append(heading); });
  await settle();
  expect(document.activeElement).not.toBe(heading);
});
