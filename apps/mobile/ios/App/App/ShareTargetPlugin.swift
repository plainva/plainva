import Foundation
import Capacitor

/** Reads the one-shot payload written by the Share Extension. The JSON shape is
 * intentionally identical to Android's ShareTargetPlugin contract. */
@objc(ShareTargetPlugin)
public class ShareTargetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTargetPlugin"
    public let jsName = "ShareTarget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consumePendingShare", returnType: CAPPluginReturnPromise)
    ]

    private let appGroup = "group.com.plainva.app"
    private let payloadName = "pending-share.json"

    @objc func consumePendingShare(_ call: CAPPluginCall) {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            call.resolve(["text": NSNull(), "subject": NSNull(), "files": []])
            return
        }
        let url = root.appendingPathComponent(payloadName)
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.resolve(["text": NSNull(), "subject": NSNull(), "files": []])
            return
        }
        try? FileManager.default.removeItem(at: url)
        call.resolve(object)
    }
}
