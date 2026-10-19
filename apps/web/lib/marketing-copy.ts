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
const zhTW: Copy = {
  nav: ["產品", "使用方法", "信任", "定價", "研究"],
  demo: "體驗截圖接續",
  access: "申請使用",
  email: "透過郵件申請",
  login: "登入",
  theme: "切換明暗主題",
  openMenu: "開啟導覽",
  closeMenu: "關閉導覽",
  navigation: "主導覽",
  footer: "讓每一段關係，都有可以接續的背景。",
  explore: "探索",
  privacy: "隱私政策",
  original: "中文原文",
  audience: "個人 Agent · 重要的人和未完的事",
  headline: ["每次跟進，", "都接得上上次對話。"],
  promise: "保留聯絡人的背景，發現對話裡的變化，準備恰當的下一步。",
  methodTitle: "從一句話，到下一次好好交談。",
  methodIntro: "聯絡人、對話和行事曆，圍繞同一段關係展開。",
  steps: [
    {
      title: "留住背景",
      detail: "把你選擇的對話放回聯絡人身邊。",
      example: "林澄 · 產品負責人尋訪",
      caption: "一段關係，持續累積的背景",
    },
    {
      title: "看清變化",
      detail: "從當前的問題，回到那句支持它的原話。",
      example: "遠端安排仍未確認",
      caption: "來源可查，變化待你審閱",
    },
    {
      title: "接續下一步",
      detail: "先澄清，再決定是否聯絡或安排行事曆。",
      example: "先確認政策與具體日期",
      caption: "待審閱建議，不會自動傳送",
    },
  ],
  methodLink: "了解使用方法",
  trustTitle: "放心記住，也能放手刪除。",
  trustIntro: "原話有出處，判斷有餘地。重要決定始終由你作出。",
  trustLink: "了解信任與隱私",
  closingTitle: "把下一次跟進，接在這裡。",
  closingDetail: "先用合成案例體驗。希望用於自己的工作？透過郵件申請早期使用。",
  prototype: "可互動原型 · 全部為合成案例",
  pricingLink: "查看使用與定價",
  faqs: [
    {
      question: "它能幫我留下什麼？",
      answer:
        "先理解你分享的對話，再由你選擇留下認識背景或未完事項。產品方向是讓新回覆更新同一件事、下一次交流找回相關背景；實際開放範圍在申請時明確。",
    },
    {
      question: "會自動傳送訊息或安排行事曆嗎？",
      answer:
        "不會。確認一項事實，不等於授權一次行動。傳送對象、內容與時間需要另外審閱；本頁演示不連接外部服務。",
    },
    {
      question: "移除來源之後會怎樣？",
      answer:
        "依賴它的當前結論與建議會失去證據支持。歷史決定仍保留其來源狀態，不能繼續冒充已獲支持的結論。你可以在上方合成案例中親手體驗。",
    },
    {
      question: "現在可以開始使用嗎？需要付費嗎？",
      answer:
        "公開演示無需登入，也不收費。實際工作空間透過郵件申請；付費方案尚未公佈。這裡不會收取費用或啟動訂閱。",
    },
  ],
  brief: {
    title: "關係簡報",
    synthetic: "合成案例",
    name: "林澄",
    role: "候選人 · 產品負責人尋訪",
    initial: "澄",
    question: "當前問題",
    blocker: "遠端安排，還沒落定。",
    missing: "來源已移除，當前判斷失去支持。",
    proposed: "待審閱",
    reviewed: "你已確認",
    withdrawn: "證據不可用",
    quoteLabel: "支持原話",
    quote: zh.brief.quote,
    attribution: "候選人 · 5 月 19 日 10:18",
    uncertain: "來源未給出年份與時區；“週三”仍需澄清。",
    source: "查看聊天截圖",
    sourceClose: "收起聊天截圖",
    sourceAlt:
      "合成聊天截圖，綠色氣泡在 10:18 提到週三前決定及新加坡遠端安排尚未確認",
    sourceNote: "林澄為演示關聯的合成人物；截圖頂部顯示對話另一方。",
    next: "待審閱的下一步",
    nextDetail: "先核實遠端政策，再問清具體決策日期。",
    noAction: "不再保留這條建議。先補充有授權的來源。",
    review: "審閱變化",
    confirm: "確認這項事實",
    cancel: "暫不確認",
    undo: "撤銷確認",
    remove: "移除證據",
    restore: "重新開始演示",
    reviewTitle: "確認“候選人說遠端安排尚未確認”？",
    reviewDetail:
      "只確認這句話表達的狀態。不會確認政策、補全日期、傳送訊息或安排行事曆。",
    confirmedNote: "已確認候選人的表述。未傳送訊息，也未安排行事曆。",
    removedNote: "已移除演示來源，依賴它的判斷與建議同時失效。",
    resetNote: "新一輪演示已開始，事實需要重新審閱。",
    history: "此前的確認保留為演示歷史，當前證據已不可用。",
    local: "僅此頁面的合成演示，不儲存真實聯絡人。",
    originalQuote: "原話保持中文",
    translation: "英文釋義",
    retraction: "試試移除證據，看看下一步如何變化。",
  },
};

