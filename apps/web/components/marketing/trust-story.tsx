import { ArrowDown, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { marketingCopy, relationshipDemoHref } from "@/lib/marketing-copy";
import type { MarketingLocale } from "@/lib/marketing-locale";
import styles from "./trust-story.module.css";

export const trustStoryMeta = {
  "zh-CN": {
    title: "原话、解释、决定。各有边界。",
    description: "重要的来往，需要能检查的依据。先看对方说了什么，再决定要留下什么、要做什么。",
  },
  en: {
    title: "Original words. Interpretation. Your decision.",
    description: "Important relationships deserve inspectable context. Read what was said, then choose what to keep and what to do.",
  },
};

const storyCopy = {
  "zh-CN": {
    eyebrow: "信任，从原话开始",
    title: ["原话、解释、决定。", "各有边界。"],
    follow: "沿着一段原话，查看边界",
    caseLabel: "合成阅读示例",
    date: "9 月 28 日 · 合成对话",
    name: "陈夏",
    speaker: "你",
    invitation: "下周可以看看你的产品，你先发个介绍给我？",
    reply: "好，我整理一下发你。",
    limit: "原话只说明答应发介绍。没有约定截止日期，也没有确认见面。",
    chainLabel: "01 / 从依据到决定",
    chainTitle: "看懂一句话，仍由你作决定。",
    chainIntro: "原话、Agent 提出的理解和你的决定，分别保留。建议不会因为看起来合理，就成为已确认的事实。",
    chain: [
      ["来源 / 可检查", "保留是谁、何时、说了什么。", "只带入当前目的需要的内容。身份有歧义，先核对；来源没有提到的内容，保持未知。"],
      ["理解 / 待你审阅", "“你答应先发产品介绍。”", "这是依据原话提出的理解。你可以纠正、略过，或决定是否留下；临时计划不会因此成为永久标签。"],
      ["决定 / 由你授权", "留下背景，与发出消息分别决定。", "外部效果需要另行审阅最终对象、内容和时间。确认一份理解，不授予发送或安排日程的权限。"],
    ],
    removalLabel: "02 / 来源改变之后",
    removalTitle: "支持不在了，结论也要改变。",
    removalIntro: "两个独立示意，说明来源可用与移除后的边界；这不是本页的删除操作。",
    available: "来源可用 · 待审阅",
    availableTitle: "原话与时间可以检查。",
    availableText: "“先发介绍”是待审阅理解，尚未成为已确认事项。你仍可以回到上方原话，检查这份理解。",
    removed: "来源已移除 · 失去支持",
    removedTitle: "原文不可再查看。",
    removedText: "依赖这份来源的当前理解与建议应当失去支持。历史决定可保留当时的确认与当前来源状态，不能据此重建已删除的原话。",
    questionsLabel: "03 / 使用前，先核对",
    questions: [
      ["这个公开示例会读取我的资料吗？", "此页仅使用合成资料，不读取你的通讯录、聊天或日历。展开说明只改变当前阅读状态，不会保存记录或执行外部操作。"],
      ["实际工作区如何处理我的资料？", "使用前核对已接入来源、处理位置、访问权限与保留范围。真实处理方式取决于工作区配置和已授权范围；这份阅读示例不能替代实际配置与隐私说明。"],
    ],
    closingTitle: "先理解边界，再带入自己的来往。",
    closingText: "此页不保存记录、不发送消息。完整截图接续是产品方向；实际开放能力与资料范围，使用前核对。",
    availability: "下载与开放状态",
    privacy: "隐私政策",
  },
  en: {
    eyebrow: "Trust starts with the words",
    title: ["Original words.", "Interpretation.", "Your decision."],
    follow: "Follow the words through each boundary",
    caseLabel: "Synthetic reading example",
    date: "September 28 · Synthetic conversation",
    name: "Chen Xia",
    speaker: "You",
    invitation: "I can look at your product next week. Could you send an overview first?",
    reply: "I’ll put it together and send it over.",
    limit: "An agreement to send an overview. No agreed deadline and no confirmed meeting.",
    chainLabel: "01 / From evidence to decision",
    chainTitle: "Understanding the words leaves the decision with you.",
    chainIntro: "Keep the original words, the Agent’s interpretation, and your decision separate. A plausible suggestion is still awaiting your review.",
    chain: [
      ["Source / inspectable", "Who said what, and when.", "Bring only what the current purpose needs. Resolve identity ambiguity first. What the source does not say stays unknown."],
      ["Interpretation / awaiting review", "“You agreed to send a product overview.”", "A reading grounded in the words above. Correct it, skip it, or decide whether to keep it. A temporary plan does not become a permanent label."],
      ["Decision / your authorization", "Keeping context and sending a message are separate decisions.", "Review the final recipient, content, and time for any external effect. Confirming an interpretation grants no permission to send or schedule."],
    ],
    removalLabel: "02 / When the source changes",
    removalTitle: "When support is gone, the conclusion must change.",
    removalIntro: "Two separate illustrations show the boundaries with and without a source. This page does not delete anything.",
    available: "Source available · awaiting review",
    availableTitle: "Original words and time are inspectable.",
    availableText: "“Send an overview first” is a proposed reading, not a confirmed item. You can still check this interpretation against the original words above.",
    removed: "Source removed · unsupported",
    removedTitle: "Original words unavailable.",
    removedText: "Current interpretations and suggestions that depend on this source should lose their support. Earlier decisions may retain their confirmation history and current source status. They cannot reconstruct deleted words.",
    questionsLabel: "03 / Before bringing your own data",
    questions: [
      ["Does this public example read my data?", "This page uses synthetic material only. It does not read your contacts, chats, or calendar. Opening an explanation changes only this reading view, without saving records or executing external actions."],
      ["How does a real workspace handle my data?", "Check connected sources, processing location, access permissions, and retention before use. Actual processing depends on the workspace configuration and authorized scope. This reading example cannot replace those settings or the privacy notice."],
    ],
    closingTitle: "Understand the boundaries before bringing your conversations.",
    closingText: "This page does not save records or send messages. The full screenshot continuity loop is a product direction. Confirm available capabilities and data scope before use.",
    availability: "Downloads & availability",
    privacy: "Privacy policy",
  },
};

export function TrustStory({ locale }: { locale: MarketingLocale }) {
  const copy = storyCopy[locale];
  const c = marketingCopy(locale);
  return (
    <main id="main-content" tabIndex={-1} className={styles.page} lang={locale}>
      <section className={styles.hero} aria-labelledby="trust-story-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="trust-story-title">{copy.title.map((line, index) => <span key={line}>{line}{locale === "en" && index < copy.title.length - 1 ? " " : ""}</span>)}</h1>
        </div>
        <aside className={styles.source} aria-label={copy.caseLabel}>
          <p className={styles.sourceLabel}>{copy.caseLabel}<span>{copy.date}</span></p>
          <blockquote><cite>{copy.name}</cite><p>“{copy.invitation}”</p></blockquote>
          <blockquote><cite>{copy.speaker}</cite><p>“{copy.reply}”</p></blockquote>
          <p className={styles.limit}>{copy.limit}</p>
        </aside>
        <div className={styles.overview}>
          <p className={styles.lead}>{trustStoryMeta[locale].description}</p>
          <a className={styles.textLink} href="#trust-boundaries">{copy.follow}<ArrowDown size={18} aria-hidden="true" /></a>
        </div>
      </section>
      <section id="trust-boundaries" className={styles.boundaries} aria-labelledby="trust-boundaries-title">
        <div><p className={styles.eyebrow}>{copy.chainLabel}</p><h2 id="trust-boundaries-title">{copy.chainTitle}</h2><p className={styles.lead}>{copy.chainIntro}</p></div>
        <ol className={styles.chain}>{copy.chain.map(([state, title, text]) => <li key={state}><p className={styles.state}>{state}</p><h3>{title}</h3><p>{text}</p></li>)}</ol>
      </section>
      <section className={styles.chapter} aria-labelledby="trust-removal-title">
        <p className={styles.eyebrow}>{copy.removalLabel}</p><h2 id="trust-removal-title">{copy.removalTitle}</h2><p className={styles.lead}>{copy.removalIntro}</p>
        <div className={styles.comparison}>
          <article><p className={styles.state}>{copy.available}</p><h3>{copy.availableTitle}</h3><p>{copy.availableText}</p></article>
          <article className={styles.unsupported}><p className={styles.state}>{copy.removed}</p><h3>{copy.removedTitle}</h3><p>{copy.removedText}</p></article>
        </div>
      </section>
      <section className={styles.questions} aria-label={copy.questionsLabel}>
        <p className={styles.eyebrow}>{copy.questionsLabel}</p>
        <div>{copy.questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className={styles.closing} aria-labelledby="trust-access-title">
        <h2 id="trust-access-title">{copy.closingTitle}</h2><p className={styles.lead}>{copy.closingText}</p>
        <div className={styles.actions}>
          <Link className={styles.demoLink} href={relationshipDemoHref}>{c.demo}<ArrowRight size={18} aria-hidden="true" /></Link>
          <Link className={styles.textLink} href="/privacy">{copy.privacy}<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link className={styles.textLink} href="/download">{copy.availability}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>
    </main>
  );
}
