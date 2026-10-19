import { describe, expect, it } from "vitest";
import { resolveMarketingLocale } from "./marketing-locale";
import {
  marketingAccessHref,
  marketingCopy,
  marketingNavigation,
  relationshipDemoHref,
} from "./marketing-copy";

describe("public website locale negotiation", () => {
  it.each([
    [undefined, "zh-CN,zh;q=0.9,en;q=0.8", "zh-CN"],
    [undefined, "en-GB,en;q=0.9,zh;q=0.5", "en"],
    [undefined, "en;q=0.4,zh-TW;q=0.9", "zh-TW"],
    [undefined, "fr-FR,zh-HK;q=0.7", "zh-TW"],
    [undefined, "fr-FR,ja;q=0.7", "ja"],
    [undefined, "ko-KR,en;q=0.8", "ko"],
    [undefined, "zh-Hant-HK", "zh-TW"],
    [undefined, "zh;q=0,en;q=0.8", "en"],
    [undefined, "zh;q=invalid,en", "en"],
    ["en", "zh-CN", "en"],
    ["zh-TW", "en-US", "zh-TW"],
    ["ja", "zh-CN", "ja"],
    ["zh-CN", "en-US", "zh-CN"],
    ["unsupported", "en-US", "en"],
    [undefined, "", "en"],
  ])(
    "resolves preference %s and browser %s to %s",
    (preference, header, expected) => {
      expect(resolveMarketingLocale(preference, header)).toBe(expected);
    },
  );
  it("keeps original evidence unchanged across translations", () => {
    expect(marketingCopy("en").brief.quote).toBe(
      marketingCopy("zh-CN").brief.quote,
    );
  });
  it("uses real subpages, a precise demo anchor, and an email-only access request", () => {
    expect(
      marketingNavigation.every(
        (href) => href.startsWith("/") && !href.includes("#"),
      ),
    ).toBe(true);
    expect(relationshipDemoHref).toBe("/#personal-agent-demo");
    expect(marketingAccessHref("en")).toBe(
      "mailto:hello@talentsignal.ai?subject=Request%20capri%20access",
    );
  });
});