const ja: Copy = {
  nav: ["プロダクト", "使い方", "トラスト", "料金", "リサーチ"],
  demo: "スクリーンショットの続きを体験",
  access: "利用申請",
  email: "メールで申請",
  login: "ログイン",
  theme: "ライト・ダークの切り替え",
  openMenu: "ナビゲーションを開く",
  closeMenu: "ナビゲーションを閉じる",
  navigation: "メインナビゲーション",
  footer: "すべての関係に、続きから話せる背景を。",
  explore: "探す",
  privacy: "プライバシーポリシー",
  original: "中国語の原文",
  audience: "パーソナル Agent · 大切な人となお終わっていないこと",
  headline: ["すべてのフォローアップが、", "前回の会話から続きます。"],
  promise:
    "相手の背景を残し、会話の変化に気づき、それぞれの関係にふさわしい次の一歩を準備します。",
  methodTitle: "ひとつのメッセージから、次のにぎやかな会話へ。",
  methodIntro: "人・会話・予定が、ひとつの関係をめぐってつながります。",
  steps: [
    {
      title: "背景を残す",
      detail: "選んだ会話を、その人のそばに戻します。",
      example: "Lin Cheng · プロダクトリーダーのサーチ",
      caption: "ひとつの関係に、積み重なる背景",
    },
    {
      title: "変化を見抜く",
      detail: "今の問いから、それを支えた一言に戻ります。",
      example: "リモート勤務の扱いはまだ未確定",
      caption: "出典は確認可能、変化はあなたが審査",
    },
    {
      title: "次の一歩を続ける",
      detail: "まず曖昧さを解消し、連絡や日程の決定はその後に。",
      example: "方針と具体的な日付を先に確認",
      caption: "審査待ちの提案、自動送信はしません",
    },
  ],
  methodLink: "使い方を見る",
  trustTitle: "安心して記憶し、手放すこともできます。",
  trustIntro: "発言には出典を、判断には余白を。重要な決定は常にあなたが下します。",
  trustLink: "トラストとプライバシーを見る",
  closingTitle: "次のフォローアップを、ここから。",
  closingDetail:
    "まずは合成ケースでお試しください。自分の仕事で使いたい方は、メールで早期アクセスを申請できます。",
  prototype: "インタラクティブな試作 · すべて合成ケース",
  pricingLink: "利用と料金を見る",
  faqs: [
    {
      question: "何を残せますか？",
      answer:
        "共有した会話の出典つきの理解を確認したうえで、背景や未完のことを残すかを選べます。同じ項目を更新し、次に思い出すのはプロダクトの方向性です。実際の開放範囲は申請時に明確にお伝えします。",
    },
    {
      question: "メッセージの送信や会議の予定を自動で行いますか？",
      answer:
        "いいえ。事実の確認は行動の許可ではありません。送信先・内容・時間は別途審査が必要です。このデモは外部サービスに接続しません。",
    },
    {
      question: "出典を削除するとどうなりますか？",
      answer:
        "それに依存する現在の結論と提案は、証拠の支持を失います。過去の決定は出典の状態を保持し、支持された結論を装うことはできません。上の合成ケースでお試しいただけます。",
    },
    {
      question: "今から使えますか。料金はかかりますか？",
      answer:
        "公開デモはログイン不要・無料です。実際のワークスペースはメールで申請してください。有料プランは未発表です。このサイトが課金やサブスクリプションを始めることはありません。",
    },
  ],
  brief: {
    title: "関係ブリーフ",
    synthetic: "合成ケース",
    name: "Lin Cheng",
    role: "候補者 · プロダクトリーダーのサーチ",
    initial: "LC",
    question: "現在の問い",
    blocker: "リモート勤務の扱いがまだ決まっていません。",
    missing: "出典が削除され、現在の判断は支持を失いました。",
    proposed: "審査待ち",
    reviewed: "あなたが確認済み",
    withdrawn: "証拠は利用できません",
    quoteLabel: "支持する発言",
    quote: zh.brief.quote,
    attribution: "候補者 · 5月19日 10:18",
    uncertain: "出典に年とタイムゾーンはありません。「水曜日」は依然として要確認です。",
    source: "チャットのスクリーンショットを見る",
    sourceClose: "スクリーンショットを閉じる",
    sourceAlt:
      "合成チャットのスクリーンショット。10:18 の緑の吹き出しに、水曜日までに決めることとシンガポールのリモート勤務が未確定であることが記されています",
    sourceNote:
      "Lin Cheng はデモのために紐づけられた合成の人物です。スクリーンショット上部にもう一方の参加者が表示されます。",
    next: "審査待ちの次の一歩",
    nextDetail: "まずリモート勤務の方針を確認し、正確な決定日を尋ねます。",
    noAction: "この提案は残しません。まず許可された出典を追加してください。",
    review: "変化を審査",
    confirm: "この事実を確認",
    cancel: "今は確認しない",
    undo: "確認を取り消す",
    remove: "証拠を削除",
    restore: "デモをやり直す",
    reviewTitle: "「候補者がリモート勤務は未確定だと述べた」を確認しますか？",
    reviewDetail:
      "この一言が表す状態だけを確認します。方針の確認、日付の補完、メッセージの送信、会議の予定は行いません。",
    confirmedNote: "候補者の発言を確認しました。メッセージは送信せず、会議も予定していません。",
    removedNote: "デモの出典を削除しました。それに依存する判断と提案も同時に無効になりました。",
    resetNote: "新しいデモを開始しました。事実はもう一度審査が必要です。",
    history: "以前の確認はデモの履歴として残ります。現在の証拠は利用できません。",
    local: "このページ上の合成デモのみ。実在の連絡先は保存しません。",
    originalQuote: "原文は中国語のまま",
    translation: "英語の訳",
    retraction: "証拠を削除して、次の一歩がどう変わるか試してみてください。",
  },
};

