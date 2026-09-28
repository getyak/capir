import Carbon
import Foundation

enum CaptureShortcutRegistrationError: LocalizedError {
    case unsupportedKey
    case conflict

    var errorDescription: String? {
        switch self {
        case .unsupportedKey: "这个按键暂时不支持全局截图，请选择其他快捷键。"
        case .conflict: "这个快捷键已被系统或其他应用占用，请更换。"
        }
    }
}

/** A registered system hot key; it does not require an input-monitoring grant. */
@MainActor
final class CaptureHotKeyController {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var onCapture: (() -> Void)?
    private var currentShortcut: CaptureShortcutPreference?
    private var nextIdentifier: UInt32 = 1

    private static let letterCodes: [String: UInt32] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
        "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32,
        "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
        "-": 27, "8": 28, "0": 29, "]": 30, "[": 33, "'": 39, ";": 41, "\\": 42,
        ",": 43, "/": 44, ".": 47, "`": 50,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "f13": 105, "f14": 107, "f15": 113, "f16": 106, "f17": 64,
        "f18": 79, "f19": 80, "f20": 90,
    ]

    static func keyString(for hardwareCode: UInt16) -> String? {
        letterCodes.first(where: { $0.value == UInt32(hardwareCode) })?.key
    }

    func register(_ shortcut: CaptureShortcutPreference, onCapture: @escaping () -> Void) throws {
        guard shortcut.isValid, let code = Self.letterCodes[shortcut.key] else { throw CaptureShortcutRegistrationError.unsupportedKey }
        if currentShortcut == shortcut {
            self.onCapture = onCapture
            return
        }
        var modifiers: UInt32 = 0
        if shortcut.modifiers.contains(.control) { modifiers |= UInt32(controlKey) }
        if shortcut.modifiers.contains(.option) { modifiers |= UInt32(optionKey) }
        if shortcut.modifiers.contains(.shift) { modifiers |= UInt32(shiftKey) }
        if shortcut.modifiers.contains(.command) { modifiers |= UInt32(cmdKey) }
        let identity = EventHotKeyID(signature: OSType(0x54534350), id: nextIdentifier) // TSCP
        var replacement: EventHotKeyRef?
        let status = RegisterEventHotKey(code, modifiers, identity, GetApplicationEventTarget(), 0, &replacement)
        guard status == noErr, let replacement else { throw CaptureShortcutRegistrationError.conflict }
        if handler == nil {
            var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let callback: EventHandlerUPP = { _, _, pointer in
                guard let pointer else { return OSStatus(eventNotHandledErr) }
                let owner = Unmanaged<CaptureHotKeyController>.fromOpaque(pointer).takeUnretainedValue()
                Task { @MainActor in owner.onCapture?() }
                return noErr
            }
            let installed = InstallEventHandler(GetApplicationEventTarget(), callback, 1, &event,
                                                 Unmanaged.passUnretained(self).toOpaque(), &handler)
            guard installed == noErr else {
                UnregisterEventHotKey(replacement)
                throw CaptureShortcutRegistrationError.conflict
            }
        }
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = replacement
        currentShortcut = shortcut
        self.onCapture = onCapture
        nextIdentifier &+= 1
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        if let handler { RemoveEventHandler(handler); self.handler = nil }
        onCapture = nil
        currentShortcut = nil
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
    }
}
