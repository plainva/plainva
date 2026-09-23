import Foundation
import Capacitor
import WidgetKit

/**
 * The bridge between the app and its home-screen widgets, iOS side
 * (plan Widgets, W2) — the counterpart of `WidgetBridgePlugin.java`.
 *
 * Four calls and no judgement in any of them: the app decides what a widget
 * shows and when, `WidgetStore` holds the bytes in the App Group container,
 * and this class only carries them across. `reloadAllTimelines` is harmless
 * where no widget extension is installed, so the app is free to call it on
 * every trigger without asking first.
 */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    // A method missing from this list is invisible to the platform, however
    // correct its implementation is — the mail socket plugin proved that once.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readPendingActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPendingActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise)
    ]

    private func store() -> WidgetStore? {
        try? WidgetStore()
    }

    private func reload() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    /** What the widgets draw until the app next runs. */
    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json required")
            return
        }
        guard let store = store() else {
            call.reject("no app group container")
            return
        }
        do {
            try store.writeSnapshot(json)
        } catch {
            call.reject("snapshot not written")
            return
        }
        reload()
        call.resolve()
    }

    /**
     * What is on disk right now. The app reads its own snapshot back after a
     * cold start -- a tap on a widget can be the thing that started the
     * process, and then nothing is in memory to resolve the index against.
     */
    @objc func readSnapshot(_ call: CAPPluginCall) {
        // An empty result rather than a wrapped nil: `Any` around an Optional
        // reaches JSONSerialization as something it cannot encode.
        guard let json = store()?.readSnapshot() else {
            call.resolve([:])
            return
        }
        call.resolve(["json": json])
    }

    /** Wipes it — the vault was locked, changed or removed (W6). */
    @objc func clearSnapshot(_ call: CAPPluginCall) {
        store()?.clearSnapshot()
        reload()
        call.resolve()
    }

    /** The ticks made on the home screen since the app last looked. */
    @objc func readPendingActions(_ call: CAPPluginCall) {
        call.resolve(["actions": store()?.pendingActions() ?? []])
    }

    /**
     * Drops the orders the app has redeemed — by id, never wholesale: a tap
     * that lands between the read and this call has to survive it.
     */
    @objc func clearPendingActions(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [NSNumber] ?? []).map { $0.int64Value }
        store()?.clearActions(ids: Set(ids))
        call.resolve()
    }

    /** Asks every widget to redraw from what is on disk. */
    @objc func reloadWidgets(_ call: CAPPluginCall) {
        reload()
        call.resolve()
    }
}
