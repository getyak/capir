import { ArrowRight, Check } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import {
  marketingAccessHref,
  marketingCopy,
  relationshipDemoHref,
} from "@/lib/marketing-copy";
import type { MarketingLocale } from "@/lib/marketing-locale";
import styles from "./marketing.module.css";
import { ProductStory, productStoryMeta } from "./product-story";

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
    trust: {
      title: "有出处的背景，有边界的智能。",
      description: "把原话、解释和决定分开，让每一步都能检查、纠正或停止。",
      rows: [
        [
          "你选择来源",
          "只处理你为当前目的主动提供的内容。",
          "公开演示仅包含合成资料，不读取你的通讯录、聊天或日历。实际接入的来源与权限应在使用前明确。",
        ],
        [
          "原话可以检查",
          "来源、说话人和时间与重要结论保持关联。",
          "身份不明、相对时间或矛盾不会被悄悄补全。Agent 的解释以建议呈现，不给个人价值、性格或录用概率评分。",
        ],
        [
          "行动单独授权",
          "确认事实，不等于发送消息或安排日程。",
          "外部效果需要单独审阅最终对象、内容和时间。本页的确认按钮仅改变当前演示状态，不保存真实记录。",
        ],
        [
          "移除意味着失效",
          "当前结论不能继续使用已移除的支持证据。",
          "依赖来源的建议失效，历史决定仍保留其当时的确认与当前来源状态。演示的“重新开始”创建新一轮演示，不代表恢复任何已删除的真实资料。",
        ],
      ],
    },
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
    trust: {
      title: "Context with sources. Intelligence with boundaries.",
      description:
        "Keep original words, interpretations, and decisions separate, so each step can be inspected, corrected, or stopped.",
      rows: [
        [
          "You choose the source",
          "Process only the content you provide for the current purpose.",
          "This public demo contains synthetic material only. It does not read your contacts, chats, or calendar. Real source access and permissions should be explicit before use.",
        ],
        [
          "The words stay inspectable",
          "Keep source, speaker, and time attached to important conclusions.",
          "Unknown identities, relative dates, and contradictions are not silently resolved. Agent interpretations remain suggestions, with no scoring of personal worth, personality, or acceptance probability.",
        ],
        [
          "Actions need separate approval",
          "Confirming a fact does not send a message or schedule a meeting.",
          "External effects require review of the final recipient, content, and time. This demo's confirmation button only changes the current page state, never real records.",
        ],
        [
          "Removal invalidates support",
          "Current conclusions cannot keep using a removed source.",
          "Dependent suggestions become unsupported. Earlier decisions keep their confirmation history and current source status. “Start a new demo” starts a fresh simulation; it does not recover deleted real data.",
        ],
      ],
    },
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
  const c = marketingCopy(locale);
  const copy = subpageCopy[locale][kind];
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
      {kind === "trust" && (
        <p className={styles.callout}>
          <Link className={styles.inlineLink} href="/privacy">
            {c.privacy}
            {en ? ` · ${c.original}` : ""}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
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
