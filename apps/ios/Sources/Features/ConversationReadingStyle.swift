import SwiftUI

/// Compact conversation type follows the user's text size without shrinking
/// accessibility reading or the controls around it.
struct ConversationReadingStyle: ViewModifier {
    var monospaced = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var pointSize: CGFloat = 14

    func body(content: Content) -> some View {
        content.font(dynamicTypeSize.isAccessibilitySize
            ? .system(.body, design: monospaced ? .monospaced : .default)
            : .system(size: pointSize, design: monospaced ? .monospaced : .default))
    }
}
