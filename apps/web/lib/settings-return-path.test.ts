import { describe, expect, it } from "vitest";

import { settingsReturnPath, settingsSectionFrom } from "./settings-return-path";
import { SETTINGS_SECTIONS } from "./settings-sections";

const ORIGIN = "https://workspace.example";

/** The return path must never leave the fixed settings route. */
function expectSameOriginSettingsPath(path: string) {
  expect(path.startsWith("/workspace/settings")).toBe(true);
  expect(path.startsWith("//")).toBe(false);
  expect(path).not.toContain("\\");
  expect(path).not.toContain("..");
  expect(new URL(path, ORIGIN).origin).toBe(ORIGIN);
}

describe("settings return path", () => {
  it("preservesAccountSectionAfterLogin", () => {
    expect(settingsReturnPath("account")).toBe("/workspace/settings?section=account");
    expect(settingsReturnPath("connections")).toBe("/workspace/settings?section=connections");
    expectSameOriginSettingsPath(settingsReturnPath("account"));
  });

  it("preserves every allowlisted section and keeps overview bare", () => {
    for (const section of SETTINGS_SECTIONS) {
      const path = settingsReturnPath(section.id);
      expectSameOriginSettingsPath(path);
      expect(path).toBe(section.href);
    }
    expect(settingsReturnPath("overview")).toBe("/workspace/settings");
    expect(settingsReturnPath("testing")).toBe("/workspace/settings?section=testing");
  });

  it("unknownSectionUsesOverview", () => {
    for (const value of ["", "  ", "unknown", "Overview", "ACCOUNT", "settings", "0"]) {
      expect(settingsReturnPath(value)).toBe("/workspace/settings");
      expect(settingsSectionFrom(value)).toBe("overview");
    }
    expect(settingsReturnPath(null)).toBe("/workspace/settings");
    expect(settingsReturnPath(undefined)).toBe("/workspace/settings");
  });

  it("externalURLCannotBecomeReturnTarget", () => {
    const hostile = [
      "https://evil.example/workspace/settings",
      "//evil.example/workspace/settings",
      "http://evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/workspace/settings?section=account",
      "account#fragment",
      "account&next=https://evil.example",
      "../../../etc/passwd",
      "%2F%2Fevil.example",
      "account\nLocation: https://evil.example",
    ];
    for (const value of hostile) {
      const path = settingsReturnPath(value);
      expect(path).toBe("/workspace/settings");
      expectSameOriginSettingsPath(path);
      expect(path).not.toContain("evil.example");
    }
  });

  it("treats repeated and malformed query input as the overview", () => {
    // Next.js surfaces `?section=account&section=advanced` as an array, and a
    // nested object must not be coerced into a section id either.
    for (const value of [
      ["account", "advanced"],
      ["account"],
      [],
      { section: "account" },
      42,
      true,
    ]) {
      expect(settingsReturnPath(value)).toBe("/workspace/settings");
      expect(settingsSectionFrom(value)).toBe("overview");
    }
  });

  it("keeps the return path distinct from the login route it feeds", () => {
    const callback = settingsReturnPath(["account"]);
    const login = `/login?callbackUrl=${encodeURIComponent(callback)}`;
    const parsed = new URL(login, ORIGIN);
    expect(parsed.pathname).toBe("/login");
    expect(parsed.searchParams.get("callbackUrl")).toBe("/workspace/settings");
  });
});
