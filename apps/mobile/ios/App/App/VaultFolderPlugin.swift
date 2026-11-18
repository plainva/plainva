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
        CAPPluginMethod(name: "openRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readPart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise),
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
            let nsError = error as NSError
            call.reject(error.localizedDescription, isMissing(error) ? "ENOENT" : "\(nsError.domain):\(nsError.code)")
        }
    }

    private static let keys: Set<URLResourceKey> = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey, .creationDateKey, .nameKey]

    private func isMissing(_ error: Error) -> Bool {
        let e = error as NSError
        return (e.domain == NSCocoaErrorDomain && (e.code == NSFileReadNoSuchFileError || e.code == NSFileNoSuchFileError))
            || (e.domain == NSPOSIXErrorDomain && e.code == Int(ENOENT))
    }

    /** The entry itself, a link as a link: what `delete` asks before it removes one (never its target). */
    private func describe(_ url: URL) throws -> [String: Any] {
        let values = try url.resourceValues(forKeys: VaultFolderPlugin.keys)
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

    /** One folder by the desktop's rules: links followed, what cannot be listed named (VaultFolderListing, issue #125). */
    @objc func list(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let dir = target(base, call.getString("path") ?? "") else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"]) }
            call.resolve(try VaultFolderListing.list(dir))
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let url = target(base, call.getString("path") ?? "") else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"]) }
            do {
                // A link answers for what it points at, as in `list`; one that points nowhere is not there.
                if let entry = try VaultFolderListing.describeFollowing(url) {
                    call.resolve(["entry": entry])
                } else {
                    call.resolve(["entry": NSNull()])
                }
            } catch where isMissing(error) {
                call.resolve(["entry": NSNull()])
            }
        }
    }

    /** The most one message carries, in bytes before base64 (`BRIDGE_PART_BYTES` in JS). */
    private static let maxPart = 256 * 1024
    /** A read or a write in parts nobody finished (its page went away) is dropped after this long without a call. */
    private static let idleSeconds: TimeInterval = 120

    /** A read in parts: the copy of the one version that was opened, in the app's caches. */
    private final class OpenRead {
        let copy: URL
        let handle: FileHandle
        let size: Int
        var lastUsed = Date()
        init(copy: URL, handle: FileHandle, size: Int) { self.copy = copy; self.handle = handle; self.size = size }
    }

    /** A write in parts: what was sent so far, in the app's caches, and where it goes. */
    private final class OpenWrite {
        let parts: URL
        let handle: FileHandle
        let folder: String
        let path: String
        var lastUsed = Date()
        init(parts: URL, handle: FileHandle, folder: String, path: String) { self.parts = parts; self.handle = handle; self.folder = folder; self.path = path }
    }

    private var reads: [String: OpenRead] = [:]
    private var writes: [String: OpenWrite] = [:]

    private func partsFolder() throws -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("vault-folder-parts", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func dropIdle() {
        let cutoff = Date().addingTimeInterval(-VaultFolderPlugin.idleSeconds)
        lock.lock()
        let staleReads = reads.filter { $0.value.lastUsed < cutoff }.map { $0.key }
        let staleWrites = writes.filter { $0.value.lastUsed < cutoff }.map { $0.key }
        lock.unlock()
        staleReads.forEach(dropRead)
        staleWrites.forEach(dropWrite)
    }

    private func dropRead(_ id: String) {
        lock.lock()
        let read = reads.removeValue(forKey: id)
        lock.unlock()
        guard let read = read else { return }
        try? read.handle.close()
        try? FileManager.default.removeItem(at: read.copy)
    }

    private func dropWrite(_ id: String) {
        lock.lock()
        let write = writes.removeValue(forKey: id)
        lock.unlock()
        guard let write = write else { return }
        try? write.handle.close()
        try? FileManager.default.removeItem(at: write.parts)
    }

    /**
     * A file in one answer, up to `maxBytes` (one part when left out). A
     * larger one answers `tooLarge` with its size and no data: a whole picture
     * in one answer is the message that froze the app on Android (release list
     * F54, the class of F51) - the same rule on both platforms.
     */
    @objc func read(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), let url = target(base, path) else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path required"]) }
            let asked = call.getInt("maxBytes") ?? VaultFolderPlugin.maxPart
            let limit = max(0, min(asked, VaultFolderPlugin.maxPart))
            var coordinatorError: NSError?
            var data: Data?
            var tooLarge: Int?
            var readError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
                do {
                    let handle = try FileHandle(forReadingFrom: readURL)
                    defer { try? handle.close() }
                    let head = try handle.read(upToCount: limit + 1) ?? Data()
                    if head.count > limit {
                        tooLarge = Int(try handle.seekToEnd())
                    } else {
                        data = head
                    }
                } catch { readError = error }
            }
            if let e = coordinatorError { throw e }
            if let e = readError { throw e }
            if let size = tooLarge {
                call.resolve(["tooLarge": true, "size": size])
                return
            }
            guard let content = data else {
                throw NSError(domain: "VaultFolder", code: 7, userInfo: [NSLocalizedDescriptionKey: "file coordinator returned no content"])
            }
            call.resolve(["dataBase64": content.base64EncodedString()])
        }
    }

    /**
     * Opens a file for a read in parts. The file is copied into the app's
     * caches under the coordinator first: a sync client may write it
     * meanwhile, and the copy is the one version every part comes from.
     */
    @objc func openRead(_ call: CAPPluginCall) {
        dropIdle()
        withFolder(call) { base in
            guard let path = call.getString("path"), let url = target(base, path) else { throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path required"]) }
            let copy = try partsFolder().appendingPathComponent("read-" + UUID().uuidString)
            var coordinatorError: NSError?
            var copyError: Error?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
                do { try FileManager.default.copyItem(at: readURL, to: copy) } catch { copyError = error }
            }
            if let e = coordinatorError ?? copyError {
                try? FileManager.default.removeItem(at: copy)
                throw e
            }
            do {
                let handle = try FileHandle(forReadingFrom: copy)
                let size = Int(try handle.seekToEnd())
                let id = UUID().uuidString
                lock.lock()
                reads[id] = OpenRead(copy: copy, handle: handle, size: size)
                lock.unlock()
                call.resolve(["id": id, "size": size])
            } catch {
                try? FileManager.default.removeItem(at: copy)
                throw error
            }
        }
    }

    /** At most `length` bytes (never more than one part) from `offset` of an open read, base64. */
    @objc func readPart(_ call: CAPPluginCall) {
        lock.lock()
        let read = call.getString("id").flatMap { reads[$0] }
        lock.unlock()
        guard let read = read, let offset = call.getInt("offset"), let length = call.getInt("length"), offset >= 0, length >= 0 else {
            call.reject("no such read, or no offset and length")
            return
        }
        do {
            read.lastUsed = Date()
            let want = max(0, min(min(length, VaultFolderPlugin.maxPart), read.size - offset))
            var bytes = Data()
            if want > 0 {
                try read.handle.seek(toOffset: UInt64(offset))
                bytes = try read.handle.read(upToCount: want) ?? Data()
            }
            call.resolve(["data": bytes.base64EncodedString()])
        } catch {
            call.reject("read failed: \(error.localizedDescription)")
        }
    }

    @objc func closeRead(_ call: CAPPluginCall) {
        if let id = call.getString("id") { dropRead(id) }
        call.resolve()
    }

    @objc func write(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), let url = target(base, path), let b64 = call.getString("dataBase64"), let data = Data(base64Encoded: b64) else {
                throw NSError(domain: "VaultFolder", code: 2, userInfo: [NSLocalizedDescriptionKey: "path and dataBase64 required"])
            }
            try writeCoordinated(data, to: url)
            call.resolve()
        }
    }

    /** Coordinated and atomic, as a sync client in the same folder expects. */
    private func writeCoordinated(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var coordinatorError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: [.forReplacing], error: &coordinatorError) { writeURL in
            do { try data.write(to: writeURL, options: [.atomic]) } catch { writeError = error }
        }
        if let e = coordinatorError { throw e }
        if let e = writeError { throw e }
    }

    /** A write in parts: they gather in the app's caches; the folder's file is touched only at `commit`. */
    @objc func begin(_ call: CAPPluginCall) {
        dropIdle()
        guard let folder = call.getString("handle"), let path = call.getString("path") else {
            call.reject("handle and path required")
            return
        }
        do {
            let parts = try partsFolder().appendingPathComponent("write-" + UUID().uuidString)
            guard FileManager.default.createFile(atPath: parts.path, contents: nil) else {
                throw NSError(domain: "VaultFolder", code: 8, userInfo: [NSLocalizedDescriptionKey: "could not create the parts file"])
            }
            let handle = try FileHandle(forWritingTo: parts)
            let id = UUID().uuidString
            lock.lock()
            writes[id] = OpenWrite(parts: parts, handle: handle, folder: folder, path: path)
            lock.unlock()
            call.resolve(["id": id])
        } catch {
            call.reject("write failed: \(error.localizedDescription)")
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        lock.lock()
        let id = call.getString("id")
        let write = id.flatMap { writes[$0] }
        lock.unlock()
        guard let write = write, let id = id, let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("no such write")
            return
        }
        do {
            write.lastUsed = Date()
            try write.handle.write(contentsOf: data)
            call.resolve()
        } catch {
            dropWrite(id)
            call.reject("write failed: \(error.localizedDescription)")
        }
    }

    /** Writes the gathered parts over the folder's file, exactly as `write` does with one message. */
    @objc func commit(_ call: CAPPluginCall) {
        lock.lock()
        let write = call.getString("id").flatMap { writes.removeValue(forKey: $0) }
        lock.unlock()
        guard let write = write else {
            call.reject("no such write")
            return
        }
        defer {
            try? write.handle.close()
            try? FileManager.default.removeItem(at: write.parts)
        }
        guard let resolved = folder(for: write.folder) else {
            call.reject("folder access expired")
            return
        }
        do {
            try write.handle.close()
            guard let url = target(resolved.url, write.path) else {
                throw NSError(domain: "VaultFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "path escapes the folder"])
            }
            // Mapped, not loaded: the parts stay on disk until the atomic write copies them.
            try writeCoordinated(try Data(contentsOf: write.parts, options: [.alwaysMapped]), to: url)
            call.resolve()
        } catch {
            let nsError = error as NSError
            call.reject(error.localizedDescription, "\(nsError.domain):\(nsError.code)")
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        if let id = call.getString("id") { dropWrite(id) }
        call.resolve()
    }

    @objc func delete(_ call: CAPPluginCall) {
        withFolder(call) { base in
            guard let path = call.getString("path"), !path.isEmpty, let url = target(base, path), url.standardizedFileURL.path != base.standardizedFileURL.path else {
                throw NSError(domain: "VaultFolder", code: 3, userInfo: [NSLocalizedDescriptionKey: "path required"])
            }
            let recursive = call.getBool("recursive") ?? false
            let entry = try describe(url)
            if entry["isDirectory"] as? Bool == true && !recursive {
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
