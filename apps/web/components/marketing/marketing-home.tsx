"use client";

import Link from "next/link";
import { useReducer } from "react";
import { initialPersonalAgentDemo, personalAgentDemoReducer } from "@/lib/personal-agent-demo";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { marketingAccessHref } from "@/lib/marketing-copy";
import { siteConfig } from "@/lib/site";
import { personalAgentHomeFaqs } from "@/lib/personal-agent-copy";
import { PersonalAgentDemo } from "./personal-agent-demo";
import s from "./personal-agent.module.css";

export function MarketingHome({ locale }: { locale: MarketingLocale }) {
  const [demo, dispatchDemo] = useReducer(personalAgentDemoReducer, initialPersonalAgentDemo);
  const en = locale === "en";
  const faqs = personalAgentHomeFaqs(locale);
  const t = (zh: string, english: string) => en ? english : zh;
  const stories = en ? [
    ["Remember an introduction", "You meet someone working on overseas payments. Keep how you met and what they said, without manufacturing a follow-up. A possible visit next month remains a plan at that time, never a permanent label."],
    ["Keep a small promise", "You agree to send a portfolio. Review one unfinished thing with no invented deadline. A later reply can propose changing the same item to waiting for their review."],
    ["Prepare for the next conversation", "Find shared context, changes, and what remains unfinished. No record of sending a promised example is different from proof that it was never sent."],
    ["Let context become current", "A later message says they decided to stay with their team. Review the change, retain the earlier history, and stop using an old job-search intention as current context."],
    ["Leave room for waiting", "“Not now” can pause a reminder while preserving context. Waiting is not evidence of disinterest. The absence of a next step is a complete result."],
  ] : [
    ["刚认识，先留作下次背景", "活动后认识一个做海外支付的人。留下怎么认识的、当时提到什么，不必制造跟进任务。“下个月可能来上海”保留为当时的计划，不成为永久标签。"],
    ["答应了一件小事，别让它沉下去", "你答应整理设计师作品集。审阅后记成一件未完的事，没有日期就不安排明天到期。新的回复能提出更新同一事项，变为等对方看完。"],
    ["下次见面，接得上上次", "回顾共同背景、最近变化和未完事项。没有记录表明案例已经提供，不等于案例没有提供；来源不足时，留出确认空间。"],
    ["新的消息，让旧理解变新", "对方从“考虑换工作”变为“决定留在团队”。审阅更新当前背景，同时保留来往历史，不再把旧意向当成今天的事实。"],
    ["先别提醒，也是一种理解", "一句“等项目结束再聊”，可以保留背景并暂停提醒。不会把等待推断成不感兴趣，没有下一步也可以安心结束。"],
  ];

  return <main id="main-content" tabIndex={-1} className={s.page} lang={locale}>
    <section className={s.hero} aria-labelledby="personal-agent-title">
      <p className={s.eyebrow}>{t("你的个人 Agent · 从一张聊天截图开始", "Your personal Agent · start with a chat screenshot")}</p>
      <div className={s.heroCopy}>
        <h1 id="personal-agent-title">{t("重要的人，未完的事。", "People that matter.")}<br/>{en ? <>Unfinished things. <span>Kept close.</span></> : <>随手交给 <span>{siteConfig.name}。</span></>}</h1>
        <div className={s.heroIntro}><p>{t("留下认识的背景、答应的事情和后来的变化。下一次交流，从这里接着聊。", "Keep the context, the promises, and what changed afterward. Pick up your next conversation where you left off.")}</p><div className={s.heroActions}><a className={s.primaryLink} href="#personal-agent-demo">{t("体验这段对话", "Try this conversation")}<ArrowRight size={16}/></a><Link className={s.secondaryLink} href="/download">{t(`下载 ${siteConfig.name}`, `Get ${siteConfig.name}`)}<ArrowUpRight size={15}/></Link></div></div>
      </div>
    </section>
    <PersonalAgentDemo locale={locale} state={demo} dispatch={dispatchDemo}/>
    <section className={s.continuity} id="method" aria-labelledby="continuity-title"><div className={s.continuityInner}>
      <div><p className={s.kicker}>{t("同一个人，同一件事", "Same person. Same unfinished thing.")}</p><h2 id="continuity-title">{t("今天留下的，", "What you keep today,")}<br/>{t("下次还接得起来。", "helps you next time.")}</h2><p>{t("价值在下一次交流时出现。新的截图接回旧承诺，变化经过审阅，留下可以继续的状态。", "The value returns with the next conversation. A new capture reconnects to an earlier promise; reviewed changes leave a state you can continue.")}</p></div>
      <div className={s.timeThread}>
        <article className={s.timeStep}><span>{t("昨天 · 一次托付", "Yesterday · a handoff")}</span><h3>{t("“好，我整理一下。”", "“I'll put it together.”")}</h3><p>{t("先看到理解，确认后留下产品介绍这件事。", "See the understanding, then review the product-overview commitment.")}</p><small>{t("事项 01 · 等你整理 · 无约定截止日期", "Item 01 · waiting on you · no agreed deadline")}</small></article>
        <article className={s.timeStep}><span>{t("今天 · 新的回复", "Today · a new reply")}</span><h3>{t("“收到，我周末看看。”", "“Got it. I'll review it this weekend.”")}</h3><p>{t("你的新截图提出状态更新，仍由你确认。", "Your new capture proposes a state change for your review.")}</p><small>{t("事项 01 · 更新为等对方 · 不重复新建", "Item 01 · now waiting on them · no duplicate")}</small></article>
        <article className={s.timeStep}><span>{t("下次 · 接着交流", "Next time · continue")}</span><h3>{t("“见面前，回顾什么？”", "“What should I recall before we meet?”")}</h3><p>{t("共同背景、已经变化的事和仍待确认的问题。", "Shared context, reviewed changes, and questions still open.")}</p><small>{t("原话可查 · 时间未确定 · 可以等待", "Inspectable sources · time unconfirmed · waiting is valid")}</small></article>
      </div>
    </div></section>
    <section className={s.personSection} id="product" aria-labelledby="person-context-title"><div className={s.sectionCopy}><p className={s.kicker}>{t("先接住一句话，再慢慢认识一个人", "Keep a conversation. Get to know a person over time.")}</p><h2 id="person-context-title">{t("每个人身边，", "Beside each person,")}<br/>{t("都有可以继续的背景。", "context you can continue.")}</h2><p>{t("人物页不必像一份完整履历。先回答三个日常问题，让下次见面不用从头翻记录。", "A person page need not begin with a complete biography. Start with three everyday questions so your next meeting needs less reconstruction.")}</p><Link className={s.secondaryLink} href="/product">{t("了解个人 Agent 的工作方式", "Explore the personal Agent")}<ArrowUpRight size={15}/></Link></div>
      <div className={s.personSheet}><div className={s.personIdentity}><span className={s.avatar} aria-hidden="true">{demo.sourceAvailable ? "夏" : "·"}</span><div><h3>{demo.sourceAvailable ? t("陈夏", "Chen Xia") : t("来源已移除", "Source removed")}</h3><p>{t("与上方演示使用同一份背景 · 仅本页", "Same context as the demo above · page only")}</p></div></div>
        {!demo.sourceAvailable ? <div className={s.personQuestion}><span>{t("当前背景不可用", "Current context unavailable")}</span><p>{t("重要内容已失去来源支持，无法继续用于回顾。", "Important context has lost its source support and cannot be used in a recap.")}</p><small>{t("重播不会恢复来源；可明确开始新合成演示。", "Replay cannot restore sources. Start a clearly named new synthetic demo.")}</small></div> : !demo.identityResolved ? <div className={s.personQuestion}><span>{t("人物尚未绑定", "Person not yet linked")}</span><p>{t("先确认当前截图属于哪一位人物，再读取私有背景。", "Resolve which person this capture concerns before reading private context.")}</p></div> : <>
          <div className={s.personQuestion}><span>{t("我们怎么认识的？", "How do we know each other?")}</span><p>{t("这份截图没有提供认识背景。", "This capture does not provide how you met.")}</p><small>{t("保持缺口，不根据聊天推断关系类型。", "Keep the gap; do not infer relationship type from wording.")}</small></div>
          <div className={s.personQuestion}><span>{t("最近发生了什么？", "What changed recently?")}</span><p>{demo.updateConfirmed ? t("你表示已发介绍；陈夏说周末看看。", "You said the overview was sent; Chen Xia said they would review it over the weekend.") : t("陈夏说下周可以看看产品，你答应先发介绍。", "Chen Xia said they could look at the product next week; you agreed to send an overview.")}</p><small>{demo.saved ? t("演示中已审阅的陈述 · 来源时间可查", "Statements reviewed in the demo · inspectable source time") : t("尚待你确认 · 不等于已经保存", "For your review · not a completed save")}</small></div>
          <div className={s.personQuestion}><span>{t("还有什么没结束？", "What remains unfinished?")}</span><p>{demo.updateConfirmed ? t("等对方看完，见面时间尚未确定。", "Waiting for their review; meeting time not agreed.") : demo.saved ? t("事项 01：整理产品介绍。", "Item 01: prepare the product overview.") : t("尚未记下事项。是否留下，由你决定。", "No item kept yet. You choose whether it deserves to stay.")}</p><small>{demo.remindersPaused ? t("提醒已暂停 · 背景仍保留", "Reminders paused · context retained") : t("不补截止日期，不推断对方态度。", "No invented deadline or attitude inference.")}</small></div>
        </>}
        <p>{t("人物、背景与事项分别生长；本页不保存真实资料。", "People, context, and work grow separately; this page saves no real data.")}</p>
      </div>
    </section>
    <section className={s.stories} aria-labelledby="stories-title"><div className={s.storiesInner}><div><p className={s.kicker}>{t("五种普通时刻", "Five everyday moments")}</p><h2 id="stories-title">{t("不必每次，", "You don't always need")}<br/>{t("都有下一步。", "a next step.")}</h2></div><div className={s.storyList}>{stories.map(([title,body],i)=><details key={title} open={i===0 ? true : undefined}><summary>{title}</summary><p>{body}</p></details>)}</div></div></section>
    <section className={s.trustSection} aria-labelledby="trust-title"><div className={s.trustCopy}><p className={s.kicker}>{t("理解分寸，也是能力", "Knowing when to pause is a capability")}</p><h2 id="trust-title">{t("放心留下，", "Keep it with care.")}<br/>{t("也可以纠正、等待、放手。", "Correct it. Wait. Let it go.")}</h2><p>{t("你为什么在意一个人，不能靠模型猜成永久事实。重要内容保留出处与时间，重要决定始终由你作出。", "Why someone matters to you cannot become a permanent fact by model guesswork. Important context retains source and time; consequential decisions stay with you.")}</p><Link className={s.secondaryLink} href="/trust">{t("查看信任与隐私边界", "Explore trust & privacy")}<ArrowUpRight size={15}/></Link></div><div className={s.trustNotes}>{[
      [t("原话、理解和确认，分别呈现", "Words, understanding, and confirmation stay distinct"),t("每条重要背景能回到说话人、时间和来源。同名先确认，不把别人的背景误接进来。", "Trace important context to speaker, time, and source. Resolve same names before reading private relationship context.")],
      [t("新消息能改变旧理解", "New messages can change old understanding"),t("临时计划不会永久有效。更新保留历史；移除来源，依赖它的当前背景与建议失效。", "Temporary plans are not timeless. Changes retain history; removing a source invalidates dependent current context and suggestions.")],
      [t("暂停保留背景，不制造催促", "A pause retains context without pressure"),t("没有约定日期就不造截止时间。没有变化可以安静等待；准备草稿不等于发送消息。", "No agreed date means no invented deadline. No change can justify silence; a prepared draft is not a sent message.")],
    ].map(([title,body],i)=><div className={s.trustNote} key={title}><span>0{i+1}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}</div></section>
    <section className={s.closing} id="access"><h2>{t("这段话，以后还用得上。", "This conversation will matter again.")}</h2><p>{t("先用合成对话体验这条链路。希望用于自己的来往？申请早期工作空间，核对可用能力与资料范围。", "Try the loop with synthetic conversations. For your own context, request early workspace access and confirm its available capabilities and data scope.")}</p><div className={s.heroActions}><a className={s.primaryLink} href={marketingAccessHref(locale)}>{t("申请早期体验", "Request early access")}<ArrowUpRight size={16}/></a><Link className={s.secondaryLink} href="/download">{t("查看下载与开放状态", "Downloads & availability")}<ArrowRight size={16}/></Link></div><p className={s.availability}>{t("macOS 公开下载 · iOS 受邀预览 · 微信直接连接尚未开放", "macOS public download · iOS invited preview · direct WeChat connection unavailable")}</p></section>
    <section className={s.faq} aria-labelledby="faq-title"><h2 id="faq-title">{t("你可能想知道", "Before you begin")}</h2>{faqs.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>
  </main>;
}
