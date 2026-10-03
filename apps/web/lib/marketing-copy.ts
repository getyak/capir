import type { MarketingLocale } from "./marketing-locale";
import { siteConfig } from "./site";

export const relationshipDemoHref = "/#personal-agent-demo";
export function marketingAccessHref(locale: MarketingLocale) {
  return `mailto:${siteConfig.email}?subject=${encodeURIComponent(locale === "en" ? `Request ${siteConfig.name} access` : `申请使用 ${siteConfig.name}`)}`;
}

const zh = {
  nav: ["产品", "使用方法", "信任", "定价", "研究"],
  demo: "体验截图接续",
  access: "申请使用",
  email: "通过邮件申请",
  login: "登录",
  theme: "切换明暗主题",
  openMenu: "打开导航",
  closeMenu: "关闭导航",
  navigation: "主导航",
  footer: "让每一段关系，都有可以接续的背景。",
  explore: "探索",
  privacy: "隐私政策",
  original: "中文原文",
  audience: "个人 Agent · 重要的人和未完的事",
  headline: ["每次跟进，", "都接得上上次对话。"],
  promise: "保留联系人的背景，发现对话里的变化，准备恰当的下一步。",
  methodTitle: "从一句话，到下一次好好交谈。",
  methodIntro: "联系人、对话和日程，围绕同一段关系展开。",
  steps: [
    {
      title: "留住背景",
      detail: "把你选择的对话放回联系人身边。",
      example: "林澄 · 产品负责人寻访",
      caption: "一段关系，持续积累的背景",
    },
    {
      title: "看清变化",
      detail: "从当前的问题，回到那句支持它的原话。",
      example: "远程安排仍未确认",
      caption: "来源可查，变化待你审阅",
    },
    {
      title: "接续下一步",
      detail: "先澄清，再决定是否联系或安排日程。",
      example: "先确认政策与具体日期",
      caption: "待审阅建议，不会自动发送",
    },
  ],
  methodLink: "了解使用方法",
  trustTitle: "放心记住，也能放手删除。",
  trustIntro: "原话有出处，判断有余地。重要决定始终由你作出。",
  trustLink: "了解信任与隐私",
  closingTitle: "把下一次跟进，接在这里。",
  closingDetail: "先用合成案例体验。希望用于自己的工作？通过邮件申请早期使用。",
  prototype: "可交互原型 · 全部为合成案例",
  pricingLink: "查看使用与定价",
  faqs: [
    {
      question: "它能帮我留下什么？",
      answer:
        "先理解你分享的对话，再由你选择留下认识背景或未完事项。产品方向是让新回复更新同一件事、下一次交流找回相关背景；实际开放范围在申请时明确。",
    },
    {
      question: "会自动发消息或安排日程吗？",
      answer:
        "不会。确认一项事实，不等于授权一次行动。发送对象、内容与时间需要另外审阅；本页演示不连接外部服务。",
    },
    {
      question: "移除来源之后会怎样？",
      answer:
        "依赖它的当前结论与建议会失去证据支持。历史决定仍保留其来源状态，不能继续冒充已获支持的结论。你可以在上方合成案例中亲手体验。",
    },
    {
      question: "现在可以开始使用吗？需要付费吗？",
      answer:
        "公开演示无需登录，也不收费。实际工作空间通过邮件申请；付费方案尚未公布。这里不会收取费用或启动订阅。",
    },
  ],
  brief: {
    title: "关系简报",
    synthetic: "合成案例",
    name: "林澄",
    role: "候选人 · 产品负责人寻访",
    initial: "澄",
    question: "当前问题",
    blocker: "远程安排，还没落定。",
    missing: "来源已移除，当前判断失去支持。",
    proposed: "待审阅",
    reviewed: "你已确认",
    withdrawn: "证据不可用",
    quoteLabel: "支持原话",
    quote: "我周三前需要做决定。新加坡远程办公的安排还没有确认。",
    attribution: "候选人 · 5 月 19 日 10:18",
    uncertain: "来源未给出年份与时区；“周三”仍需澄清。",
    source: "查看聊天截图",
    sourceClose: "收起聊天截图",
    sourceAlt:
      "合成聊天截图，绿色气泡在 10:18 提到周三前决定及新加坡远程安排尚未确认",
    sourceNote: "林澄为演示关联的合成人物；截图顶部显示对话另一方。",
    next: "待审阅的下一步",
    nextDetail: "先核实远程政策，再问清具体决策日期。",
    noAction: "不再保留这条建议。先补充有授权的来源。",
    review: "审阅变化",
    confirm: "确认这项事实",
    cancel: "暂不确认",
    undo: "撤销确认",
    remove: "移除证据",
    restore: "重新开始演示",
    reviewTitle: "确认“候选人说远程安排尚未确认”？",
    reviewDetail:
      "只确认这句话表达的状态。不会确认政策、补全日期、发送消息或安排日程。",
    confirmedNote: "已确认候选人的表述。未发送消息，也未安排日程。",
    removedNote: "已移除演示来源，依赖它的判断与建议同时失效。",
    resetNote: "新一轮演示已开始，事实需要重新审阅。",
    history: "此前的确认保留为演示历史，当前证据已不可用。",
    local: "仅此页面的合成演示，不保存真实联系人。",
    originalQuote: "原话保持中文",
    translation: "英文释义",
    retraction: "试试移除证据，看看下一步如何变化。",
  },
};

