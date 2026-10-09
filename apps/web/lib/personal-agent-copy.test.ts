import { describe, expect, it } from "vitest";
import { personalAgentHomeFaqs } from "./personal-agent-copy";
describe("localized home FAQ source", () => {
  it("returns the visible locale for the same structured-data source", () => {
    const zh = personalAgentHomeFaqs("zh-CN");
    const en = personalAgentHomeFaqs("en");
    expect(zh).toHaveLength(4);
    expect(en).toHaveLength(4);
    expect(zh[0][0]).toBe("这会连接或读取我的微信吗？");
    expect(en[0][0]).toBe("Is this connected to WeChat?");
    expect(en.every(([question, answer]) => !/[\u4e00-\u9fff]/.test(question + answer))).toBe(true);
  });
});
