// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SignInState } from "@/app/login/actions";

const feedback = vi.hoisted(() => ({ state: { error: "" } as SignInState }));
vi.mock("react", async importOriginal => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState: () => [feedback.state, vi.fn(), false],
}));
vi.mock("@/app/login/actions", () => ({
  registerPasswordAccount: vi.fn(), signInWithPasswordAccount: vi.fn(),
}));
import { AccountAccessForm } from "./account-access-form";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  feedback.state = { error: "" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = () => act(() => root.render(<AccountAccessForm callbackUrl="/workspace/people" registrationEnabled={false} />));
const failure = () => ({ error: "这个测试空间已达到会话上限。请在已有会话中退出登录后重试。", code: "test_workspace_session_limit", retryable: false } as const);

it("reveals off-screen feedback and focuses it without clearing the form", async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(24, window.innerHeight + 10, 272, 90));
  await render();
  const identifier = host.querySelector<HTMLInputElement>("[name=identifier]")!;
  identifier.focus();
  expect(scroll).not.toHaveBeenCalled();
  feedback.state = failure(); await render();
  const alert = host.querySelector<HTMLElement>("form [role=alert]")!;
  expect(document.activeElement).toBe(alert);
  expect(alert.tabIndex).toBe(-1);
  expect(identifier.getAttribute("aria-describedby")).toBe(alert.id);
  expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
  expect(host.querySelector("[name=password]")).not.toBeNull();
});

it("refocuses a repeated failure and leaves already-visible feedback still", async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(24, 100, 272, 90));
  await render(); feedback.state = failure(); await render();
  const alert = host.querySelector<HTMLElement>("form [role=alert]")!;
  expect(document.activeElement).toBe(alert);
  host.querySelector<HTMLInputElement>("[name=identifier]")!.focus();
  feedback.state = failure(); await render();
  expect(document.activeElement).toBe(alert);
  expect(scroll).not.toHaveBeenCalled();
});
