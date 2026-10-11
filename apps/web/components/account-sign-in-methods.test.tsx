// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

const actions = vi.hoisted(() => ({
  saveAccountPassword: vi.fn(),
  unlinkLoginMethod: vi.fn(),
  startProviderLink: vi.fn(),
  startPasswordStepUpLink: vi.fn(),
  startProviderReauth: vi.fn(),
  completeStagedPassword: vi.fn(),
  continueTargetLink: vi.fn(),
  completeStagedUnlink: vi.fn(),
}));
vi.mock("@/app/workspace/settings/login-methods/actions", () => actions);

import { AccountDataSync, AccountSignInMethods } from "./account-sign-in-methods";
import { StagedTargetLinkForm } from "@/app/workspace/settings/link-complete/staged-forms";
import type { AccountSettings } from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";

function settings(overrides: Partial<AccountSettings> = {}): AccountSettings {
  return {
    contract_version: CONTRACT_VERSION,
    user: {
      id: "10000000-0000-4000-8000-000000000001",
      email: "owner@example.test",
      display_name: "Owner",
      username: null,
      kind: "google_human",
      revision: 1,
      login_methods: ["google"],
      email_verified_at: "2026-09-25T00:00:00.000Z",
    },
    sign_in_methods: [
      { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
      { provider: "google", state: "connected", hint: "owner@example.test", can_unlink: true },
      { provider: "password", state: "unconnected", hint: null, can_unlink: false },
    ],
    email_ownership_state: "verified",
    workspace: {
      id: "20000000-0000-4000-8000-000000000002",
      name: "Workspace",
      slug: "personal-fixture",
      revision: 1,
      owner_user_id: "10000000-0000-4000-8000-000000000001",
      role: "member",
      is_owner: true,
      can_manage: true,
      is_test: false,
    },
    sessions: [],
    members: [],
    activity: [],
    lab_enabled: false,
    ...overrides,
  };
}

describe("settings sign-in methods", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows the real method state for every provider, including narrow layouts", () => {
    const html = renderToString(<AccountSignInMethods initial={settings()} />);
    expect(html).toContain("登录方式");
    expect(html).toContain("已绑定");
    expect(html).toContain("未绑定");
    // Status is visible per row; the ambiguous action label never carries it.
    expect(html).toContain("绑定");
    // The last-method note belongs to a connected row that cannot be removed.
    const locked = renderToString(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
            { provider: "google", state: "connected", hint: null, can_unlink: false },
            { provider: "password", state: "unconnected", hint: null, can_unlink: false },
          ],
        })}
      />,
    );
    expect(locked).toContain("至少保留一种登录方式");
  });

  it("separates current-account verification from new-provider confirmation", () => {
    const html = renderToString(<AccountSignInMethods initial={settings()} />);
    expect(html).toContain("添加登录方式不会创建工作空间、移动记录或更改主邮箱");
    // The binding review names the original account effect before committing.
    const review = renderToString(
      <StagedTargetLinkForm
        targetProvider="apple"
        note="当前身份已验证。继续连接新的登录方式；完成后仍是你现在的账户。"
        scope={{
          operationRef: "10000000-0000-4000-8000-000000000001",
          accountId: "20000000-0000-4000-8000-000000000002",
          userId: "30000000-0000-4000-8000-000000000003",
          accountRevision: 1,
          userRevision: 1,
        }}
      />,
    );
    expect(review).toContain("将 Apple 绑定到这个账户");
    expect(review).toContain("完成后仍是你现在的账户");
  });

  it("offers provider reauthentication for provider-only accounts", () => {
    const html = renderToString(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "connected", hint: "relay@privaterelay.appleid.com", can_unlink: true },
            { provider: "google", state: "unconnected", hint: null, can_unlink: false },
            { provider: "password", state: "unconnected", hint: null, can_unlink: false },
          ],
        })}
      />,
    );
    // The row offers the first password and the other provider without a
    // mandatory current-password field.
    expect(html).toContain("设置密码");
    expect(html).toContain("绑定");
    expect(html).not.toContain("必须使用密码");
  });

  it("marks legacy-unverified passwords honestly instead of promoting them", () => {
    const html = renderToString(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
            { provider: "google", state: "unconnected", hint: null, can_unlink: false },
            { provider: "password", state: "legacy_unverified", hint: null, can_unlink: false },
          ],
          email_ownership_state: "legacy_unverified",
        })}
      />,
    );
    expect(html).toContain("需要验证邮箱");
    expect(html).toContain("还没有验证邮箱所有权");
  });

  it("claims success only after the readback agrees, and failures never claim the account is unchanged", () => {
    // Verified success: the completion carried the method and expected state
    // and the authoritative settings readback agrees.
    const verified = renderToString(
      <AccountSignInMethods initial={settings()} linkStatus="done" />,
    );
    // A bare completion flag without method verification proves nothing.
    expect(verified).toContain("请核对下方登录方式的实际状态");
    const failed = renderToString(<AccountSignInMethods initial={settings()} linkStatus="error" />);
    expect(failed).toContain("无法确认这次操作的结果");
    expect(failed).not.toContain("没有完成");
    expect(verified).not.toContain("操作已完成");
    expect(failed).not.toContain("账号没有任何更改");
    expect(failed).toContain("请核对下方登录方式的实际状态");
  });

  it("never claims a live sync success; the sync block states automatic behavior", () => {
    const html = renderToString(<AccountDataSync />);
    expect(html).toContain("联系人与对话会自动同步到你的设备");
    expect(html).not.toContain("同步完成");
  });
});

