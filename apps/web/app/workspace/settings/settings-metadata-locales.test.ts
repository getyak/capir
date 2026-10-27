import { expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
const state = vi.hoisted(() => ({ locale: "en" as LocaleTag }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
import * as page from "./page";
import { translate } from "@/lib/i18n";
it.each(["en", "zh-CN", "zh-TW", "ja", "ko"] as LocaleTag[])("uses the %s request locale and inherits the root brand template", async locale => {
  state.locale = locale;
  expect(page).toHaveProperty("generateMetadata");
  expect(await (page as unknown as { generateMetadata: () => Promise<unknown> }).generateMetadata()).toEqual({ title: translate(locale, "设置"), description: translate(locale, "账号、空间与界面偏好。"), robots: { follow: false, index: false } });
});
