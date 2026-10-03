import AppKit
import SwiftUI

/** Records a chord only while the user focuses the native settings control. */
struct CaptureShortcutRecorder: NSViewRepresentable {
    let recorded: (CaptureShortcutPreference) -> Void
    let cancelled: () -> Void

    func makeNSView(context: Context) -> RecorderView {
        let view = RecorderView(frame: .zero)
        view.recorded = recorded
        view.cancelled = cancelled
        return view
    }

    func updateNSView(_ view: RecorderView, context: Context) {
        view.recorded = recorded
        view.cancelled = cancelled
        DispatchQueue.main.async { [weak view] in
            if let view, let window = view.window, window.firstResponder !== view { window.makeFirstResponder(view) }
        }
    }
}

final class RecorderView: NSView {
    var recorded: ((CaptureShortcutPreference) -> Void)?
    var cancelled: (() -> Void)?
    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window { window.makeFirstResponder(self) }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { cancelled?(); return }
        guard let key = CaptureHotKeyController.keyString(for: event.keyCode) else {
            NSSound.beep(); return
        }
        var flags: CaptureShortcutModifiers = []
        if event.modifierFlags.contains(.control) { flags.insert(.control) }
        if event.modifierFlags.contains(.option) { flags.insert(.option) }
        if event.modifierFlags.contains(.shift) { flags.insert(.shift) }
        if event.modifierFlags.contains(.command) { flags.insert(.command) }
        let choice = CaptureShortcutPreference(key: key, modifiers: flags)
        guard choice.isValid else { NSSound.beep(); return }
        recorded?(choice)
    }
}