describe("sign-in disclosure (dom)", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
  });

  async function mount(element: ReactElement) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(element));
  }

  it("keeps connected and legacy methods visible and discloses only optional providers", async () => {
    await mount(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
            { provider: "google", state: "connected", hint: "owner@example.test", can_unlink: true },
            { provider: "password", state: "legacy_unverified", hint: null, can_unlink: false },
          ],
        })}
      />,
    );
    const visible = host.querySelector("[data-sign-in-visible]")!;
    expect(visible.textContent).toContain("Google");
    expect(visible.textContent).toContain("密码");
    expect(visible.textContent).not.toContain("Apple");

    const addMethods = host.querySelector<HTMLDetailsElement>("[data-add-login-methods]")!;
    expect(addMethods).toBeTruthy();
    expect(addMethods.open).toBe(false);
    const summary = addMethods.querySelector("summary")!;
    expect(summary.textContent).toBe("添加登录方式（1）");
    expect(addMethods.textContent).toContain("Apple");
    expect(addMethods.textContent).toContain("未绑定");
    expect(addMethods.textContent).toContain("绑定");
  });

  it("makes the disclosure keyboard-operable and reveals the hidden provider", async () => {
    await mount(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
            { provider: "google", state: "connected", hint: null, can_unlink: true },
            { provider: "password", state: "unconnected", hint: null, can_unlink: false },
          ],
        })}
      />,
    );
    const addMethods = host.querySelector<HTMLDetailsElement>("[data-add-login-methods]")!;
    const summary = addMethods.querySelector("summary")!;
    // Native summary is focusable and toggles the disclosure with a click/keyboard activation.
    summary.focus();
    expect(document.activeElement).toBe(summary);
    await act(async () => summary.click());
    expect(addMethods.open).toBe(true);
    expect(addMethods.textContent).toContain("Apple");
  });

  it("does not render the disclosure when every optional provider is already connected", async () => {
    await mount(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "connected", hint: null, can_unlink: true },
            { provider: "google", state: "connected", hint: null, can_unlink: true },
            { provider: "password", state: "connected", hint: null, can_unlink: true },
          ],
        })}
      />,
    );
    expect(host.querySelector("[data-add-login-methods]")).toBeNull();
    expect(host.textContent).toContain("Apple");
    expect(host.textContent).toContain("Google");
  });

  it("puts the data-sync explanation behind a named disclosure", async () => {
    await mount(<AccountDataSync lastObservedAt="2026-09-24T00:00:00.000Z" />);
    const details = host.querySelector<HTMLDetailsElement>("[data-data-sync]")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("数据同步说明");
    expect(details.textContent).toContain("联系人与对话会自动同步到你的设备");
  });
});

const macCallback = "/desktop-auth/authorize?attempt=a&state=b";

function providerOnlySettings() {
  return settings({
    sign_in_methods: [
      { provider: "apple", state: "connected", hint: "relay@privaterelay.appleid.com", can_unlink: true },
      { provider: "google", state: "unconnected", hint: null, can_unlink: false },
      { provider: "password", state: "unconnected", hint: null, can_unlink: false },
    ],
  });
}