const ko: Copy = {
  nav: ["제품", "사용 방법", "신뢰", "요금", "리서치"],
  demo: "스크린샷 이어가기 체험",
  access: "사용 신청",
  email: "이메일로 신청",
  login: "로그인",
  theme: "라이트/다크 전환",
  openMenu: "탐색 열기",
  closeMenu: "탐색 닫기",
  navigation: "주 탐색",
  footer: "모든 관계에, 이어서 말할 수 있는 배경을 남깁니다.",
  explore: "둘러보기",
  privacy: "개인정보 처리방침",
  original: "중국어 원문",
  audience: "퍼스널 Agent · 소중한 사람과 아직 끝나지 않은 일",
  headline: ["모든 후속 연락이,", "지난 대화에서 이어집니다."],
  promise:
    "상대의 배경을 남기고, 대화 속 변화를 알아차리고, 각 관계에 맞는 다음 단계를 준비합니다.",
  methodTitle: "한 메시지에서, 다음 좋은 대화로.",
  methodIntro: "사람·대화·일정이 하나의 관계를 중심으로 이어집니다.",
  steps: [
    {
      title: "배경을 남기기",
      detail: "선택한 대화를 그 사람 곁으로 되돌립니다.",
      example: "Lin Cheng · 프로덕트 리더 서치",
      caption: "하나의 관계에, 쌓여 가는 배경",
    },
    {
      title: "변화 알아차리기",
      detail: "현재의 질문에서, 그것을 뒷받침한 그 말로 돌아갑니다.",
      example: "원격 근무가 아직 미확정",
      caption: "출처 확인 가능, 변화는 직접 검토",
    },
    {
      title: "다음 단계 잇기",
      detail: "먼저 모호함을 해소하고, 연락이나 일정 결정은 그 다음에.",
      example: "방침과 구체적인 날짜를 먼저 확인",
      caption: "검토 대기 제안, 자동 발송하지 않음",
    },
  ],
  methodLink: "사용 방법 보기",
  trustTitle: "안심하고 기억하고, 손놓는 것도 가능합니다.",
  trustIntro: "말에는 출처를, 판단에는 여지를. 중요한 결정은 언제나 당신의 몫입니다.",
  trustLink: "신뢰와 프라이버시 보기",
  closingTitle: "다음 후속 연락을, 여기서 시작하세요.",
  closingDetail:
    "먼저 합성 사례로 체험해 보세요. 자신의 업무에 쓰고 싶다면 이메일로 조기 액세스를 신청할 수 있습니다.",
  prototype: "인터랙티브 프로토타입 · 모두 합성 사례",
  pricingLink: "이용 및 요금 보기",
  faqs: [
    {
      question: "무엇을 남길 수 있나요?",
      answer:
        "공유한 대화의 출처가 있는 이해를 확인한 뒤, 배경이나 끝나지 않은 일을 남길지 선택합니다. 같은 항목을 업데이트하고 다음에 다시 떠올리는 것은 제품의 방향이며, 실제 제공 범위는 신청 시 명확히 안내합니다.",
    },
    {
      question: "메시지 발송이나 회의 일정을 자동으로 처리하나요?",
      answer:
        "아니요. 사실을 확인하는 것은 행동을 허가하는 것이 아닙니다. 받는 사람·내용·시간은 별도의 검토가 필요합니다. 이 데모는 외부 서비스에 연결되지 않습니다.",
    },
    {
      question: "출처를 제거하면 어떻게 되나요?",
      answer:
        "그것에 의존하던 현재의 결론과 제안은 증거의 지지를 잃습니다. 과거의 결정은 출처 상태를 유지하며, 지지를 받는 결론을 가장할 수 없습니다. 위의 합성 사례에서 직접 확인해 보세요.",
    },
    {
      question: "지금 시작할 수 있나요. 비용이 있나요?",
      answer:
        "공개 데모는 로그인 없이 무료입니다. 실제 작업 공간은 이메일로 신청하세요. 유료 플랜은 아직 발표되지 않았습니다. 이 사이트는 결제나 구독을 시작하지 않습니다.",
    },
  ],
  brief: {
    title: "관계 브리프",
    synthetic: "합성 사례",
    name: "Lin Cheng",
    role: "후보자 · 프로덕트 리더 서치",
    initial: "LC",
    question: "현재 질문",
    blocker: "원격 근무가 아직 정해지지 않았습니다.",
    missing: "출처가 제거되어 현재 판단이 지지를 잃었습니다.",
    proposed: "검토 대기",
    reviewed: "확인 완료",
    withdrawn: "증거 사용 불가",
    quoteLabel: "뒷받침하는 말",
    quote: zh.brief.quote,
    attribution: "후보자 · 5월 19일 10:18",
    uncertain: "출처에 연도와 시간대가 없습니다. 「수요일」은 여전히 확인이 필요합니다.",
    source: "채팅 스크린샷 보기",
    sourceClose: "스크린샷 닫기",
    sourceAlt:
      "합성 채팅 스크린샷. 10:18의 초록 말풍선에 수요일 전에 결정해야 한다는 말과 싱가포ール 원격 근무가 미확정이라는 내용이 있습니다",
    sourceNote:
      "Lin Cheng는 데모를 위해 연결된 합성 인물입니다. 스크린샷 상단에 대화 상대가 표시됩니다.",
    next: "검토 대기인 다음 단계",
    nextDetail: "먼저 원격 근무 방침을 확인하고, 정확한 결정 날짜를 묻습니다.",
    noAction: "이 제안은 남기지 않습니다. 먼저 권한이 있는 출처를 추가하세요.",
    review: "변화 검토",
    confirm: "이 사실 확인",
    cancel: "지금은 확인 안 함",
    undo: "확인 취소",
    remove: "증거 제거",
    restore: "데모 다시 시작",
    reviewTitle: "「후보자가 원격 근무는 아직 미확정이라고 말했다」를 확인할까요?",
    reviewDetail:
      "이 말이 나타내는 상태만 확인합니다. 방침 확인, 날짜 보완, 메시지 발송, 회의 일정은 처리하지 않습니다.",
    confirmedNote: "후보자의 발언을 확인했습니다. 메시지를 보내지 않았고 회의도 예정하지 않았습니다.",
    removedNote: "데모 출처를 제거했습니다. 그에 의존하던 판단과 제안도 동시에 무효가 되었습니다.",
    resetNote: "새 데모가 시작되었습니다. 사실을 다시 검토해야 합니다.",
    history: "이전 확인은 데모 기록으로 남습니다. 현재 증거는 사용할 수 없습니다.",
    local: "이 페이지의 합성 데모일 뿐입니다. 실제 연락처는 저장하지 않습니다.",
    originalQuote: "원문은 중국어 유지",
    translation: "영어 번역",
    retraction: "증거를 제거해 보고 다음 단계가 어떻게 변하는지 확인해 보세요.",
  },
};

const DICTS: Record<MarketingLocale, Copy> = {
  en,
  "zh-CN": zh,
  "zh-TW": zhTW,
  ja,
  ko,
};

export function marketingCopy(locale: MarketingLocale): Copy {
  return DICTS[locale] ?? en;
}
export const marketingNavigation = [
  "/product",
  "/how-it-works",
  "/trust",
  "/pricing",
  "/blog",
] as const;
