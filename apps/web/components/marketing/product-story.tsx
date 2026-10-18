import { ArrowRight, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { marketingCopy, relationshipDemoHref } from "@/lib/marketing-copy";
import type { MarketingLocale } from "@/lib/marketing-locale";
import shared from "./marketing.module.css";
import styles from "./product-story.module.css";

export const productStoryMeta = {
  "zh-CN": {
    title: "重要的人，下次接着聊。",
    description: "记得为什么认识，也知道上次聊到了哪里。看看原话、你的审阅和后来的变化，怎样留在同一段来往里。",
  },
  en: {
    title: "Pick up where you left off.",
    description: "Keep the context of a relationship close, ready for the next conversation. See how sources, your review, and later changes stay together.",
  },
};

const storyCopy = {
  "zh-CN": {
    eyebrow: "你的个人 Agent",
    title: ["重要的人，", "下次接着聊。"],
    promise: "记得为什么认识，也知道上次聊到了哪里。",
    caseLabel: "合成关系案例",
    beforeNext: "下次交流前",
    synthetic: "合成案例 · 审阅后的示例",
    name: "陈夏",
    relationship: "关于你的产品",
    background: "共同背景",
    backgroundText: "陈夏愿意看看你的产品。",
    unknown: "认识的经过，这份来源没有提到。",
    recent: "最近的变化",
    recentText: "产品介绍已经发出，对方说周末看看。",
    waiting: "等对方看完，再继续",
    unresolved: "未确定见面时间 · 没有约定截止日期",
    sourceToggle: "查看支持这段背景的原话",
    sourceSpeaker: "你",
    sent: "介绍发你了。",
    received: "收到，我周末看看。",
    sourceDate: "9 月 30 日 · 合成对话",
    sourceLimit: "“周末看看”不是见面时间，也不等于已经看完。",
    changeTitle: "新消息，改写同一件事。",
    changeIntro: "保留变化前后的状态，也保留作出判断的那句话。",
    firstDate: "9 月 28 日 · 起初",
    promiseQuote: "好，我整理一下发你。",
    firstState: "等你整理",
    firstMeaning: "你答应先发产品介绍，没有约定截止日期。",
    laterDate: "9 月 30 日 · 后来",
    laterState: "等对方看完",
    laterMeaning: "新来源提出状态变化，经你审阅后，更新同一事项。",
    evidenceToggle: "查看两次变化的依据",
    invitation: "下周可以看看你的产品，你先发个介绍给我？",
    firstSourceDate: "9 月 28 日 · 合成对话",
    reviewBoundary: "这里呈现的是审阅后的合成路径。新消息提出变化；你的审阅决定是否更新，不重复新建事项。",
    layersTitle: "人、背景和事情，分别生长。",
    layersIntro: "一次来往可以留下不同的内容。不必把一段对话变成完整档案。",
    layers: [
      ["人物", "核对过的身份线索", "陈夏。名字相同，仍要先确认是不是同一个人。"],
      ["背景", "带着来源与时间", "对方当时愿意看产品；临时计划不变成永久标签。"],
      ["事项", "保留承诺与等待条件", "产品介绍这一件事，从等你整理，变成等对方看完。"],
    ],
    quietTitle: "可以等待，也可以先停一停。",
    quietText: "没有新进展，不必制造下一步。暂停提醒只改变提醒，不推测对方态度。准备草稿，也不等于发送消息。",
    removalToggle: "移除来源后，这段背景会怎样？",
    removalText: "失去支持的当前背景与建议应当失效。历史审阅不能替代原话，也不能恢复已经删除的内容。",
    closingTitle: "先体验，再带入自己的来往。",
    closingText: "此页是合成阅读示例，不保存记录、不发送消息。完整截图接续是产品方向；实际开放能力与资料范围，使用前核对。",
    availability: "下载与开放状态",
  },
  en: {
    eyebrow: "Your personal Agent",
    title: ["Pick up where", "you left off."],
    promise: "Keep the context of a relationship close, ready for the next conversation.",
    caseLabel: "Synthetic relationship case",
    beforeNext: "Before the next conversation",
    synthetic: "Synthetic case · after review",
    name: "Chen Xia",
    relationship: "About your product",
    background: "Shared context",
    backgroundText: "Chen Xia offered to look at your product.",
    unknown: "How you met is not in this source.",
    recent: "What changed",
    recentText: "You sent the overview. Chen Xia said they would look over the weekend.",
    waiting: "Wait for their review, then continue",
    unresolved: "No meeting time · No agreed deadline",
    sourceToggle: "Read the words behind this context",
    sourceSpeaker: "You",
    sent: "Sent you the overview.",
    received: "Got it. I’ll take a look over the weekend.",
    sourceDate: "September 30 · Synthetic conversation",
    sourceLimit: "“Over the weekend” is not a meeting time or evidence that the review is complete.",
    changeTitle: "A new reply. The same unfinished thing.",
    changeIntro: "Keep what changed alongside the words that support it.",
    firstDate: "September 28 · At first",
    promiseQuote: "I’ll put it together and send it over.",
    firstState: "Waiting on you",
    firstMeaning: "You promised to send a product overview. No deadline was agreed.",
    laterDate: "September 30 · Later",
    laterState: "Waiting on their review",
    laterMeaning: "A new source proposes a change. Your review updates the same item.",
    evidenceToggle: "Read the sources for both changes",
    invitation: "I can look at your product next week. Could you send an overview first?",
    firstSourceDate: "September 28 · Synthetic conversation",
    reviewBoundary: "This synthetic path shows the result after review. New messages propose changes; you choose whether to update the existing item instead of creating a duplicate.",
    layersTitle: "People, context, and work grow separately.",
    layersIntro: "One conversation can leave different useful things. It need not become a complete profile.",
    layers: [
      ["Person", "Reviewed identity clues", "Chen Xia. The same name still needs an identity check."],
      ["Context", "With a source and a time", "An offer to look at your product, made then. A temporary plan stays temporary."],
      ["Work", "A promise and its waiting condition", "The same product overview moves from waiting on you to waiting on their review."],
    ],
    quietTitle: "Waiting is a useful outcome, too.",
    quietText: "Without new progress, there may be nothing to do. Pausing affects reminders, not assumptions about someone’s interest. Preparing a draft does not send a message.",
    removalToggle: "What happens if a source is removed?",
    removalText: "Current context and suggestions that lose their support should become invalid. An earlier review cannot replace the original words or restore deleted content.",
    closingTitle: "Explore before bringing your own conversations.",
    closingText: "This synthetic reading example does not save records or send messages. The full screenshot continuity loop is a product direction. Confirm available capabilities and data scope before use.",
    availability: "Downloads & availability",
  },
};

export function ProductStory({ locale }: { locale: MarketingLocale }) {
  const copy = storyCopy[locale];
  const c = marketingCopy(locale);
  return (
    <main id="main-content" tabIndex={-1} className={styles.page} lang={locale}>
      <section className={styles.hero} aria-labelledby="product-story-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="product-story-title">{copy.title.map((line, index) => <span key={line}>{line}{locale === "en" && index < copy.title.length - 1 ? " " : ""}</span>)}</h1>
          <p className={styles.promise}>{copy.promise}</p>
          <Link href={relationshipDemoHref} className={shared.primary}>
            {c.demo}<ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <aside className={styles.folio} aria-label={copy.caseLabel}>
          <div className={styles.folioTop}><span>{copy.beforeNext}</span><span>{copy.synthetic}</span></div>
          <div className={styles.identity}><h2>{copy.name}</h2><p>{copy.relationship}</p></div>
          <dl className={styles.context}>
            <div><dt>{copy.background}</dt><dd>{copy.backgroundText}<span>{copy.unknown}</span></dd></div>
            <div><dt>{copy.recent}</dt><dd>{copy.recentText}</dd></div>
          </dl>
          <div className={styles.dependency}><strong>{copy.waiting}</strong><p>{copy.unresolved}</p></div>
          <details className={styles.evidence}>
            <summary>{copy.sourceToggle}</summary>
            <div className={styles.source}>
              <p>{copy.sourceDate}</p>
              <blockquote><cite>{copy.sourceSpeaker}</cite><p>{copy.sent}</p></blockquote>
              <blockquote><cite>{copy.name}</cite><p>{copy.received}</p></blockquote>
              <p>{copy.sourceLimit}</p>
            </div>
          </details>
        </aside>
      </section>
      <section className={styles.chapter} aria-labelledby="product-change-title">
        <h2 id="product-change-title">{copy.changeTitle}</h2><p className={styles.lead}>{copy.changeIntro}</p>
        <div className={styles.change}>
          <article><p className={styles.date}>{copy.firstDate}</p><blockquote><p>“{copy.promiseQuote}”</p><cite>{copy.sourceSpeaker}</cite></blockquote><h3>{copy.firstState}</h3><p>{copy.firstMeaning}</p></article>
          <article className={styles.current}><p className={styles.date}>{copy.laterDate}</p><blockquote><p>“{copy.received}”</p><cite>{copy.name}</cite></blockquote><h3>{copy.laterState}</h3><p>{copy.laterMeaning}</p></article>
        </div>
        <details className={styles.evidence}>
          <summary>{copy.evidenceToggle}</summary>
          <div className={styles.sourceGrid}>
            <div className={styles.source}><p>{copy.firstSourceDate}</p><blockquote><cite>{copy.name}</cite><p>{copy.invitation}</p></blockquote><blockquote><cite>{copy.sourceSpeaker}</cite><p>{copy.promiseQuote}</p></blockquote></div>
            <div className={styles.source}><p>{copy.sourceDate}</p><blockquote><cite>{copy.sourceSpeaker}</cite><p>{copy.sent}</p></blockquote><blockquote><cite>{copy.name}</cite><p>{copy.received}</p></blockquote></div>
          </div>
          <p className={styles.reviewBoundary}>{copy.reviewBoundary}</p>
        </details>
      </section>
      <section className={styles.chapter} aria-labelledby="product-layers-title">
        <h2 id="product-layers-title">{copy.layersTitle}</h2><p className={styles.lead}>{copy.layersIntro}</p>
        <dl className={styles.layers}>{copy.layers.map(([label, meaning, example]) => <div key={label}><dt>{label}</dt><dd><strong>{meaning}</strong><p>{example}</p></dd></div>)}</dl>
      </section>
      <section className={styles.quiet} aria-labelledby="product-waiting-title">
        <h2 id="product-waiting-title">{copy.quietTitle}</h2><p>{copy.quietText}</p>
        <details className={styles.evidence}><summary>{copy.removalToggle}</summary><p className={styles.removal}>{copy.removalText}</p></details>
      </section>
      <section className={styles.closing} aria-labelledby="product-access-title">
        <h2 id="product-access-title">{copy.closingTitle}</h2><p>{copy.closingText}</p>
        <Link href="/download" className={styles.availability}>{copy.availability}<DownloadSimple size={18} aria-hidden="true" /></Link>
      </section>
    </main>
  );
}
