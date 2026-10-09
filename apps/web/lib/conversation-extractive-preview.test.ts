import { describe, expect, it } from "vitest";

import {
  extractiveReadingPreview,
  isLongAnswer,
} from "./conversation-extractive-preview";

const LONG = [
  "## 合作进展",
  "",
  "陈宇负责设计协作。试点阶段的时间已经确认，下周会给出第一版排期。",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "| 项目 | 状态 |",
  "| --- | --- |",
  "| 排期 | 待确认 |",
  "",
  "回复偏好保持不变：先确认时间，再约定后续跟进方式。合同细节仍然需要法务复核后才能进入下一步。",
  "",
  "目前有三个未决事项需要你来判断：第一，排期是否接受两周缓冲；第二，合同主体用现有模板还是新模板；第三，是否先安排一次三人对齐会。",
  "",
  "已经核对过的事实是：陈宇在上一轮明确提出设计协作由他负责；试点预算已由财务口头确认；对外发布节奏暂缓，等你确认之后再推进。",
  "",
  "下一步建议：先回复排期意见，其余两项可以在同一个回复里一并说明，我会把结论整理进关系记录并标注依据来源。",
].join("\n");

describe("extractive reading preview", () => {
  it("quotes the answer's own leading prose and never invents text", () => {
    const preview = extractiveReadingPreview(LONG);
    expect(preview.startsWith("合作进展")).toBe(true);
    // Verbatim sentences of the source answer, not generated phrasing.
    expect(preview).toContain("陈宇负责设计协作。");
    expect(preview).toContain("试点阶段的时间已经确认，下周会给出第一版排期。");
  });

  it("skips code blocks and tables instead of slicing structured content", () => {
    const preview = extractiveReadingPreview(LONG);
    expect(preview).not.toContain("const x");
    expect(preview).not.toContain("| 排期 |");
  });

  it("stays within the character budget and marks prose-only extraction", () => {
    const body = Array.from({ length: 12 }, (_, index) =>
      `第${index}段说明了这一轮沟通里确认过的内容，方便后续复盘。`).join("\n\n");
    const preview = extractiveReadingPreview(body);
    expect(preview.length).toBeLessThanOrEqual(220);
    expect(preview.length).toBeLessThan(body.length);
  });

  it("returns empty for structure-only answers", () => {
    expect(extractiveReadingPreview("```\ncode\n```")).toBe("");
  });

  it("marks only genuinely long answers as foldable", () => {
    expect(isLongAnswer("短回答")).toBe(false);
    expect(isLongAnswer(LONG)).toBe(true);
  });
});
