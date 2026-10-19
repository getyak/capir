import { describe, expect, it } from "vitest";
import { resolveDisplayLocale, SUPPORTED_LOCALES, type LocaleTag } from "@talent-signal/contracts";
import { catalogs, interpolate, translate } from "./i18n";

describe("canonical locale resolution", () => {
  it.each([
    ["ja", ["en"], "ja"],
    ["system", ["ja-JP", "en"], "ja"],
    ["system", ["zh-Hant", "en"], "zh-TW"],
    ["system", ["zh-HK"], "zh-TW"],
    ["system", ["zh-MO"], "zh-TW"],
    ["system", ["zh-Hans"], "zh-CN"],
    ["system", ["zh"], "zh-CN"],
    ["system", ["zh-TW"], "zh-TW"],
    ["system", ["ko-KR"], "ko"],
    ["system", ["en-GB"], "en"],
    ["system", ["fr-FR", "ja;q=0.9"], "ja"],
    ["system", ["fr-FR"], "en"],
    ["system", [], "en"],
    ["system", ["unsupported", "zh_CN"], "zh-CN"],
  ])("resolves %s over %s to %s", (preference, requested, expected) => {
    expect(resolveDisplayLocale(preference as LocaleTag | "system", requested)).toBe(expected);
  });
});

describe("web catalogs", () => {
  it("every supported locale ships the same keys as en, except zh-CN identity keys", () => {
    const reference = Object.keys(catalogs.en).sort();
    // gettext-style keys are Chinese source strings: zh-CN resolves them to
    // identity and need not duplicate them. Semantic keys are explicit in
    // every locale; other locales carry every key.
    const semantic = reference.filter((key) => !/[\u3040-\u30ff\u3400-\u9fff]/.test(key));
    for (const locale of SUPPORTED_LOCALES) {
      const keys = Object.keys(catalogs[locale]);
      const required = locale === "zh-CN" ? semantic : reference;
      for (const key of required) {
        expect(keys.includes(key), `locale ${locale} missing ${key}`).toBe(true);
      }
    }
    expect(reference.length).toBeGreaterThan(0);
  });
  it("translates with interpolation and falls back to en for unknown keys", () => {
    expect(translate("ja", "language.option.system")).toBe("システムに合わせる");
    expect(translate("en", "missing.key")).toBe("missing.key");
    expect(translate("ko", "missing.key")).toBe("missing.key");
    expect(interpolate("Hello {name}, {missing} stays", { name: "Ada" })).toBe("Hello Ada, {missing} stays");
  });
  it("resolves gettext-style Chinese-source keys to identity for zh locales", () => {
    expect(translate("zh-CN", "保存偏好")).toBe("保存偏好");
    expect(translate("zh-TW", "保存偏好")).toBe("保存偏好");
    expect(translate("en", "保存偏好", undefined, "Save preference")).toBe("Save preference");
  });
  it("keeps evidence-boundary wording in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const hint = catalogs[locale]["language.prompt.hint"];
      expect(hint, `locale ${locale}`).toBeTruthy();
    }
  });
});
