// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { translate } from "@/lib/i18n";
import { settingsAccount } from "@/lib/test/settings-account";
import { createAvatarStore } from "@/lib/avatar-preferences";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/workspace/settings/actions", () => ({ saveAccountSettings: actions.save }));
vi.mock("./account-sign-in-methods", () => ({ AccountSignInMethods: () => null, AccountDataSync: () => null }));
vi.mock("./account-conflict-recovery", () => ({ AccountConflictRecovery: () => null }));
import { AccountSettingsPanel } from "./account-settings";
import { SettingsWorkspace } from "./settings-workspace";
import { AvatarDefaultSettings, AvatarEditor } from "./avatar-editor";
import AvatarEditorDialog from "./avatar-editor-dialog";
import { AvatarPreferencesProvider } from "./avatar-preferences-provider";
import { LocaleProvider } from "./locale-provider";
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(["en", "ja", "ko", "zh-TW"] as LocaleTag[])("localizes Settings-owned scope chrome in %s and preserves authored names", async locale => {
  const initial = { ...settingsAccount, user: { ...settingsAccount.user, display_name: "我的中文姓名" }, workspace: { ...settingsAccount.workspace, name: "中文原始空间" } };
  for (const [section, scope] of [["overview", "账号 · 本机头像"], ["appearance", "仅此浏览器 · 本机保存"], ["connections", "当前空间 · {name}"]] as const) {
    await act(async () => root.render(<LocaleProvider locale={locale}><SettingsWorkspace initial={initial} section={section} labEnabled={false} sessionVersion="locale" /></LocaleProvider>));
    const expected = translate(locale, scope, { name: "中文原始空间" });
    expect(host.querySelector("[data-settings-scope]")?.textContent).toContain(expected);
    expect(expected).not.toBe(scope);
    if (section === "overview") { expect(host.textContent).toContain("我的中文姓名"); expect(host.textContent).toContain(translate(locale, "更换头像")); expect(host.textContent).not.toContain("更换头像"); }
    if (section === "connections") expect(host.textContent?.match(/中文原始空间/g)).toHaveLength(3);
  }
});
it.each(["en", "ja", "ko", "zh-TW"] as LocaleTag[])("localizes avatar choices and dialog chrome in %s while preserving the person label", async locale => {
  const trigger = document.createElement("button"); host.append(trigger);
  await act(async () => root.render(<LocaleProvider locale={locale}><AvatarPreferencesProvider scope="locale"><AvatarDefaultSettings /><AvatarEditorDialog request={{ id: "one", label: "原始中文姓名", trigger, expected: undefined }} onClose={() => undefined} /></AvatarPreferencesProvider></LocaleProvider>));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("原始中文姓名");
  for (const key of ["联系人头像", "自动", "姓名", "几何", "柔光", "保存头像", "优先照片，没有照片时使用默认风格"]) {
    expect(dialog.textContent).toContain(translate(locale, key));
    if (locale === "en") expect(translate(locale, key)).not.toBe(key);
  }
  expect(dialog.querySelector('input[type="file"]')?.getAttribute("aria-label")).toBe(translate(locale, "选择头像图片"));
  expect(dialog.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(translate(locale, "关闭头像设置"));
  expect(host.querySelector("section")?.textContent).toContain(translate(locale, "柔光"));
});
it("localizes default-avatar save status and owned storage failures", async () => {
  await act(async () => root.render(<LocaleProvider locale="en"><AvatarPreferencesProvider scope="locale"><AvatarDefaultSettings /></AvatarPreferencesProvider></LocaleProvider>));
  const shapes = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Geometry"))!;
  expect(shapes).toBeTruthy();
  await act(async () => shapes.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe(translate("en", "默认头像风格已保存"));
  expect(createAvatarStore("locale", () => localStorage).getSnapshot().defaultStyle).toBe("shapes");
  const storage = window.localStorage;
  vi.spyOn(window, "localStorage", "get").mockReturnValue({ getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage), key: storage.key.bind(storage), get length() { return storage.length; }, setItem: () => { throw new Error("storage full"); } });
  await act(async () => shapes.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(translate("en", "默认风格未保存，请检查浏览器存储后重试。"));
});
it("preserves a supplied upload error verbatim while translating its owned fallback", async () => {
  const trigger = document.createElement("button");
  await act(async () => root.render(<LocaleProvider locale="en"><AvatarPreferencesProvider scope="locale"><AvatarEditorDialog request={{ id: "one", label: "原始中文姓名", trigger, expected: undefined }} onClose={() => undefined} /></AvatarPreferencesProvider></LocaleProvider>));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  Object.defineProperty(file, "type", { configurable: true, get: () => { throw new Error("原始读取错误"); } });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("原始读取错误");
  Object.defineProperty(file, "type", { get: () => { throw null; } });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(translate("en", "图片无法读取，请换一张重试。"));
});
it("preserves caller-authored avatar trigger labels", async () => {
  await act(async () => root.render(<LocaleProvider locale="en"><AvatarEditor id="one" label="中文姓名" triggerLabel="自写中文按钮" /></LocaleProvider>));
  expect(host.textContent).toContain("自写中文按钮");
});

it("localizes account session dates and revocation confirmation while preserving client labels", async () => {
  const initial = { ...settingsAccount, sessions: [{ id: "session", client_label: "中文设备原名", created_at: "2026-09-20T02:00:00.000Z", expires_at: "2026-10-20T02:00:00.000Z", is_current: false }] };
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  await act(async () => root.render(<LocaleProvider locale="en"><AccountSettingsPanel initial={initial} section="account" /></LocaleProvider>));
  expect(host.querySelector("h1")?.textContent).toBe("Account & security");
  expect(host.querySelector("[data-other-sessions] summary")?.textContent).toBe("Other sign-in sessions (1)");
  expect(host.textContent).toContain("中文设备原名");
  expect(host.textContent).toContain(new Date(initial.sessions[0].created_at).toLocaleString("en", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }));
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(confirm).toHaveBeenCalledWith("Sign out the session on “中文设备原名”? That device will need to sign in again.");
  expect(actions.save).not.toHaveBeenCalled();
});
it("localizes workspace roles, member state and name-editor accessibility while preserving names", async () => {
  const initial = { ...settingsAccount, members: [{ id: settingsAccount.user.id, display_name: "中文成员原名", email: "member@example.test", role: "admin" as const, is_owner: true, status: "active" as const }] };
  await act(async () => root.render(<LocaleProvider locale="en"><AccountSettingsPanel initial={initial} section="workspace" embedded /></LocaleProvider>));
  expect(host.querySelector('button[aria-label="Edit Workspace name"]')).toBeTruthy();
  expect(host.textContent).toContain("Owner · Test");
  expect(host.textContent).toContain("中文成员原名 (you)");
  expect(host.textContent).toContain("Owner · Active");
  expect(host.textContent).toContain(settingsAccount.workspace.name);
});
it("localizes owned mutation feedback while preserving backend errors verbatim", async () => {
  for (const result of [{ saved: true }, { error: "原始服务器错误" }]) {
    actions.save.mockReset().mockResolvedValue(result);
    await act(async () => root.render(<LocaleProvider locale="en"><AccountSettingsPanel key={JSON.stringify(result)} initial={settingsAccount} section="profile" embedded /></LocaleProvider>));
    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit Display name"]')!;
    expect(edit).toBeTruthy(); await act(async () => edit.click());
    await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe(result.error ?? translate("en", "已保存并核验。"));
  }
});
