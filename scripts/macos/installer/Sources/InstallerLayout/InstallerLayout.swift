import AppKit
import DSStore
import Foundation

/// Build-time only. Finder needs a Carbon Alias created on the mounted image:
/// https://github.com/sindresorhus/DSStore#setting-a-background-picture
@main
struct InstallerLayout {
    @MainActor static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        let inspect = arguments.first == "--inspect"
        guard arguments.count == (inspect ? 2 : 1) else {
            throw failure("Expected [--inspect] <mounted installer volume>")
        }
        let root = URL(fileURLWithPath: arguments.last!, isDirectory: true).standardizedFileURL
        let values = try root.resourceValues(forKeys: [.volumeURLKey, .isDirectoryKey])
        guard values.isDirectory == true,
              root.resolvingSymlinksInPath() == root,
              values.volume?.standardizedFileURL == root,
              FileManager.default.fileExists(atPath: root.appendingPathComponent("Talent Signal.app").path),
              try FileManager.default.destinationOfSymbolicLink(atPath: root.appendingPathComponent("Applications").path) == "/Applications"
        else { throw failure("Use the root of the mounted installer, containing its app and Applications link") }
        if inspect {
            try inspectLayout(root)
            return
        }
        let background = root.appendingPathComponent(".background", isDirectory: true)
        try FileManager.default.createDirectory(at: background, withIntermediateDirectories: true)
        let picture = background.appendingPathComponent("install.png")
        try drawBackground().write(to: picture, options: .atomic)
        // Keep the original instructions available without a third, clipped
        // icon competing with the two installation targets in the compact view.
        var instructions = root.appendingPathComponent("Install.txt")
        if FileManager.default.fileExists(atPath: instructions.path) {
            var attributes = URLResourceValues()
            attributes.isHidden = true
            try instructions.setResourceValues(attributes)
        }
        var store = DSStore()
        try store.setWindowBounds(top: 160, left: 160, bottom: 620, right: 880)
        store.setViewStyle(DSStore.ViewStyle.icon)
        store.setWindowSettings(.init(
            windowBounds: "{{160, 160}, {720, 460}}", containerShowSidebar: false,
            showSidebar: false, showTabView: false, showToolbar: false,
            showStatusBar: false, showPathBar: false, viewStyle: "icnv"
        ))
        store.setIconViewSettings(.init(
            showIconPreview: false, showItemInfo: false, labelOnBottom: true,
            scrollPositionX: 0, scrollPositionY: 0, textSize: 13, iconSize: 96,
            gridSpacing: 100, viewOptionsVersion: 1, arrangeBy: "none"
        ))
        try store.setBackgroundPicture(imageURL: picture, relativeTo: root)
        try store.setIconPosition(for: "Talent Signal.app", x: 190, y: 225)
        try store.setIconPosition(for: "Applications", x: 530, y: 225)
        try store.write(to: root.appendingPathComponent(".DS_Store"))
        try inspectLayout(root)
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "InstallerLayout", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    @MainActor static func drawBackground() throws -> Data {
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 1440, pixelsHigh: 920,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            throw failure("Cannot create installer background")
        }
        bitmap.size = NSSize(width: 720, height: 460) // 144 DPI, not a 1440-point Finder background.
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = context
        let scale = AffineTransform(scale: 2)
        (scale as NSAffineTransform).concat()
        NSColor(srgbRed: 0.992, green: 0.988, blue: 0.973, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 720, height: 460).fill()
        let ink = NSColor(srgbRed: 0.161, green: 0.169, blue: 0.169, alpha: 1)
        func text(_ string: String, y: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular) {
            let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: ink]
            let width = (string as NSString).size(withAttributes: attributes).width
            (string as NSString).draw(at: NSPoint(x: (720 - width) / 2, y: y), withAttributes: attributes)
        }
        // The existing held-interval mark, including its open seam.
        NSGraphicsContext.saveGraphicsState()
        let markTransform = NSAffineTransform()
        markTransform.translateX(by: 316, yBy: 391)
        markTransform.scale(by: 0.5)
        markTransform.concat()
        let mark = NSBezierPath()
        mark.move(to: NSPoint(x: 38, y: 53.5))
        mark.curve(to: NSPoint(x: 24, y: 55.1), controlPoint1: NSPoint(x: 33.7, y: 55.6), controlPoint2: NSPoint(x: 28.8, y: 56.3))
        mark.curve(to: NSPoint(x: 9.9, y: 28.4), controlPoint1: NSPoint(x: 12.1, y: 52.2), controlPoint2: NSPoint(x: 5.7, y: 39.8))
        mark.curve(to: NSPoint(x: 35.1, y: 15.5), controlPoint1: NSPoint(x: 13.7, y: 18.2), controlPoint2: NSPoint(x: 24.7, y: 12.6))
        mark.lineWidth = 5.5; mark.lineCapStyle = .round; ink.setStroke(); mark.stroke()
        let seam = NSBezierPath()
        seam.move(to: NSPoint(x: 43.8, y: 48.4))
        seam.curve(to: NSPoint(x: 46.5, y: 23.9), controlPoint1: NSPoint(x: 51.2, y: 42.3), controlPoint2: NSPoint(x: 52.4, y: 31.4))
        seam.lineWidth = 5.5; seam.lineCapStyle = .round
        NSColor(srgbRed: 0.735, green: 0.220, blue: 0.130, alpha: 1).setStroke(); seam.stroke()
        NSGraphicsContext.restoreGraphicsState()
        ("capri" as NSString).draw(at: NSPoint(x: 352, y: 397), withAttributes: [.font: NSFont.systemFont(ofSize: 18, weight: .medium), .foregroundColor: ink])
        text("让每一次重要对话，都有下文。", y: 340, size: 25, weight: .medium)
        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: 333, y: 235)); arrow.line(to: NSPoint(x: 387, y: 235))
        arrow.move(to: NSPoint(x: 379, y: 243)); arrow.line(to: NSPoint(x: 387, y: 235)); arrow.line(to: NSPoint(x: 379, y: 227))
        arrow.lineWidth = 1.5; ink.withAlphaComponent(0.55).setStroke(); arrow.stroke()
        text("拖入 Applications 安装", y: 112, size: 17, weight: .medium)
        text("完成后，从 Applications 打开 capri。", y: 85, size: 12)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw failure("Cannot encode background") }
        return data
    }

    @MainActor static func inspectLayout(_ root: URL) throws {
        let store = try DSStore.read(from: root.appendingPathComponent(".DS_Store"))
        guard let bounds = store.windowBounds(),
              let app = store.iconPosition(for: "Talent Signal.app"),
              let applications = store.iconPosition(for: "Applications"),
              let image = NSBitmapImageRep(data: try Data(contentsOf: root.appendingPathComponent(".background/install.png"))) else {
            throw failure("Installer metadata is incomplete")
        }
        let result: [String: Any] = [
            "windowSize": ["width": bounds.width, "height": bounds.height],
            "appPosition": ["x": app.x, "y": app.y],
            "applicationsPosition": ["x": applications.x, "y": applications.y],
            "backgroundPixels": ["width": image.pixelsWide, "height": image.pixelsHigh],
            "backgroundIsCarbonAlias": store.iconViewSettings()?.backgroundImageAlias?.isEmpty == false,
            "applicationsTarget": try FileManager.default.destinationOfSymbolicLink(atPath: root.appendingPathComponent("Applications").path),
            "hiddenBackground": try root.appendingPathComponent(".background").resourceValues(forKeys: [.isHiddenKey]).isHidden == true,
        ]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
