// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { LoginMethodActionState } from "../login-methods/actions";

const actions = vi.hoisted(() => ({ completeStagedPassword: vi.fn(), continueTargetLink: vi.fn() }));
vi.mock("@/app/workspace/settings/login-methods/actions", () => actions);
import { StagedPasswordForm } from "./staged-forms";

const passwordPath = "/workspace/settings/link-complete/password";
const ref = "60000000-0000-4000-8000-000000000006";
const resultUrl = `${passwordPath}?result=${ref}`;
const scope = { operationRef: ref, accountId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000002", accountRevision: 2, userRevision: 3 };
const unknown: LoginMethodActionState = { passwordResult: { ref, state: "unknown" }, error: "结果尚未确认" };
let root: Root | undefined;
let host: HTMLDivElement;
let releasePending: (() => void) | undefined;
function element(resultRef?: string) {
  // Object spread permits the new optional result hint without inventing a
  // future export or counting a TypeScript excess-prop error as behavioral RED.
  const props = { intent: "change_password" as const, scope, ...(resultRef ? { resultRef } : {}) };
  return <StagedPasswordForm {...props} />;
}
async function mount(resultRef?: string) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(element(resultRef)); });
}
function recoveryLink() { return host.querySelector<HTMLAnchorElement>(`a[href="${resultUrl}"]`); }
function fillPassword() {
  const input = host.querySelector<HTMLInputElement>('input[name="newPassword"]');
  expect(input).not.toBeNull(); input!.value = "synthetic-ui-password"; return input!;
}
async function submit() {
  const form = host.querySelector("form"); expect(form).not.toBeNull();
  await act(async () => { form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
beforeEach(() => {
  actions.completeStagedPassword.mockReset(); actions.continueTargetLink.mockReset();
  actions.completeStagedPassword.mockResolvedValue(unknown);
  window.history.replaceState(null, "", passwordPath);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => { releasePending?.(); }); releasePending = undefined;
  await act(async () => { root?.unmount(); }); root = undefined; host?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/");
});

describe("staged password recovery form", () => {
  it("renders a plain GET recovery link before the first save, without a password or proof value", () => {
    const html = renderToString(element());
    expect(html).toContain(`href="${resultUrl}"`);
    expect(html).toContain('name="newPassword"');
    expect(html).not.toContain("synthetic-ui-password");
    expect(html).not.toContain("attempt_secret"); expect(html).not.toContain("challenge_nonce");
  });
  it("makes a matching result URL read-only from the first render", async () => {
    await mount(ref);
    expect(host.querySelector('input[name="newPassword"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[name="passwordMode"]')?.value).toBe("check");
    expect(host.textContent).toContain("检查结果"); expect(host.textContent).not.toContain("已保存并核验");
    expect(actions.completeStagedPassword).not.toHaveBeenCalled();
  });
  it("preserves a null-state recovery URL before dispatch while the real FormData still contains the password", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword();
    const replace = vi.spyOn(window.history, "replaceState");
    actions.completeStagedPassword.mockImplementation(async (_state: LoginMethodActionState, data: FormData) => {
      expect(window.location.pathname + window.location.search).toBe(resultUrl);
      expect(data.get("newPassword")).toBe("synthetic-ui-password");
      expect(data.get("passwordMode")).toBe("save"); return unknown;
    });
    await submit();
    expect(actions.completeStagedPassword).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(null, "", resultUrl);
    expect(host.querySelector('input[name="newPassword"]')).toBeNull();
  });
  it("fences a same-turn double submit before React pending state can disable the button", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword();
    const pending = new Promise<LoginMethodActionState>((resolve) => { releasePending = () => resolve(unknown); });
    actions.completeStagedPassword.mockReturnValue(pending);
    const form = host.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(actions.completeStagedPassword).toHaveBeenCalledTimes(1);
    await act(async () => { releasePending!(); }); releasePending = undefined;
    expect(actions.completeStagedPassword).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch a save when preserving recovery navigation fails", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword();
    vi.spyOn(window.history, "replaceState").mockImplementation(() => { throw new Error("synthetic history failure"); });
    await submit();
    expect(actions.completeStagedPassword).not.toHaveBeenCalled();
    expect(host.querySelector('input[name="newPassword"]')).not.toBeNull();
    expect(host.textContent).toContain("恢复入口");
  });
  it("checks an unknown outcome without resubmitting the password and confirms only the matching readback", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword(); await submit();
    expect(host.querySelector('input[name="newPassword"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[name="passwordMode"]')?.value).toBe("check");
    actions.completeStagedPassword.mockImplementation(async (_state: LoginMethodActionState, data: FormData) => {
      expect(data.get("passwordMode")).toBe("check"); expect(data.get("newPassword")).toBeNull();
      return { passwordResult: { ref, state: "applied" }, saved: true };
    });
    await submit(); expect(actions.completeStagedPassword).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("已保存并核验"); expect(host.querySelector('input[name="newPassword"]')).toBeNull();
  });
  it("restores editing only after a matching known local rejection", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword();
    actions.completeStagedPassword.mockResolvedValue({ passwordResult: { ref, state: "editing" }, error: "请调整新密码" });
    await submit();
    expect(host.querySelector('input[name="newPassword"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[name="passwordMode"]')?.value).toBe("save");
    fillPassword(); await submit(); expect(actions.completeStagedPassword).toHaveBeenCalledTimes(2);
  });
  it("keeps a mismatched returned operation in recovery instead of restoring its editor", async () => {
    await mount(); expect(recoveryLink()).not.toBeNull(); fillPassword();
    actions.completeStagedPassword.mockResolvedValue({ passwordResult: { ref: "70000000-0000-4000-8000-000000000007", state: "editing" } });
    await submit();
    expect(host.querySelector('input[name="newPassword"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[name="passwordMode"]')?.value).toBe("check");
    expect(host.textContent).not.toContain("已保存并核验");
  });
});
