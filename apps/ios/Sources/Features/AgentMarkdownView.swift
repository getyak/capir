import Foundation
import Markdown
import SwiftUI
import UIKit

/// GFM supplies structure only. Rendering cannot load images or grant source authority.
enum AgentMarkdownBlock: Equatable {
    case paragraph(AttributedString)
    case heading(Int, AttributedString)
    case listItem(String, [AgentMarkdownBlock])
    case quote([AgentMarkdownBlock])
    case code(language: String?, text: String)
    case table(headers: [AttributedString], rows: [[AttributedString]])
    case rule
}

enum AgentMarkdownParser {
    static func parse(_ source: String) -> [AgentMarkdownBlock] {
        blocks(in: Document(parsing: source))
    }

    static func safeLink(_ destination: String?) -> URL? {
        guard let destination, let url = URL(string: destination),
              let scheme = url.scheme?.lowercased(),
              ["https", "http"].contains(scheme),
              url.host?.isEmpty == false,
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    private static func blocks(in parent: any Markup) -> [AgentMarkdownBlock] {
        parent.children.flatMap { node -> [AgentMarkdownBlock] in
            switch node {
            case let heading as Heading:
                return [.heading(heading.level, inline(heading))]
            case let paragraph as Paragraph:
                return [.paragraph(inline(paragraph))]
            case let code as CodeBlock:
                return [.code(language: code.language, text: code.code)]
            case let quote as BlockQuote:
                return [.quote(blocks(in: quote))]
            case let list as OrderedList:
                return list.listItems.enumerated().map { offset, item in
                    .listItem(marker(for: item, fallback: "\(Int(list.startIndex) + offset)."), blocks(in: item))
                }
            case let list as UnorderedList:
                return list.listItems.map { item in
                    .listItem(marker(for: item, fallback: "•"), blocks(in: item))
                }
            case let table as Markdown.Table:
                return [.table(
                    headers: table.head.cells.map { inline($0) },
                    rows: table.body.rows.map { $0.cells.map { inline($0) } }
                )]
            case is ThematicBreak:
                return [.rule]
            case let html as HTMLBlock:
                return [.paragraph(AttributedString(html.rawHTML))]
            default:
                return node.childCount > 0 ? blocks(in: node) : []
            }
        }
    }

    private static func marker(for item: ListItem, fallback: String) -> String {
        switch item.checkbox {
        case .checked: return "☑"
        case .unchecked: return "☐"
        case nil: return fallback
        }
    }

    private static func inline(_ node: any Markup) -> AttributedString {
        if let text = node as? Markdown.Text { return AttributedString(text.string) }
        if node is SoftBreak { return AttributedString(" ") }
        if node is LineBreak { return AttributedString("\n") }
        if let code = node as? InlineCode {
            var result = AttributedString(code.code)
            result.font = .system(.subheadline, design: .monospaced)
            result.backgroundColor = Color.tsLine.opacity(0.4)
            return result
        }
        if let html = node as? InlineHTML { return AttributedString(html.rawHTML) }

        var result = node.children.reduce(into: AttributedString()) { $0 += inline($1) }
        if node is Strong || node is Emphasis || node is Strikethrough {
            // Preserve nested emphasis and code/link attributes on each run.
            for run in Array(result.runs) {
                var intent = run.inlinePresentationIntent ?? []
                if node is Strong { intent.insert(.stronglyEmphasized) }
                if node is Emphasis { intent.insert(.emphasized) }
                if node is Strikethrough { intent.insert(.strikethrough) }
                result[run.range].inlinePresentationIntent = intent
            }
        }
        if let link = node as? Markdown.Link,
           let url = safeLink(link.destination) {
            result.link = url
        }
        // Image nodes display alt text only; URLs never trigger automatic requests.
        if node is Markdown.Image, result.characters.isEmpty {
            result = AttributedString("▧")
        }
        return result
    }
}

struct AgentMarkdownView: View {
    private let blocks: [AgentMarkdownBlock]

