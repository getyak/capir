import { expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
const state = vi.hoisted(() => ({ locale: "en" as LocaleTag }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => state.locale }));
import * as page from "./page";
import { translate } from "@/lib/i18n";
it.each(["en", "zh-CN", "zh-TW", "ja", "ko"] as LocaleTag[])("uses the %s request locale and leaves the brand suffix to the root", async locale => {
  state.locale = locale;
  expect(page).toHaveProperty("generateMetadata");
  const metadata = await (page as unknown as { generateMetadata: () => Promise<unknown> }).generateMetadata();
  expect(metadata).toEqual({ title: translate(locale, "时间"), description: translate(locale, "回看联系与对话，为下一次沟通留出时间。"), robots: { follow: false, index: false } });
});
