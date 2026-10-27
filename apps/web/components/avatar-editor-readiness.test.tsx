// @vitest-environment happy-dom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AvatarEditor } from "./avatar-editor";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
});

function view(scope: string | null = "avatar-readiness") {
  return <AvatarPreferencesProvider scope={scope}>
    <AvatarEditor id="person-one" label="张伟" />
  </AvatarPreferencesProvider>;
}

it("keeps the painted avatar disabled, then opens the editor on one click after hydration", async () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view());
  document.body.append(host);
  const trigger = host.querySelector("button")!;
  expect(trigger.disabled).toBe(true);
  await act(async () => { root = hydrateRoot(host, view()); });
  expect(trigger.disabled).toBe(false);
  await act(async () => {
    trigger.click();
    await import("./avatar-editor-dialog");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(document.querySelector("[data-avatar-editor][role='dialog']")?.textContent).toContain("联系人头像");
});

it("keeps an avatar without an authorized provider disabled after hydration", async () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view(null));
  document.body.append(host);
  await act(async () => { root = hydrateRoot(host, view(null)); });
  const trigger = host.querySelector("button")!;
  expect(trigger.disabled).toBe(true);
  await act(async () => trigger.click());
  expect(document.querySelector("[data-avatar-editor][role='dialog']")).toBeNull();
});

it("keeps the text avatar action discoverable and opens the same authorized editor", async () => {
  const content = <AvatarPreferencesProvider scope="avatar-readiness"><AvatarEditor id="person-one" label="张伟" appearance="text" /></AvatarPreferencesProvider>;
  const host = document.createElement("div");
  host.innerHTML = renderToString(content); document.body.append(host);
  const trigger = host.querySelector("button")!;
  expect(trigger.textContent).toBe("编辑头像");
  expect(trigger.getAttribute("aria-label")).toBe("编辑 张伟 的头像");
  expect(trigger.querySelector("svg")).toBeNull();
  expect(trigger.disabled).toBe(true);
  await act(async () => { root = hydrateRoot(host, content); });
  expect(trigger.disabled).toBe(false);
  await act(async () => { trigger.click(); await import("./avatar-editor-dialog"); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector("[data-avatar-editor][role='dialog']")?.textContent).toContain("联系人头像");
});