type Copy = typeof zh;
const en: Copy = {
  nav: ["Product", "How it works", "Trust", "Pricing", "Journal"],
  demo: "Try screenshot continuity",
  access: "Request access",
  email: "Apply by email",
  login: "Log in",
  theme: "Toggle light and dark theme",
  openMenu: "Open navigation",
  closeMenu: "Close navigation",
  navigation: "Main navigation",
  footer: "Keep the context that lets every relationship continue.",
  explore: "Explore",
  privacy: "Privacy policy",
  original: "Original Chinese",
  audience:
    "Personal Agent · People and unfinished things",
  headline: ["Every follow-up,", "a conversation continued."],
  promise:
    "Keep the context, notice what changed, and prepare the right next step for each relationship.",
  methodTitle: "From one message to your next good conversation.",
  methodIntro:
    "People, conversations, and meetings. One continuous relationship.",
  steps: [
    {
      title: "Keep the context",
      detail: "Bring a conversation you choose back to the person.",
      example: "Lin Cheng · Product leadership search",
      caption: "One relationship, a growing history",
    },
    {
      title: "Notice the change",
      detail: "Trace the current question to the words behind it.",
      example: "Remote arrangement still unresolved",
      caption: "Source available, change ready for review",
    },
    {
      title: "Continue thoughtfully",
      detail: "Clarify first. Then decide whether to reach out or schedule.",
      example: "Clarify the policy and exact date",
      caption: "A suggestion to review, never sent automatically",
    },
  ],
  methodLink: "See how it works",
  trustTitle: "Context you can trust. Evidence you can remove.",
  trustIntro:
    "Keep the source close and leave room for judgment. Important decisions stay with you.",
  trustLink: "Explore trust & privacy",
  closingTitle: "Let the next conversation start here.",
  closingDetail:
    "Explore with a synthetic case. To use it in your own work, request early access by email.",
  prototype: "Interactive prototype · All examples are synthetic",
  pricingLink: "View access & pricing",
  faqs: [
    {
      question: "What can I keep with it?",
      answer:
        "See a sourced understanding of a conversation you share, then choose context or an unfinished thing to keep. Updating the same item and recalling it next time are the product direction; confirm available capabilities when requesting access.",
    },
    {
      question: "Will it send messages or schedule meetings?",
      answer:
        "No. Confirming a fact does not authorize an action. The recipient, content, and time need a separate review. This demonstration has no external service connections.",
    },
    {
      question: "What happens when I remove a source?",
      answer:
        "Current conclusions and suggestions that depend on it lose their evidence support. Earlier decisions retain their source status and cannot masquerade as supported conclusions. Try it in the synthetic case above.",
    },
    {
      question: "Can I start now, and does it cost anything?",
      answer:
        "The public demo needs no login and is free to explore. Request a real workspace by email. Paid plans have not been announced. This website does not charge you or start a subscription.",
    },
  ],
  brief: {
    title: "Relationship brief",
    synthetic: "Synthetic case",
    name: "Lin Cheng",
    role: "Candidate · Product leadership search",
    initial: "LC",
    question: "Open question",
    blocker: "The remote arrangement is still unresolved.",
    missing: "Source removed. The current interpretation is unsupported.",
    proposed: "For review",
    reviewed: "Confirmed by you",
    withdrawn: "Evidence unavailable",
    quoteLabel: "Supporting words",
    quote: zh.brief.quote,
    attribution: "Candidate · May 19, 10:18",
    uncertain:
      "The source omits year and time zone. “Wednesday” still needs clarification.",
    source: "View chat screenshot",
    sourceClose: "Hide chat screenshot",
    sourceAlt:
      "Synthetic Chinese chat: the green message at 10:18 mentions deciding before Wednesday and an unresolved Singapore remote arrangement",
    sourceNote:
      "Lin Cheng is the synthetic identity linked for this demo. The screenshot header names the other participant.",
    next: "A next step to review",
    nextDetail:
      "Clarify the remote policy, then ask for the exact decision date.",
    noAction:
      "This suggestion is no longer supported. Add an authorized source first.",
    review: "Review change",
    confirm: "Confirm this fact",
    cancel: "Not now",
    undo: "Undo confirmation",
    remove: "Remove evidence",
    restore: "Start a new demo",
    reviewTitle:
      "Confirm that the candidate said the remote arrangement is unresolved?",
    reviewDetail:
      "Confirm only what these words say. This does not confirm a policy, resolve a date, send a message, or schedule a meeting.",
    confirmedNote:
      "Candidate statement confirmed. No message sent or meeting scheduled.",
    removedNote:
      "Demo source removed. Its dependent interpretation and suggestion are now unsupported.",
    resetNote: "New demo started. The fact needs a new review.",
    history:
      "The earlier confirmation remains in demo history. Its evidence is now unavailable.",
    local:
      "Synthetic demonstration on this page only. No real contacts are saved.",
    originalQuote: "Original words in Chinese",
    translation: "English translation",
    retraction: "Try removing the evidence to see the next step change.",
  },
};
export function marketingCopy(locale: MarketingLocale): Copy {
  return locale === "en" ? en : zh;
}
export const marketingNavigation = [
  "/product",
  "/how-it-works",
  "/trust",
  "/pricing",
  "/blog",
] as const;
