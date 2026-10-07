import Foundation

/**
 * The two files the system's assistant lives on (AI harness P4.7).
 *
 * Siri and Shortcuts reach Plainva through App Intents, and an intent runs
 * natively — also while the app is closed, when no JavaScript runs. So an
 * intent works nothing out and writes nothing into the vault; it reads one file
 * and appends to another, the way a home-screen widget does (`WidgetStore`).
 *
 * `notes.json` is the DIRECTORY: the titles the system may know, written by
 * the app while it ran. Which notes are in it is the app's decision — the
 * privacy gate, the device's switch — and never this file's: it holds a
 * title, a folder's name and a key per row, no path and no text, and nothing
 * at all for an encrypted workspace. Its file protection is `complete`: while the device is
 * locked it cannot be read, so nothing is found by a voice at a locked phone.
 *
 * `orders.json` runs the other way: what somebody asked for — open this row,
 * search for these words, note this in the journal, add this task — with the
 * moment it was asked. The app redeems an order when it next comes to the
 * front, through its own write paths. This file is protected until the first
 * unlock only: the intents ask for an authenticated person, and that can be
 * somebody a watch or a car vouches for while the phone itself is locked.
 *
 * Every public method takes the lock exactly once, around private helpers
 * that never take it (`flock` is not reentrant; see `WidgetStore`).
 */
public enum IntentStoreFailure: Error {
    case storage
}

/** One row of the directory. */
public struct IntentNote: Equatable {
    /**
     * The note's key: what an order names and what a saved shortcut remembers.
     * A fingerprint of the path under a secret only the app has — never a
     * path, and the same for as long as the note stays where it is.
     */
    public let key: String
    public let title: String
    /** The name of the folder the note lies in, where it lies in one. */
    public let folder: String?

    public init(key: String, title: String, folder: String?) {
        self.key = key
        self.title = title
        self.folder = folder
    }
}

public struct IntentDirectoryFile: Equatable {
    /** When the app wrote it, ms since the epoch. */
    public let writtenAt: Int64
    public let vault: String
    public let notes: [IntentNote]
}

public final class IntentStore {
    static let version = 1
    static let maxDirectoryBytes = 1024 * 1024
    static let maxNotes = 2000
    static let maxOrders = 100
    /** A sentence somebody spoke, not a document. */
    static let maxTextScalars = 2000
    public static let kinds: Set<String> = ["open", "search", "journal", "task"]
    /** What somebody asked to have WRITTEN. Nothing here ever drops one: only the app takes it out, by writing it. */
    static let captures: Set<String> = ["journal", "task"]

    /// The App Group, from Info.plist (`PlainvaAppGroup`): the Labs build has its own.
    public static let appGroup = Bundle.main.object(forInfoDictionaryKey: "PlainvaAppGroup") as? String ?? "group.com.plainva.app"

    let root: URL
    private let fm = FileManager.default

