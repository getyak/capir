import { describe, expect, it } from "vitest";
import {
  isSettingsSection,
  normalizeSettingsQuery,
  searchSettings,
  settingsDrilldownSections,
  SETTINGS_SEARCH_ENTRIES,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_GROUPS,
  type SettingsSection,
} from "./settings-sections";

describe("settings section schema", () => {
  it("accepts every rendered section and the overview default", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "overview",
      "account",
      "workspace",
      "appearance",
      "connections",
      "advanced",
      "testing",
    ]);
    for (const section of SETTINGS_SECTIONS) {
      expect(isSettingsSection(section.id)).toBe(true);
    }
  });

  it("rejects unknown, empty and missing values without throwing", () => {
    expect(isSettingsSection("billing")).toBe(false);
    expect(isSettingsSection("")).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
    expect(isSettingsSection(null)).toBe(false);
  });

  it("is a pure server-safe predicate (no React or client boundary)", () => {
    const section: SettingsSection = "account";
    expect(isSettingsSection(section)).toBe(true);
  });

  it("keeps the overview out of the drilldown row and testing conditional", () => {
    expect(settingsDrilldownSections(true).map((section) => section.id)).toEqual([
      "account",
      "workspace",
      "appearance",
      "connections",
      "advanced",
      "testing",
    ]);
    expect(settingsDrilldownSections(false).map((section) => section.id)).toEqual([
      "account",
      "workspace",
      "appearance",
      "connections",
      "advanced",
    ]);
  });

  it("describes the visible settings groups in navigation order", () => {
    expect(SETTINGS_SECTION_GROUPS.map((group) => group.id)).toEqual([
      "personal",
      "trust",
      "support",
    ]);
    expect(SETTINGS_SECTION_GROUPS.flatMap((group) => group.sections)).toEqual([
      "overview",
      "account",
      "appearance",
      "connections",
      "workspace",
      "advanced",
      "testing",
    ]);
  });
});

describe("settings search index", () => {
  it("routes screenshot/document import aliases to captures", () => {
    for (const query of ["截图", "截屏", "屏幕快照", "屏幕截图", "screenshot", "文档", "导入"]) {
      expect(searchSettings(query, true).map((entry) => entry.id)).toContain("captures");
    }
    expect(searchSettings("跟随系统", true).map((entry) => entry.id)).toContain("appearance");
    expect(searchSettings("工作区", true).map((entry) => entry.id)).toContain("workspace");
  });

  it("routes screen-recording permission queries to a device-owned help result", () => {
    for (const query of ["屏幕录制", "录屏", "屏幕录制权限", "screen recording"]) {
      const hits = searchSettings(query, true).map((entry) => entry.id);
      expect(hits, query).toContain("screen-recording-permission");
      // Screen recording is an OS permission, never screenshot intake.
      expect(hits, query).not.toContain("captures");
    }
    const [help] = searchSettings("屏幕录制权限", true);
    expect(help.href).toBe("/workspace/settings?section=advanced#device-permissions");
    expect(help.scope).toBe("macOS 设备");
    expect(help.description).toContain("macOS");
  });

  it("is whitespace and case insensitive", () => {
    expect(searchSettings("  Screenshot ", true).map((entry) => entry.id)).toContain("captures");
    expect(normalizeSettingsQuery(" 登录 方式 ")).toBe("登录方式");
  });

  it("returns nothing for an empty or unknown query", () => {
    expect(searchSettings("", true)).toEqual([]);
    expect(searchSettings("   ", true)).toEqual([]);
    expect(searchSettings("张三的联系方式", true)).toEqual([]);
  });

  it("hides testing until the Lab is enabled and only indexes static destinations", () => {
    expect(searchSettings("测试", false).map((entry) => entry.id)).not.toContain("testing");
    expect(searchSettings("测试", true).map((entry) => entry.id)).toContain("testing");
    // Every result is a declared static destination, never relationship data.
    const ids = new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id));
    expect(ids.size).toBe(SETTINGS_SEARCH_ENTRIES.length);
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(entry.href.startsWith("/workspace")).toBe(true);
    }
  });
});
