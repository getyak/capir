// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PeopleDirectoryReturnList } from "./people-directory-return-list";

const route = vi.hoisted(() => ({ pathname: "/workspace/people" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
const entry = "person-7258d22f-42e3-4d40-ba4d-683a0cc76f7d";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;

async function render(id = entry, href = "/person") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<PeopleDirectoryReturnList className="list">
    <li><a id={id} href={href}>Person</a></li>
  </PeopleDirectoryReturnList>));
  return host.querySelector("a")!;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  window.location.hash = "";
  route.pathname = "/workspace/people";
});

it("restores the named list link with no extra scroll", async () => {
  window.location.hash = entry;
  const focus = vi.spyOn(HTMLAnchorElement.prototype, "focus");
  const link = await render();
  expect(document.activeElement).toBe(link);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  focus.mockRestore();
});

it("preserves an already focused control", async () => {
  window.location.hash = entry;
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  await render();
  expect(document.activeElement).toBe(input);
});

it.each(["", "person-untrusted", entry])("does not focus an absent or unvalidated target: %s", async hash => {
  window.location.hash = hash;
  await render("different-entry");
  expect(document.activeElement).toBe(document.body);
});

it("never focuses a matching target outside this list", async () => {
  window.location.hash = entry;
  const external = document.createElement("a");
  external.id = entry;
  external.href = "/outside";
  document.body.append(external);
  await render("different-entry");
  expect(document.activeElement).toBe(document.body);
});

it("resolves the target inside this list even when a retained surface has the same ID", async () => {
  window.location.hash = entry;
  const external = document.createElement("a");
  external.id = entry;
  external.href = "/outside";
  document.body.append(external);
  const link = await render();
  expect(document.activeElement).toBe(link);
  expect(document.activeElement).not.toBe(external);
});

it("does not focus the hidden directory while another route is active", async () => {
  window.location.hash = entry;
  route.pathname = "/workspace/people/another";
  await render();
  expect(document.activeElement).toBe(document.body);
});

it("restores a retained list on route entry but does not refocus on refresh", async () => {
  window.location.hash = entry;
  route.pathname = "/workspace/people/another";
  const link = await render();
  const view = () => <PeopleDirectoryReturnList className="list">
    <li><a id={entry} href="/person">Person</a></li>
  </PeopleDirectoryReturnList>;
  route.pathname = "/workspace/people";
  await act(async () => root?.render(view()));
  expect(document.activeElement).toBe(link);
  link.blur();
  await act(async () => root?.render(view()));
  expect(document.activeElement).toBe(document.body);
});

it("names the existing directory entry while preserving full query, session and history state", async () => {
  const query = `林 & ${"长".repeat(170)}`;
  const url = new URL("/workspace/people", window.location.origin);
  url.searchParams.set("query", query);
  url.searchParams.set("session", "session-a");
  const state = { navigation: "existing-state" };
  window.history.replaceState(state, "", url.href);
  const replace = vi.spyOn(window.history, "replaceState");
  const link = await render(entry, `/workspace/people/${entry.slice(7)}`);
  link.addEventListener("click", e => e.preventDefault());
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  expect(replace).toHaveBeenCalledExactlyOnceWith(state, "", `${url.href}#${entry}`);
  expect(new URL(window.location.href).searchParams.get("query")).toBe(query);
});

it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("leaves modified clicks alone: %j", async modifier => {
  window.history.replaceState(null, "", "/workspace/people");
  const replace = vi.spyOn(window.history, "replaceState");
  const link = await render(entry, `/workspace/people/${entry.slice(7)}`);
  link.addEventListener("click", e => e.preventDefault());
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...modifier })));
  expect(replace).not.toHaveBeenCalled();
});

it.each(["https://outside.test/workspace/people/7258d22f-42e3-4d40-ba4d-683a0cc76f7d", "/workspace/settings", "/person"])("does not rewrite history for a different destination: %s", async href => {
  window.history.replaceState(null, "", "/workspace/people");
  const replace = vi.spyOn(window.history, "replaceState");
  const link = await render(entry, href);
  link.addEventListener("click", e => e.preventDefault());
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  expect(replace).not.toHaveBeenCalled();
});

it("keeps navigation available when the host refuses history writes", async () => {
  window.history.replaceState(null, "", "/workspace/people");
  const link = await render(entry, `/workspace/people/${entry.slice(7)}`);
  const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => expect(() => link.dispatchEvent(event)).not.toThrow());
  expect(replace).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(false);
});

it("does not name a return entry when the independent avatar is activated", async () => {
  window.history.replaceState(null, "", "/workspace/people");
  const replace = vi.spyOn(window.history, "replaceState");
  const link = await render(entry, `/workspace/people/${entry.slice(7)}`);
  const avatar = document.createElement("button");
  link.parentElement!.prepend(avatar);
  await act(async () => avatar.click());
  expect(replace).not.toHaveBeenCalled();
});
