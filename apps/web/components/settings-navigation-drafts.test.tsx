// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ children, ...props }: { children?: ReactNode; href: string }) =>
    React.createElement("a", props, children) };
});
vi.mock("@/app/workspace/settings/actions", () => ({ saveAccountSettings: save }));
vi.mock("./account-sign-in-methods", () => ({ AccountSignInMethods: () => null, AccountDataSync: () => null }));
vi.mock("./account-conflict-recovery", () => ({ AccountConflictRecovery: () => null }));
import { SettingsWorkspace } from "./settings-workspace";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { settingsAccount } from "@/lib/test/settings-account";
import type { SettingsSection } from "@/lib/settings-sections";

let root: Root;
let host: HTMLDivElement;
const account = { ...settingsAccount, user: { ...settingsAccount.user, kind: "human" as const } };
function render(section: SettingsSection, initial = account, sessionVersion = "session-a") {
  return act(() => root.render(
    <AvatarPreferencesProvider scope="settings-draft-test">
      <SettingsWorkspace initial={initial} labEnabled={false} section={section} sessionVersion={sessionVersion} />
    </AvatarPreferencesProvider>,
  ));
}
function pane(section: SettingsSection) {
  return host.querySelector<HTMLElement>(`[data-settings-pane="${section}"]`)!;
}
async function edit(section: "overview" | "workspace", value: string) {
  await render(section);
  const button = pane(section).querySelector<HTMLButtonElement>('button[aria-label^="编辑"][aria-label$="名称"]')!;
  expect(button).toBeTruthy();
  await act(() => button.click());
  const input = pane(section).querySelector<HTMLInputElement>('input[name="name"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  save.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains independent profile and workspace drafts without writing them", async () => {
  const profile = await edit("overview", "Unsaved profile");
  const workspace = await edit("workspace", "Unsaved workspace");
  expect(pane("overview").hidden).toBe(true);
  await render("connections");
  await render("overview");
  expect(pane("overview").hidden).toBe(false);
  expect(pane("overview").querySelector("input[name=name]")).toBe(profile);
  expect(profile.value).toBe("Unsaved profile");
  await render("workspace");
  expect(pane("workspace").querySelector("input[name=name]")).toBe(workspace);
  expect(workspace.value).toBe("Unsaved workspace");
  expect(save).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it("preserves the draft, failure and retry identity across categories", async () => {
  await edit("overview", "Draft after failure");
  save.mockResolvedValueOnce({ error: "Unable to save. Retry." });
  await act(() => pane("overview").querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  const first = save.mock.calls[0][1] as FormData;
  await render("account");
  await render("overview");
  expect(pane("overview").textContent).toContain("Unable to save. Retry.");
  expect(pane("overview").querySelector<HTMLInputElement>("input[name=name]")?.value).toBe("Draft after failure");
  save.mockResolvedValueOnce({ saved: true, data: { ...account, user: { ...account.user, display_name: "Draft after failure", revision: 2 } } });
  await act(() => pane("overview").querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect((save.mock.calls[1][1] as FormData).get("operationId")).toBe(first.get("operationId"));
  expect(pane("overview").querySelector("input[name=name]")).toBeNull();
  await render("connections");
  await render("overview");
  expect(pane("overview").textContent).toContain("Draft after failure");
});

it("retains an unsaved display language when navigating away and back", async () => {
  await render("appearance");
  const select = pane("appearance").querySelector<HTMLSelectElement>('select[name="display_language"]')!;
  expect(select).toBeTruthy();
  await act(() => {
    select.value = "ja";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await render("overview");
  await render("appearance");
  expect(pane("appearance").querySelector<HTMLSelectElement>('select[name="display_language"]')?.value).toBe("ja");
  expect(save).not.toHaveBeenCalled();
});

it.each(["account", "workspace", "session"] as const)("drops retained drafts at the %s boundary", async boundary => {
  await edit("overview", "Private draft");
  await render("connections");
  const changed = {
    ...account,
    user: { ...account.user, id: boundary === "account" ? "another-user" : account.user.id },
    workspace: { ...account.workspace, id: boundary === "workspace" ? "another-workspace" : account.workspace.id },
  };
  await render("overview", changed, boundary === "session" ? "session-b" : "session-a");
  expect(host.textContent).not.toContain("Private draft");
  expect(host.querySelector("input[name=name]")).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
