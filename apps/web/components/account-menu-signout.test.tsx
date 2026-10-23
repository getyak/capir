// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceAccountMenu } from "./workspace-account-menu";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  delete window.talentSignalDesktop;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each([false, true])("submits the actual desktop presentation flag: %s", async hosted => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (hosted) window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const loading = { status: "loading" } as const;
  await act(async () => root!.render(
    <WorkspaceAccountMenu accountName="Synthetic User" workspaceName={null} signOutAction={() => {}}
      usage={{ subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} }} />,
  ));
  await act(async () => mount.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
  const form = document.querySelector<HTMLFormElement>("[aria-label='账号与空间操作'] form")!;
  expect(new FormData(form).get("desktopHost")).toBe(hosted ? "true" : "false");
});
