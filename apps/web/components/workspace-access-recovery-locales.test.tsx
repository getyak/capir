import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ locale: "en", refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
import { LocaleProvider } from "./locale-provider";
import { SessionRetryButton } from "./session-retry-button";
import { WorkspaceAccessRecovery } from "./workspace-access-recovery";
it.each([
  ["en", "Confirm your signed-in workspace again", "Before continuing, confirm your account"],
  ["zh-CN", "需要重新确认登录空间", "继续之前，先确认账号"],
  ["zh-TW", "需要重新確認登入的工作空間", "繼續之前，請先確認帳號"],
  ["ja", "ログイン先のワークスペースを再確認してください", "続ける前にアカウントを確認してください"],
  ["ko", "로그인한 워크스페이스를 다시 확인하세요", "계속하기 전에 계정을 확인하세요"],
] as const)("localizes stopped-run protection in %s without changing the supplied recovery action", async (locale, title, eyebrow) => {
  state.locale = locale;
  const page = await WorkspaceAccessRecovery({ children: <a href="/login?callbackUrl=%2Fworkspace%2Ftoday">Recovery action</a> });
  const html = renderToStaticMarkup(<LocaleProvider locale={locale}>{page}</LocaleProvider>);
  expect(html).toContain(`lang="${locale}"`); expect(html).toContain(title); expect(html).toContain(eyebrow);
  expect(html).toContain('href="/login?callbackUrl=%2Fworkspace%2Ftoday"'); expect(html).toContain("Recovery action");
  if (locale === "en") { expect(html).toContain("People, conversations and drafts stay hidden until confirmation."); expect(html).not.toContain("需要重新确认"); }
});

it.each([
  ["en", "The account service is temporarily unavailable", "Retry connection", "you do not need to sign in again"],
  ["zh-CN", "暂时无法连接账号服务", "重试连接", "无需重新登录"],
  ["zh-TW", "暫時無法連線至帳號服務", "重試連線", "無需重新登入"],
  ["ja", "アカウントサービスに一時的に接続できません", "接続を再試行", "再ログインは不要"],
  ["ko", "일시적으로 계정 서비스에 연결할 수 없습니다", "연결 다시 시도", "다시 로그인하지 않고"],
] as const)("localizes temporary %s recovery while keeping retry separate from reauthentication", async (locale, title, retry, preservation) => {
  state.locale = locale;
  const page = await WorkspaceAccessRecovery({ unavailable: true, children: <SessionRetryButton /> });
  const html = renderToStaticMarkup(<LocaleProvider locale={locale}>{page}</LocaleProvider>);
  expect(html).toContain(`lang="${locale}"`);
  expect(html).toContain(title); expect(html).toContain(retry); expect(html).toContain(preservation);
  expect(html).not.toContain('href="/login');
  if (locale === "en") expect(html).not.toMatch(/[\u3400-\u9fff]/);
});