    public init(root: URL? = nil) throws {
        guard let location = root ?? FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: IntentStore.appGroup)?.appendingPathComponent("intents-v1", isDirectory: true) else {
            throw IntentStoreFailure.storage
        }
        self.root = location
        try fm.createDirectory(at: location, withIntermediateDirectories: true)
        #if os(iOS)
        try? fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: location.path)
        #endif
        var url = location
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    private var directoryURL: URL { root.appendingPathComponent("notes.json") }
    private var ordersURL: URL { root.appendingPathComponent("orders.json") }

    private func locked<T>(_ action: () throws -> T) throws -> T {
        let fd = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw IntentStoreFailure.storage }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw IntentStoreFailure.storage }
        defer { flock(fd, LOCK_UN) }
        return try action()
    }

    // ------------------------------------------------- helpers, lock held

    /** Temp file, fsync, rename: a kill mid-write never leaves a half-file. `sealed` files cannot be read while the device is locked. */
    private func _write(_ url: URL, _ text: String, sealed: Bool) throws {
        let temporary = root.appendingPathComponent("." + url.lastPathComponent + "-" + UUID().uuidString)
        defer { if fm.fileExists(atPath: temporary.path) { try? fm.removeItem(at: temporary) } }
        guard let data = text.data(using: .utf8) else { throw IntentStoreFailure.storage }
        #if os(iOS)
        try data.write(to: temporary, options: sealed ? [.completeFileProtection] : [.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: temporary)
        #endif
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        if fcntl(handle.fileDescriptor, F_FULLFSYNC) != 0 {
            guard fsync(handle.fileDescriptor) == 0 else { throw IntentStoreFailure.storage }
        }
        guard rename(temporary.path, url.path) == 0 else { throw IntentStoreFailure.storage }
    }

    private func _object(_ url: URL, limit: Int) -> [String: Any]? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= limit,
              let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func _orders() -> [[String: Any]] {
        guard let root = _object(ordersURL, limit: IntentStore.maxDirectoryBytes), root["version"] as? Int == IntentStore.version,
              let orders = root["orders"] as? [[String: Any]] else { return [] }
        return orders
    }

    private func _nextId() -> Int64 {
        max(1, ((_object(ordersURL, limit: IntentStore.maxDirectoryBytes)?["nextId"]) as? NSNumber)?.int64Value ?? 1)
    }

    private func _saveOrders(_ orders: [[String: Any]], nextId: Int64) throws {
        let root: [String: Any] = ["version": IntentStore.version, "nextId": NSNumber(value: nextId), "orders": orders]
        let data = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
        guard let text = String(data: data, encoding: .utf8) else { throw IntentStoreFailure.storage }
        try _write(ordersURL, text, sealed: false)
    }

    // ------------------------------------------------------------ directory

    /** What the app worked out. Refused where it is no directory of this version: nothing half-understood is kept for a voice to read. */
    public func writeDirectory(_ json: String) throws {
        guard json.utf8.count <= IntentStore.maxDirectoryBytes, IntentStore.parseDirectory(json) != nil else { throw IntentStoreFailure.storage }
        try locked { try _write(directoryURL, json, sealed: true) }
    }

    /** Wipes it. Throws where the file is still there afterwards — the app must know that titles are left behind. */
    public func clearDirectory() throws {
        try locked {
            if fm.fileExists(atPath: directoryURL.path) { try fm.removeItem(at: directoryURL) }
        }
    }

    /** The directory on disk, or nil: none was written, the device is locked, or it is not one. */
    public func readDirectory() -> IntentDirectoryFile? {
        (try? locked { () -> IntentDirectoryFile? in
            guard let size = try? directoryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= IntentStore.maxDirectoryBytes,
                  let text = try? String(contentsOf: directoryURL, encoding: .utf8) else { return nil }
            return IntentStore.parseDirectory(text)
        }) ?? nil
    }

    /** Reads a directory as the app writes it (`systemIntents.ts`). Total: anything else is nil. */
    public static func parseDirectory(_ json: String) -> IntentDirectoryFile? {
        guard let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              root["version"] as? Int == IntentStore.version,
              let writtenAt = (root["writtenAt"] as? NSNumber)?.int64Value, writtenAt > 0,
              let vault = root["vault"] as? String,
              let rows = root["notes"] as? [[String: Any]], rows.count <= IntentStore.maxNotes else { return nil }
        var notes: [IntentNote] = []
        notes.reserveCapacity(rows.count)
        for row in rows {
            guard let key = row["k"] as? String, IntentStore.isKey(key),
                  let title = row["t"] as? String, !title.isEmpty else { return nil }
            let folder = row["f"] as? String
            notes.append(IntentNote(key: key, title: title, folder: (folder?.isEmpty ?? true) ? nil : folder))
        }
        return IntentDirectoryFile(writtenAt: writtenAt, vault: vault, notes: notes)
    }

    /** What a key looks like: sixteen hex digits. Anything else is no key, wherever it comes from. */
    public static func isKey(_ text: String) -> Bool {
        text.utf8.count == 16 && text.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }

    // --------------------------------------------------------------- orders

    /** What somebody said, as it may be kept: nothing invisible, its line breaks, a bounded length. */
    public static func cleanText(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        var count = 0
        for scalar in text.unicodeScalars {
            if count >= IntentStore.maxTextScalars { break }
            if scalar == "\n" {
                out.append(scalar)
            } else if scalar.properties.generalCategory == .control || scalar.properties.generalCategory == .format
                        || scalar.properties.generalCategory == .lineSeparator || scalar.properties.generalCategory == .paragraphSeparator {
                out.append(" ")
            } else {
                out.append(scalar)
            }
            count += 1
        }
        return String(out).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /**
     * Records an order; answers its id, or 0 where there was nothing to
     * record — an unknown kind, no words where words are the order, a full
     * queue. `key` names the note that was chosen (kind "open"); its title
     * travels as `text`, for the app to search for where the key no longer
     * means a note.
     *
     * Two kinds of order, two rules. What somebody asked to have WRITTEN
     * waits for as long as it takes: it is never dropped for its age, and a
     * queue that is full of such words takes no more and says so. Somewhere
     * to GO is about now, and only the last place counts — a new one takes
     * the place of the one before, so there is always room for it.
     */
    @discardableResult
    public func enqueue(kind: String, text: String, key: String? = nil, at: Int64) -> Int64 {
        guard IntentStore.kinds.contains(kind) else { return 0 }
        let words = IntentStore.cleanText(text)
        let capture = IntentStore.captures.contains(kind)
        if capture && words.isEmpty { return 0 }
        return (try? locked { () -> Int64 in
            let waiting = _orders()
            let kept = capture ? waiting : waiting.filter { IntentStore.captures.contains($0["kind"] as? String ?? "") }
            // One row stays free for a place to go, so that a full queue never keeps a note from being opened.
            if capture && kept.filter({ IntentStore.captures.contains($0["kind"] as? String ?? "") }).count >= IntentStore.maxOrders - 1 { return 0 }
            let id = _nextId()
            var order: [String: Any] = ["id": NSNumber(value: id), "kind": kind, "at": NSNumber(value: at), "text": words]
            if kind == "open", let key = key, IntentStore.isKey(key) {
                order["key"] = key
            }
            try _saveOrders(kept + [order], nextId: id + 1)
            return id
        }) ?? 0
    }

    /** Every order still waiting, as the bridge hands it to JavaScript. */
    public func pendingOrders() -> [[String: Any]] {
        (try? locked { _orders() }) ?? []
    }

    /** Drops the orders the app has dealt with — by id, never wholesale: one that arrived in between survives. */
    public func clearOrders(ids: Set<Int64>) {
        try? locked {
            let kept = _orders().filter { !ids.contains(($0["id"] as? NSNumber)?.int64Value ?? -1) }
            try? _saveOrders(kept, nextId: _nextId())
        }
    }
}

/** Which rows of a directory somebody means by what they said. */
public enum IntentSearch {
    /** Text as it is compared: without case, accents or width, with single spaces. */
    public static func fold(_ text: String) -> String {
        let folded = text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
        return folded.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /**
     * The rows that match, the best first: the title itself, a title that
     * begins with the words, a title whose words begin with each of them, a
     * title that contains them. Within one rank the directory's own order
     * stays — the notes changed last come first.
     */
    public static func matches(_ query: String, in notes: [IntentNote], limit: Int = 12) -> [IntentNote] {
        let wanted = fold(query)
        guard !wanted.isEmpty, limit > 0 else { return [] }
        let tokens = wanted.split(separator: " ").map(String.init)
        var ranked: [(rank: Int, row: Int, note: IntentNote)] = []
        for (row, note) in notes.enumerated() {
            let title = fold(note.title)
            let rank: Int
            if title == wanted {
                rank = 0
            } else if title.hasPrefix(wanted) {
                rank = 1
            } else {
                let words = title.split(separator: " ").map(String.init)
                if tokens.allSatisfy({ token in words.contains(where: { $0.hasPrefix(token) }) }) {
                    rank = 2
                } else if title.contains(wanted) {
                    rank = 3
                } else {
                    continue
                }
            }
            ranked.append((rank, row, note))
        }
        // `sorted` is not stable in every Swift version: the row breaks ties.
        return ranked.sorted { $0.rank != $1.rank ? $0.rank < $1.rank : $0.row < $1.row }.prefix(limit).map { $0.note }
    }
}
