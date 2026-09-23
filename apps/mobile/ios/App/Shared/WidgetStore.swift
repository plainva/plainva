import Foundation

/**
 * The two files a home-screen widget lives on, iOS side (plan Widgets, W2).
 *
 * The counterpart of `WidgetStore.java`, and the same two rules. `snapshot.json`
 * is what the app worked out the last time it ran — no JavaScript runs while
 * Plainva is closed, so a widget can compute nothing and only draws this.
 * `actions.json` runs the other way: a tick made on the home screen is an
 * ORDER, which the app redeems when it next opens, because ticking a task off
 * means the database's completion model, the recurrence and the provider sync,
 * and none of that exists in Swift.
 *
 * Unlike Android, the widget here is a SEPARATE PROCESS. Both files therefore
 * live in the App Group container, beside `share-inbox-v1`, and every access
 * takes the same `flock` the share queue uses — the extension and the app can
 * genuinely write at the same moment.
 *
 * Every public method takes that lock exactly ONCE, around private helpers
 * that never take it. `flock` is not reentrant the way a Java monitor is: a
 * second `open` + `LOCK_EX` from the same process waits for a lock the same
 * thread is holding, and the widget hangs rather than drawing. So the rule
 * here is structural — a `_`-prefixed helper assumes the lock is held and
 * never calls a public method.
 *
 * File protection is `completeUntilFirstUserAuthentication`, not `complete`:
 * a lock-screen widget has to render while the device is locked. What that
 * admits is bounded by what the snapshot carries — a title, a day, a time, an
 * index; never note text, never a path, and nothing at all while the
 * workspace is sealed.
 */
public enum WidgetStoreFailure: Error {
    case storage
}

public final class WidgetStore {
    /** A tick older than this was made against a snapshot nobody can resolve any more. */
    static let actionTTLms: Int64 = 7 * 24 * 60 * 60 * 1000
    /** A bound on a file two processes read: orders pile up only while the app is never opened. */
    static let maxActions = 200
    static let maxSnapshotBytes = 256 * 1024

    public static let appGroup = "group.com.plainva.app"

    let root: URL
    private let fm = FileManager.default

