import Foundation
import Capacitor
import AppIntents

/**
 * The bridge between the app and its App Intents (AI harness P4.7).
 *
 * Four calls and no judgement in any of them, like the widgets' bridge: the
 * app decides which titles the system may know and what becomes of an order;
 * `IntentStore` holds the bytes in the App Group container; this class only
 * carries them across — and tells the web layer when an intent left an order
 * while the app was running, because "open this note" is about now.
 */
@objc(IntentBridgePlugin)
public class IntentBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IntentBridgePlugin"
    public let jsName = "IntentBridge"
    // A method missing from this list is invisible to the platform, however
    // correct its implementation is.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readOrders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearOrders", returnType: CAPPluginReturnPromise)
    ]

    /// Posted by an intent after it recorded an order, in this process.
    public static let orderRecorded = Notification.Name("PlainvaIntentOrderRecorded")

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(forName: IntentBridgePlugin.orderRecorded, object: nil, queue: .main) { [weak self] _ in
            // Kept until somebody listens: an intent can be what STARTED the app,
            // and then the web layer is not there yet.
            self?.notifyListeners("orders", data: [:], retainUntilConsumed: true)
        }
    }

    deinit {
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
    }

    private func store() -> IntentStore? {
        try? IntentStore()
    }

    /// The names in "Open ⟨note⟩ in Plainva" come from the directory: the system learns that it changed.
    private func directoryChanged() {
        if #available(iOS 16.0, *) {
            PlainvaShortcuts.updateAppShortcutParameters()
        }
    }

    /** The titles the system may know until the app next runs. */
    @objc func writeDirectory(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json required")
            return
        }
        guard let store = store() else {
            call.reject("no app group container")
            return
        }
        do {
            try store.writeDirectory(json)
        } catch {
            call.reject("directory not written")
            return
        }
        directoryChanged()
        call.resolve()
    }

    /**
     * Wipes them — the switch went off, the vault was locked, changed or
     * removed. Rejects where the file is still there: the app must not
     * believe that nothing is named while something is.
     */
    @objc func clearDirectory(_ call: CAPPluginCall) {
        guard let store = store() else {
            // No container, no file.
            call.resolve()
            return
        }
        do {
            try store.clearDirectory()
        } catch {
            call.reject("directory not cleared")
            return
        }
        directoryChanged()
        call.resolve()
    }

    /** What the intents left since the app last looked. */
    @objc func readOrders(_ call: CAPPluginCall) {
        call.resolve(["orders": store()?.pendingOrders() ?? []])
    }

    /** Drops the orders the app has dealt with — by id, never wholesale. */
    @objc func clearOrders(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [NSNumber] ?? []).map { $0.int64Value }
        store()?.clearOrders(ids: Set(ids))
        call.resolve()
    }
}
