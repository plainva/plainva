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
 * root the vault adapter reads and writes through @capacitor/filesystem.
 * Targets are standardized and required to stay inside that root (no `..`,
 * no absolute path, no sandbox escape). Capacitor runs plugin methods off
 * the main thread, so the sync never blocks the UI.
 */
@objc(AtomicFilePlugin)
public class AtomicFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AtomicFilePlugin"
    public let jsName = "AtomicFile"
    // A method missing from this list is invisible to the platform, however
    // correct its implementation is — the mail socket plugin proved that once.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sha256", returnType: CAPPluginReturnPromise)
    ]

    @objc func write(_ call: CAPPluginCall) {
        guard let rel = call.getString("path"), let data = call.getString("data") else {
            call.reject("path and data required")
            return
        }
        let encoding = call.getString("encoding") ?? "utf8"

        guard let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else {
            call.reject("no documents directory")
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
