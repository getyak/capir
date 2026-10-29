import { describe, expect, it } from "vitest";
import { authoredContactDraftRequested, proposalDeclines } from "./workspaceProposalDeclines.js";

describe("formatted authored proposal refusals", () => {
  it.each([
    ["为林海准备一个待我确认的新联系人草稿。不要保存 Memory。", true],
    ["不要保存 Memory，请准备联系人草稿。", true],
    ["Do not save Memory. Prepare a contact draft for review.", true],
    ["不要保存记忆，先给结论。", false],
    ["Do not save anything; just explain the image.", false],
    ["不要创建联系人草稿。", false],
    ["不要保存 Memory。联系人草稿已经准备好供审核。", false],
    ["Do not save Memory. The contact draft is ready for review.", false],
    ["Do not save Memory. The draft contact proposal is ready.", false],
    ["引用：`请准备联系人草稿`。不要保存 Memory。", false],
  ] as const)("requires an authored contact-draft request before host staging: %s", (text, expected) => {
    expect(authoredContactDraftRequested([text])).toBe(expected);
  });

  it.each([
    "不要 `保存` Memory，请准备联系人草稿。",
    "Do not `save` Memory. Prepare a contact draft for review.",
    "`不要` 保存 Memory，请准备联系人草稿。",
    "`Do not` save Memory. Prepare a contact draft for review.",
    "不要保存 `Memory`，请准备联系人草稿。",
    "Do not save `Memory`. Prepare a contact draft for review.",
    "No `Memory`. Prepare a contact draft for review.",
    "`No` Memory. Prepare a contact draft for review.",
  ])("keeps author emphasis as a scoped Memory refusal: %s", text => {
    expect(proposalDeclines([text])).toEqual({
      global: false, contact: false, memory: true, calendar: false, mcp: false,
    });
  });

  it.each([
    "引用：`不要保存 Memory`。请准备联系人草稿。",
    "Quoted source: `Do not save Memory`. Prepare a contact draft for review.",
    "引用：`不要保存 Memory` 草稿。请准备联系人草稿。",
    "Quoted source: `Do not save Memory` draft. Prepare a contact draft for review.",
    "引用：`不要做任何操作` 后创建联系人。",
    "Quoted source: `Do not save anything` and create contacts.",
  ])("does not promote a standalone quoted instruction to author intent: %s", text => {
    expect(proposalDeclines([text])).toEqual({
      global: false, contact: false, memory: false, calendar: false, mcp: false,
    });
  });

  it.each(["不要 `保存`任何内容。", "Do not `save` anything."])(
    "preserves an unqualified formatted global refusal: %s", text => {
      expect(proposalDeclines([text])).toEqual({
        global: true, contact: false, memory: false, calendar: false, mcp: false,
      });
    });

  it.each([
    "不要 `做任何操作`，请准备联系人草稿。",
    "不要 `给我保存` Memory，请准备联系人草稿。",
  ])("formatted global legacy refusal is retained: %s", text => {
    expect(proposalDeclines([text])).toMatchObject({ global: true });
  });
});