    init(markdown: String) {
        blocks = AgentMarkdownParser.parse(markdown)
    }

    var body: some View {
        AgentMarkdownBlocks(blocks: blocks)
            .modifier(ConversationReadingStyle())
            .foregroundStyle(Color.tsInk)
            .tint(Color.tsVermilion)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("agent-markdown")
    }
}

private struct AgentMarkdownBlocks: View {
    let blocks: [AgentMarkdownBlock]
    @Environment(\.appLanguage) private var language

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    private func blockView(_ block: AgentMarkdownBlock) -> AnyView {
        switch block {
        case let .paragraph(text):
            return AnyView(Text(text).fixedSize(horizontal: false, vertical: true))
        case let .heading(_, text):
            return AnyView(Text(text)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
                .accessibilityAddTraits(.isHeader))
        case let .listItem(marker, children):
            return AnyView(HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(marker)
                    .foregroundStyle(Color.tsMutedInk)
                    .accessibilityLabel(markerLabel(marker))
                AgentMarkdownBlocks(blocks: children)
                    .frame(maxWidth: .infinity, alignment: .leading)
            })
        case let .quote(children):
            return AnyView(AgentMarkdownBlocks(blocks: children)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Color.tsLine).frame(width: 3)
                })
        case let .code(codeLanguage, text):
            return AnyView(AgentMarkdownCode(languageName: codeLanguage, code: text))
        case let .table(headers, rows):
            return AnyView(AgentMarkdownTable(headers: headers, rows: rows))
        case .rule:
            return AnyView(Divider().overlay(Color.tsLine))
        }
    }

    private func markerLabel(_ marker: String) -> String {
        switch marker {
        case "☑": return language.text("Checked")
        case "☐": return language.text("Unchecked")
        default: return marker
        }
    }
}

private struct AgentMarkdownCode: View {
    let languageName: String?
    let code: String
    @Environment(\.appLanguage) private var language
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(languageName?.isEmpty == false ? languageName! : language.text("Code"))
                    .font(.caption.monospaced())
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    UIPasteboard.general.setItems(
                        [["public.utf8-plain-text": code]],
                        options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)]
                    )
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copied
                    ? language.text("Copied")
                    : language.text("Copy code"))
                .onChange(of: code) { _ in copied = false }
            }
            .foregroundStyle(Color.tsMutedInk)
            ScrollView(.horizontal) {
                Text(verbatim: code)
                    .modifier(ConversationReadingStyle(monospaced: true))
                    .fixedSize(horizontal: true, vertical: true)
                    .textSelection(.enabled)
                    .padding(.bottom, 12)
            }
        }
        .padding(.horizontal, 12)
        .background(Color.tsLine.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent-markdown-code")
    }
}

private struct AgentMarkdownTable: View {
    let headers: [AttributedString]
    let rows: [[AttributedString]]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 14) {
                    if rows.isEmpty {
                        ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                            Text(header).fontWeight(.semibold)
                        }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(Array(row.enumerated()), id: \.offset) { index, value in
                                VStack(alignment: .leading, spacing: 2) {
                                    if index < headers.count {
                                        Text(headers[index]).fontWeight(.semibold)
                                    }
                                    Text(value)
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                        Divider()
                    }
                }
            } else {
                ScrollView(.horizontal) {
                    Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                        GridRow {
                            ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                                cell(header).fontWeight(.semibold)
                                    .background(Color.tsLine.opacity(0.3))
                            }
                        }
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            GridRow {
                                ForEach(Array(row.enumerated()), id: \.offset) { index, value in
                                    cell(value)
                                        .accessibilityLabel(index < headers.count
                                            ? Text(headers[index] + AttributedString(": ") + value)
                                            : Text(value))
                                }
                            }
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent-markdown-table")
    }

    private func cell(_ text: AttributedString) -> some View {
        Text(text)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 100, maxWidth: 220, alignment: .topLeading)
            .padding(8)
            .overlay(alignment: .bottom) { Divider() }
    }
}
