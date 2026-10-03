import type { MarketingLocale } from "./marketing-locale";

/** The visible FAQ and its structured data share exactly one localized source. */
export function personalAgentHomeFaqs(locale: MarketingLocale): readonly (readonly [string, string])[] {
  const en = locale === "en";
  return en ? [
    ["Is this connected to WeChat?", "No. The homepage is a page-local synthetic interaction using a WeChat-style transcript. It does not connect to WeChat, read your chats, save real records, or send messages."],
    ["What can I use now?", "Explore the public synthetic demonstration without signing in. macOS downloads have a dedicated release page; iOS is an invited preview. Request a real workspace by email and confirm its available features and data scope. The full screenshot continuity loop shown here is the product direction, not a universal release claim."],
    ["Does every screenshot become a permanent memory?", "See what was understood before choosing what to retain. People, dated context, and unfinished things are distinct. An uncertain identity must be resolved before private context is read; no next step is required."],
    ["What happens when I remove a source?", "Its dependent answers lose support and disappear from the current demo. Replay only repeats motion; it cannot restore sources. Starting a clearly named new synthetic demo explicitly reloads the sample."],
  ] : [
    ["这会连接或读取我的微信吗？", "不会。首页是使用微信风格合成素材的本页交互演示，不连接微信、不读取聊天、不保存真实资料，也不发送消息。"],
    ["现在可以用到什么？", "公开合成演示无需登录。macOS 下载有独立发布页，iOS 为受邀预览。真实工作空间通过邮件申请，使用前核对开放能力与资料范围；这里展示的完整截图接续是产品方向，不代表所有客户端已经开放。"],
    ["每张截图都会成为永久记忆吗？", "先看理解，再选择什么值得留下。人物、带时间的背景和未完事项分别生长；身份不确定时先确认，再读取私有背景。没有下一步也可以只保留认识背景。"],
    ["移除来源后，还能继续引用吗？", "依赖来源的当前答案会失去支持，在本页演示中不再显示。重播只重播动效，不恢复来源；明确开始新的合成演示才重新加载样例。"],
  ];
}
