import Foundation
import Capacitor
import CryptoKit

/**
 * Atomic file writes for the vault sandbox (hardening plan P2, iOS side —
 * the counterpart of the Android AtomicFilePlugin). Filesystem.writeFile
 * truncates in place, so a kill mid-write can leave a torn or zero-byte
 * note. Instead: write a dot-prefixed temp file in the target directory,
 * F_FULLFSYNC it to disk, then atomically rename it over the destination.
 *
 * Paths are relative to Capacitor's Directory.Data, which on iOS resolves
 * to the Documents directory (Capacitor 8 maps DATA -> .document) — the same
 * root the vault adapter reads and writes through @capacitor/filesystem —
 * or, with `directory: "LIBRARY"`, to Library (Directory.Library), where the
 * app keeps the files that belong to it and not to the person.
 * Targets are standardized and required to stay inside that root (no `..`,
 * no absolute path, no sandbox escape). Capacitor runs plugin methods off
 * the main thread, so the sync never blocks the UI.
 *
 * Large files never cross the bridge in one message (release list: the
 * Android app froze after start, 17.11.; the same calls run here): a file is
 * written in parts - `begin` makes the temp file, `append` adds one part,
 * `commit` syncs and renames it into place, `abort` drops it - and read in
 * parts (`read` with an offset). The target holds the old bytes or all of
 * the new ones, never part of them. A temp file a killed process left is
 * removed by `sweep` at the next start.
 */
