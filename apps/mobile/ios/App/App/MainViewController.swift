import UIKit
import Capacitor

/**
 * Registers the local plugins (P7) — the storyboard instantiates this
 * subclass instead of the stock CAPBridgeViewController, matching the
 * MainActivity registration on Android.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebDavHttpPlugin())
        bridge?.registerPluginInstance(SecureStorePlugin())
        bridge?.registerPluginInstance(AtomicFilePlugin())
    }
}