    public init(root: URL? = nil) throws {
        guard let location = root ?? FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetStore.appGroup)?.appendingPathComponent("widget-v1", isDirectory: true) else {
            throw WidgetStoreFailure.storage
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

    private var snapshotURL: URL { root.appendingPathComponent("snapshot.json") }
    private var actionsURL: URL { root.appendingPathComponent("actions.json") }

    /** One lock file for both, so a tick and a fresh snapshot never interleave. */
    private func locked<T>(_ action: () throws -> T) throws -> T {
        let fd = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw WidgetStoreFailure.storage }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw WidgetStoreFailure.storage }
        defer { flock(fd, LOCK_UN) }
        return try action()
    }

    // ------------------------------------------------- helpers, lock held

    /** Temp file, fsync, rename: a kill mid-write never leaves a half-file. */
    private func _write(_ url: URL, _ text: String) throws {
        let temporary = root.appendingPathComponent("." + url.lastPathComponent + "-" + UUID().uuidString)
        defer { if fm.fileExists(atPath: temporary.path) { try? fm.removeItem(at: temporary) } }
        guard let data = text.data(using: .utf8) else { throw WidgetStoreFailure.storage }
        #if os(iOS)
        try data.write(to: temporary, options: [.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: temporary)
        #endif
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        if fcntl(handle.fileDescriptor, F_FULLFSYNC) != 0 {
            guard fsync(handle.fileDescriptor) == 0 else { throw WidgetStoreFailure.storage }
        }
        guard rename(temporary.path, url.path) == 0 else { throw WidgetStoreFailure.storage }
    }

    private func _read(_ url: URL) -> String? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= WidgetStore.maxSnapshotBytes else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private func _object(_ url: URL) -> [String: Any]? {
        guard let raw = _read(url), let data = raw.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func _writtenAt() -> Int64 {
        ((_object(snapshotURL)?["writtenAt"]) as? NSNumber)?.int64Value ?? 0
    }

    private func _actions() -> [[String: Any]] {
        guard let root = _object(actionsURL), root["version"] as? Int == 1,
              let actions = root["actions"] as? [[String: Any]] else { return [] }
        return actions
    }

    private func _nextId() -> Int64 {
        max(1, ((_object(actionsURL)?["nextId"]) as? NSNumber)?.int64Value ?? 1)
    }

    private func _saveActions(_ actions: [[String: Any]], nextId: Int64) throws {
        let root: [String: Any] = ["version": 1, "nextId": NSNumber(value: nextId), "actions": actions]
        let data = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
        guard let text = String(data: data, encoding: .utf8) else { throw WidgetStoreFailure.storage }
        try _write(actionsURL, text)
    }

    // ------------------------------------------------------------- snapshot

    public func writeSnapshot(_ json: String) throws {
        try locked { try _write(snapshotURL, json) }
    }

    public func readSnapshot() -> String? {
        (try? locked { _read(snapshotURL) }) ?? nil
    }

    public func clearSnapshot() {
        try? locked { try? fm.removeItem(at: snapshotURL) }
    }

    /** When the app wrote the snapshot on disk — what an order has to name. */
    public func snapshotWrittenAt() -> Int64 {
        (try? locked { _writtenAt() }) ?? 0
    }

    // --------------------------------------------------------------- orders

    /**
     * Records a tick against the snapshot currently on disk; answers the
     * order's id, or 0 when there was nothing to record.
     */
    @discardableResult
    public func enqueue(index: Int, at: Int64) -> Int64 {
        (try? locked { () -> Int64 in
            let snapshotAt = _writtenAt()
            guard snapshotAt != 0, index >= 0 else { return 0 }
            var kept: [[String: Any]] = []
            for action in _actions() {
                // The same row tapped twice is one tick, not two.
                if (action["snapshotAt"] as? NSNumber)?.int64Value == snapshotAt, (action["index"] as? NSNumber)?.intValue == index {
                    return (action["id"] as? NSNumber)?.int64Value ?? 0
                }
                // An order whose snapshot is long gone can no longer name a row.
                let made = (action["at"] as? NSNumber)?.int64Value ?? 0
                if at - made > WidgetStore.actionTTLms { continue }
                kept.append(action)
            }
            guard kept.count < WidgetStore.maxActions else { return 0 }
            let id = _nextId()
            kept.append(["id": NSNumber(value: id), "index": NSNumber(value: index), "snapshotAt": NSNumber(value: snapshotAt), "at": NSNumber(value: at)])
            try _saveActions(kept, nextId: id + 1)
            return id
        }) ?? 0
    }

    /** Every order still waiting, as the bridge hands it to JavaScript. */
    public func pendingActions() -> [[String: Any]] {
        (try? locked { _actions() }) ?? []
    }

    /** Drops the orders the app has redeemed — by id, never wholesale. */
    public func clearActions(ids: Set<Int64>) {
        try? locked {
            // A tap between the app's read and this call has to survive it.
            let kept = _actions().filter { !ids.contains(($0["id"] as? NSNumber)?.int64Value ?? -1) }
            try? _saveActions(kept, nextId: _nextId())
        }
    }

    /**
     * Which rows of the CURRENT snapshot carry a tick the app has not redeemed
     * — what lets the widget show the tick the moment it is made.
     */
    public func pendingIndexes() -> Set<Int> {
        (try? locked { () -> Set<Int> in
            let snapshotAt = _writtenAt()
            guard snapshotAt != 0 else { return [] }
            var out: Set<Int> = []
            for action in _actions() where (action["snapshotAt"] as? NSNumber)?.int64Value == snapshotAt {
                if let index = (action["index"] as? NSNumber)?.intValue, index >= 0 { out.insert(index) }
            }
            return out
        }) ?? []
    }
}
