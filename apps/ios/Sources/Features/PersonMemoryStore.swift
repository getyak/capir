import Foundation
import SwiftUI

protocol PersonMemoryServing {
    func recallPersonMemory(personID: String, contextID: String?, cursor: String?) async throws -> PersonMemoryPage
    func isCurrentScope() async -> Bool
}

@MainActor
final class PersonMemoryStore: ObservableObject {
    enum Phase: Equatable { case idle, loading, loaded, unavailable }
    @Published private(set) var items: [PersonMemoryItem] = []
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var nextCursor: String?
    @Published private(set) var loadingMore = false
    @Published private(set) var paginationFailed = false
    private var generation = 0
    private var personID: String?
    private var contextID: String?
    private var service: (any PersonMemoryServing)?

    func load(personID: String, contextID: String?,
              service: any PersonMemoryServing, requiring itemID: String? = nil) async {
        generation += 1
        let epoch = generation
        self.personID = personID; self.contextID = contextID; self.service = service
        // Revoked or changed scope is never presented as a current snapshot.
        items = []; nextCursor = nil; phase = .loading
        loadingMore = false; paginationFailed = false
        do {
            var collected: [PersonMemoryItem] = []
            var cursor: String?
            var seen = Set<String>()
            repeat {
                try Task.checkCancellation()
                let page = try await service.recallPersonMemory(personID: personID, contextID: contextID, cursor: cursor)
                try page.validate(personID: personID, contextID: contextID)
                collected.append(contentsOf: page.items)
                guard Set(collected.map(\.id)).count == collected.count else {
                    throw ConversationMemoryReviewError.invalidScope
                }
                cursor = page.has_more == true ? page.next_cursor : nil
                if let cursor, !seen.insert(cursor).inserted { throw ConversationMemoryReviewError.invalidScope }
                if itemID == nil || collected.contains(where: { $0.id == itemID }) { break }
                // Bounded revalidation of an item reached through pagination.
                if seen.count >= 20, cursor != nil { throw ConversationMemoryReviewError.invalidScope }
            } while cursor != nil
            let current = await service.isCurrentScope()
            guard epoch == generation else { return }
            try Task.checkCancellation()
            guard current else { throw ConversationMemoryReviewError.invalidScope }
            items = collected; nextCursor = cursor; phase = .loaded
        } catch {
            guard epoch == generation else { return }
            items = []; nextCursor = nil; phase = .unavailable
        }
    }

    func reload(requiring itemID: String? = nil) async {
        guard let personID, let service else { return }
        await load(personID: personID, contextID: contextID, service: service, requiring: itemID)
    }

    func loadMore() async {
        guard phase == .loaded, !loadingMore, let cursor = nextCursor,
              let personID, let service else { return }
        let epoch = generation
        loadingMore = true; paginationFailed = false
        defer { if generation == epoch { loadingMore = false } }
        do {
            let page = try await service.recallPersonMemory(personID: personID, contextID: contextID, cursor: cursor)
            try page.validate(personID: personID, contextID: contextID)
            let current = await service.isCurrentScope()
            guard epoch == generation else { return }
            try Task.checkCancellation()
            guard current, page.next_cursor != cursor,
                  Set((items + page.items).map(\.id)).count == items.count + page.items.count
            else { throw ConversationMemoryReviewError.invalidScope }
            items += page.items
            nextCursor = page.has_more == true ? page.next_cursor : nil
        } catch {
            guard epoch == generation else { return }
            // An unsuccessful authority read cannot leave old excerpts visible.
            items = []; nextCursor = nil; phase = .unavailable
            paginationFailed = true
        }
    }

    func clear() {
        generation += 1
        items = []; nextCursor = nil; phase = .idle; service = nil
        personID = nil; contextID = nil; loadingMore = false; paginationFailed = false
    }

    func markUnavailable() {
        clear()
        phase = .unavailable
    }

    func beginLoading() {
        clear()
        phase = .loading
    }
}
