import { describe, expect, it } from "vitest";
import { avatarInitials, avatarPalette, avatarHash, resolveAvatar } from "./avatar";

describe("recognizable avatar fallbacks", () => {
  it("keeps text legible in every light and dark identity color", () => {
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    for (const [lightBackground, lightText, darkBackground, darkText] of avatarPalette) {
      for (const [background, text] of [[lightBackground, lightText], [darkBackground, darkText]]) {
        const values = [luminance(background!), luminance(text!)].sort((a, b) => a - b);
        expect((values[1]! + .05) / (values[0]! + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each([
    ["张伟", "伟"], ["欧阳娜娜", "娜"], ["李 小明", "明"],
    ["John Smith", "JS"], ["John Michael Smith", "JS"], ["Ada", "A"],
    [" Élodie Martin ", "ÉM"], ["", ""], ["+86 138-0013-8000", ""],
    ["john@example.com", ""], ["未知联系人", ""], ["👋", ""],
    ["陆星（测试）", "星"], ["江岚 (测试)", "岚"], ["李 小明（合作方）（测试）", "明"],
    ["Ada (Demo)", "A"], ["John Smith（测试）", "JS"], [" Élodie Martin (partner) ", "ÉM"],
    ["김민수 (테스트)", "김"], ["（测试）", ""], [" (Demo) ", ""],
    ["未知联系人（测试）", ""], ["john@example.com (Demo)", ""], ["13800138000（测试）", ""],
  ])("derives a name, never identifier text: %s", (name, expected) => {
    expect(avatarInitials(name)).toBe(expected);
  });

  it("keeps the same person's palette after renaming and never ranks them", () => {
    expect(resolveAvatar({ id: "person-1", label: "张伟" }).color)
      .toEqual(resolveAvatar({ id: "person-1", label: "John Smith" }).color);
    expect(new Set(Array.from({ length: 100 }, (_, i) => avatarHash(`p-${i}`) % avatarPalette.length)).size).toBe(10);
  });

  it("prioritizes photos automatically, honors explicit styles, and falls back for unnamed people", () => {
    expect(resolveAvatar({ id: "p", label: "John Smith", url: "https://example.test/photo", defaultStyle: "shapes" }))
      .toMatchObject({ photo: "https://example.test/photo", style: "shapes" });
    expect(resolveAvatar({ id: "p", label: "张伟", url: "https://example.test/photo", preference: { style: "initials" } }))
      .toMatchObject({ photo: null, style: "initials", initials: "伟" });
    expect(resolveAvatar({ id: "p", label: "13800138000" })).toMatchObject({ photo: null, style: "shapes" });
    expect(resolveAvatar({ id: "p", label: "Jane", url: "javascript:alert(1)" }).photo).toBeNull();
  });
});
