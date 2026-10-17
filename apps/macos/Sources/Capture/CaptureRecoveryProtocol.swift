import Foundation

enum CaptureRecoveryError: Error {
    case invalidImage, encryptionFailed, ownershipMismatch
}

protocol CaptureRecoveryPersisting {
    func save(_ intent: CaptureIntent) throws
    func load(origin: String, ownerScope: String, now: Date) throws -> [CaptureIntent]
    func remove(_ intent: CaptureIntent) throws
}
