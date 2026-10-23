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
  "zh-TW": {
    product: { ...productStoryMeta["zh-TW"], rows: [] },
    "how-it-works": {
      title: "少重建一次背景，多認真交談一次。",
      description:
        "從一張你主動分享的聊天截圖開始。先看理解，再確認值得留下的內容，下一次繼續同一件事。",
      rows: [
        [
          "選擇一段對話",
          "只帶入當前關係需要的內容。",
          "在首頁合成案例中，陳夏請你先發產品介紹，你回覆“好，我整理一下”。Agent 的理解保留說話人和時間；沒有約定截止日期，就不補一個。",
        ],
        [
          "審閱發生的變化",
          "區分對方說了什麼，與已經確認了什麼。",
          "你選擇是否留作背景或記下承諾。人物身份有歧義時先確認，不讀取另一位同名人物的私有背景。待確認內容不會提前聲稱已經儲存。",
        ],
        [
          "決定下一步",
          "先提出一件有依據、可以審閱的事。",
          "用新截圖提出“介紹已發，等對方看完”的更新，審閱後改變同一事項。沒有新進展可以等待，也可以暫停。傳送外部訊息仍需要單獨的人類決定。",
        ],
      ],
    },
    trust: { ...trustStoryMeta["zh-TW"], rows: [] },
    pricing: {
      title: "先體驗，再決定是否一起使用。",
      description:
        "公開演示現在就能打開。真實工作空間處於早期申請階段，付費方案尚未公佈。",
      rows: [],
    },
  },
  ja: {
    product: { ...productStoryMeta.ja, rows: [] },
    "how-it-works": {
      title: "背景の引き直しを減らし、本気の会話を増やす。",
      description:
        "あなたが共有した一枚のチャットのスクリーンショットから始めます。まず理解を確認し、残す価値のある内容を選び、次回は同じことを続けます。",
      rows: [
        [
          "会話を選ぶ",
          "今の関係に必要な内容だけを持ち込みます。",
          "ホームの合成ケースでは、Chen Xia がプロダクトの紹介を依頼し、あなたが「はい、まとめて送ります」と返信します。Agent の理解は話者と時刻を保持し、締め切りの合意がなければ創作しません。",
        ],
        [
          "起きた変化を審査する",
          "相手が何を言ったかと、何が確認されたかを分けます。",
          "背景として残すか、約束として記録するかを選べます。身元に曖昧さがあれば先に確認し、同姓同名の别人の非公開背景は読み取りません。審査待ちの内容を保存済みと表現することはありません。" ,
        ],
        [
          "次の一歩を決める",
          "根拠があり、審査できる提案をひとつ。",
          "新しいスクリーンショットが「紹介を送信済み、相手のレビュー待ち」という更新を提案。あなたの審査が同じ項目を変えます。待つこと・休むことも有効な結果です。外部メッセージには別の人間の決定が必要です。",
        ],
      ],
    },
    trust: { ...trustStoryMeta.ja, rows: [] },
    pricing: {
      title: "まず体験して、一緒に使うかを決める。",
      description:
        "公開デモは今すぐお試しいただけます。実際のワークスペースは早期アクセス申請制です。有料プランは未発表です。",
      rows: [],
    },
  },
  ko: {
    product: { ...productStoryMeta.ko, rows: [] },
    "how-it-works": {
      title: "배경을 다시 만드는 일을 줄이고, 진짜 대화를 늘립니다.",
      description:
        "당신이 직접 공유한 채팅 스크린샷 한 장에서 시작합니다. 먼저 이해를 확인하고, 남길 가치가 있는 내용을 선택하고, 다음에는 같은 일을 이어갑니다.",
      rows: [
        [
          "대화 선택",
          "현재 관계에 필요한 내용만 가져옵니다.",
          "홈의 합성 사례에서 Chen Xia가 제품 소개를 요청하고 당신은 「네, 정리해서 보낼게요」라고 답합니다. Agent의 이해는 화자와 시각을 유지하며, 마감 합의가 없으면 만들어내지 않습니다.",
        ],
        [
          "발생한 변화 검토",
          "상대가 무엇을 말했는지와 무엇이 확인되었는지를 구분합니다.",
          "배경으로 남길지, 약속으로 기록할지 선택합니다. 신원이 모호하면 먼저 확인하고, 같은 이름의 다른 사람 비공개 배경은 읽지 않습니다. 검토 대기 내용을 저장 완료처럼 표현하지 않습니다.",
        ],
        [
          "다음 단계 결정",
          "근거가 있고 검토할 수 있는 제안 하나.",
          "새 스크린샷이 「소개를 보냈고, 상대가 보길 기다리는 중」이라는 업데이트를 제안합니다. 당신의 검토가 같은 항목을 바꿉니다. 기다리기와 멈추기도 유효한 결과입니다. 외부 메시지는 별도의 사람의 결정이 필요합니다.",
        ],
      ],
    },
    trust: { ...trustStoryMeta.ko, rows: [] },
    pricing: {
      title: "먼저 체험하고, 함께 쓸지 정하세요.",
      description:
        "공개 데모는 지금 바로 열 수 있습니다. 실제 작업 공간은 조기 신청 단계이며, 유료 플랜은 아직 발표되지 않았습니다.",
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
