import Foundation

/// A local fictional teaching example. It has no service, account or persistence.
struct FirstRunSample {
    enum Kind: String, CaseIterable, Identifiable {
        case dependency, agreement, suggestion
        var id: String { rawValue }
    }
    struct Item: Identifiable {
        let id: Kind
        let title: String
        let detail: String
        let quote: String
        let corrected: Bool
    }
    static let source = "方案我看过了，预算还要和合伙人确认。周四我们再聊。"
    private(set) var revealed = false
    private(set) var selected: Kind?
    private(set) var editing: Kind?
    var correctionDraft = ""
    private(set) var correctionError: String?
    private var corrections: [Kind: String] = [:]

    var selectedQuote: String? { items.first { $0.id == selected }?.quote }
    var items: [Item] {
        guard revealed else { return [] }
        return [
            item(.dependency, title: "当前阻碍", detail: "预算尚待确认。", quote: "预算还要和合伙人确认"),
            item(.agreement, title: "约定", detail: "周四再沟通，具体日期仍需确认。", quote: "周四我们再聊"),
            item(.suggestion, title: "建议", detail: "准备一次跟进，等待你决定。", quote: "周四我们再聊"),
        ]
    }
    private func item(_ kind: Kind, title: String, detail: String, quote: String) -> Item {
        Item(id: kind, title: title, detail: corrections[kind] ?? detail,
             quote: quote, corrected: corrections[kind] != nil)
    }
    mutating func reveal() { revealed = true }
    mutating func inspect(_ kind: Kind) {
        guard revealed else { return }
        selected = kind
        cancelCorrection()
    }
    mutating func beginCorrection(_ kind: Kind) {
        guard let item = items.first(where: { $0.id == kind }) else { return }
        selected = kind
        editing = kind
        correctionDraft = item.detail
        correctionError = nil
    }
    mutating func applyCorrection() -> Bool {
        guard let editing else { return false }
        let text = correctionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 500, text.utf8.count <= 4_096 else {
            correctionError = "写下一条不超过 500 字的示例解释。"
            return false
        }
        corrections[editing] = text
        cancelCorrection()
        return true
    }
    mutating func cancelCorrection() {
        editing = nil
        correctionDraft = ""
        correctionError = nil
    }
    mutating func reset() { self = FirstRunSample() }
}
