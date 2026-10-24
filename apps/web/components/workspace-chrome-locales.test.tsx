// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { HealthNotice, SystemHealthProvider, useSystemHealth } from "./system-health-provider";
import type { WeeklyUsageStore } from "@/lib/weekly-usage";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace" }));
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: request }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
const loading = { status: "loading" } as const;
const store: WeeklyUsageStore = { subscribe: () => () => {}, getSnapshot: () => loading, refresh() {}, dispose() {} };
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ordinary workspace locale and observation boundary", () => {
  it.each([
    ["en", "Account and workspace actions", "Recorded runs this week", "Help and support", "Appearance", "Sign out"],
    ["zh-CN", "账号与空间操作", "本周已记录运行", "帮助与支持", "外观", "退出登录"],
    ["zh-TW", "帳號與空間操作", "本週已記錄執行", "說明與支援", "外觀", "退出登錄"],
    ["ja", "アカウントとワークスペースの操作", "今週の実行記録", "ヘルプとサポート", "外観", "ログアウト"],
    ["ko", "계정 및 워크스페이스 작업", "이번 주 실행 기록", "도움말 및 지원", "화면", "로그아웃"],
  ] as const)("localizes the %s account popover without translating identity", async (locale, label, usage, help, appearance, signOut) => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<LocaleProvider locale={locale}><WorkspaceAccountMenu accountName="王小明" workspaceName="原始空间" signOutAction={() => {}} usage={store} /></LocaleProvider>));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-slot='account-trigger']")!.click());
    const menu = document.querySelector<HTMLElement>("[data-slot='popover-content']")!;
    expect(menu.getAttribute("aria-label")).toBe(label);
    for (const text of [usage, help, appearance, signOut, "王小明", "原始空间"]) expect(menu.textContent).toContain(text);
    if (locale === "en") expect(menu.textContent).not.toMatch(/本周|退出登录|工作区设置|读取中|外观/);
  });

  it("localizes missing identity labels without inventing a recruiting role", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<LocaleProvider locale="en"><WorkspaceAccountMenu accountName=" " workspaceName={null} signOutAction={() => {}} usage={store} /></LocaleProvider>));
    expect(host.querySelector("[data-slot='account-trigger']")?.getAttribute("aria-label")).toBe("Account · Personal workspace");
    expect(host.textContent).not.toMatch(/招聘顾问|个人工作区/);
  });

  it("uses English for an unconfirmed health read without asserting an outage", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<LocaleProvider locale="en"><HealthNotice value={{ observation: null, phase: "error", refreshing: false, stale: false, refresh: async () => {} }} /></LocaleProvider>));
    expect(host.textContent).toContain("Service status cannot be confirmed right now.");
    expect(host.textContent).not.toMatch(/unavailable|服务/);
    expect(host.querySelector("aside")?.getAttribute("data-tone")).toBe("warning");
  });

  it("does not manufacture a backend observation when browser transport fails", async () => {
    request.mockRejectedValue(new TypeError("synthetic browser offline"));
    function Probe() { const value = useSystemHealth(); return <output>{JSON.stringify({ phase: value.phase, observation: value.observation })}</output>; }
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<LocaleProvider locale="en"><SystemHealthProvider><Probe /></SystemHealthProvider></LocaleProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual({ phase: "error", observation: null });
    expect(host.textContent).toContain("Service status cannot be confirmed right now.");
  });
});
