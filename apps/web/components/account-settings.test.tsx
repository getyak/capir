// @vitest-environment happy-dom
import { CONTRACT_VERSION, type AccountSettings } from "@talent-signal/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/workspace/settings/actions", () => ({ saveAccountSettings: vi.fn() }));
vi.mock("./account-sign-in-methods", () => ({
  AccountSignInMethods: () => null,
  AccountDataSync: () => null,
}));
vi.mock("./account-conflict-recovery", () => ({ AccountConflictRecovery: () => null }));
vi.mock("./avatar-editor", () => ({ AvatarEditor: () => null }));

import { AccountSettingsPanel } from "./account-settings";

function account(overrides: Partial<AccountSettings> = {}): AccountSettings {
  return {
    contract_version: CONTRACT_VERSION,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      display_name: "Owner",
      username: null,
      kind: "human",
      revision: 2,
      login_methods: ["password"],
      email_verified_at: null,
    },
    sign_in_methods: [
      { provider: "apple", state: "unconnected", hint: null, can_unlink: false },
      { provider: "google", state: "unconnected", hint: null, can_unlink: false },
      { provider: "password", state: "legacy_unverified", hint: null, can_unlink: false },
    ],
    email_ownership_state: "legacy_unverified",
    workspace: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Workspace",
      slug: "fixture",
      revision: 1,
      owner_user_id: "11111111-1111-4111-8111-111111111111",
      role: "admin",
      is_owner: true,
      can_manage: true,
      is_test: false,
    },
    sessions: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        client_label: "这台 Mac",
        created_at: "2026-09-20T02:00:00.000Z",
        expires_at: "2026-10-20T02:00:00.000Z",
        is_current: true,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        client_label: "iPhone",
        created_at: "2026-09-21T02:00:00.000Z",
        expires_at: "2026-10-21T02:00:00.000Z",
        is_current: false,
      },
    ],
    members: [],
    activity: [],
    lab_enabled: false,
    ...overrides,
  };
}

let root: Root | undefined;
let host: HTMLDivElement;

async function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  vi.clearAllMocks();
});

describe("account settings sessions", () => {
  it("keeps the current session visible and discloses other sessions by count", async () => {
    await mount(<AccountSettingsPanel initial={account()} section="account" embedded />);

    // One selected settings title, no second tabs inside the embedded panel.
    expect(host.querySelector('[aria-label="账号设置"]')).toBeNull();

    const disclosure = host.querySelector<HTMLDetailsElement>("[data-other-sessions]")!;
    expect(disclosure).toBeTruthy();
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector("summary")!.textContent).toBe("其他登录会话（1）");
    expect(disclosure.textContent).toContain("iPhone");
    expect(disclosure.textContent).toContain("退出此会话");

    // The current session is rendered outside the disclosure and stays visible.
    const currentLabel = [...host.querySelectorAll("strong")].find(
      (element) => element.textContent === "这台 Mac",
    )!;
    expect(currentLabel).toBeTruthy();
    expect(disclosure.contains(currentLabel)).toBe(false);
    expect(host.textContent).toContain("当前会话");

    // Revocation consequences stay explicit outside the disclosure.
    expect(host.textContent).toContain("退出会话后，该设备需要重新登录。");
  });

  it("makes the other-sessions disclosure keyboard-operable", async () => {
    await mount(<AccountSettingsPanel initial={account()} section="account" embedded />);
    const disclosure = host.querySelector<HTMLDetailsElement>("[data-other-sessions]")!;
    const summary = disclosure.querySelector("summary")!;
    summary.focus();
    expect(document.activeElement).toBe(summary);
    await act(async () => summary.click());
    expect(disclosure.open).toBe(true);
    expect(disclosure.textContent).toContain("iPhone");
  });

  it("omits the disclosure when there is only the current session", async () => {
    const onlyCurrent = account();
    onlyCurrent.sessions = onlyCurrent.sessions.filter((session) => session.is_current);
    await mount(<AccountSettingsPanel initial={onlyCurrent} section="account" embedded />);
    expect(host.querySelector("[data-other-sessions]")).toBeNull();
    expect(host.textContent).toContain("这台 Mac");
    expect(host.textContent).toContain("当前会话");
  });
});
