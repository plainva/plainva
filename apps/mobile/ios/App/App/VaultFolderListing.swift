import Foundation

/**
 * One folder of a picked vault folder, listed by the rules of the desktop's
 * walk (`vault_walk.rs`, issue #72) — the iPhone's half of issue #125.
 *
 * The folder plugin described every entry by its own resource values. A link
 * read that way is a small file: a link to a folder was "read" as a file and
 * its folder never walked, a link to a file carried the link's size and time
 * instead of the file's, and a link to a place that is not on this device —
 * a folder that exists only on the Mac that made the link, synced by iCloud
 * as a link — was a file whose every read failed. That one read stopped the
 * whole first scan of the reporter's vault.
 *
 *  - A link stands for what it points at: a folder is walked, a file carries
 *    its own size and times. The resolved kind wins, as on the desktop, and
 *    the entry says it is a link (`link`): a backup leaves it out, as the
 *    desktop's does.
 *  - A link that points nowhere, and anything neither file nor folder (a
 *    socket, a FIFO), is not listed; it is named, reason `unreadable`, so the
 *    index can say what it left out — and protect what lies under it.
 *  - A folder carries its identity (device and inode, what the desktop
 *    compares), so the walk above can cut a link that leads back into a folder
 *    it is already in, and report the cut as a `cycle`.
 *  - A name with a backslash cannot be addressed by the vault's paths: named,
 *    not listed (the desktop does the same).
 *
 * Foundation only, so the rules can be tested without the app
 * (`tests/VaultFolderListingTests.swift`, run in CI).
 */
enum VaultFolderListing {
    static let keys: Set<URLResourceKey> = [
        .isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey,
        .fileSizeKey, .contentModificationDateKey, .creationDateKey, .nameKey,
    ]

    /**
     * One entry as a walk sees it. A skipped one says what kind it is: a link
     * that points nowhere (`link`), neither file nor folder (`special`), a name
     * the vault's paths cannot address (`name`), or one whose values could not
     * be read (`unreadable`). The walk of the vault names them all; a backup
     * leaves the first two out, as the desktop's does, and fails on the others.
     */
    enum Item {
        case entry([String: Any])
        case skipped(kind: String)
    }

    /** The entries of `dir`, the names it could not list, and the folder's own identity. */
    static func list(_ dir: URL) throws -> [String: Any] {
        let urls = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: Array(keys), options: [])
        var entries: [[String: Any]] = []
        var skipped: [[String: Any]] = []
        for url in urls {
            switch item(url) {
            case .entry(let entry): entries.append(entry)
            case .skipped(kind: let kind): skipped.append(["name": url.lastPathComponent, "reason": "unreadable", "kind": kind])
            }
        }
        var out: [String: Any] = ["entries": entries, "skipped": skipped]
        if let id = identity(dir) { out["identity"] = id }
        return out
    }

    /** An entry, a link followed to what it points at. */
    static func item(_ url: URL) -> Item {
        guard let own = try? url.resourceValues(forKeys: keys) else { return .skipped(kind: "unreadable") }
        let name = own.name ?? url.lastPathComponent
        if name.contains("\\") { return .skipped(kind: "name") }
        if own.isSymbolicLink == true {
            guard let target = resolved(url) else { return .skipped(kind: "link") }
            return .entry(linked(describe(name: name, values: target.values, identityOf: target.url)))
        }
        if own.isDirectory == true || own.isRegularFile == true {
            return .entry(describe(name: name, values: own, identityOf: url))
        }
        return .skipped(kind: "special")
    }

    /**
     * What `stat` answers for a path: the entry with a link followed; nil for a
     * link that points nowhere — on the desktop such a path does not exist
     * either. Throws what the system throws for a path that is not there.
     */
    static func describeFollowing(_ url: URL) throws -> [String: Any]? {
        let own = try url.resourceValues(forKeys: keys)
        let name = own.name ?? url.lastPathComponent
        if own.isSymbolicLink == true {
            guard let target = resolved(url) else { return nil }
            return linked(describe(name: name, values: target.values, identityOf: target.url))
        }
        return describe(name: name, values: own, identityOf: url)
    }

    /** The link's target and its values; nil when it is not there. */
    static func resolved(_ url: URL) -> (url: URL, values: URLResourceValues)? {
        // fileExists follows the link, all the way: a link to a link that
        // points nowhere, or a link to itself, is not there.
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let target = url.resolvingSymlinksInPath()
        guard let values = try? target.resourceValues(forKeys: keys), values.isSymbolicLink != true else { return nil }
        guard values.isDirectory == true || values.isRegularFile == true else { return nil }
        return (target, values)
    }

    /**
     * An entry reached through a link says so: a backup leaves links out, as
     * the desktop's does — what lies behind one is not the vault's to pack,
     * and a link inside the vault would pack its folder twice.
     */
    static func linked(_ entry: [String: Any]) -> [String: Any] {
        var out = entry
        out["link"] = true
        return out
    }

    static func describe(name: String, values: URLResourceValues, identityOf url: URL) -> [String: Any] {
        let isDir = values.isDirectory ?? false
        var out: [String: Any] = [
            "name": name,
            "isDirectory": isDir,
            "size": isDir ? 0 : (values.fileSize ?? 0),
            "mtime": Int((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000),
        ]
        if let created = values.creationDate {
            out["ctime"] = Int(created.timeIntervalSince1970 * 1000)
        }
        if isDir, let id = identity(url) { out["identity"] = id }
        return out
    }

    /** A folder's identity: device and inode, the pair the desktop compares. */
    static func identity(_ url: URL) -> String? {
        var info = stat()
        guard stat(url.path, &info) == 0 else { return nil }
        return "\(info.st_dev):\(info.st_ino)"
    }
}
