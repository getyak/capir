// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import type { WeeklyUsageStore } from "@/lib/weekly-usage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
const loading = { status: "loading" } as const;
const loadingStore: WeeklyUsageStore = {
  subscribe: () => () => {}, getSnapshot: () => loading, refresh() {}, dispose() {},
};
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("account avatar modal layering", () => {
  it("keeps the account surface through avatar editing and returns focus in two steps", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(
      <AvatarPreferencesProvider scope="popover-test">
        <WorkspaceAccountMenu accountName="Synthetic User" workspaceName={null}
          signOutAction={() => {}} usage={loadingStore} />
      </AvatarPreferencesProvider>,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
    const content = document.querySelector<HTMLElement>("[aria-label='账号与空间操作']")!;
    const avatar = content.querySelector<HTMLButtonElement>("[aria-label='编辑我的头像']")!;
    await act(async () => {
      avatar.click();
      await import("./avatar-editor-dialog");
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const editor = document.querySelector<HTMLElement>("[data-avatar-editor][role='dialog']")!;
    expect(editor).not.toBeNull();
    expect(content.getAttribute("data-state")).toBe("open");
    await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.querySelector("[data-avatar-editor][role='dialog']")).toBeNull();
    expect(content.getAttribute("data-state")).toBe("open");
    expect(document.activeElement).toBe(avatar);
    await act(async () => avatar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(host.querySelector("[data-slot='account-trigger']"));
  });
  it("dismisses a reopened focused avatar before document Escape registration, keeping the parent and draft", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(
      <AvatarPreferencesProvider scope="fast-avatar-dismiss">
        <WorkspaceAccountMenu accountName="Synthetic User" workspaceName={null}
          signOutAction={() => {}} usage={loadingStore} />
      </AvatarPreferencesProvider>,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
    const content = document.querySelector<HTMLElement>("[aria-label='账号与空间操作']")!;
    const avatar = content.querySelector<HTMLButtonElement>("[aria-label='编辑我的头像']")!;
    // Model the observed mount interval: the focused modal is usable before
    // the library's document capture listener for its highest layer arrives.
    const subscribe = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "keydown" && typeof options === "object" && options.capture) return;
      subscribe(type, listener, options);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => {
        avatar.click();
        await import("./avatar-editor-dialog");
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      const editor = document.querySelector<HTMLElement>("[data-avatar-editor][role='dialog']")!;
      expect(editor.contains(document.activeElement)).toBe(true);
      if (attempt === 0) {
        const cancel = Array.from(editor.querySelectorAll("button")).find(button => button.textContent === "取消")!;
        await act(async () => cancel.click());
      } else {
        await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      }
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(document.querySelector("[data-avatar-editor][role='dialog']")).toBeNull();
      expect(content.getAttribute("data-state")).toBe("open");
      expect(document.activeElement).toBe(avatar);
    }
  });

});
