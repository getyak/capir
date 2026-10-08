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

async function render(id = entry) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<PeopleDirectoryReturnList className="list">
    <li><a id={id} href="/person">Person</a></li>
  </PeopleDirectoryReturnList>));
  return host.querySelector("a")!;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
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