@objc(AtomicFilePlugin)
public class AtomicFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AtomicFilePlugin"
    public let jsName = "AtomicFile"
    // A method missing from this list is invisible to the platform, however
    // correct its implementation is — the mail socket plugin proved that once.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sha256", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sweep", returnType: CAPPluginReturnPromise)
    ]

    /** A write in parts: its temp file, its target and the open handle. */
    private struct OpenWrite {
        let temp: URL
        let target: URL
        let handle: FileHandle
    }

    private var openWrites: [String: OpenWrite] = [:]
    private let openLock = NSLock()
    /** The most a single `read` hands back, in bytes (before base64). */
    private static let maxRead = 256 * 1024
    /** A temp file older than this is no write of this process: removed by `sweep`. */
    private static let orphanAge: TimeInterval = 10 * 60

    /** The file below the root `directory` names that `rel` names; nil when it would leave it. */
    private func inSandbox(_ rel: String, _ directory: String) -> URL? {
        let searchPath: FileManager.SearchPathDirectory
        switch directory {
        case "DATA": searchPath = .documentDirectory
        case "LIBRARY": searchPath = .libraryDirectory
        default: return nil
        }
        guard let root = FileManager.default.urls(for: searchPath, in: .userDomainMask).first else { return nil }
        let rootStd = root.standardizedFileURL
        let file = URL(fileURLWithPath: rel, relativeTo: rootStd).standardizedFileURL
        let rootPrefix = rootStd.path.hasSuffix("/") ? rootStd.path : rootStd.path + "/"
        return file.path.hasPrefix(rootPrefix) ? file : nil
    }

    private func takeWrite(_ id: String, remove: Bool) -> OpenWrite? {
        openLock.lock()
        defer { openLock.unlock() }
        return remove ? openWrites.removeValue(forKey: id) : openWrites[id]
    }

    private func dropWrite(_ id: String) {
        guard let write = takeWrite(id, remove: true) else { return }
        try? write.handle.close()
        try? FileManager.default.removeItem(at: write.temp)
    }

    @objc func begin(_ call: CAPPluginCall) {
        guard let rel = call.getString("path") else {
            call.reject("path required")
            return
        }
        guard let target = inSandbox(rel, call.getString("directory") ?? "DATA") else {
            call.reject("path escapes the sandbox")
            return
        }
        let parent = target.deletingLastPathComponent()
        let temp = parent.appendingPathComponent(".plainva-tmp-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
            guard FileManager.default.createFile(atPath: temp.path, contents: nil) else {
                call.reject("atomic write failed: the temp file could not be made")
                return
            }
            let handle = try FileHandle(forWritingTo: temp)
            let id = UUID().uuidString
            openLock.lock()
            openWrites[id] = OpenWrite(temp: temp, target: target, handle: handle)
            openLock.unlock()
            call.resolve(["id": id])
        } catch {
            try? FileManager.default.removeItem(at: temp)
            call.reject("atomic write failed: \(error.localizedDescription)")
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let data = call.getString("data"), let write = takeWrite(id, remove: false) else {
            call.reject("no such write")
            return
        }
        guard let bytes = Data(base64Encoded: data) else {
            dropWrite(id)
            call.reject("invalid base64 data")
            return
        }
        do {
            try write.handle.write(contentsOf: bytes)
            call.resolve()
        } catch {
            dropWrite(id)
            call.reject("atomic write failed: \(error.localizedDescription)")
        }
    }

    @objc func commit(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let write = takeWrite(id, remove: true) else {
            call.reject("no such write")
            return
        }
        do {
            _ = fcntl(write.handle.fileDescriptor, F_FULLFSYNC)
            try write.handle.close()
        } catch {
            try? write.handle.close()
            try? FileManager.default.removeItem(at: write.temp)
            call.reject("atomic write failed: \(error.localizedDescription)")
            return
        }
        if rename(write.temp.path, write.target.path) != 0 {
            let err = String(cString: strerror(errno))
            try? FileManager.default.removeItem(at: write.temp)
            call.reject("atomic rename failed: \(err)")
            return
        }
        call.resolve()
    }

    @objc func abort(_ call: CAPPluginCall) {
        if let id = call.getString("id") { dropWrite(id) }
        call.resolve()
    }

    /** Part of a file: `length` bytes (at most 256 KB) from `offset`, as base64, with the file's size. */
    @objc func read(_ call: CAPPluginCall) {
        guard let rel = call.getString("path") else {
            call.reject("path required")
            return
        }
        let offset = call.getInt("offset") ?? 0
        let length = min(call.getInt("length") ?? AtomicFilePlugin.maxRead, AtomicFilePlugin.maxRead)
        guard offset >= 0, length >= 0, let source = inSandbox(rel, call.getString("directory") ?? "DATA") else {
            call.reject("path escapes the sandbox")
            return
        }
        guard FileManager.default.fileExists(atPath: source.path) else {
            call.reject("File does not exist", "OS-PLUG-FILE-0008")
            return
        }
        do {
            let handle = try FileHandle(forReadingFrom: source)
            defer { try? handle.close() }
            let size = try handle.seekToEnd()
            try handle.seek(toOffset: UInt64(offset))
            let chunk = try handle.read(upToCount: length) ?? Data()
            call.resolve(["data": chunk.base64EncodedString(), "size": size])
        } catch {
            call.reject("read failed: \(error.localizedDescription)")
        }
    }

    /** Removes the temp files a killed process left below `path` (older than ten minutes). */
    @objc func sweep(_ call: CAPPluginCall) {
        guard let rel = call.getString("path"), let folder = inSandbox(rel, call.getString("directory") ?? "DATA") else {
            call.reject("path escapes the sandbox")
            return
        }
        let cutoff = Date().addingTimeInterval(-AtomicFilePlugin.orphanAge)
        var removed = 0
        if let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]) {
            for case let file as URL in walker where file.lastPathComponent.hasPrefix(".plainva-tmp-") {
                let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
                guard values?.isRegularFile == true, let modified = values?.contentModificationDate, modified < cutoff else { continue }
                if (try? FileManager.default.removeItem(at: file)) != nil { removed += 1 }
            }
        }
        call.resolve(["removed": removed])
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let rel = call.getString("path"), let data = call.getString("data") else {
            call.reject("path and data required")
            return
        }
        let encoding = call.getString("encoding") ?? "utf8"

        // "LIBRARY" for the app's own files, which the Files app must not show
        // (src/platform/internalFiles.ts); Directory.Data (Documents) otherwise.
        let directory = call.getString("directory") ?? "DATA"
        let searchPath: FileManager.SearchPathDirectory
        switch directory {
        case "DATA": searchPath = .documentDirectory
        case "LIBRARY": searchPath = .libraryDirectory
        default:
            call.reject("unknown directory \(directory)")
            return
        }
        guard let root = FileManager.default.urls(for: searchPath, in: .userDomainMask).first
        else {
            call.reject("no \(directory) directory")
            return
        }
        let rootStd = root.standardizedFileURL
        let target = URL(fileURLWithPath: rel, relativeTo: rootStd).standardizedFileURL
        let rootPrefix = rootStd.path.hasSuffix("/") ? rootStd.path : rootStd.path + "/"
        guard target.path.hasPrefix(rootPrefix) else {
            call.reject("path escapes the sandbox")
            return
        }

        let bytes: Data
        if encoding == "base64" {
            guard let decoded = Data(base64Encoded: data) else {
                call.reject("invalid base64 data")
                return
            }
            bytes = decoded
        } else {
            bytes = Data(data.utf8)
        }

        let parent = target.deletingLastPathComponent()
        let temp = parent.appendingPathComponent(".plainva-tmp-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: temp.path, contents: nil)
            let handle = try FileHandle(forWritingTo: temp)
            do {
                try handle.write(contentsOf: bytes)
                // F_FULLFSYNC flushes the drive cache — stronger than fsync,
                // which iOS/APFS may otherwise satisfy from the buffer cache.
                _ = fcntl(handle.fileDescriptor, F_FULLFSYNC)
                try handle.close()
            } catch {
                try? handle.close()
                throw error
            }
        } catch {
            try? FileManager.default.removeItem(at: temp)
            call.reject("atomic write failed: \(error.localizedDescription)")
            return
        }

        // POSIX rename atomically replaces an existing destination on the same
        // filesystem (temp lives in the target's directory).
        if rename(temp.path, target.path) != 0 {
            let err = String(cString: strerror(errno))
            try? FileManager.default.removeItem(at: temp)
            call.reject("atomic rename failed: \(err)")
            return
        }
        call.resolve()
    }

    /**
     * Content hash of a vault file, computed while streaming it (issue #48).
     *
     * The sync needs the hash of every pushed file. Reading a 90 MB attachment
     * into the WebView just to hash it is exactly the memory peak the streamed
     * upload exists to avoid — so the hash is taken here, in one pass, and the
     * bytes never leave the native side.
     */
    @objc func sha256(_ call: CAPPluginCall) {
        guard let rel = call.getString("path") else {
            call.reject("path required")
            return
        }
        guard let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else {
            call.reject("no documents directory")
            return
        }
        let rootStd = root.standardizedFileURL
        let source = URL(fileURLWithPath: rel, relativeTo: rootStd).standardizedFileURL
        let rootPrefix = rootStd.path.hasSuffix("/") ? rootStd.path : rootStd.path + "/"
        guard source.path.hasPrefix(rootPrefix) else {
            call.reject("path escapes the sandbox")
            return
        }
        do {
            let handle = try FileHandle(forReadingFrom: source)
            defer { try? handle.close() }
            var hasher = SHA256()
            var size = 0
            while true {
                guard let chunk = try handle.read(upToCount: 256 * 1024), !chunk.isEmpty else { break }
                hasher.update(data: chunk)
                size += chunk.count
            }
            let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            call.resolve(["sha256": hex, "size": size])
        } catch {
            call.reject("hash failed: \(error.localizedDescription)")
        }
    }
}
