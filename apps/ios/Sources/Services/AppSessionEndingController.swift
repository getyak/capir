import Foundation

@MainActor
final class AppSessionEndingController {
    private let endpoint: URL
    private let sessions: any TalentSignalSessionPersisting
    private let endings: any AppSessionEndingPersisting
    private let client: any AppAuthenticationServing
    init(endpoint: URL, sessions: any TalentSignalSessionPersisting,
         endings: any AppSessionEndingPersisting, client: any AppAuthenticationServing) {
        self.endpoint = endpoint; self.sessions = sessions; self.endings = endings; self.client = client
    }
    func prepare(_ session: TalentSignalSession) throws -> AppSessionEnding {
        guard RuntimeEndpoint.same(endpoint, session.baseURL) else { throw AppSessionError.scopeMismatch }
        var records = try endings.load()
        let fingerprint = AppSessionEnding.fingerprint(session)
        if let existing = records.first(where: { $0.credentialFingerprint == fingerprint }) { return existing }
        // Keep unresolved operations; only fully verified older receipts can leave
        // the bounded journal. Expiry alone never proves protected local removal.
        let completed = records.filter(\.settled).sorted { $0.startedAt > $1.startedAt }
        let retained = Set(completed.prefix(20).map(\.id))
        records.removeAll { $0.settled && !retained.contains($0.id) }
        guard records.count < 64 else { throw AppSessionEndingError.pendingLimit }
        let record = AppSessionEnding(session: session)
        records.append(record)
        try endings.save(records)
        return record
    }
    func run(_ id: UUID) async throws -> AppSessionEnding {
        var records = try endings.load()
        guard let index = records.firstIndex(where: { $0.id == id }),
              records[index].endpointScope == RuntimeEndpoint.scope(endpoint) else { throw AppSessionError.scopeMismatch }
        var record = records[index]
        if record.credential == nil && !record.remoteSettled,
           let saved = try sessions.load(), record.blocks(saved) {
            record.credential = saved
            records[index] = record; try endings.save(records)
        }
        // Removing an old operation's credential must not delete a newer sign-in.
        do {
            guard try sessions.removeEndingCredential(record) else { throw AppSessionEndingError.localReadback }
            record.local = .removed; record.failure = nil
        } catch { record.local = .failed; record.failure = .storage }
        records[index] = record; try endings.save(records)
        if !record.remoteSettled {
            if record.renewable != true && record.expiresAt <= Date() {
                record.remote = .expired
            } else if let credential = record.credential {
                do { try await client.logout(credential); record.remote = .revoked }
                catch let error as AppSessionError {
                    // An absent pending capability cannot prove that an older
                    // enrollment transaction will never commit. Keep its
                    // original bearer for the atomic destructive revoke proof.
                    let pendingEnrollment = record.credential?.persistent?.enrolled == false
                    if (!pendingEnrollment && error.invalidatesSession) || {
                        if case let .backend(status, code, _) = error { return status == 401 && code == "SESSION_INVALID" && record.renewable != true }
                        return false
                    }() {
                        record.remote = .alreadyInvalid
                    } else {
                        record.remote = .unverified
                        record.failure = .server
                    }
                } catch {
                    record.remote = .unverified
                    record.failure = (error is CancellationError || (error as? URLError)?.code == .cancelled) ? .cancelled : .network
                }
            } else { record.remote = .unverified; record.failure = .storage }
        }
        if record.remoteSettled { record.credential = nil }
        records[index] = record
        try endings.save(records)
        return record
    }
}

enum AppSessionEndingError: LocalizedError {
    case pendingLimit, localReadback, unreadable
    var errorDescription: String? {
        switch self {
        case .unreadable: return "Sign-out recovery records could not be read. Existing protected records were preserved."
        case .pendingLimit: return "Earlier sign-out operations need attention before another protected receipt can be saved."
        case .localReadback: return "Protected local session removal could not be verified."
        }
    }
}
