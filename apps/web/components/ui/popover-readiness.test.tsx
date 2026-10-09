// @vitest-environment happy-dom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function view(disabled = false) {
  return <Popover><PopoverTrigger asChild disabled={disabled}>
    <button type="button">Account</button>
  </PopoverTrigger><PopoverContent>Usage</PopoverContent></Popover>;
}

it("keeps the server trigger disabled, then accepts one real click after hydration", async () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view());
  document.body.append(host);
  const button = host.querySelector("button")!;
  expect(button.disabled).toBe(true);
  await act(async () => { root = hydrateRoot(host, view()); });
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector("[data-slot='popover-content']")?.textContent).toBe("Usage");
});

it("preserves a caller's disabled state after hydration", async () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view(true));
  document.body.append(host);
  await act(async () => { root = hydrateRoot(host, view(true)); });
  const button = host.querySelector("button")!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
