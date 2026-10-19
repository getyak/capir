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
  "zh-TW": {
    title: "重要的人，下次接著聊。",
    description: "記得為什麼認識，也知道上次聊到了哪裡。看看原話、你的審閱和後來的變化，怎樣留在同一段來往裡。",
  },
  ja: {
    title: "大切な人との会話を、そこから続ける。",
    description: "どうして知り合ったかを覚え、前回どこまで話したかもわかる。発言の原文、あなたの審査、その後の変化が同じやりとりの中にどう残るかをご覧ください。",
  },
  ko: {
    title: "소중한 사람과, 다음에 이어서 대화하세요.",
    description: "어떻게 알게 되었는지 기억하고, 지난번 대화가 어디까지 이어졌는지도 압니다. 원문, 당신의 검토, 이후의 변화가 같은 왕래 안에 어떻게 남는지 확인해 보세요.",
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
  "zh-TW": {
    eyebrow: "你的個人 Agent",
    title: ["重要的人，", "下次接著聊。"],
    promise: "記得為什麼認識，也知道上次聊到了哪裡。",
    caseLabel: "合成關係案例",
    beforeNext: "下次交流前",
    synthetic: "合成案例 · 審閱後的示例",
    name: "陳夏",
    relationship: "關於你的產品",
    background: "共同背景",
    backgroundText: "陳夏願意看看你的產品。",
    unknown: "認識的經過，這份來源沒有提到。",
    recent: "最近的變化",
    recentText: "產品介紹已經發出，對方說週末看看。",
    waiting: "等對方看完，再繼續",
    unresolved: "未確定見面時間 · 沒有約定截止日期",
    sourceToggle: "查看支持這段背景的原話",
    sourceSpeaker: "你",
    sent: "介紹發你了。",
    received: "收到，我週末看看。",
    sourceDate: "9 月 30 日 · 合成對話",
    sourceLimit: "“週末看看”不是見面時間，也不等於已經看完。",
    changeTitle: "新訊息，改寫同一件事。",
    changeIntro: "保留變化前後的狀態，也保留作出判斷的那句話。",
    firstDate: "9 月 28 日 · 起初",
    promiseQuote: "好，我整理一下發你。",
    firstState: "等你整理",
    firstMeaning: "你答應先發產品介紹，沒有約定截止日期。",
    laterDate: "9 月 30 日 · 後來",
    laterState: "等對方看完",
    laterMeaning: "新來源提出狀態變化，經你審閱後，更新同一事項。",
    evidenceToggle: "查看兩次變化的依據",
    invitation: "下週可以看看你的產品，你先發個介紹給我？",
    firstSourceDate: "9 月 28 日 · 合成對話",
    reviewBoundary: "這裡呈現的是審閱後的合成路徑。新訊息提出變化；你的審閱決定是否更新，不重複新建事項。",
    layersTitle: "人、背景和事情，分別生長。",
    layersIntro: "一次來往可以留下不同的內容。不必把一段對話變成完整檔案。",
    layers: [
      ["人物", "核對過的身份線索", "陳夏。名字相同，仍要先確認是不是同一個人。"],
      ["背景", "帶著來源與時間", "對方當時願意看產品；臨時計劃不變成永久標籤。"],
      ["事項", "保留承諾與等待條件", "產品介紹這一件事，從等你整理，變成等對方看完。"],
    ],
    quietTitle: "可以等待，也可以先停一停。",
    quietText: "沒有新進展，不必製造下一步。暫停提醒只改變提醒，不推測對方態度。準備草稿，也不等於傳送訊息。",
    removalToggle: "移除來源後，這段背景會怎樣？",
    removalText: "失去支持的當前背景與建議應當失效。歷史審閱不能替代原話，也不能恢復已經刪除的內容。",
    closingTitle: "先體驗，再帶入自己的來往。",
    closingText: "此頁是合成閱讀示例，不儲存記錄、不傳送訊息。完整截圖接續是產品方向；實際開放能力與資料範圍，使用前核對。",
    availability: "下載與開放狀態",
  },
  ja: {
    eyebrow: "あなたのパーソナル Agent",
    title: ["大切な人と、", "次に続きから。"],
    promise: "どうして知り合ったかを覚え、前回どこまで話したかもわかる。",
    caseLabel: "合成の関係ケース",
    beforeNext: "次の会話の前に",
    synthetic: "合成ケース · 審査後の例",
    name: "Chen Xia",
    relationship: "あなたのプロダクトについて",
    background: "共有された背景",
    backgroundText: "Chen Xia はプロダクトを見たいと申し出てくれました。",
    unknown: "どのように知り合ったかは、この出典にはありません。",
    recent: "最近の変化",
    recentText: "プロダクトの紹介を送信。相手は週末に見ると言っていました。",
    waiting: "相手のレビューを待ってから続ける",
    unresolved: "面談の日時は未定 · 締め切りの合意なし",
    sourceToggle: "この背景を支えた発言を読む",
    sourceSpeaker: "あなた",
    sent: "紹介を送りました。",
    received: "受け取りました。週末に見てみます。",
    sourceDate: "9月30日 · 合成会話",
    sourceLimit: "「週末に見る」は面談の日時でも、レビュー完了の証拠でもありません。",
    changeTitle: "新しい返信が、同じことを書き換える。",
    changeIntro: "変化した状態と、それを支えた一言の両方を残します。",
    firstDate: "9月28日 · 最初",
    promiseQuote: "はい、まとめて送ります。",
    firstState: "あなたの対応待ち",
    firstMeaning: "プロダクトの紹介を送る約束をしました。締め切りの合意はありません。",
    laterDate: "9月30日 · その後",
    laterState: "相手のレビュー待ち",
    laterMeaning: "新しい出典が変化を提案。あなたの審査が同じ項目を更新します。",
    evidenceToggle: "二つの変化の根拠を読む",
    invitation: "来週プロダクトを見てみられます。先に紹介を送ってもらえますか？",
    firstSourceDate: "9月28日 · 合成会話",
    reviewBoundary: "ここに見せるのは審査後の合成パスです。新しい返信は変化を提案し、更新するかどうかはあなたの審査が決めます。項目の重複作成はしません。",
    layersTitle: "人・背景・仕事は、別々に育つ。",
    layersIntro: "ひとつのやりとりが、異なる有用なものを残せます。会話を完全なプロフィールにする必要はありません。",
    layers: [
      ["人物", "確認済みの手がかり", "Chen Xia。同姓同名でも、同一人物かどうかの確認が先です。"],
      ["背景", "出典と時刻つき", "その時点でプロダクトを見たいという申し出。一時的な予定は一時のまま。"],
      ["仕事", "約束とその待ち条件", "同じプロダクト紹介が、あなたの対応待ちから相手のレビュー待ちへ。"],
    ],
    quietTitle: "待つことも、少し休むことも。",
    quietText: "新しい進展がなければ、次の一歩を作る必要はありません。停止はリマインダーだけに影響し、相手の態度を推測しません。下書きの準備もメッセージの送信ではありません。",
    removalToggle: "出典を削除したら、この背景はどうなる？",
    removalText: "支持を失った現在の背景と提案は無効になるべきです。過去の審査が原文の代わりになることも、削除済みの内容を復元することもできません。",
    closingTitle: "まず体験して、それから自分のやりとりを。",
    closingText: "このページは合成の読解例です。記録の保存もメッセージの送信もしません。完全なスクリーンショット継続はプロダクトの方向性です。利用前に提供機能とデータ範囲をご確認ください。",
    availability: "다운로드 및 제공 상태",
  },
  ko: {
    eyebrow: "당신의 퍼스널 Agent",
    title: ["소중한 사람과,", "다음에 이어서."],
    promise: "어떻게 알게 되었는지 기억하고, 지난번 대화가 어디까지 이어졌는지도 압니다.",
    caseLabel: "합성 관계 사례",
    beforeNext: "다음 대화 전에",
    synthetic: "합성 사례 · 검토 후 예시",
    name: "Chen Xia",
    relationship: "당신의 제품 관련",
    background: "공유된 배경",
    backgroundText: "Chen Xia가 당신의 제품을 보고 싶다고 했습니다.",
    unknown: "어떻게 알게 되었는지는 이 출처에 없습니다.",
    recent: "최근의 변화",
    recentText: "제품 소개를 보냈습니다. 상대는 주말에 보겠다고 했습니다.",
    waiting: "상대가 본 다음 이어가기",
    unresolved: "면담 일자 미정 · 마감 합의 없음",
    sourceToggle: "이 배경을 뒷받침한 말 읽기",
    sourceSpeaker: "당신",
    sent: "소개 보내드렸습니다.",
    received: "확인했습니다. 주말에 볼게요.",
    sourceDate: "9월 30일 · 합성 대화",
    sourceLimit: "「주말에 본다」는 면담 일자도, 열람 완료의 증거도 아닙니다.",
    changeTitle: "새 답장이, 같은 일을 다시 씁니다.",
    changeIntro: "변화한 상태와, 그것을 뒷받침한 말을 함께 남깁니다.",
    firstDate: "9월 28일 · 처음",
    promiseQuote: "네, 정리해서 보내드릴게요.",
    firstState: "당신의 대기",
    firstMeaning: "제품 소개를 보내기로 약속했습니다. 마감 합의는 없습니다.",
    laterDate: "9월 30일 · 이후",
    laterState: "상대의 열람 대기",
    laterMeaning: "새 출처가 상태 변화를 제안합니다. 당신의 검토가 같은 항목을 업데이트합니다.",
    evidenceToggle: "두 변화의 근거 읽기",
    invitation: "다음 주에 제품을 볼 수 있어요. 먼저 소개를 보내주시겠어요?",
    firstSourceDate: "9월 28일 · 합성 대화",
    reviewBoundary: "여기 보이는 것은 검토 후의 합성 경로입니다. 새 답장은 변화를 제안하고, 업데이트할지는 당신의 검토가 결정합니다. 항목을 중복 생성하지 않습니다.",
    layersTitle: "사람·배경·일은 따로 자랍니다.",
    layersIntro: "한 번의 왕래가 서로 다른 유용한 것을 남길 수 있습니다. 대화를 완전한 프로필로 만들 필요는 없습니다.",
    layers: [
      ["사람", "확인된 단서", "Chen Xia. 같은 이름이어도 같은 사람인지 확인이 먼저입니다."],
      ["배경", "출처와 시각 포함", "그 시점에 제품을 보고 싶다는 제안. 일시적 계획은 일시적 그대로."],
      ["일", "약속과 대기 조건", "같은 제품 소개가 당신의 대기에서 상대의 열람 대기로."],
    ],
    quietTitle: "기다리기, 잠시 멈추기.",
    quietText: "새 진전이 없다면 다음 단계를 만들 필요가 없습니다. 멈춤은 알림에만 영향을 주며 상대의 태도를 추측하지 않습니다. 초안 준비도 메시지 발송이 아닙니다.",
    removalToggle: "출처를 제거하면 이 배경은 어떻게 되나요?",
    removalText: "지지를 잃은 현재의 배경과 제안은 무효가 되어야 합니다. 과거의 검토가 원문을 대신하거나 삭제된 내용을 복원할 수 없습니다.",
    closingTitle: "먼저 체험하고, 자신의 대화를 담아 보세요.",
    closingText: "이 페이지는 합성 읽기 예시입니다. 기록을 저장하지 않고 메시지를 보내지 않습니다. 전체 스크린샷 이어가기는 제품의 방향입니다. 사용 전에 제공 기능과 데이터 범위를 확인하세요.",
    availability: "다운로드 및 제공 상태",
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
          <h1 id="product-story-title">{copy.title.map((line, index) => <span key={line}>{line}{!locale.startsWith("zh") && index < copy.title.length - 1 ? " " : ""}</span>)}</h1>
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
