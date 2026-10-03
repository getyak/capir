import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceComposer, type WorkspaceComposerProps } from "@/components/workspace-composer";
import { searchSidebarPeople } from "./workspace-sidebar";
import {
  COMPOSER_DISCOVERY_HINT,
  COMPOSER_DRAFT_LIMIT,
  COMPOSER_MENTION_MENU_LABEL,
  COMPOSER_SLASH_MENU_LABEL,
  composerDescribedBy,
  composerLengthState,
  composerMentionInsertion,
  composerMenuA11y,
  detectComposerTrigger,
  filterSlashCommands,
  insertComposerText,
  resolveComposerKey,
} from "./workspace-composer";

describe("caret-aware trigger detection", () => {
  it("opens a slash command at the start of the field or a word", () => {
    expect(detectComposerTrigger("/", 1)).toEqual({
      kind: "slash",
      query: "",
      start: 0,
      end: 1,
    });
    expect(detectComposerTrigger("go /org", 7)).toEqual({
      kind: "slash",
      query: "org",
      start: 3,
      end: 7,
    });
    // A bare `/` surrounded by spaces is still discoverable.
    expect(detectComposerTrigger("tea / coffee", 5)).toMatchObject({
      kind: "slash",
      query: "",
      start: 4,
      end: 5,
    });
  });

  it("filters from the caret while replacing the whole command token", () => {
    expect(detectComposerTrigger("a /organize b", 6)).toEqual({
      kind: "slash",
      query: "org",
      start: 2,
      end: 11,
    });
  });

  it("does not treat emails, URLs, paths or dates as triggers", () => {
    expect(detectComposerTrigger("mail chen@example.com", 21)).toBe(null);
    expect(detectComposerTrigger("chen@", 5)).toBe(null);
    expect(detectComposerTrigger("see https://example.com/path", 28)).toBe(null);
    expect(detectComposerTrigger("https://", 8)).toBe(null);
    expect(detectComposerTrigger("/workspace/people", 17)).toBe(null);
    expect(detectComposerTrigger("9/20", 4)).toBe(null);
    expect(detectComposerTrigger("foo/bar", 7)).toBe(null);
    expect(detectComposerTrigger("@example.com", 12)).toBe(null);
  });

  it("keeps dotted English names usable as mentions", () => {
    expect(detectComposerTrigger("@John.Smith", 11)).toEqual({
      kind: "mention",
      query: "John.Smith",
      start: 0,
      end: 11,
    });
  });

  it("opens a mention at the caret, including mid-name and after Chinese text", () => {
    expect(detectComposerTrigger("@陈曦", 3)).toEqual({
      kind: "mention",
      query: "陈曦",
      start: 0,
      end: 3,
    });
    expect(detectComposerTrigger("@陈曦", 2)).toEqual({
      kind: "mention",
      query: "陈",
      start: 0,
      end: 3,
    });
    expect(detectComposerTrigger("你好@陈曦", 5)).toEqual({
      kind: "mention",
      query: "陈曦",
      start: 2,
      end: 5,
    });
    expect(detectComposerTrigger("(@陈", 3)).toEqual({
      kind: "mention",
      query: "陈",
      start: 1,
      end: 3,
    });
    expect(detectComposerTrigger("说完。@陈", 5)).toEqual({
      kind: "mention",
      query: "陈",
      start: 3,
      end: 5,
    });
  });

  it("closes a mention at whitespace and tolerates an out-of-range caret", () => {
    expect(detectComposerTrigger("@陈 曦", 2)).toMatchObject({
      kind: "mention",
      query: "陈",
      start: 0,
      end: 2,
    });
    expect(detectComposerTrigger("abc", 99)).toBe(null);
    expect(detectComposerTrigger("abc", -5)).toBe(null);
  });
});

