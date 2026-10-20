// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type AgentPreferenceResponse, type LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";

const requests = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: requests.fetch }));
import { AgentResponsePreference } from "./agent-response-preference";

let root: Root;
let host: HTMLDivElement;
let stored: AgentPreferenceResponse;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  stored = { contract_version: CONTRACT_VERSION, preference: { response_style: "default", prompt_output_language: "system", revision: 0, updated_at: null, provenance: null } };
  requests.fetch.mockImplementation(async (_path, init) => {
    if (init.method === "PUT") {
      const input = JSON.parse(init.body);
      stored = { ...stored, preference: { ...stored.preference, response_style: input.response_style, prompt_output_language: input.prompt_output_language,
        revision: stored.preference.revision + 1, updated_at: "2026-10-20T00:00:00.000Z", provenance: { kind: "user_setting", user_id: "11111111-1111-4111-8111-111111111111", source_id: "user-preference:11111111-1111-4111-8111-111111111111:1" } } };
    }
    return Response.json(stored);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const variants = [
  { locale: "ja", heading: "返信設定", save: "設定を保存", reload: "再読み込み", loading: "確認中…", saved: "保存しました。新しい会話にこの設定を使用します。", disabled: "このワークスペースでは返信設定はまだ利用できません。", changed: "別の端末で設定が変更されました。再読み込みしてください。", failed: "返信設定を読み込めません。しばらくしてから再試行してください。" },
  { locale: "ko", heading: "응답 환경설정", save: "환경설정 저장", reload: "다시 읽기", loading: "확인 중…", saved: "저장했습니다. 새 대화에 이 설정을 사용합니다.", disabled: "이 작업 공간에서는 응답 환경설정이 아직 활성화되지 않았습니다.", changed: "다른 기기에서 환경설정이 변경되었습니다. 다시 읽어 주세요.", failed: "응답 환경설정을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요." },
] as const;

async function render(locale: LocaleTag) {
  await act(async () => root.render(<LocaleProvider locale={locale}><AgentResponsePreference sessionVersion="current-session" /></LocaleProvider>));
}

it.each(variants)("localizes loading, save, success and reread controls in $locale", async variant => {
  let finish!: (response: Response) => void;
  requests.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(variant.locale);
  expect(host.querySelector("h1")?.textContent).toBe(variant.heading);
  expect(host.querySelector("button")?.textContent).toBe(variant.loading);
  await act(async () => finish(Response.json(stored)));
  const language = host.querySelector<HTMLSelectElement>("[data-prompt-language]")!;
  await act(() => { language.value = "en"; language.dispatchEvent(new Event("change", { bubbles: true })); });
  const save = host.querySelector<HTMLButtonElement>("button")!;
  expect(save.textContent).toBe(variant.save);
  await act(async () => save.click());
  expect(stored.preference.prompt_output_language).toBe("en");
  expect(host.querySelector("[role=status]")?.textContent).toBe(variant.saved);
  const reload = host.querySelectorAll<HTMLButtonElement>("button")[1]!;
  expect(reload.textContent).toBe(variant.reload);
  await act(async () => reload.click());
  expect(host.querySelector("[role=status]")).toBeNull();
  expect(language.value).toBe("en");
});

it.each(variants)("localizes disabled-workspace and network errors in $locale", async variant => {
  requests.fetch.mockResolvedValueOnce(Response.json({ code: "AGENT_PREFERENCES_DISABLED", message: "not enabled for this workspace" }, { status: 403 }));
  await render(variant.locale);
  expect(host.querySelector("[role=alert]")?.textContent).toBe(variant.disabled);
  requests.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe(variant.failed);
});

it.each(variants)("explains a save conflict in $locale without claiming success", async variant => {
  await render(variant.locale);
  const language = host.querySelector<HTMLSelectElement>("[data-prompt-language]")!;
  await act(() => { language.value = "en"; language.dispatchEvent(new Event("change", { bubbles: true })); });
  requests.fetch.mockResolvedValueOnce(Response.json({ code: "AGENT_PREFERENCE_CHANGED", message: "Read the current preference before saving your change." }, { status: 409 }));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe(variant.changed);
  expect(host.querySelector("[role=status]")).toBeNull();
  expect(language.value).toBe("en");
});

it.each([
  ["en", "Automatic replies follow the current request's language and affect generated text only."],
  ["zh-CN", "自动时按当前请求的语言回复，只影响助手生成的内容。"],
  ["zh-TW", "自動時依目前請求的語言回覆，只影響助手產生的內容。"],
  ["ja", "自動設定では現在のリクエストの言語で返信し、生成する文章だけに適用されます。"],
  ["ko", "자동 설정에서는 현재 요청의 언어로 응답하며, 생성되는 텍스트에만 적용됩니다."],
] as const)("describes automatic request-language output in %s", (locale, hint) => {
  const html = renderToStaticMarkup(<LocaleProvider locale={locale}><AgentResponsePreference sessionVersion="current-session" /></LocaleProvider>);
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(container.textContent).toContain(hint);
});