describe("connect continuity preselection (GET-141)", () => {
  it("preselects the connecting panel for a provider-only owner with no mandatory password", () => {
    const html = renderToString(
      <AccountSignInMethods initial={providerOnlySettings()} connect="google" returnTo={macCallback} />,
    );
    // Preselected panel with clear consent and current-identity verification.
    expect(html).toContain("将 Google 绑定到这个账户");
    expect(html).toContain("不会创建工作空间、移动记录或更改主邮箱");
    expect(html).toContain("先验证当前身份");
    // The linked provider verifies the current identity; no password field.
    expect(html).toContain("使用 Apple 验证当前身份");
    expect(html).not.toContain("当前密码");
    // The original callback rides along as a hidden return hint.
    expect(html).toContain('name="returnTo"');
    expect(html).toContain(macCallback.replace(/&/g, "&amp;"));
  });

  it("keeps the password-owner step-up path with the same return hint", () => {
    const html = renderToString(
      <AccountSignInMethods
        initial={settings({
          sign_in_methods: [
            { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
            { provider: "google", state: "unconnected", hint: null, can_unlink: false },
            { provider: "password", state: "connected", hint: null, can_unlink: true },
          ],
        })}
        connect="google"
        returnTo={macCallback}
      />,
    );
    expect(html).toContain("将 Google 绑定到这个账户");
    expect(html).toContain("当前密码");
    expect(html).toContain('name="returnTo"');
  });

  it("drops a forged return hint and never emits an external link", () => {
    const html = renderToString(
      <AccountSignInMethods
        initial={providerOnlySettings()}
        connect="google"
        returnTo="https://evil.example/steal"
      />,
    );
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain('name="returnTo"');
  });

  it("never opens the panel when the hinted method is already connected or unknown", () => {
    const connected = renderToString(
      <AccountSignInMethods initial={settings()} connect="google" />,
    );
    expect(connected).not.toContain("将 Google 绑定到这个账户");
    const forged = renderToString(
      <AccountSignInMethods initial={providerOnlySettings()} connect={"password" as never} />,
    );
    expect(forged).not.toContain("绑定到这个账户");
  });
});

describe("connect continuity outcomes (dom)", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    window.history.replaceState({}, "", "/");
  });

  async function mount(element: ReactElement) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(element));
  }

  it("continues the original journey only after the readback-verified success", async () => {
    window.history.replaceState(
      {},
      "",
      `/workspace/settings?section=account&link=done&method=google&state=connected&returnTo=${encodeURIComponent(macCallback)}`,
    );
    await mount(<AccountSignInMethods initial={settings()} />);
    expect(host.textContent).toContain("这个登录方式当前已绑定");
    const cont = host.querySelector<HTMLAnchorElement>("[data-continue-return]")!;
    expect(cont.textContent).toBe("继续之前的工作");
    expect(cont.getAttribute("href")).toBe(macCallback);
  });

  it("a forged success flag claims nothing and keeps only the neutral escape", async () => {
    window.history.replaceState(
      {},
      "",
      `/workspace/settings?section=account&link=done&method=google&state=connected&returnTo=${encodeURIComponent(macCallback)}`,
    );
    // The authoritative readback shows Google is NOT connected.
    await mount(<AccountSignInMethods initial={providerOnlySettings()} />);
    expect(host.textContent).toContain("请核对下方登录方式的实际状态");
    expect(host.textContent).not.toContain("继续之前的工作");
    const escape = host.querySelector<HTMLAnchorElement>("[data-continue-return]")!;
    expect(escape.textContent).toBe("返回之前的工作");
    expect(escape.getAttribute("href")).toBe(macCallback);
  });

  it("keeps cancellation and failure recoverable with the hinted retry panel", async () => {
    window.history.replaceState(
      {},
      "",
      `/workspace/settings?section=account&link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    await mount(<AccountSignInMethods initial={providerOnlySettings()} />);
    expect(host.textContent).toContain("无法确认这次操作的结果");
    expect(host.textContent).not.toContain("继续之前的工作");
    expect(host.querySelector<HTMLAnchorElement>("[data-continue-return]")!.textContent).toBe(
      "返回之前的工作",
    );
    // The connecting panel reopens preselected for a recoverable retry.
    expect(host.textContent).toContain("将 Google 绑定到这个账户");
    expect(host.textContent).toContain("使用 Apple 验证当前身份");
  });

  it("shows a neutral cancelled result that never reopens the panel", async () => {
    window.history.replaceState(
      {},
      "",
      `/workspace/settings?section=account&link=cancelled&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    await mount(<AccountSignInMethods initial={providerOnlySettings()} />);
    expect(host.textContent).toContain("已回到账号设置。登录方式以下方实际状态为准。");
    expect(host.textContent).not.toContain("已取消这次连接。");
    // Cancellation claims nothing and never reopens the connecting panel,
    // even when a connect hint is forged alongside it.
    expect(host.textContent).not.toContain("继续之前的工作");
    expect(host.textContent).not.toContain("将 Google 绑定到这个账户");
    expect(host.querySelector<HTMLAnchorElement>("[data-continue-return]")!.getAttribute("href")).toBe(
      macCallback,
    );
  });

  it("leaves a visible return action after a local panel cancellation", async () => {
    window.history.replaceState(
      {},
      "",
      `/workspace/settings?connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    await mount(<AccountSignInMethods initial={providerOnlySettings()} />);
    expect(host.textContent).toContain("将 Google 绑定到这个账户");
    const cancel = [...host.querySelectorAll("button")].find(
      button => button.textContent === "取消",
    )!;
    await act(async () => cancel.click());
    expect(host.textContent).not.toContain("将 Google 绑定到这个账户");
    const back = host.querySelector<HTMLAnchorElement>("[data-continue-return]")!;
    expect(back.textContent).toBe("返回之前的工作");
    expect(back.getAttribute("href")).toBe(macCallback);
  });
});
