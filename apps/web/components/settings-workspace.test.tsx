// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ children, ...props }: { children?: ReactNode; href: string }) =>
      React.createElement("a", { ...props, "data-next-link": "" }, children),
  };
});
vi.mock("@/app/workspace/settings/actions", () => ({ saveAccountSettings: save }));
vi.mock("./account-sign-in-methods", () => ({ AccountSignInMethods: () => null, AccountDataSync: () => null }));
vi.mock("./account-conflict-recovery", () => ({ AccountConflictRecovery: () => null }));
import { AccountSettingsPanel } from "./account-settings";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { settingsAccount } from "@/lib/test/settings-account";
let root: Root; let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(() => root.render(<AvatarPreferencesProvider scope="settings-test"><AccountSettingsPanel initial={settingsAccount} section="profile" embedded /></AvatarPreferencesProvider>));
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent === text || el.getAttribute("aria-label") === text)!;
  expect(button).toBeTruthy(); await act(() => button.click());
}
/**
 * Submit through the real save submit button, the user path for this form.
 * A bare `requestSubmit()` is not equivalent here: happy-dom then reports the
 * form itself as `event.submitter`, which react-dom 19.3 forwards into
 * `new FormData(form, submitter)` and happy-dom rejects as unowned. Browsers
 * report a null submitter in that case (the spec maps a form submitter to
 * null on the event), so this is a test-environment artifact, not the product
 * submission path.
 */
async function submit() {
  const button = host.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
function submittedForm(call: number): FormData {
  return save.mock.calls[call]![1] as FormData;
}
it("makes editing explicit and discards a cancelled name draft", async () => {
  expect(host.querySelector('input[name="name"]')).toBeNull();
  expect(host.textContent).toContain("更换头像");
  expect(host.querySelector("details")?.open).toBe(false);
  await click("编辑显示名称");
  const input = host.querySelector<HTMLInputElement>('input[name="name"]')!;
  expect(document.activeElement).toBe(input);
  input.value = "未保存的名字";
  await click("取消"); await click("编辑显示名称");
  expect(host.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(settingsAccount.user.display_name);
  expect(save).not.toHaveBeenCalled();
});
it("opens the profile editor as a document navigation for the macOS window handoff", () => {
  const edit = host.querySelector<HTMLAnchorElement>('a[href^="/onboarding?edit=true"]');
  expect(edit?.textContent).toContain("编辑资料");
  expect(edit?.hasAttribute("data-next-link")).toBe(false);
});
it("keeps the editable name and recovery message after a failed save, then retries the same operation", async () => {
  save.mockResolvedValueOnce({ error: "资料已更新，请重新载入后重试。" });
  await click("编辑显示名称");
  const input = host.querySelector<HTMLInputElement>('input[name="name"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "新名字");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  expect(save).toHaveBeenCalledTimes(1);
  expect(submittedForm(0).get("name")).toBe("新名字");
  expect(host.textContent).toContain("资料已更新");
  expect(host.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe("新名字");
  save.mockResolvedValueOnce({ saved: true, data: { ...settingsAccount,
    user: { ...settingsAccount.user, display_name: "新名字" } } });
  await submit();
  expect(save).toHaveBeenCalledTimes(2);
  expect(submittedForm(1).get("name")).toBe("新名字");
  expect(submittedForm(1).get("operationId")).toBeTruthy();
  expect(submittedForm(1).get("operationId")).toBe(submittedForm(0).get("operationId"));
  expect(host.querySelector('input[name="name"]')).toBeNull();
  expect(host.textContent).toContain("新名字");
});

it("saves the profile avatar through the shared editor and restores its labelled trigger", async () => {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="编辑我的头像"]')!;
  expect(trigger.textContent).toContain("更换头像");
  await act(async () => { trigger.click(); await import("./avatar-editor-dialog"); });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const controls = [...dialog.querySelectorAll("button")];
  const shapes = controls.find(button => button.querySelector(":scope > span:last-of-type")?.textContent === "几何")!;
  await act(() => shapes.click());
  await act(async () => controls.find(button => button.textContent === "保存头像")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(trigger.querySelector('[data-avatar-style]')?.getAttribute("data-avatar-style")).toBe("shapes");
  expect(JSON.parse(localStorage.getItem("talent-signal:avatars:v1:settings-test")!).people.self.style).toBe("shapes");
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(save).not.toHaveBeenCalled();
});
