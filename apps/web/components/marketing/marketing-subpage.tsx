import { ArrowRight, Check } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import {
  marketingAccessHref,
  marketingCopy,
  relationshipDemoHref,
} from "@/lib/marketing-copy";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { legacyCopyLocale } from "@/lib/marketing-locale";
import styles from "./marketing.module.css";
import { ProductStory, productStoryMeta } from "./product-story";
import { TrustStory, trustStoryMeta } from "./trust-story";

export type MarketingPageKind =
  "product" | "how-it-works" | "trust" | "pricing";
export const subpageCopy = {
  "zh-CN": {
    product: { ...productStoryMeta["zh-CN"], rows: [] },
    "how-it-works": {
      title: "少重建一次背景，多认真交谈一次。",
      description:
        "从一张你主动分享的聊天截图开始。先看理解，再确认值得留下的内容，下一次继续同一件事。",
      rows: [
        [
          "选择一段对话",
          "只带入当前关系需要的内容。",
          "在首页合成案例中，陈夏请你先发产品介绍，你回复“好，我整理一下”。Agent 的理解保留说话人和时间；没有约定截止日期，就不补一个。",
        ],
        [
          "审阅发生的变化",
          "区分对方说了什么，与已经确认了什么。",
          "你选择是否留作背景或记下承诺。人物身份有歧义时先确认，不读取另一位同名人物的私有背景。待确认内容不会提前声称已经保存。",
        ],
        [
          "决定下一步",
          "先提出一件有依据、可以审阅的事。",
          "用新截图提出“介绍已发，等对方看完”的更新，审阅后改变同一事项。没有新进展可以等待，也可以暂停。发送外部消息仍需要单独的人类决定。",
        ],
      ],
    },
    trust: { ...trustStoryMeta["zh-CN"], rows: [] },
    pricing: {
      title: "先体验，再决定是否一起使用。",
      description:
        "公开演示现在就能打开。真实工作空间处于早期申请阶段，付费方案尚未公布。",
      rows: [],
    },
  },
  en: {
    product: { ...productStoryMeta["en"], rows: [] },
    "how-it-works": {
      title: "Less reconstructing. More real conversation.",
      description:
        "Share a screenshot intentionally. See what was understood, review what deserves to stay, then return to the same unfinished thing.",
      rows: [
        [
          "Choose a conversation",
          "Bring only what this relationship needs.",
          "In the synthetic home demo, Chen Xia asks you to send a product overview and you agree to prepare it. The understanding retains speaker and time. No deadline was agreed, so none is invented.",
        ],
        [
          "Review what changed",
          "Separate what someone said from what is confirmed.",
          "Choose whether to keep context or record a commitment. Resolve identity ambiguity before reading another same-name person's private evidence. A pending review is never described as a completed save.",
        ],
        [
          "Decide the next step",
          "Prepare one supported, reviewable suggestion.",
          "A later screenshot proposes “overview sent; waiting for their review.” Your review changes the same item. Waiting and pausing are valid outcomes. External messages still require a separate human decision.",
        ],
      ],
    },
    trust: { ...trustStoryMeta["en"], rows: [] },
    pricing: {
      title: "Explore first. Decide together when it fits.",
      description:
        "The public demo is ready to explore. Real workspaces are available by early-access request. Paid plans have not been announced.",
      rows: [],
    },
  },
};

export function MarketingSubpage({
  kind,
  locale,
}: {
  kind: MarketingPageKind;
  locale: MarketingLocale;
}) {
  if (kind === "product") return <ProductStory locale={locale} />;
  if (kind === "trust") return <TrustStory locale={locale} />;
  const c = marketingCopy(locale);
  const copy = subpageCopy[legacyCopyLocale(locale)][kind];
  const en = locale === "en";
  return (
    <main id="main-content" tabIndex={-1} className={styles.page} lang={locale}>
      <section className={styles.subHero}>
        <p className={styles.eyebrow}>
          {c.nav[["product", "how-it-works", "trust", "pricing"].indexOf(kind)]}
        </p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </section>
      {kind === "pricing" ? (
        <>
          <div className={styles.pricingGrid}>
            <article className={styles.pricePlan}>
              <h2>{en ? "Public demo" : "公开演示"}</h2>
              <p className={styles.price}>
                {en ? "Free to explore" : "免费体验"}
              </p>
              <p>
                {en
                  ? "Understand the workflow before bringing your own data."
                  : "先理解工作方式，再决定是否带入自己的资料。"}
              </p>
              <ul>
                {(en
                  ? [
                      "Synthetic screenshot continuity demo",
                      "Inspect, review, and remove evidence",
                      "No login or card required",
                    ]
                  : [
                      "合成截图接续体验",
                      "查看、审阅和移除证据",
                      "无需登录或绑定支付方式",
                    ]
                ).map((item) => (
                  <li key={item}>
                    <Check size={16} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link className={styles.primary} href={relationshipDemoHref}>
                {c.demo}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </article>
            <article className={styles.pricePlan}>
              <h2>{en ? "Early workspace access" : "早期工作空间"}</h2>
              <p className={styles.price}>{en ? "By request" : "申请开放"}</p>
              <p>
                {en
                  ? "For client work, partnerships, collaboration, and recruiting."
                  : "面向客户合作、伙伴关系、协作与招聘。"}
              </p>
              <ul>
                {(en
                  ? [
                      "Discuss your relationship workflow",
                      "Confirm available features and data scope",
                      "Paid plans and billing are not yet available",
                    ]
                  : [
                      "交流你的联系人工作方式",
                      "使用前确认可用功能与资料范围",
                      "付费方案与在线订阅尚未开放",
                    ]
                ).map((item) => (
                  <li key={item}>
                    <Check size={16} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <a className={styles.primary} href={marketingAccessHref(locale)}>
                {c.access}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <p className={styles.notice}>{c.email}</p>
            </article>
          </div>
          <p className={styles.callout}>
            {en
              ? "An access request opens your email app. It does not start a trial, create a subscription, or authorize a payment. Availability and any future price will be confirmed before you commit."
              : "申请入口会打开你的邮件应用，不会启动试用期、创建订阅或授权付款。实际开放范围及未来收费会在使用前明确。"}
          </p>
        </>
      ) : (
        <div className={styles.featureRows}>
          {copy.rows.map(([title, lead, text]) => (
            <section className={styles.featureRow} key={title}>
              <h2>{title}</h2>
              <div>
                <strong>{lead}</strong>
                <p>{text}</p>
              </div>
            </section>
          ))}
        </div>
      )}
      {kind !== "pricing" && (
        <section className={styles.closing}>
          <h2>
            {en
              ? "See what changes when the source changes."
              : "亲手看看，来源改变时会发生什么。"}
          </h2>
          <div className={styles.actions}>
            <Link className={styles.primary} href={relationshipDemoHref}>
              {c.demo}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className={styles.secondary} href={marketingAccessHref(locale)}>
              {c.access}
              <span>{c.email}</span>
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
