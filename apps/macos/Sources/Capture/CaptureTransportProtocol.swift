import Foundation

struct CaptureAdmission: Decodable, Sendable {
    let sessionId: UUID
    let messageId: UUID
    let queueEntryId: UUID
    let status: String
}

struct CaptureReceipt: Decodable, Sendable {
    let sessionId: UUID
    let messageId: UUID
    let queueEntryId: UUID
    let status: String
    let imageManifest: [CaptureImageManifest]
    let resultRecorded: Bool
}

enum CaptureTransportError: Error, Equatable {
    case staleOrigin
    case untrustedHost
    case malformedResponse
    case server(Int, String)
    case unavailable
}


/// Later-started authenticated reads may finish first. Once a newer owner,
/// login or processor policy is observed, an older response cannot restore
/// authority merely because it arrives last.
@MainActor
final class CaptureContextReadFence {
    private struct Identity: Equatable {
        let origin: String
        let ownerScope: String
        let loginBinding: String
        let policyVersion: String
        init(_ context: CaptureContext) {
            origin = context.origin
            ownerScope = context.ownerScope
            loginBinding = context.loginBinding
            policyVersion = context.processing.policyVersion
        }
    }
    private enum Latest { case context(Identity), signedOut }
    private var nextSequence = 0
    private var appliedSequence = 0
    private var latest: Latest?

    func begin() -> Int { nextSequence += 1; return nextSequence }

    func accept(_ context: CaptureContext, sequence: Int) throws {
        if sequence < appliedSequence {
            guard case .some(.context(let current)) = latest, current == Identity(context) else {
                throw CaptureTransportError.staleOrigin
            }
            return
        }
        appliedSequence = sequence
        latest = .context(Identity(context))
    }

    @discardableResult
    func signedOut(sequence: Int) -> Bool {
        guard sequence >= appliedSequence else { return false }
        appliedSequence = sequence
        latest = .signedOut
        return true
    }
}

@MainActor
protocol CaptureTransporting {
    var automaticallyPollsStatus: Bool { get }
    func isOriginCurrent(_ origin: String) -> Bool
    func context() async throws -> CaptureContext
    func admit(_ intent: CaptureIntent, context: CaptureContext) async throws -> CaptureAdmission
    func receipt(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureReceipt?
    func result(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureResult?
}

extension CaptureTransporting {
    var automaticallyPollsStatus: Bool { false }
    func isOriginCurrent(_ origin: String) -> Bool { false }
    // Legacy transport adapters have no clue producer; nil is an honest
    // no-clue result, never a source of synthetic person/company labels.
    func result(for intent: CaptureIntent, context: CaptureContext) async throws -> CaptureResult? { nil }
}
