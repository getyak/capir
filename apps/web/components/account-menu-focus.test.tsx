// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
});
