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
  "zh-TW": {
    title: "原話、解釋、決定。各有邊界。",
    description: "重要的來往，需要能檢查的依據。先看對方說了什麼，再決定要留下什麼、要做什麼。",
  },
  ja: {
    title: "原文・解釈・あなたの決定。それぞれに境界を。",
    description: "大切なやりとりには、確認できる根拠が必要です。まず相手が何と言ったかを読み、何を残し、何をするかを決めます。",
  },
  ko: {
    title: "원문·해석·당신의 결정. 각자의 경계를.",
    description: "중요한 왕래에는 확인 가능한 근거가 필요합니다. 상대가 무엇이라고 말했는지 먼저 읽고, 무엇을 남기고 무엇을 할지 결정하세요.",
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
  "zh-TW": {
    eyebrow: "信任，從原話開始",
    title: ["原話、解釋、決定。", "各有邊界。"],
    follow: "沿著一段原話，查看邊界",
    caseLabel: "合成閱讀示例",
    date: "9 月 28 日 · 合成對話",
    name: "陳夏",
    speaker: "你",
    invitation: "下週可以看看你的產品，你先發個介紹給我？",
    reply: "好，我整理一下發你。",
    limit: "原話只說明答應發介紹。沒有約定截止日期，也沒有確認見面。",
    chainLabel: "01 / 從依據到決定",
    chainTitle: "看懂一句話，仍由你作決定。",
    chainIntro: "原話、Agent 提出的理解和你的決定，分別保留。建議不會因為看起來合理，就成為已確認的事實。",
    chain: [
      ["來源 / 可檢查", "保留是誰、何時、說了什麼。", "只帶入當前目的需要的內容。身份有歧義，先核對；來源沒有提到的內容，保持未知。"],
      ["理解 / 待你審閱", "“你答應先發產品介紹。”", "這是依據原話提出的理解。你可以糾正、略過，或決定是否留下；臨時計劃不會因此成為永久標籤。"],
      ["決定 / 由你授權", "留下背景，與發出訊息分別決定。", "外部效果需要另行審閱最終對象、內容和時間。確認一份理解，不授予傳送或安排行事曆的權限。"],
    ],
    removalLabel: "02 / 來源改變之後",
    removalTitle: "支持不在了，結論也要改變。",
    removalIntro: "兩個獨立示意，說明來源可用與移除後的邊界；這不是本頁的刪除操作。",
    available: "來源可用 · 待審閱",
    availableTitle: "原話與時間可以檢查。",
    availableText: "“先發介紹”是待審閱理解，尚未成為已確認事項。你仍可以回到上方原話，檢查這份理解。",
    removed: "來源已移除 · 失去支持",
    removedTitle: "原文不可再查看。",
    removedText: "依賴這份來源的當前理解與建議應當失去支持。歷史決定可保留當時的確認與當前來源狀態，不能據此重建已刪除的原話。",
    questionsLabel: "03 / 使用前，先核對",
    questions: [
      ["這個公開示例會讀取我的資料嗎？", "此頁僅使用合成資料，不讀取你的通訊錄、聊天或行事曆。展開說明只改變當前閱讀狀態，不會儲存記錄或執行外部操作。"],
      ["實際工作區如何處理我的資料？", "使用前核對已接入來源、處理位置、存取權限與保留範圍。真實處理方式取決於工作區配置和已授權範圍；這份閱讀示例不能替代實際配置與隱私說明。"],
    ],
    closingTitle: "先理解邊界，再帶入自己的來往。",
    closingText: "此頁不儲存記錄、不傳送訊息。完整截圖接續是產品方向；實際開放能力與資料範圍，使用前核對。",
    availability: "下載與開放狀態",
    privacy: "隱私政策",
  },
  ja: {
    eyebrow: "信頼は原文から",
    title: ["原文・解釈・決定。", "それぞれに境界を。"],
    follow: "原文をたどって境界を見る",
    caseLabel: "合成の読解例",
    date: "9月28日 · 合成会話",
    name: "Chen Xia",
    speaker: "あなた",
    invitation: "来週プロダクトを見てみられます。先に紹介を送ってもらえますか？",
    reply: "はい、まとめて送ります。",
    limit: "原文が示すのは紹介を送る約束だけ。締め切りの合意も、面談の確認もありません。",
    chainLabel: "01 / 根拠から決定へ",
    chainTitle: "一言を理解しても、決定はあなたが。",
    chainIntro: "原文、Agent による理解、そしてあなたの決定はそれぞれ別に残ります。もっともらしい提案も、確認済みの事実になるわけではありません。",
    chain: [
      ["出典 / 確認可能", "誰がいつ何を言ったかを残します。", "現在の目的に必要なものだけを持ち込みます。身元に曖昧さがあればまず照合し、出典にないことは不明のままにします。"],
      ["理解 / 審査待ち", "「プロダクトの紹介を送る約束をしました」", "原文に基づいて提案された理解です。訂正・スキップ・保持を決められます。一時的な予定が永続的なラベルになることはありません。"],
      ["決定 / あなたの許可", "背景の保持とメッセージ送信は別々の決定。", "外部への影響は、最終的な宛先・内容・時刻を別途審査します。理解の確認は送信や日程の許可を与えるものではありません。"],
    ],
    removalLabel: "02 / 出典が変わった後",
    removalTitle: "支持がなくなれば、結論も変わる。",
    removalIntro: "出典がある場合・ない場合の境界を示す二つの独立した図解です。このページで削除が行われるわけではありません。",
    available: "出典あり · 審査待ち",
    availableTitle: "原文と時刻は確認できます。",
    availableText: "「まず紹介を送る」は審査待ちの理解であり、確認済みの項目ではありません。上の原文に戻ってこの理解を確認できます。",
    removed: "出典削除済み · 支持なし",
    removedTitle: "原文はもう確認できません。",
    removedText: "この出典に依存する現在の理解と提案は支持を失うべきです。過去の決定は当時の確認と現在の出典状態を保持できますが、削除された原文を再構築することはできません。",
    questionsLabel: "03 / 利用前に確認",
    questions: [
      ["この公開例は私のデータを読み取りますか？", "このページは合成データのみを使用し、連絡先・チャット・カレンダーを読み取りません。説明の開閉はこの閲覧表示だけを変更し、記録の保存も外部操作の実行もしません。"],
      ["実際のワークスペースではデータをどう扱いますか？", "利用前に、接続済みの出典・処理場所・アクセス権限・保持範囲をご確認ください。実際の処理はワークスペースの設定と許可された範囲に依存します。この読解例は実際の設定やプライバシー通知の代わりにはなりません。"],
    ],
    closingTitle: "まず境界を理解して、自分のやりとりを。",
    closingText: "このページは記録を保存せず、メッセージも送信しません。完全なスクリーンショット継続はプロダクトの方向性です。利用前に提供機能とデータ範囲をご確認ください。",
    availability: "ダウンロードと提供状況",
    privacy: "プライバシーポリシー",
  },
  ko: {
    eyebrow: "신뢰는 원문에서",
    title: ["원문·해석·결정.", "각자의 경계를."],
    follow: "원문을 따라 경계 확인",
    caseLabel: "합성 읽기 예시",
    date: "9월 28일 · 합성 대화",
    name: "Chen Xia",
    speaker: "당신",
    invitation: "다음 주에 제품을 볼 수 있어요. 먼저 소개를 보내주시겠어요?",
    reply: "네, 정리해서 보내드릴게요.",
    limit: "원문이 말하는 것은 소개를 보내겠다는 약속뿐입니다. 마감 합의도, 면담 확정도 없습니다.",
    chainLabel: "01 / 근거에서 결정으로",
    chainTitle: "한마디를 이해해도 결정은 당신의 몫입니다.",
    chainIntro: "원문, Agent의 이해, 당신의 결정은 각각 따로 남습니다. 그럴듯한 제안도 확인된 사실이 되지는 않습니다.",
    chain: [
      ["출처 / 확인 가능", "누가 언제 무엇을 말했는지 남깁니다.", "현재 목적에 필요한 것만 가져옵니다. 신원이 모호하면 먼저 대조하고, 출처에 없는 것은 미지로 둡니다."],
      ["이해 / 검토 대기", "「제품 소개를 보내기로 했습니다」", "원문에 근거해 제안된 이해입니다. 수정·건너뛰기·보관을 결정할 수 있습니다. 일시적 계획이 영구적 라벨이 되지 않습니다."],
      ["결정 / 당신의 승인", "배경 보관과 메시지 발송은 별개의 결정입니다.", "외부 영향은 최종 대상·내용·시각을 별도로 검토합니다. 이해를 확인하는 것이 발송이나 일정 권한을 부여하지 않습니다."],
    ],
    removalLabel: "02 / 출처가 변한 뒤",
    removalTitle: "지지가 없어지면 결론도 바뀌어야 합니다.",
    removalIntro: "출처가 있을 때와 없을 때의 경계를 보여주는 두 개의 독립된 설명입니다. 이 페이지에서 삭제가 이루어지지 않습니다.",
    available: "출처 있음 · 검토 대기",
    availableTitle: "원문과 시각을 확인할 수 있습니다.",
    availableText: "「먼저 소개를 보내기」는 검토 대기인 이해이며, 확인된 항목이 아닙니다. 위의 원문으로 돌아가 이 이해를 확인할 수 있습니다.",
    removed: "출처 제거됨 · 지지 없음",
    removedTitle: "원문을 더 볼 수 없습니다.",
    removedText: "이 출처에 의존하던 현재의 이해와 제안은 지지를 잃어야 합니다. 과거의 결정은 당시의 확인과 현재 출처 상태를 유지할 수 있으나, 삭제된 원문을 재구성할 수는 없습니다.",
    questionsLabel: "03 / 사용 전에 확인",
    questions: [
      ["이 공개 예시가 내 데이터를 읽나요?", "이 페이지는 합성 자료만 사용하며 연락처·채팅·캘린더를 읽지 않습니다. 설명을 펼치는 것은 현재 읽기 화면만 바꾸며 기록을 저장하거나 외부 작업을 실행하지 않습니다."],
      ["실제 작업 공간은 내 데이터를 어떻게 다루나요?", "사용 전에 연결된 출처·처리 위치·접근 권한·보관 범위를 확인하세요. 실제 처리는 작업 공간 구성과 승인된 범위에 따릅니다. 이 읽기 예시가 설정이나 개인정보 고지를 대신할 수 없습니다."],
    ],
    closingTitle: "먼저 경계를 이해하고, 자신의 대화를 담으세요.",
    closingText: "이 페이지는 기록을 저장하지 않고 메시지를 보내지 않습니다. 전체 스크린샷 이어가기는 제품의 방향입니다. 사용 전에 제공 기능과 데이터 범위를 확인하세요.",
    availability: "다운로드 및 제공 상태",
    privacy: "개인정보 처리방침",
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
          <h1 id="trust-story-title">{copy.title.map((line, index) => <span key={line}>{line}{!locale.startsWith("zh") && index < copy.title.length - 1 ? " " : ""}</span>)}</h1>
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
