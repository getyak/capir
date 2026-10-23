import Foundation
import WebKit

/// A stopped WebKit process must not hold the login gesture indefinitely.
/// The gate ignores a late callback without cancelling or deleting its donor.
@MainActor
final class DesktopDraftScriptRead {
    private var continuation: CheckedContinuation<String?, Never>?
    private var deadline: Task<Void, Never>?

    static func read(timeout: Duration = .seconds(3),
                     start: (@escaping (String?) -> Void) -> Void) async -> String? {
        let gate = DesktopDraftScriptRead()
        return await withCheckedContinuation { continuation in
            gate.continuation = continuation
            gate.deadline = Task { @MainActor in
                do { try await Task.sleep(for: timeout) } catch { return }
                gate.finish(nil)
            }
            start { gate.finish($0) }
        }
    }

    private func finish(_ value: String?) {
        guard let continuation else { return }
        self.continuation = nil
        deadline?.cancel(); deadline = nil
        continuation.resume(returning: value)
    }
}

struct DesktopRetainedDraft: Identifiable {
    let id = UUID()
    let recovery: DesktopDraftRecovery
}

/// Content-free ownership obtained from the first-party live session readback.
/// A DOM attribute, local key or callback URL can never establish this owner.
struct DesktopDraftOwner: Codable, Equatable {
    let accountID: String
    let userID: String
    let storageScope: String

    var valid: Bool {
        UUID(uuidString: accountID) != nil && UUID(uuidString: userID) != nil &&
        storageScope.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }
}

/// One expiring text draft in memory. No credentials, outbox, image or storage
/// inventory is transferred. The original WebKit store remains untouched.
struct DesktopDraftRecovery {
    struct Draft: Codable {
        let value: String
        let updatedAt: String
        let expiresAt: Double
        let writer: String

        func valid(at now: Date) -> Bool {
            !value.isEmpty && value.utf16.count <= 12_000 && value.utf8.count <= 48_000 &&
            !writer.isEmpty && writer.count <= 128 && desktopLoginDate(updatedAt) != nil &&
            expiresAt.isFinite && expiresAt > now.timeIntervalSince1970 * 1000 &&
            expiresAt <= now.addingTimeInterval(86_400).timeIntervalSince1970 * 1000
        }
    }
    let owner: DesktopDraftOwner
    let target: URL
    let sessionID: String?
    let draft: Draft?

    static func sessionID(in target: URL) -> String? {
        let raw: String?
        if target.path == "/workspace" {
            let items = URLComponents(url: target, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let matches = items.filter { $0.name == "draft_session" }
            raw = matches.count == 1 ? matches[0].value : nil
        } else {
            let parts = target.path.split(separator: "/")
            raw = parts.count == 3 && parts[0] == "workspace" && parts[1] == "sessions" ? String(parts[2]) : nil
        }
        return raw.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
    }

    static func readDraft(_ text: String, now: Date = Date()) -> Draft? {
        guard text.utf8.count <= 65_536, let data = text.data(using: .utf8),
              let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.valid(at: now) else { return nil }
        return draft
    }

    @MainActor static let world = WKContentWorld.world(name: "TalentSignalDraftRecovery")
    static let ownerScript = """
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(statusURL, {credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      if (response.status !== 200 || response.url !== statusURL ||
          !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return '';
      const text = await response.text();
      if (text.length > 65536) return '';
      const data = JSON.parse(text);
      return JSON.stringify({status:data.status,accountID:data.account?.id,userID:data.user?.id,
        storageScope:data.draft_storage_scope,expiresAt:data.session_expires_at});
    } finally { clearTimeout(timer); }
    """

    static func readOwner(_ text: String) -> DesktopDraftOwner? {
        struct Readback: Decodable {
            let status: String; let accountID: String; let userID: String
            let storageScope: String; let expiresAt: String
        }
        guard text.utf8.count <= 65_536, let data = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(Readback.self, from: data), value.status == "authenticated",
              let expiry = desktopLoginDate(value.expiresAt), expiry > Date() else { return nil }
        let owner = DesktopDraftOwner(accountID: value.accountID, userID: value.userID, storageScope: value.storageScope)
        return owner.valid ? owner : nil
    }
    static let readScript = """
    const key = `talent-signal:conversation:v1:${scope}:${session}:draft`;
    const value = localStorage.getItem(key);
    return typeof value === 'string' && value.length <= 65536 ? value : '';
    """
    static let restoreScript = """
    const prefix = `talent-signal:conversation:v1:${scope}:`;
    const key = `${prefix}${session}:draft`;
    const current = localStorage.getItem(key);
    if (current) {
      const prior = JSON.parse(current);
      if (typeof prior.value === 'string' && prior.value && prior.value !== value.value && prior.expiresAt > Date.now()) {
        throw new Error('A different local draft already exists');
      }
    }
    // Native has compared both verified owners and retained the original TTL.
    localStorage.setItem(key, JSON.stringify(value));
    const homeValue = JSON.stringify({id:session,expiresAt:value.expiresAt});
    if (home) localStorage.setItem(`${prefix}home`, homeValue);
    return localStorage.getItem(key) === JSON.stringify(value) &&
      (!home || localStorage.getItem(`${prefix}home`) === homeValue);
    """
}
