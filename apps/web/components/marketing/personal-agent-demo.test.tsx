import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalAgentDemo, PersonalAgentDemoCover } from "./personal-agent-demo";
import { initialPersonalAgentDemo, personalAgentDemoReducer } from "@/lib/personal-agent-demo";
const ready = personalAgentDemoReducer(initialPersonalAgentDemo, { type: "complete-introduction" });
function render(state = ready) { return renderToStaticMarkup(<PersonalAgentDemo locale="zh-CN" state={state} dispatch={() => {}}/>); }
function renderCover(state = ready) { return renderToStaticMarkup(<PersonalAgentDemoCover locale="zh-CN" state={state}/>); }
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
    expect(html).not.toContain("陈夏");
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
  it("the cover note reads the same demo state without a second control surface", () => {
    const html = renderCover();
    expect(html).toContain("待你确认");
    expect(html).toContain("理解草稿 · 尚未保存");
    expect(html).toContain("好，我整理一下发你。");
    expect(html).toContain("9 月 28 日 · 合成对话");
    expect(html).not.toContain("记下这件事");
    expect(html).not.toContain("重播理解过程");
  });
  it("the cover note withdraws with its source and scopes any kept state to the demo", () => {
    const removed = renderCover(personalAgentDemoReducer(ready, { type: "remove-source" }));
    expect(removed).not.toContain("好，我整理一下发你");
    expect(removed).not.toContain("陈夏");
    expect(removed).toContain("已失去来源支持");
    const saved = renderCover(personalAgentDemoReducer(ready, { type: "save" }));
    expect(saved).toContain("演示内已记下 · 尚未保存真实资料");
    expect(saved).not.toContain("待你确认");
  });
  it("keeps the causal chain and secondary controls reachable under named disclosures", () => {
    const html = render();
    expect(html).toContain("从原话到背景");
    expect(html).toContain("演示控制与更多状态");
    expect(html).toContain("重播理解过程");
    expect(html).toContain("试试遇到同名人物");
    expect(html).toContain("先别提醒我");
    expect(html).toContain("移除来源");
    expect(html).toContain("新演示");
  });
  it("the primary result presents human confirmation and the next-reply action", () => {
    expect(render()).toContain("记下这件事 · 仅演示");
    const saved = personalAgentDemoReducer(ready, { type: "save" });
    expect(render(saved)).toContain("加入下一张截图");
    expect(render(personalAgentDemoReducer(saved, { type: "new-reply" }))).toContain("确认更新同一事项");
  });
});
