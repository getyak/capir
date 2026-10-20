import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, type LocaleTag } from "@talent-signal/contracts";
import { catalogs } from "./i18n";
import pendingExtraction from "../i18n/pending-extraction.json";

/**
 * i18n coverage guard (docs/internationalization.md).
 *
 * Every user-facing Chinese source string in web production code must be a
 * gettext key that ships translations — either in the catalogs or in a
 * locale-keyed copy module. Two explicit exception categories are allowed:
 *
 * 1. CATALOG_EQUIVALENTS: locale-keyed copy modules whose values are
 *    translated per locale in-module (they ARE catalogs).
 * 2. CONTENT: source-language content — articles, seeded brief content,
 *    synthetic-evidence samples, and interactive demo narratives. Content
 *    keeps its original language by product rule (evidence invariance).
 *
 * `pending-extraction.json` is the extraction ratchet: a committed map of
 * file -> residual uncovered strings. The guard enforces that the ratchet
 * only shrinks, so extracted files can never regress and unextracted work is
 * always visible. The milestone closes only when the manifest is empty.
 */

const webRoot = resolve(import.meta.dirname, "..");

/** Locale-keyed copy modules: translated in-module, catalog-equivalent. */
const CATALOG_EQUIVALENTS = new Set([
  "lib/marketing-copy.ts",
  "lib/personal-agent-copy.ts",
  "components/marketing/product-story.tsx",
  "components/marketing/trust-story.tsx",
  "components/marketing/marketing-subpage.tsx",
]);

/** Source-language content and demo narratives: evidence invariance applies. */
const CONTENT = new Set([
  "lib/blog.ts",
  "lib/projectHealthBrief.ts",
  "components/marketing/relationship-brief.tsx",
  "components/marketing/personal-agent-demo.tsx",
  "components/relationship-mobile-concept.tsx",
  "components/relationship-desktop-concept.tsx",
]);

const EXEMPT = new Set([...CATALOG_EQUIVALENTS, ...CONTENT]);
const PENDING: Record<string, number> = pendingExtraction;

const CJK = /[\u3400-\u9fff]/;
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "i18n" || entry === ".next") continue;
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
        out.push(full.slice(webRoot.length + 1));
      }
    }
  };
  for (const root of ["app", "components", "lib"]) walk(resolve(webRoot, root));
  return out;
}

function uncoveredStrings(file: string): Set<string> {
  const source = readFileSync(resolve(webRoot, file), "utf8");
  const found = new Set<string>();
  // Catalog keys may carry leading/trailing spaces at call sites; compare
  // against a normalized key index so trimming cannot fake a gap.
  const enKeys = new Set(Object.keys(catalogs.en).map(normalize));
  const add = (value: string) => {
    const key = normalize(value);
    if (key && CJK.test(key) && !enKeys.has(key)) found.add(key);
  };
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(match[1]);
  for (const match of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(match[1]);
  for (const match of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    if (!match[1].includes("${")) add(match[1]);
  }
  for (const match of source.matchAll(/>([^<>{}]*[\u3400-\u9fff][^<>{}]*)</g)) add(match[1]);
  return found;
}

describe("web i18n coverage", () => {
  it("files outside the ratchet have no uncovered Chinese strings", () => {
    const violations: string[] = [];
    for (const file of productionFiles()) {
      if (EXEMPT.has(file) || file in PENDING) continue;
      for (const key of uncoveredStrings(file)) violations.push(`${file}: ${key}`);
    }
    expect(
      violations,
      `regressions or unextracted files outside the ratchet:\n${violations.slice(0, 20).join("\n")}`,
    ).toEqual([]);
  });

  it("the extraction ratchet only shrinks", () => {
    const grown: string[] = [];
    const gone: string[] = [];
    for (const [file, allowed] of Object.entries(PENDING)) {
      let current: number;
      try {
        current = uncoveredStrings(file).size;
      } catch {
        gone.push(file);
        continue;
      }
      if (current > allowed) grown.push(`${file}: ${current} > ${allowed}`);
    }
    expect(gone, "ratchet entries whose files vanished (remove them from the manifest)").toEqual([]);
    expect(grown, "residual counts grew; extract the new strings and shrink the manifest").toEqual([]);
  });

  it("every catalog key ships a translation in all non-source locales", () => {
    const reference = Object.keys(catalogs.en);
    const semantic = reference.filter((key) => !CJK.test(key));
    for (const locale of SUPPORTED_LOCALES) {
      const required = (locale === "zh-CN" ? semantic : reference) as string[];
      const missing = required.filter((key) => !(key in catalogs[locale]));
      expect(missing, `locale ${locale} missing keys`).toEqual([]);
    }
  });

  it("zh-TW entries are Traditional Chinese, not converted zh-CN", () => {
    // Simplified-only characters with distinct Traditional forms must never
    // appear in zh-TW values: the locale is authored for Taiwan readers.
    const simplifiedOnly = /[这们个为说时过还来对开现让从关闭]/;
    const violations = Object.entries(catalogs["zh-TW"] as Record<string, string>)
      .filter(([, value]) => simplifiedOnly.test(value))
      .map(([key, value]) => `${key} -> ${value}`);
    expect(violations, "simplified characters leaked into zh-TW").toEqual([]);
  });

  it("no cross-script lookalike leaks (Hangul in ja, kana in ko, CJK in en)", () => {
    // Hangul syllables like 스트 and katakana スト are visual lookalikes;
    // batch authoring has produced these slips before, so they are guarded.
    const checks: ReadonlyArray<[LocaleTag, RegExp, string]> = [
      ["ja", /[\uac00-\uac00\ud7af-\ud7af\uac00-\ud7af]|[\uac00-\ud7af]/, "Hangul in ja"],
      ["ko", /[\u3040-\u30ff]/, "kana in ko"],
      ["en", /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/, "CJK in en"],
      ["zh-TW", /[\u3040-\u30ff\uac00-\ud7af]/, "kana/Hangul in zh-TW"],
    ];
    for (const [locale, pattern, label] of checks) {
      const violations = Object.entries(catalogs[locale] as Record<string, string>)
        .filter(([, value]) => pattern.test(value))
        .map(([key, value]) => `${key} -> ${value}`);
      expect(violations, label).toEqual([]);
    }
  });

  it("catalog values are non-empty strings in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(catalogs[locale as LocaleTag])) {
        expect(typeof value, `${locale}:${key}`).toBe("string");
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});
