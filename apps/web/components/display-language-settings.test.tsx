// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TalentSignalHttpError, type AccountMutation, type AccountSettings } from "@talent-signal/contracts";
import { settingsAccount } from "@/lib/test/settings-account";
import { LocaleProvider } from "./locale-provider";

const backend = vi.hoisted(() => ({ claims: vi.fn(), update: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: backend.claims }));
vi.mock("@/lib/server/accountBackend", () => ({ updateAccountSettings: backend.update }));
import { DisplayLanguageSettings } from "./display-language-settings";

let root: Root;
let host: HTMLDivElement;
let stored: AccountSettings;
let operations: AccountMutation[];

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  stored = structuredClone(settingsAccount);
  stored.preferences = { display_language: "system" };
  operations = [];
  backend.claims.mockResolvedValue({ backendAccountId: stored.workspace.id, backendUserId: stored.user.id });
  backend.update.mockImplementation(async (input: AccountMutation) => {
    if (operations.some(previous => previous.id === input.id)) throw new Error("operation already used");
    if (input.kind !== "preferences" || input.expected_revision !== stored.user.revision) throw new Error("stale preference");
    operations.push(input);
    stored = { ...stored, user: { ...stored.user, revision: stored.user.revision + 1 }, preferences: { display_language: input.display_language } };
    return stored;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<DisplayLanguageSettings account={settingsAccount} />));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function choose(language: string) {
  const select = host.querySelector<HTMLSelectElement>("select")!;
  await act(() => {
    select.value = language;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function save() {
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
}

it("saves a second language with a new operation and the last confirmed revision", async () => {
  await choose("ja");
  await save();
  expect(stored.preferences?.display_language).toBe("ja");
  await choose("ko");
  await save();
  expect(stored.preferences?.display_language).toBe("ko");
  expect(operations).toHaveLength(2);
  expect(operations[1]!.id).not.toBe(operations[0]!.id);
  expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("ko");
});

it("retries an unconfirmed result with the original operation and language", async () => {
  backend.update.mockRejectedValueOnce(new Error("connection lost"));
  await choose("ja");
  await save();
  const first = backend.update.mock.calls[0]![0];
  expect(host.textContent).toContain("暂时无法核验保存结果");
  expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("ja");
  await save();
  expect(backend.update.mock.calls[1]![0]).toEqual(first);
  expect(stored.preferences?.display_language).toBe("ja");
});

it("keeps the last confirmed revision when a later save needs retrying", async () => {
  await choose("ja");
  await save();
  backend.update.mockRejectedValueOnce(new Error("connection lost"));
  await choose("ko");
  await save();
  const attempt = backend.update.mock.calls[1]![0];
  await save();
  expect(backend.update.mock.calls[2]![0]).toEqual(attempt);
  expect(stored.preferences?.display_language).toBe("ko");
});

it("shows an intervening account change after an uncertain save instead of a false success", async () => {
  backend.update.mockImplementationOnce(async (input: AccountMutation) => {
    operations.push(input);
    stored = { ...stored, user: { ...stored.user, revision: 2 }, preferences: { display_language: "ja" } };
    throw new Error("response lost after commit");
  });
  await choose("ja");
  await save();
  stored = { ...stored, user: { ...stored.user, revision: 3 }, preferences: { display_language: "ko" } };
  backend.update.mockImplementationOnce(async () => stored);
  await save();
  expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("ko");
  expect(host.textContent).toContain("界面语言已在另一端改变");
  expect(host.textContent).not.toContain("已保存。");
  expect(host.querySelector<HTMLInputElement>('[name="revision"]')!.value).toBe("3");
  await choose("en");
  await save();
  expect(stored.preferences?.display_language).toBe("en");
});

it.each([
  { locale: "ja", expired: "ログインまたはテストセッションの期限が切れました。ご自身のワークスペースに戻って再試行してください。", stale: "プロフィールまたは権限が変更されました。ページを再読み込みし、最新の内容を確認してから送信してください。", unknown: "保存結果を確認できません。現在の内容を保持したまま、同じ操作を再試行するか、ページを再読み込みして確認してください。" },
  { locale: "ko", expired: "로그인 또는 테스트 세션이 만료되었습니다. 본인 작업 공간으로 돌아가 다시 시도해 주세요.", stale: "프로필 또는 권한이 변경되었습니다. 페이지를 새로고침하고 최신 내용을 확인한 뒤 제출해 주세요.", unknown: "저장 결과를 확인할 수 없습니다. 현재 내용을 유지한 채 같은 작업을 다시 시도하거나 새로고침하여 확인해 주세요." },
] as const)("localizes expired, stale and uncertain-save recovery in $locale without losing the draft", async variant => {
  await act(() => root.render(<LocaleProvider locale={variant.locale}><DisplayLanguageSettings account={settingsAccount} /></LocaleProvider>));
  await choose("en");
  backend.claims.mockRejectedValueOnce(new Error("expired test session"));
  await save();
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe(variant.expired);
  backend.update.mockRejectedValueOnce(new TalentSignalHttpError(409, "ACCOUNT_STALE", "Refresh before saving", null));
  await save();
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe(variant.stale);
  backend.update.mockRejectedValueOnce(new Error("response unavailable"));
  await save();
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe(variant.unknown);
  expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("en");
  const attempt = backend.update.mock.calls.at(-1)![0];
  await save();
  expect(backend.update.mock.calls.at(-1)![0]).toEqual(attempt);
  expect(stored.preferences?.display_language).toBe("en");
});

it("withdraws an older language success after another selection without reviving it on a round trip", async () => {
  await choose("ja"); await save();
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe("已保存。");
  await choose("ko");
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe("");
  await choose("ja");
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe("");
});
it("withdraws an older language failure when a different intent begins", async () => {
  backend.update.mockRejectedValueOnce(new Error("connection lost"));
  await choose("ja"); await save();
  const first = backend.update.mock.calls[0]![0];
  expect(host.textContent).toContain("暂时无法核验保存结果");
  await choose("ko");
  expect(host.querySelector("[aria-live=polite]")?.textContent).toBe("");
  await save();
  expect(stored.preferences?.display_language).toBe("ko");
  expect(backend.update.mock.calls[1]![0].id).not.toBe(first.id);
});
