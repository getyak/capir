import Foundation
import CryptoKit

struct AppSessionEnding: Codable, Identifiable {
    enum Local: String, Codable { case pending, removed, failed }
    enum Remote: String, Codable { case pending, revoked, alreadyInvalid, unverified, expired }
    enum Failure: String, Codable { case storage, network, server, invalidResponse, cancelled }
    let id: UUID
    let endpointScope: String
    let credentialFingerprint: String
    let identityFingerprint: String
    let startedAt: Date
    let expiresAt: Date
    var local: Local = .pending
    var remote: Remote = .pending
    var failure: Failure?
    // Accessible only through the endpoint's protected ending journal. This
    // credential never participates in normal session restore or report export.
    var credential: TalentSignalSession?
    var blockedCredentialFingerprints: [String]? = nil
    var renewable: Bool? = nil
    var remoteSettled: Bool { [.revoked, .alreadyInvalid, .expired].contains(remote) }
    var settled: Bool { local == .removed && remoteSettled }
    static func fingerprint(_ session: TalentSignalSession) -> String {
        if let capability = session.persistent {
            return SHA256.hex(RuntimeEndpoint.scope(session.baseURL) + "|persistent|" + capability.sessionID)
        }
        return SHA256.hex(RuntimeEndpoint.scope(session.baseURL) + "|" + session.accessToken)
    }
    func blocks(_ session: TalentSignalSession) -> Bool {
        guard endpointScope == RuntimeEndpoint.scope(session.baseURL),
              identityFingerprint == SHA256.hex(session.account.id + "|" + session.user.id) else { return false }
        let targets = Set([credentialFingerprint] + (blockedCredentialFingerprints ?? []))
        return targets.contains(Self.fingerprint(session))
            || targets.contains(IOSPersistentSessionCredential.tokenFingerprint(session.accessToken, endpoint: session.baseURL))
            || (session.persistent?.accessFingerprints ?? []).contains(where: { targets.contains($0) })
    }
    init(id: UUID = UUID(), session: TalentSignalSession, now: Date = Date()) {
        self.id = id; endpointScope = RuntimeEndpoint.scope(session.baseURL)
        credentialFingerprint = Self.fingerprint(session); startedAt = now; expiresAt = session.expiresAt
        identityFingerprint = SHA256.hex(session.account.id + "|" + session.user.id)
        credential = session
        blockedCredentialFingerprints = session.logoutFingerprints
        renewable = session.persistent != nil
    }
}

struct AppSessionEndingArchive: Codable {
    let version: Int
    var records: [AppSessionEnding]
}


struct AppSessionEndingReceipt: Identifiable {
    let id: UUID
    let startedAt: Date
    let expiresAt: Date
    let local: AppSessionEnding.Local
    let remote: AppSessionEnding.Remote
    let failure: AppSessionEnding.Failure?
    let renewable: Bool
    var settled: Bool { local == .removed && [.revoked, .alreadyInvalid, .expired].contains(remote) }
    init(_ record: AppSessionEnding) {
        id = record.id; startedAt = record.startedAt; expiresAt = record.expiresAt
        local = record.local; remote = record.remote; failure = record.failure
        renewable = record.renewable == true
    }
}
