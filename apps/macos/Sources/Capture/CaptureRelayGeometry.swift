import Foundation
import CoreGraphics

/// Transient UI points only. Deliberately not Codable: neither screen geometry
/// nor display identity belongs in a capture intent or Agent payload.
struct CaptureRelayDisplay: Equatable {
    var id: UInt32
    let frame: CGRect
    let visibleFrame: CGRect
    let scale: CGFloat

    var isValid: Bool {
        id != 0 && scale.isFinite && scale > 0 && CaptureRelayGeometry.valid(frame) &&
            CaptureRelayGeometry.valid(visibleFrame) && frame.contains(visibleFrame)
    }
}

struct CaptureRegionOrigin: Equatable {
    let rect: CGRect
    let display: CaptureRelayDisplay

    static func region(selection: CGRect, display: CaptureRelayDisplay) -> Self? {
        guard display.isValid, CaptureRelayGeometry.valid(selection),
              CGRect(origin: .zero, size: display.frame.size).contains(selection) else { return nil }
        return .init(rect: CGRect(x: display.frame.minX + selection.minX,
                                  y: display.frame.maxY - selection.maxY,
                                  width: selection.width, height: selection.height), display: display)
    }
}

struct CaptureRelayDestination: Equatable {
    let rect: CGRect
    let display: CaptureRelayDisplay
}

struct CaptureRelayFlight {
    let frames: [CGRect]
    let keyTimes: [Double]
    let duration: TimeInterval
}

enum CaptureRelayGeometry {
    static func valid(_ rect: CGRect) -> Bool {
        [rect.origin.x, rect.origin.y, rect.width, rect.height, rect.maxX, rect.maxY].allSatisfy(\.isFinite) &&
            rect.width > 0 && rect.height > 0
    }

    /// Normalized active travel samples from Figma Motion 2018:2615. Strip the
    /// promotional hold/loop; preserve the 420 ms path. Core Animation linearly
    /// interpolates both center and size between these ordered stops, so whole
    /// rectangles remain inside the same convex display frame.
    static func flight(from source: CaptureRegionOrigin?, to target: CaptureRelayDestination?,
                       reducedMotion: Bool, motionEnabled: Bool) -> CaptureRelayFlight? {
        guard !reducedMotion, motionEnabled, let source, let target,
              source.display == target.display, source.display.isValid,
              valid(source.rect), valid(target.rect),
              source.display.frame.contains(source.rect),
              target.display.visibleFrame.contains(target.rect) else { return nil }
        let xs: [CGFloat] = [-726, -652.97, -575.08, -495.265, -416.081, -339.707, -267.957,
                             -202.288, -143.823, -93.399, -51.668, -19.431, 0]
        let ys: [CGFloat] = [-214, -301.888, -355.622, -380.058, -379.796, -359.2, -322.433,
                             -273.503, -216.338, -154.931, -93.634, -37.984, 0]
        let progress = xs.map { ($0 + 726) / 726 }
        let rises = zip(progress, ys).map { progress, y in max(0, -214 * (1 - progress) - y) }
        guard let peak = rises.max(), peak > 0 else { return nil }
        let normalized = rises.map { $0 / peak }
        let distance = hypot(target.rect.midX - source.rect.midX, target.rect.midY - source.rect.midY)
        var height = min(160, distance * 0.35)
        let straight: [CGRect] = progress.map { p in
            let width = source.rect.width + (target.rect.width - source.rect.width) * p
            let height = source.rect.height + (target.rect.height - source.rect.height) * p
            let center = CGPoint(x: source.rect.midX + (target.rect.midX - source.rect.midX) * p,
                                 y: source.rect.midY + (target.rect.midY - source.rect.midY) * p)
            return CGRect(x: center.x - width / 2, y: center.y - height / 2, width: width, height: height)
        }
        for (rect, rise) in zip(straight, normalized) where rise > 0 {
            height = min(height, max(0, source.display.frame.maxY - rect.maxY) / rise)
        }
        // A nearly flat path is a misleading arc; use the honest fade instead.
        guard height >= 8 else { return nil }
        var frames = zip(straight, normalized).map { rect, rise in rect.offsetBy(dx: 0, dy: rise * height) }
        frames[0] = source.rect
        frames[frames.count - 1] = target.rect
        guard frames.allSatisfy({ source.display.frame.contains($0) }) else { return nil }
        return .init(frames: frames, keyTimes: xs.indices.map { Double($0) / Double(xs.count - 1) }, duration: 0.420)
    }
}