describe("slash command filtering", () => {
  it("lists every real capability for an empty query", () => {
    expect(filterSlashCommands("").map((command) => command.id)).toEqual([
      "organize",
      "follow-up",
      "meeting-questions",
      "people",
      "meetings",
      "capture",
    ]);
  });

  it("matches English, Chinese and full-width input", () => {
    expect(filterSlashCommands("organize").map((c) => c.id)).toContain("organize");
    expect(filterSlashCommands("整理").map((c) => c.id)).toContain("organize");
    expect(filterSlashCommands("跟进").map((c) => c.id)).toContain("follow-up");
    expect(filterSlashCommands("会议").map((c) => c.id)).toEqual([
      "meeting-questions",
      "meetings",
    ]);
    expect(filterSlashCommands("ＭＥＥＴＩＮＧ").map((c) => c.id)).toContain(
      "meetings",
    );
  });

  it("drops capture when the surface has no capture entry", () => {
    expect(filterSlashCommands("", { capture: false }).map((c) => c.id)).not.toContain(
      "capture",
    );
  });

  it("returns no matches for unknown text", () => {
    expect(filterSlashCommands("zzz")).toEqual([]);
  });
});

describe("mention directory results", () => {
  const directory = {
    people: [
      { id: "p1", display_label: "陈曦", contexts: [{ id: "c1", display_label: "腾讯" }] },
      { id: "p2", display_label: "陈曦", contexts: [{ id: "c2", display_label: "字节" }] },
      { id: "p3", display_label: "Alex Chen", contexts: [] },
    ],
  };

  it("matches normalized labels and keeps duplicate names distinct by context", () => {
    const matches = searchSidebarPeople(directory, "陈曦", 8);
    expect(matches.map((person) => person.label)).toEqual(["陈曦", "陈曦"]);
    expect(matches.map((person) => person.detail)).toEqual(["腾讯", "字节"]);
    expect(searchSidebarPeople(directory, "Ｃｈｅｎ", 8).map((p) => p.label)).toEqual([
      "Alex Chen",
    ]);
  });

  it("returns an honest empty result for unknown text or malformed data", () => {
    expect(searchSidebarPeople(directory, "找不到", 8)).toEqual([]);
    expect(searchSidebarPeople(null, "", 8)).toEqual([]);
    expect(searchSidebarPeople({ people: "not-an-array" }, "", 8)).toEqual([]);
  });
});

describe("insertion preserves the rest of the draft", () => {
  it("replaces only the token in the middle of a sentence", () => {
    const result = insertComposerText({
      value: "你好 @陈 再见",
      start: 3,
      end: 5,
      insert: "@陈曦（腾讯）",
      maxLength: 1_000,
    });
    expect(result).toEqual({
      value: "你好 @陈曦（腾讯） 再见",
      caret: 10,
      inserted: true,
      overflow: false,
    });
  });

  it("replaces the selected range and deletes when the insertion is empty", () => {
    expect(
      insertComposerText({
        value: "abcdef",
        start: 2,
        end: 4,
        insert: "XY",
        maxLength: 1_000,
      }),
    ).toMatchObject({ value: "abXYef", caret: 4 });
    expect(
      insertComposerText({
        value: "abcdef",
        start: 1,
        end: 4,
        insert: "",
        maxLength: 1_000,
      }),
    ).toMatchObject({ value: "aef", caret: 1 });
  });

  it("reports overflow instead of silently truncating", () => {
    const result = insertComposerText({
      value: "12345",
      start: 5,
      end: 5,
      insert: "678",
      maxLength: 6,
    });
    expect(result).toEqual({
      value: "12345",
      caret: 5,
      inserted: false,
      overflow: true,
    });
  });

  it("allows a result exactly at the bound and clamps bad ranges", () => {
    expect(
      insertComposerText({
        value: "1234",
        start: 4,
        end: 4,
        insert: "56",
        maxLength: 6,
      }),
    ).toMatchObject({ value: "123456", caret: 6, inserted: true });
    expect(
      insertComposerText({
        value: "abc",
        start: 99,
        end: -2,
        insert: "X",
        maxLength: 10,
      }),
    ).toMatchObject({ value: "abcX", caret: 4, inserted: true });
  });
});

