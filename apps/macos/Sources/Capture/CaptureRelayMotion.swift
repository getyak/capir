import Foundation

struct CaptureRelayAccessibility {
    let reduceMotion: Bool
    let reduceTransparency: Bool
}

/// Presentation-only once tokens. This gate cannot admit, retry, cancel, or
/// complete an Agent task. Late callbacks from a retired surface do nothing.
struct CaptureRelayMotionGate {
    private var intentID: UUID?
    private var ownerRevision: Int?
    private var landed = false
    private var scanned = false
    private var revealedVersions: Set<String> = []

    mutating func bind(intentID: UUID, ownerRevision: Int) {
        guard !matches(intentID, ownerRevision) else { return }
        clear()
        self.intentID = intentID
        self.ownerRevision = ownerRevision
    }

    mutating func clear() { self = Self() }

    private func matches(_ id: UUID, _ revision: Int) -> Bool {
        intentID == id && ownerRevision == revision
    }

    mutating func land(intentID: UUID, ownerRevision: Int, quiet: Bool) -> Bool {
        guard matches(intentID, ownerRevision), !landed else { return false }
        landed = true
        return !quiet
    }

    mutating func scans(intentID: UUID, ownerRevision: Int, admitted: Bool, quiet: Bool) -> Int {
        guard matches(intentID, ownerRevision), admitted, !scanned else { return 0 }
        scanned = true
        return quiet ? 0 : 2
    }

    mutating func reveal(intentID: UUID, ownerRevision: Int, version: String, quiet: Bool) -> Bool {
        guard matches(intentID, ownerRevision), !version.isEmpty, version.count <= 160,
              revealedVersions.count < 16, revealedVersions.insert(version).inserted else { return false }
        return !quiet
    }
}
