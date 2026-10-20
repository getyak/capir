import type { MarketingLocale } from "./marketing-locale";

/**
 * The visible FAQ and its structured data share exactly one localized source.
 * This module is a locale-keyed copy module (docs/internationalization.md).
 */
const FAQS: Record<
  MarketingLocale,
  readonly (readonly [question: string, answer: string])[]
> = {
  "zh-CN": [
    ["这会连接或读取我的微信吗？", "不会。首页是使用微信风格合成素材的本页交互演示，不连接微信、不读取聊天、不保存真实资料，也不发送消息。"],
    ["现在可以用到什么？", "公开合成演示无需登录。macOS 下载有独立发布页，iOS 为受邀预览。真实工作空间通过邮件申请，使用前核对开放能力与资料范围；这里展示的完整截图接续是产品方向，不代表所有客户端已经开放。"],
    ["每张截图都会成为永久记忆吗？", "先看理解，再选择什么值得留下。人物、带时间的背景和未完事项分别生长；身份不确定时先确认，再读取私有背景。没有下一步也可以只保留认识背景。"],
    ["移除来源后，还能继续引用吗？", "依赖来源的当前答案会失去支持，在本页演示中不再显示。重播只重播动效，不恢复来源；明确开始新的合成演示才重新加载样例。"],
  ],
  "zh-TW": [
    ["這會連接或讀取我的微信嗎？", "不會。首頁是使用微信風格合成素材的本頁互動演示，不連接微信、不讀取聊天、不儲存真實資料，也不傳送訊息。"],
    ["現在可以用到什麼？", "公開合成演示無需登入。macOS 下載有獨立發布頁，iOS 為受邀預覽。真實工作空間透過郵件申請，使用前核對開放能力與資料範圍；這裡展示的完整截圖接續是產品方向，不代表所有用戶端已經開放。"],
    ["每張截圖都會成為永久記憶嗎？", "先看理解，再選擇什麼值得留下。人物、帶時間的背景和未完事項分別生長；身份不確定時先確認，再讀取私有背景。沒有下一步也可以只保留認識背景。"],
    ["移除來源後，還能繼續引用嗎？", "依賴來源的當前答案會失去支持，在本頁演示中不再顯示。重播只重播動效，不恢復來源；明確開始新的合成演示才重新載入樣例。"],
  ],
  ja: [
    ["これは WeChat に接続したり読み取りますか？", "いいえ。ホームページは WeChat 風の合成素材を使ったページ内インタラクションです。WeChat に接続せず、チャットを読み取らず、実データを保存せず、メッセージも送信しません。"],
    ["今は何が使えますか？", "公開の合成デモはログインなしでお試しいただけます。macOS のダウンロードには専用のリリースページがあり、iOS は招待制プレビューです。実際のワークスペースはメールで申請し、利用前に提供機能とデータ範囲をご確認ください。ここに見せる完全なスクリーンショット継続はプロダクトの方向性であり、すべてのクライアントが公開済みという意味ではありません。"],
    ["すべてのスクリーンショットが永続的な記憶になりますか？", "何を残すかを選ぶ前に、まず理解を確認します。人物・日付つきの背景・未完のことは別々に育ちます。身元が不確かな場合は確認してから非公開背景を読みます。次のステップがなくても背景だけを残せます。"],
    ["出典を削除したら、まだ引用できますか？", "出典に依存する現在の回答は支持を失い、このページのデモでは表示されなくなります。リプレイはモーションの再生のみで、出典を復元しません。明示的に新しい合成デモを始めるとサンプルが再読み込みされます。"],
  ],
  ko: [
    ["이것이 WeChat에 연결되거나 읽나요?", "아니요. 홈페이지는 WeChat 스타일 합성 자료를 사용하는 페이지 내 인터랙티브 데모입니다. WeChat에 연결하지 않고 채팅을 읽지 않으며 실제 자료를 저장하지 않고 메시지도 보내지 않습니다."],
    ["지금 무엇을 쓸 수 있나요?", "공개 합성 데모는 로그인 없이 체험할 수 있습니다. macOS 다운로드에는 전용 릴리스 페이지가 있고 iOS는 초대 미리보기입니다. 실제 작업 공간은 이메일로 신청하고 사용 전에 제공 기능과 데이터 범위를 확인하세요. 여기 보여주는 전체 스크린샷 이어가기는 제품의 방향이며, 모든 클라이언트가 공개되었다는 뜻이 아닙니다."],
    ["모든 스크린샷이 영구적인 기억이 되나요?", "무엇을 남길지 선택하기 전에 먼저 이해를 확인합니다. 사람·날짜가 있는 배경·끝나지 않은 일은 따로 자랍니다. 신원이 불확실하면 확인한 뒤 비공개 배경을 읽습니다. 다음 단계가 없어도 배경만 남길 수 있습니다."],
    ["출처를 제거하면 계속 인용할 수 있나요?", "출처에 의존하던 현재 답변은 지지를 잃고 이 페이지 데모에서 더 이상 표시되지 않습니다. 재생은 모션만 반복하며 출처를 복원하지 않습니다. 명시적으로 새 합성 데모를 시작해야 샘플이 다시 로드됩니다."],
  ],
  en: [
    ["Is this connected to WeChat?", "No. The homepage is a page-local synthetic interaction using a WeChat-style transcript. It does not connect to WeChat, read your chats, save real records, or send messages."],
    ["What can I use now?", "Explore the public synthetic demonstration without signing in. macOS downloads have a dedicated release page; iOS is an invited preview. Request a real workspace by email and confirm its available features and data scope. The full screenshot continuity loop shown here is the product direction, not a universal release claim."],
    ["Does every screenshot become a permanent memory?", "See what was understood before choosing what to retain. People, dated context, and unfinished things are distinct. An uncertain identity must be resolved before private context is read; no next step is required."],
    ["What happens when I remove a source?", "Its dependent answers lose support and disappear from the current demo. Replay only repeats motion; it cannot restore sources. Starting a clearly named new synthetic demo explicitly reloads the sample."],
  ],
};

export function personalAgentHomeFaqs(
  locale: MarketingLocale,
): readonly (readonly [string, string])[] {
  return FAQS[locale];
}
