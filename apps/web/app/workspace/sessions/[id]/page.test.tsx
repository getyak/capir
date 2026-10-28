import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";

const state = vi.hoisted(() => ({
  locale: "en" as LocaleTag,
  auth: vi.fn(), claims: vi.fn(), load: vi.fn(), mint: vi.fn(), meetings: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: state.claims }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
vi.mock("@/lib/server/memoryEntryCapability", () => ({ mintMemoryEntryCapability: state.mint }));
vi.mock("@/lib/server/contact-handoff-session", () => ({ contactHandoffSessionVersion: () => "binding" }));
vi.mock("@/lib/server/meetingDrafts", () => ({ loadMeetingDrafts: state.meetings }));
vi.mock("@/components/session-workbench/session-workbench", () => ({ SessionWorkbench: () => null }));
vi.mock("@/lib/server/workspaceSessions", () => ({
  isWorkspaceSessionId: () => true,
  loadWorkspaceSession: state.load,
  workspaceSessionDetailWire: (detail: unknown) => detail,
  workspaceSessionDraftStorageScope: () => "storage-scope",
  workspaceSessionsBinding: () => "binding",
}));

import SessionDetailPage, { generateMetadata } from "./page";
import { BackendSessionExpiredError, backendSessionRecoveryHref } from "@/lib/backend-session";

const sessionId = "11111111-1111-4111-8111-111111111111";
const locales: [LocaleTag, string, string, string, string][] = [
  ["en", "Conversation unavailable", "This conversation could not be loaded.", "Your session expired. Sign in again to view this conversation.", "Back to conversations"],
  ["zh-CN", "对话不可用", "无法读取这段对话。", "登录已过期，请重新登录后查看这段对话。", "返回对话列表"],
  ["zh-TW", "對話無法開啟", "無法讀取這段對話。", "登入已過期，請重新登入後查看這段對話。", "返回對話列表"],
  ["ja", "会話を開けません", "この会話を読み込めませんでした。", "ログインの有効期限が切れました。もう一度ログインして、この会話を確認してください。", "会話一覧に戻る"],
  ["ko", "대화를 열 수 없습니다", "이 대화를 불러오지 못했습니다.", "로그인이 만료되었습니다. 다시 로그인하여 이 대화를 확인하세요.", "대화 목록으로 돌아가기"],
];

const render = async () => renderToStaticMarkup(await SessionDetailPage({ params: Promise.resolve({ id: sessionId }) }));

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.auth.mockResolvedValue({ user: { name: "Synthetic owner" } });
  state.claims.mockResolvedValue({ backendAccountId: "synthetic-account" });
  state.load.mockRejectedValue(new Error("private upstream diagnostics"));
});

describe("Session failure recovery", () => {
  it.each(locales)("renders an honest, localized read failure in %s", async (locale, title, message, _expired, back) => {
    state.locale = locale;
    const html = await render();
    expect(html).toContain(`id="session-unavailable">${title}</h1>`);
    expect(html).toContain(message);
    expect(html).toContain(`href="/workspace/sessions">${back}</a>`);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<main[^>]*id="main-content"[^>]*tabindex="-1"/);
    expect(html).not.toContain("private upstream diagnostics");
    expect(html).not.toContain("backend_session_expired");
    expect(state.load).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(state.mint).not.toHaveBeenCalled();
    expect(state.meetings).not.toHaveBeenCalled();
  });

  it.each(locales)("keeps confirmed expiry recovery bound to the exact Session in %s", async (locale, title, _message, expired, back) => {
    state.locale = locale;
    state.load.mockRejectedValue(new BackendSessionExpiredError());
    const html = await render();
    expect(html).toContain(title);
    expect(html).toContain(expired);
    const recovery = backendSessionRecoveryHref(`/workspace/sessions/${sessionId}`).replaceAll("&", "&amp;");
    expect(html).toContain(`href="${recovery}"`);
    expect(html).toContain(`href="/workspace/sessions">${back}</a>`);
    expect(state.mint).not.toHaveBeenCalled();
  });

  it("uses the display locale for the metadata subject and leaves branding to the root template", async () => {
    expect(await generateMetadata()).toEqual({ title: "Conversations", robots: { follow: false, index: false } });
  });

  it("keeps the authentication gate ahead of a private Session read", async () => {
    state.auth.mockResolvedValue(null);
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining(`/login?callbackUrl=${encodeURIComponent(`/workspace/sessions/${sessionId}`)}`),
    });
    expect(state.load).not.toHaveBeenCalled();
    expect(state.claims).not.toHaveBeenCalled();
  });
});