describe("mention references", () => {
  it("uses the label plus the first real context, and never an id", () => {
    const person = {
      id: "11111111-1111-4111-8111-111111111111",
      label: "陈曦",
      contexts: [
        { id: "22222222-2222-4222-8222-222222222222", label: "腾讯" },
      ],
    };
    expect(composerMentionInsertion(person)).toBe("@陈曦（腾讯） ");
    expect(composerMentionInsertion(person)).not.toContain(person.id);
  });

  it("falls back to the label and trims blank context labels", () => {
    expect(composerMentionInsertion({ label: " 陈曦 ", contexts: [] })).toBe("@陈曦 ");
    expect(
      composerMentionInsertion({ label: "陈曦", contexts: [{ label: "   " }] }),
    ).toBe("@陈曦 ");
  });
});

describe("length state", () => {
  it("matches trimmed send length while retaining the raw draft bound", () => {
    expect(composerLengthState(` ${"字".repeat(1000)}\n`)).toMatchObject({ level: "near", remainingToSend: 0 });
    expect(composerLengthState(` ${"字".repeat(1001)}\n`).level).toBe("over-send");
    expect(composerLengthState(`字${" ".repeat(11999)}`).level).toBe("at-draft-limit");
  });
  it("stays quiet until the send limit approaches", () => {
    expect(composerLengthState(0)).toMatchObject({
      level: "ok",
      message: "",
      remainingToSend: 1_000,
    });
    expect(composerLengthState(899).level).toBe("ok");
    expect(composerLengthState(900)).toMatchObject({ level: "near" });
    expect(composerLengthState(900).message).toContain("100");
    expect(composerLengthState(1_000)).toMatchObject({
      level: "near",
      remainingToSend: 0,
    });
  });

  it("keeps the 12,000-character Session draft savable with a too-long state", () => {
    expect(composerLengthState(1_001)).toMatchObject({
      level: "over-send",
      remainingToSend: 0,
    });
    expect(composerLengthState(1_001).message).toContain("无法发送");
    expect(composerLengthState(COMPOSER_DRAFT_LIMIT).level).toBe("at-draft-limit");
  });

  it("honours custom bounds", () => {
    expect(
      composerLengthState(9, { sendLimit: 10, draftLimit: 20, nearLimit: 8 }),
    ).toMatchObject({ level: "near", remainingToSend: 1 });
    expect(composerLengthState(21, { sendLimit: 10, draftLimit: 20 })).toMatchObject({
      level: "at-draft-limit",
    });
  });
});

describe("keyboard decision", () => {
  const base = { key: "Enter", menuOpen: false, canSubmit: true };

  it("never acts during IME composition", () => {
    expect(resolveComposerKey({ ...base, isComposing: true })).toBe("none");
    expect(resolveComposerKey({ ...base, keyCode: 229 })).toBe("none");
  });

  it("navigates and chooses while the menu is open", () => {
    expect(resolveComposerKey({ ...base, key: "ArrowDown", menuOpen: true })).toBe(
      "next",
    );
    expect(resolveComposerKey({ ...base, key: "ArrowUp", menuOpen: true })).toBe(
      "previous",
    );
    expect(resolveComposerKey({ ...base, menuOpen: true })).toBe("choose");
    expect(
      resolveComposerKey({ ...base, menuOpen: true, shiftKey: true }),
    ).toBe("none");
    expect(
      resolveComposerKey({ ...base, menuOpen: true, metaKey: true }),
    ).toBe("submit");
    expect(
      resolveComposerKey({ ...base, menuOpen: true, ctrlKey: true, canSubmit: false }),
    ).toBe("none");
  });

  it("dismisses only the open menu on Escape", () => {
    expect(resolveComposerKey({ ...base, key: "Escape", menuOpen: true })).toBe(
      "dismiss",
    );
    expect(resolveComposerKey({ ...base, key: "Escape" })).toBe("none");
  });

  it("submits Enter or Cmd/Ctrl+Enter only when submission is allowed", () => {
    expect(resolveComposerKey({ ...base })).toBe("submit");
    expect(resolveComposerKey({ ...base, canSubmit: false })).toBe("none");
    expect(resolveComposerKey({ ...base, metaKey: true })).toBe("submit");
    expect(resolveComposerKey({ ...base, ctrlKey: true })).toBe("submit");
    expect(resolveComposerKey({ ...base, shiftKey: true })).toBe("none");
    expect(resolveComposerKey({ ...base, altKey: true })).toBe("none");
  });
});

