import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalAgentDemo } from "./personal-agent-demo";
import { initialPersonalAgentDemo, personalAgentDemoReducer } from "@/lib/personal-agent-demo";
const ready = personalAgentDemoReducer(initialPersonalAgentDemo, { type: "complete-introduction" });
function render(state = ready) { return renderToStaticMarkup(<PersonalAgentDemo locale="zh-CN" state={state} dispatch={() => {}}/>); }
describe("public screenshot demo trust surface", () => {
  it("shows attribution and review without claiming product or WeChat execution", () => {
    const html = render();
    expect(html).toContain("理解草稿 · 待确认");
    expect(html).toContain("2026/9/28 14:36 · UTC+08:00");
    expect(html).toContain("不连接微信，不保存真实资料，不发送外部消息");
    expect(html).not.toContain("已留在当前演示里");
  });
  it("removing sources removes their words from both collapsed and full capture and dependent result", () => {
    const html = render(personalAgentDemoReducer(ready, { type: "remove-source" }));
    expect(html).not.toContain("好，我整理一下发你");
    expect(html).not.toContain("下周可以看看你的产品");
    expect(html).not.toContain("整理并发送产品介绍");
    expect(html).toContain("已失去来源支持");
    expect(html).toContain("重播不会恢复来源");
  });
  it("same-name review presents scoped labels instead of relationship evidence or preselection", () => {
    const html = render(personalAgentDemoReducer(ready, { type: "ambiguous" }));
    expect(html).toContain("当前只比较身份线索");
    expect(html).not.toContain("整理并发送产品介绍</strong>");
    expect(html).not.toContain("记下这件事 · 仅演示");
  });
  it("paused reminders retain sourced context without changing a person's disposition", () => {
    const saved = personalAgentDemoReducer(ready, { type: "save" });
    const html = render(personalAgentDemoReducer(saved, { type: "toggle-reminders" }));
    expect(html).toContain("提醒已暂停");
    expect(html).toContain("这不表示对方不感兴趣");
    expect(html).toContain("好，我整理一下发你");
  });
});
