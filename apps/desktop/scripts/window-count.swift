// `window-count <pid>` — how many on-screen windows of the normal layer the
// process owns. Reads the window server's list (CGWindowListCopyWindowInfo):
// owner PID and layer need no Screen Recording or Accessibility permission,
// so this runs on a CI runner without a permission dialog. Used by
// check-package-entry.sh as the macOS evidence that the app's main window
// is there.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: window-count <pid>\n".data(using: .utf8)!)
  exit(2)
}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let count = windows.filter {
  ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
}.count
print(count)
