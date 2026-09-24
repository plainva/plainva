import Foundation
import CryptoKit
import Darwin

enum ShareQueueFailure: String, Error {
    case invalid = "SHARE_INVALID", storage = "SHARE_STORAGE", limit = "SHARE_LIMIT"
    case full = "SHARE_QUEUE_FULL", incomplete = "SHARE_INCOMPLETE", type = "SHARE_TYPE"
}

/** Shared by the extension and host. flock serializes their atomic manifests;
 * attachment bytes never travel inside a manifest or a whole-file JS payload. */
final class ShareQueueStore {
    static let fileLimit = 25 * 1024 * 1024, entryLimit = 50 * 1024 * 1024
    static let textLimit = 512 * 1024, chunkLimit = 256 * 1024
    /// From Info.plist, like WidgetStore.appGroup: the Labs build has its own group.
    static let appGroup = Bundle.main.object(forInfoDictionaryKey: "PlainvaAppGroup") as? String ?? "group.com.plainva.app"
    let root: URL
    private let fm = FileManager.default

    init(root: URL? = nil) throws {
        guard let location = root ?? FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareQueueStore.appGroup)?.appendingPathComponent("share-inbox-v1", isDirectory: true) else { throw ShareQueueFailure.storage }
        self.root = location
        try fm.createDirectory(at: location, withIntermediateDirectories: true)
        #if os(iOS)
        try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: location.path)
        #endif
        var url = location; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }
    private func validId(_ id: String) throws -> String {
        guard id.range(of: "^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$", options: .regularExpression) != nil else { throw ShareQueueFailure.invalid }
        return id
    }
    private func directory(_ id: String) throws -> URL { root.appendingPathComponent(try validId(id), isDirectory: true) }
    private func locked<T>(_ action: () throws -> T) throws -> T {
        let fd = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw ShareQueueFailure.storage }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw ShareQueueFailure.storage }
        defer { flock(fd, LOCK_UN) }
        return try action()
    }
    private func syncDirectory(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY)
        guard fd >= 0 else { throw ShareQueueFailure.storage }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw ShareQueueFailure.storage }
    }
    private func save(_ entry: [String: Any]) throws {
        guard let id = entry["id"] as? String else { throw ShareQueueFailure.invalid }
        let folder = try directory(id)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
        guard data.count <= 8 * 1024 * 1024 else { throw ShareQueueFailure.limit }
        let temporary = folder.appendingPathComponent(".manifest-" + UUID().uuidString)
        defer { if fm.fileExists(atPath: temporary.path) { try? fm.removeItem(at: temporary) } }
        #if os(iOS)
        try data.write(to: temporary, options: .completeFileProtection)
        #else
        try data.write(to: temporary)
        #endif
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        if fcntl(handle.fileDescriptor, F_FULLFSYNC) != 0 { guard fsync(handle.fileDescriptor) == 0 else { throw ShareQueueFailure.storage } }
        guard rename(temporary.path, folder.appendingPathComponent("manifest.json").path) == 0 else { throw ShareQueueFailure.storage }
        try syncDirectory(folder); try syncDirectory(root)
    }
    private func read(_ id: String) throws -> [String: Any] {
        let folder = try directory(id), url = folder.appendingPathComponent("manifest.json")
        // A terminated first save can leave the directory without a manifest.
        // Preserve its payload and make the incomplete transfer dismissible.
        if fm.fileExists(atPath: folder.path), !fm.fileExists(atPath: url.path) {
            let created = (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date()
            let interrupted: [String: Any] = ["version": 1, "id": id, "createdAt": Int64(created.timeIntervalSince1970 * 1000), "status": "failed", "failure": "SHARE_INTERRUPTED", "text": "", "subject": "", "files": []]
            try save(interrupted); return interrupted
        }
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 8 * 1024 * 1024 else { throw ShareQueueFailure.invalid }
        guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any], value["id"] as? String == id, value["version"] as? Int == 1 else { throw ShareQueueFailure.invalid }
        return value
    }
    private func directories() throws -> [URL] {
        try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]).filter { try $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true }
    }
    private func finished(_ entry: [String: Any]) -> Bool { ["completed", "discarded"].contains(entry["status"] as? String ?? "") }
    private func cleanup(_ id: String) throws {
        let dir = try directory(id)
        for url in try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) where url.lastPathComponent != "manifest.json" {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true, url.deletingLastPathComponent().standardizedFileURL == dir.standardizedFileURL else { throw ShareQueueFailure.invalid }
            try fm.removeItem(at: url)
        }
    }
    func begin(subject: String) throws -> String {
        try locked {
            guard subject.utf8.count <= Self.textLimit else { throw ShareQueueFailure.limit }
            var count = 0, reserved = 0
            for dir in try directories() {
                let entry = try read(dir.lastPathComponent)
                if finished(entry) { continue }
                count += 1
                if entry["status"] as? String == "receiving" { reserved += Self.entryLimit }
                else {
                    for file in try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey]) where file.pathExtension == "bin" { reserved += try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 }
                }
            }
            guard count < 20, reserved + Self.entryLimit <= 200 * 1024 * 1024 else { throw ShareQueueFailure.full }
            let id = UUID().uuidString.lowercased()
            try save(["version": 1, "id": id, "createdAt": Int64(Date().timeIntervalSince1970 * 1000), "status": "receiving", "ownerPid": getpid(), "text": "", "subject": subject, "files": []])
            return id
        }
    }
    func appendText(_ id: String, text: String) throws {
        try locked {
            var entry = try read(id)
            guard entry["status"] as? String == "receiving" else { throw ShareQueueFailure.invalid }
            let combined = [entry["text"] as? String ?? "", text].filter { !$0.isEmpty }.joined(separator: "\n")
            guard combined.utf8.count + (entry["subject"] as? String ?? "").utf8.count <= Self.textLimit else { throw ShareQueueFailure.limit }
            entry["text"] = combined; try save(entry)
        }
    }
    func appendFile(_ id: String, source: URL, name: String, mime: String) throws {
        try locked {
            var entry = try read(id)
            var files = entry["files"] as? [[String: Any]] ?? []
            let type = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard entry["status"] as? String == "receiving", source.isFileURL, type.isRegularFile == true, type.isSymbolicLink != true else { throw ShareQueueFailure.type }
            guard files.count < 10, name.utf16.count <= 512, mime.utf16.count <= 256 else { throw ShareQueueFailure.limit }
            let total = files.reduce(0) { $0 + ($1["size"] as? Int ?? 0) }
            let fileId = UUID().uuidString.lowercased()
            // A UUID file ID, independent of the provider's path or display name.
            let destination = try directory(id).appendingPathComponent(fileId + ".bin")
            guard fm.createFile(atPath: destination.path, contents: nil) else { throw ShareQueueFailure.storage }
            #if os(iOS)
            try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
            #endif
            let input = try FileHandle(forReadingFrom: source), output = try FileHandle(forWritingTo: destination)
            defer { try? input.close(); try? output.close() }
            var size = 0, hash = SHA256()
            while let bytes = try input.read(upToCount: 64 * 1024), !bytes.isEmpty {
                size += bytes.count
                guard size <= Self.fileLimit, total + size <= Self.entryLimit else { throw ShareQueueFailure.limit }
                try output.write(contentsOf: bytes); hash.update(data: bytes)
            }
            if fcntl(output.fileDescriptor, F_FULLFSYNC) != 0 { guard fsync(output.fileDescriptor) == 0 else { throw ShareQueueFailure.storage } }
            files.append(["id": fileId, "name": name, "mime": mime, "size": size, "sha256": hash.finalize().map { String(format: "%02x", $0) }.joined()])
            entry["files"] = files; try save(entry)
        }
    }
    func finishStaging(_ id: String) throws {
        try locked {
            var entry = try read(id)
            guard entry["status"] as? String == "receiving", !(entry["text"] as? String ?? "").isEmpty || !(entry["files"] as? [Any] ?? []).isEmpty else { throw ShareQueueFailure.incomplete }
            entry["status"] = "ready"; entry.removeValue(forKey: "ownerPid"); try save(entry)
        }
    }
    func failStaging(_ id: String, code: String) throws {
        try locked { var entry = try read(id); if finished(entry) { return }; entry["status"] = "failed"; entry["failure"] = code; entry.removeValue(forKey: "ownerPid"); try save(entry) }
    }
    func list() throws -> [[String: Any]] {
        try locked {
            var entries: [[String: Any]] = []
            for dir in try directories() {
                var entry = try read(dir.lastPathComponent)
                if finished(entry) { try cleanup(dir.lastPathComponent); continue }
                if entry["status"] as? String == "receiving", let pid = entry["ownerPid"] as? Int32, kill(pid, 0) != 0, errno == ESRCH {
                    entry["status"] = "failed"; entry["failure"] = "SHARE_INTERRUPTED"; try save(entry)
                }
                entries.append(entry)
            }
            return entries.sorted { ($0["createdAt"] as? Int64 ?? 0) < ($1["createdAt"] as? Int64 ?? 0) }
        }
    }
    func beginImport(_ id: String, plan: [String: Any]) throws -> [String: Any] {
        try locked {
            var entry = try read(id)
            guard entry["status"] as? String == "ready" else { throw ShareQueueFailure.incomplete }
            if entry["plan"] == nil {
                guard try JSONSerialization.data(withJSONObject: plan).count <= 4 * 1024 * 1024 else { throw ShareQueueFailure.limit }
                entry["plan"] = plan; try save(entry)
            }
            return entry
        }
    }
    func mark(_ id: String, fileId: String?, note: Bool) throws {
        try locked {
            var entry = try read(id)
            guard entry["status"] as? String == "ready", entry["plan"] != nil else { throw ShareQueueFailure.invalid }
            var done = entry["filesDone"] as? [String] ?? []
            let files = entry["files"] as? [[String: Any]] ?? []
            if note {
                guard done.count == files.count else { throw ShareQueueFailure.incomplete }
                entry["noteWritten"] = true
            } else {
                guard let fileId, files.contains(where: { $0["id"] as? String == fileId }) else { throw ShareQueueFailure.invalid }
                if !done.contains(fileId) { done.append(fileId) }; entry["filesDone"] = done
            }
            try save(entry)
        }
    }
    func chunk(_ id: String, fileId: String, offset: Int, length: Int) throws -> String {
        try locked {
            let entry = try read(id)
            guard entry["status"] as? String == "ready", offset >= 0, length >= 0, length <= Self.chunkLimit,
                  let file = (entry["files"] as? [[String: Any]])?.first(where: { $0["id"] as? String == fileId }), let size = file["size"] as? Int, offset <= size - length else { throw ShareQueueFailure.invalid }
            let url = try directory(id).appendingPathComponent(try validId(fileId) + ".bin"), handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: UInt64(offset))
            let bytes = try handle.read(upToCount: length) ?? Data()
            guard bytes.count == length else { throw ShareQueueFailure.incomplete }
            return bytes.base64EncodedString()
        }
    }
    func finish(_ id: String, discard: Bool) throws {
        try locked {
            let entry = try read(id)
            if !finished(entry) {
                guard discard || entry["noteWritten"] as? Bool == true else { throw ShareQueueFailure.incomplete }
                try save(["version": 1, "id": id, "createdAt": entry["createdAt"] ?? 0, "status": discard ? "discarded" : "completed"])
            }
            try cleanup(id)
        }
    }
}
