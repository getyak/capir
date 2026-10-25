import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
import { LocaleProvider } from "./locale-provider";
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