describe("accessible labels", () => {
  it("exposes distinct listbox labels and the mention disclosure", () => {
    expect(composerMenuA11y("slash")).toEqual({
      listboxLabel: COMPOSER_SLASH_MENU_LABEL,
      disclosure: null,
    });
    const mention = composerMenuA11y("mention");
    expect(mention.listboxLabel).toBe(COMPOSER_MENTION_MENU_LABEL);
    expect(mention.disclosure).toContain("仅插入姓名与背景文字");
    expect(mention.disclosure).toContain("打开人物页");
    expect(COMPOSER_DISCOVERY_HINT).toBe("/ 能力 · @ 人物");
  });

  it("joins described-by ids in order and drops empties", () => {
    expect(composerDescribedBy(["a", null, undefined, "", "b"])).toBe("a b");
    expect(composerDescribedBy([])).toBe("");
  });
});

describe("server-rendered composer", () => {
  function render(overrides: Partial<WorkspaceComposerProps> = {}) {
    const props: WorkspaceComposerProps = {
      binding: null,
      canSubmit: false,
      id: "ssr-composer",
      label: "给 capri 发消息",
      maxLength: 1_000,
      onNavigate: () => {},
      onSubmit: () => {},
      onValueChange: () => {},
      placeholder: "输入消息",
      value: "",
      variant: "home",
      ...overrides,
    };
    return renderToStaticMarkup(createElement(WorkspaceComposer, props));
  }

  it("renders the accessible label, discovery hint and listbox wiring", () => {
    const html = render();
    expect(html).toContain("给 capri 发消息");
    expect(html).toContain(COMPOSER_DISCOVERY_HINT);
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toMatch(/maxlength="1000"/i);
    // Multiline textboxes use aria-controls/activedescendant, not aria-expanded.
    expect(html).not.toContain("aria-expanded");
  });

  it("shows the explicit too-long-to-send state on a Session draft", () => {
    const html = render({
      maxLength: 12_000,
      value: "字".repeat(1_001),
      variant: "session",
    });
    expect(html).toContain("无法发送");
    expect(html).toContain("草稿仍可保存");
  });
});

describe("mention caret regressions", () => {
  it("replaces a dotted name as one token when editing its middle", () => {
    const value = "请问 @John.Smith 明天方便吗";
    const trigger = detectComposerTrigger(value, 7)!;
    expect(value.slice(trigger.start, trigger.end)).toBe("@John.Smith");
    expect(insertComposerText({ value, start: trigger.start, end: trigger.end, insert: "@Alex ", maxLength: 1000 }).value)
      .toBe("请问 @Alex  明天方便吗");
  });
  it("preserves punctuation after a referenced name", () => {
    const value = "Hi @John. Next";
    const trigger = detectComposerTrigger(value, 6)!;
    expect(insertComposerText({ value, start: trigger.start, end: trigger.end, insert: "@Alex", maxLength: 1000 }).value)
      .toBe("Hi @Alex. Next");
    expect(detectComposerTrigger("@John.Smith", 3)?.end).toBe(11);
  });
  it("finishes a context-free reference before the next words", () => {
    const reference = composerMentionInsertion({ label: "Alex", contexts: [] });
    expect(detectComposerTrigger(reference, reference.length)).toBeNull();
    expect(reference + "明天方便吗").toBe("@Alex 明天方便吗");
  });
});
