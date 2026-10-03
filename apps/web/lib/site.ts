export const siteConfig = {
  name: "capri",
  title: "capri｜接住重要的人和未完的事",
  description:
    "分享一张聊天截图，留下认识的背景、答应的事情和后来的变化。你的个人 Agent，让下一次交流接得上。",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://gettalentsignal.com",
  email: "hello@talentsignal.ai",
} as const;

export const accessRequestHref =
  `mailto:${siteConfig.email}?subject=${encodeURIComponent(`申请使用 ${siteConfig.name}`)}`;

export const faqs = [
  { question: `${siteConfig.name} 用来做什么？`, answer: "先理解你分享的聊天截图，再由你选择值得留下的认识背景和未完事项。下一次回顾或收到新回复时，继续同一个人和同一件事。完整接续是产品方向，开放范围在申请时核对。" },
  { question: "截图会自动成为永久记忆吗？", answer: "不会把提取内容当作已确认事实。先看到有来源的理解，再选择值得留下的内容；身份歧义先确认，也可以暂不保存。" },
  { question: "它会自动发送消息吗？", answer: "外部发送需要独立的人类决定。公开合成演示只改变本页状态，不连接微信，不保存真实资料，也不发送消息。" },
  { question: "没有下一步，也能保存吗？", answer: "认识背景本身就有价值。没有截止日期就不补一个；等待、暂停和停止是正常结果，不意味着对方不感兴趣。" },
  { question: "删除来源之后会怎样？", answer: "依赖它的背景和建议失去来源支持。演示重播不会恢复已移除来源；只有明确开始新合成演示才会重新加载样例。" },
] as const;
