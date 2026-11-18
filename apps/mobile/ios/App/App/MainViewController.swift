import UIKit
import Capacitor

/**
 * Registers the local plugins (P7) — the storyboard instantiates this
 * subclass instead of the stock CAPBridgeViewController, matching the
 * MainActivity registration on Android.
 */
class MainViewController: CAPBridgeViewController {
    /// Runs first in `CAPBridgeViewController.loadView()`, before the bridge is
    /// created - and the bridge's initialiser is where every plugin's `load()`
    /// runs, the SQLite plugin's among them. So the database folder exists,
    /// and is part of the backup, before that plugin looks at it.
    override open func instanceDescriptor() -> InstanceDescriptor {
        DatabaseFolder.prepare()
        return super.instanceDescriptor()
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebDavHttpPlugin())
        bridge?.registerPluginInstance(SecureStorePlugin())
        bridge?.registerPluginInstance(AtomicFilePlugin())
        bridge?.registerPluginInstance(ShareTargetPlugin())
        bridge?.registerPluginInstance(MailNetPlugin())
        bridge?.registerPluginInstance(VaultFolderPlugin())
        bridge?.registerPluginInstance(DevicePimPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(IntentBridgePlugin())
        bridge?.registerPluginInstance(ProcessExitPlugin())
        bridge?.registerPluginInstance(AiNetPlugin())
        bridge?.registerPluginInstance(AiWebPlugin())
        bridge?.registerPluginInstance(AiMcpPlugin())
        bridge?.registerPluginInstance(AiMcpAuthPlugin())
        bridge?.registerPluginInstance(LocalModelPlugin())
        bridge?.registerPluginInstance(PlatformModelPlugin())
        bridge?.registerPluginInstance(WebAuthPlugin())
    }
}

/**
 * The folder the SQLite plugin keeps the databases in on iOS
 * (`capacitor.config.ts`, `iosDatabaseLocation: "Library/CapacitorDatabase"`;
 * release list A11) - `Library`, which the Files app does not show.
 *
 * When the plugin finds that folder missing at launch it creates it, excludes
 * it from the iCloud backup without a way to say otherwise, and moves the
 * database files alone out of `Documents`, leaving their logs behind
 * (`UtilsFile.createDatabaseLocation`). The databases hold the sync queue,
 * the sync states and the deletion journal; restored from a backup without
 * them, next to the notes that do come back, a sync would turn files changed
 * on the server into conflict copies and upload again what another device
 * deleted. So the folder is made here, before the plugin loads (the plugin
 * then neither excludes nor moves; `iosDatabaseFolder.ts` moves every file
 * of a database, logs included), and at every launch it is put back into the
 * backup - also where an earlier launch let the plugin exclude it.
 * A failure is logged: the plugin then makes the folder as before, and the
 * next launch tries again.
 */
enum DatabaseFolder {
    static let name = "CapacitorDatabase"

    static func prepare() {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        var folder = library.appendingPathComponent(name, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = false
            try folder.setResourceValues(values)
        } catch {
            NSLog("[sqlite] database folder not prepared: %@", error.localizedDescription)
        }
    }
}
