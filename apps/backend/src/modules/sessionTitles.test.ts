import { describe, expect, it } from "vitest";

import {
  canonicalizeSessionTitle,
  firstTurnSessionTitle,
} from "./sessionTitles.js";

describe("Session title canonicalization", () => {
  it("keeps a specific proposal on one bounded line", () => {
    const title = canonicalizeSessionTitle(
      "  准备 Maya 的 CPO 初聊提纲\n并整理问题  ",
    );
    expect(title).toBe("准备 Maya 的 CPO 初聊提纲 并整理问题");
    expect(Array.from(title ?? "")).toHaveLength(24);
  });

  it("bounds Unicode titles to the response contract", () => {
    const title = canonicalizeSessionTitle(`整理${"🧭".repeat(40)}`);
    expect(title).toBe(`整理${"🧭".repeat(30)}`);
    expect(Array.from(title ?? "")).toHaveLength(32);
  });

  it("never splits a compound grapheme at the visible title boundary", () => {
    const family = "👨‍👩‍👧‍👦";
    const title = canonicalizeSessionTitle(`整理${family.repeat(40)}`) ?? "";
    expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title))).toHaveLength(32);
    expect(title.endsWith(family)).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(256);
  });

  it.each(["Reply", " Answer: ", "你好。", "工作台对话"])(
    "rejects generic model title %s and uses the objective",
    (proposed) => {
      expect(
        firstTurnSessionTitle("比较 Maya 的两版外联话术", proposed),
      ).toBe("比较 Maya 的两版外联话术");
    },
  );

  it("gives a greeting a stable non-generic fallback", () => {
    expect(firstTurnSessionTitle("你好", "回复")).toBe("简单聊两句");
    expect(firstTurnSessionTitle("Hello", "Reply")).toBe("Quick hello");
  });
});


it("keeps a person's explicit title when the first answer completes", async () => {
  const { titleAfterFirstReply } = await import("./sessionTitles.js");
  expect(titleAfterFirstReply("My chosen title", "Model suggestion")).toBe("My chosen title");
  expect(titleAfterFirstReply("新的对话", "Model suggestion")).toBe("Model suggestion");
  expect(titleAfterFirstReply("", "Model suggestion")).toBe("Model suggestion");
  expect(titleAfterFirstReply("Synthetic first message", "Model suggestion", "Synthetic first message")).toBe("Model suggestion");
});


it("replaces the Web producer's greeting fallback with the first answer title", async () => {
  const { titleAfterFirstReply } = await import("./sessionTitles.js");
  expect(titleAfterFirstReply("Quick hello", "Plan tomorrow", "Hello")).toBe("Plan tomorrow");
  expect(titleAfterFirstReply("简单聊两句", "明天的安排", "你好")).toBe("明天的安排");
});
