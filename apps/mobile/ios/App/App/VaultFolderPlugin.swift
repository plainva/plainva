import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * A folder the user picked in the document picker, held through a
 * security-scoped bookmark (external vault folder plan, P3 — the iOS half,
 * the twin of Android's VaultFolderPlugin).
 *
 * The handle is the bookmark data, base64. Resolving it opens the security
 * scope, which stays open while the vault is in use and is closed on
 * `release`. Every path is vault-relative and standardized against the folder
 * so nothing can escape it. Reads and writes are coordinated
 * (NSFileCoordinator): another app — a sync client — may be working in the
 * same folder, and an uncoordinated write in the middle of its download is
 * exactly the torn file the coordinator exists to prevent. Writes are atomic
 * (`.atomic`), so a kill mid-write leaves the previous file, never half of the
 * new one.
 *
 * A bookmark that no longer resolves (folder moved to the trash, permission
 * gone after a restore) answers `expired` — a state the UI names, not an
 * error the vault fails on.
 */
@objc(VaultFolderPlugin)
public class VaultFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "VaultFolderPlugin"
    public let jsName = "VaultFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolve", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rename", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mkdir", returnType: CAPPluginReturnPromise)
    ]

    private var pendingPick: CAPPluginCall?
    /** Folders whose security scope is open right now, by handle. */
    private var scoped: [String: URL] = [:]
    private let lock = NSLock()

    // MARK: picker

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("no view controller")
                return
            }
            self.pendingPick = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            host.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        guard let url = urls.first else {
            call.resolve(["picked": false, "reason": "cancelled"])
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.resolve(["picked": false, "reason": "notPickable"])
            return
        }
        do {
            let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            let handle = data.base64EncodedString()
            lock.lock()
            scoped[handle] = url
            lock.unlock()
            call.resolve(["picked": true, "handle": handle, "label": url.lastPathComponent])
        } catch {
            url.stopAccessingSecurityScopedResource()
            call.resolve(["picked": false, "reason": "notPickable"])
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        call.resolve(["picked": false, "reason": "cancelled"])
    }

    // MARK: access

    private struct Resolved {
        let url: URL
        let stale: Bool
    }

    /** The folder behind a handle with its scope open; nil when the bookmark is dead. */
    private func folder(for handle: String) -> Resolved? {
        lock.lock()
        if let open = scoped[handle] {
            lock.unlock()
            return Resolved(url: open, stale: false)
        }
        lock.unlock()
        guard let data = Data(base64Encoded: handle) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            return nil
        }
        guard url.startAccessingSecurityScopedResource() else { return nil }
        lock.lock()
        scoped[handle] = url
        lock.unlock()
        return Resolved(url: url, stale: stale)
    }

    @objc func resolve(_ call: CAPPluginCall) {
        guard let handle = call.getString("handle"), !handle.isEmpty else {
            call.resolve(["state": "invalid"])
            return
        }
        guard let resolved = folder(for: handle) else {
            call.resolve(["state": "expired", "label": ""])
            return
        }
        var isDir: ObjCBool = false
        let reachable = FileManager.default.fileExists(atPath: resolved.url.path, isDirectory: &isDir) && isDir.boolValue
        call.resolve(["state": reachable ? "ok" : "expired", "label": resolved.url.lastPathComponent])
    }

    @objc func release(_ call: CAPPluginCall) {
        if let handle = call.getString("handle") {
            lock.lock()
            let url = scoped.removeValue(forKey: handle)
            lock.unlock()
            url?.stopAccessingSecurityScopedResource()
        }
        call.resolve()
    }

    // MARK: paths

    private func target(_ base: URL, _ rel: String) -> URL? {
        let clean = rel.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let baseStd = base.standardizedFileURL
        let url = clean.isEmpty ? baseStd : baseStd.appendingPathComponent(clean).standardizedFileURL
        let prefix = baseStd.path.hasSuffix("/") ? baseStd.path : baseStd.path + "/"
        guard url.path == baseStd.path || url.path.hasPrefix(prefix) else { return nil }
        return url
    }

    private func withFolder(_ call: CAPPluginCall, _ body: (URL) throws -> Void) {
        guard let handle = call.getString("handle") else {
            call.reject("handle required")
            return
        }
        guard let resolved = folder(for: handle) else {
            call.reject("folder access expired")
            return
        }
        do {
            try body(resolved.url)
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    private static let keys: Set<URLResourceKey> = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey, .creationDateKey, .nameKey]

    private func describe(_ url: URL) -> [String: Any]? {
        guard let values = try? url.resourceValues(forKeys: VaultFolderPlugin.keys) else { return nil }
        let isDir = values.isDirectory ?? false
        var out: [String: Any] = [
            "name": values.name ?? url.lastPathComponent,
            "isDirectory": isDir,
            "size": isDir ? 0 : (values.fileSize ?? 0),
            "mtime": Int((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)
        ]
        if let created = values.creationDate {
            out["ctime"] = Int(created.timeIntervalSince1970 * 1000)
        }
        return out
    }

    // MARK: file operations

    @objc func list(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let dir = target(base, call.getString("path") ?? "") else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"]) }
            let urls = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: Array(VaultFolderPlugin.keys), options: [])
            let entries = urls.compactMap { self.describe($0) }
            call.resolve(["entries": entries])
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let url = target(base, call.getString("path") ?? "") else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"]) }
            if FileManager.default.fileExists(atPath: url.path), let entry = describe(url) {
                call.resolve(["entry": entry])
            } else {
                call.resolve(["entry": NSNull()])
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), let url = target(base, path) else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path required"]) }
            var coordinatorError: NSError?
            var data: Data?
            var readError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
                do { data = try Data(contentsOf: readURL) } catch { readError = error }
            }
            if let e = coordinatorError { throw e }
            if let e = readError { throw e }
            call.resolve(["dataBase64": (data ?? Data()).base64EncodedString()])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), let url = target(base, path), let b64 = call.getString("dataBase64"), let data = Data(base64Encoded: b64) else {
                throw NSError(domain: "VaultFolder", code: 2, userInfo: [NSLocalizedDescriptionKey: "path and dataBase64 required"])
            }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var coordinatorError: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: [.forReplacing], error: &coordinatorError) { writeURL in
                do { try data.write(to: writeURL, options: [.atomic]) } catch { writeError = error }
            }
            if let e = coordinatorError { throw e }
            if let e = writeError { throw e }
            call.resolve()
        }
    }

    @objc func delete(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), !path.isEmpty, let url = target(base, path), url.standardizedFileURL.path != base.standardizedFileURL.path else {
                throw NSError(domain: "VaultFolder", code: 3, userInfo: [NSLocalizedDescriptionKey: "path required"])
            }
            let recursive = call.getBool("recursive") ?? false
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else {
                throw NSError(domain: "VaultFolder", code: 4, userInfo: [NSLocalizedDescriptionKey: "not found: \(path)"])
            }
            if isDir.boolValue && !recursive {
                let children = try FileManager.default.contentsOfDirectory(atPath: url.path)
                if !children.isEmpty {
                    throw NSError(domain: "VaultFolder", code: 5, userInfo: [NSLocalizedDescriptionKey: "directory not empty: \(path)"])
                }
            }
            var coordinatorError: NSError?
            var removeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: [.forDeleting], error: &coordinatorError) { delURL in
                do { try FileManager.default.removeItem(at: delURL) } catch { removeError = error }
            }
            if let e = coordinatorError { throw e }
            if let e = removeError { throw e }
            call.resolve()
        }
    }

    @objc func rename(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let from = call.getString("from"), let to = call.getString("to"), let src = target(base, from), let dst = target(base, to) else {
                throw NSError(domain: "VaultFolder", code: 6, userInfo: [NSLocalizedDescriptionKey: "from and to required"])
            }
            try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            var coordinatorError: NSError?
            var moveError: Error?
            NSFileCoordinator().coordinate(writingItemAt: src, options: [.forMoving], writingItemAt: dst, options: [.forReplacing], error: &coordinatorError) { a, b in
                do { try FileManager.default.moveItem(at: a, to: b) } catch { moveError = error }
            }
            if let e = coordinatorError { throw e }
            if let e = moveError { throw e }
            call.resolve()
        }
    }

    @objc func mkdir(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let url = target(base, call.getString("path") ?? "") else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"]) }
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            call.resolve()
        }
    }
}
