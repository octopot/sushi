// stagecap <out.png> <margin-pt> <windowID>...  Composites only the given windows (glass included).
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

guard CGPreflightScreenCaptureAccess() else { FileHandle.standardError.write("no screen capture access\n".data(using: .utf8)!); exit(2) }
let args = CommandLine.arguments
let out = URL(fileURLWithPath: args[1])
let margin = CGFloat(Double(args[2])!)
let ids = Set(args.dropFirst(3).map { CGWindowID($0)! })
let main = CGWindowID(args[3])!
let done = DispatchSemaphore(value: 0)
Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let windows = content.windows.filter { ids.contains($0.windowID) }
    guard let target = windows.first(where: { $0.windowID == main }),
          let display = content.displays.first(where: { $0.frame.intersects(target.frame) }) else { print("windows not found"); exit(1) }
    let filter = SCContentFilter(display: display, including: windows)
    let config = SCStreamConfiguration()
    let rect = target.frame.insetBy(dx: -margin, dy: -margin).offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    config.sourceRect = rect
    let scale = CGFloat(filter.pointPixelScale)
    config.width = Int(rect.width * scale); config.height = Int(rect.height * scale)
    config.showsCursor = false
    config.ignoreShadowsDisplay = false
    config.capturesAudio = false
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil); CGImageDestinationFinalize(dest)
    print("wrote \(out.path) \(image.width)x\(image.height)")
  } catch { print("error: \(error)"); exit(1) }
  done.signal()
}
done.wait()
