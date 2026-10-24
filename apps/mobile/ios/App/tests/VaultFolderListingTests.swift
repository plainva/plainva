import Foundation

/**
 * The rules of `App/VaultFolderListing.swift` on a real file system (issue
 * #125): a link stands for what it points at, a link that points nowhere and
 * anything neither file nor folder is named instead of listed, and a folder
 * carries the identity the walk cuts loops by.
 */
@main
struct VaultFolderListingTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }

    static func list(_ listing: [String: Any], _ key: String) -> [[String: Any]] {
        (listing[key] as? [[String: Any]]) ?? []
    }

    static func names(_ listing: [String: Any], _ key: String) -> [String] {
        list(listing, key).compactMap { $0["name"] as? String }.sorted()
    }

    static func entry(_ listing: [String: Any], _ name: String) -> [String: Any]? {
        list(listing, "entries").first { $0["name"] as? String == name }
    }

    static func main() throws {
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent("plainva-folder-listing-" + UUID().uuidString, isDirectory: true)
        let vault = scratch.appendingPathComponent("vault", isDirectory: true)
        let outside = scratch.appendingPathComponent("outside", isDirectory: true)
        try fm.createDirectory(at: vault.appendingPathComponent("Projects/Zenn", isDirectory: true), withIntermediateDirectories: true)
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }
        try "# Plan\n".write(to: vault.appendingPathComponent("Projects/Plan.md"), atomically: true, encoding: .utf8)
        try "A note that lives outside the vault and is longer than any link to it.\n".write(to: outside.appendingPathComponent("Linked.md"), atomically: true, encoding: .utf8)

        // The reporter's link: a folder that exists only on the Mac that made it.
        try fm.createSymbolicLink(atPath: vault.appendingPathComponent("Projects/Zenn/articles").path, withDestinationPath: "/Users/nobody/Projects/zenn-content/articles")
        // A link to a folder that is there, one to a file, and one back to the vault itself.
        try fm.createSymbolicLink(at: vault.appendingPathComponent("Shared"), withDestinationURL: outside)
        try fm.createSymbolicLink(at: vault.appendingPathComponent("Linked.md"), withDestinationURL: outside.appendingPathComponent("Linked.md"))
        try fm.createSymbolicLink(at: vault.appendingPathComponent("Projects/loop"), withDestinationURL: vault)

        let zenn = try VaultFolderListing.list(vault.appendingPathComponent("Projects/Zenn"))
        try require(names(zenn, "entries").isEmpty, "a link that points nowhere is not listed")
        try require(names(zenn, "skipped") == ["articles"], "a link that points nowhere is named")
        try require(list(zenn, "skipped").first?["reason"] as? String == "unreadable", "…as unreadable")
        try require(list(zenn, "skipped").first?["kind"] as? String == "link", "…of the kind a backup leaves out")

        let root = try VaultFolderListing.list(vault)
        try require(names(root, "entries") == ["Linked.md", "Projects", "Shared"], "the root lists its entries, links included")
        try require(root["identity"] as? String == VaultFolderListing.identity(vault), "a listing carries its folder's identity")
        let shared = entry(root, "Shared")
        try require(shared?["isDirectory"] as? Bool == true, "a link to a folder is a folder")
        try require(shared?["identity"] as? String == VaultFolderListing.identity(outside), "…with the identity of the folder it points at")
        let linked = entry(root, "Linked.md")
        let size = (try fm.attributesOfItem(atPath: outside.appendingPathComponent("Linked.md").path)[.size] as? NSNumber)?.intValue
        try require(linked?["isDirectory"] as? Bool == false, "a link to a file is a file")
        try require(linked?["size"] as? Int == size, "…with the file's size, not the link's")
        try require(shared?["link"] as? Bool == true && linked?["link"] as? Bool == true, "an entry reached through a link says so")
        try require(entry(root, "Projects")?["link"] == nil, "…and a folder of its own does not")

        let projects = try VaultFolderListing.list(vault.appendingPathComponent("Projects"))
        try require(entry(projects, "loop")?["isDirectory"] as? Bool == true, "a link back to the vault is a folder")
        try require(entry(projects, "loop")?["identity"] as? String == root["identity"] as? String, "…carrying the vault's identity: the walk cuts it there")
        try require(entry(projects, "Plan.md")?["identity"] == nil, "a file carries no identity")

        // `stat` answers as `list` does.
        let sharedStat = try VaultFolderListing.describeFollowing(vault.appendingPathComponent("Shared"))
        try require(sharedStat?["isDirectory"] as? Bool == true, "stat follows a link")
        // The snapshot before a recursive delete keeps nothing of a folder that is a link (the delete takes the link alone).
        try require(sharedStat?["link"] as? Bool == true, "…and says that the path is a link")
        let projectsStat = try VaultFolderListing.describeFollowing(vault.appendingPathComponent("Projects"))
        try require(projectsStat?["link"] == nil, "…and a folder of its own is none")
        let danglingStat = try VaultFolderListing.describeFollowing(vault.appendingPathComponent("Projects/Zenn/articles"))
        try require(danglingStat == nil, "a link that points nowhere is not there")
        do {
            _ = try VaultFolderListing.describeFollowing(vault.appendingPathComponent("missing.md"))
            throw NSError(domain: "a path that is not there must throw", code: 1)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain {}

        // Neither file nor folder.
        let made = mkfifo(vault.appendingPathComponent("pipe").path, 0o600)
        try require(made == 0, "made a FIFO")
        let withPipe = try VaultFolderListing.list(vault)
        try require(names(withPipe, "skipped") == ["pipe"], "a FIFO is named, not listed")
        try require(list(withPipe, "skipped").first?["kind"] as? String == "special", "…as neither file nor folder")
        // A name the vault's paths cannot address.
        try "x".write(to: vault.appendingPathComponent("back\\slash.md"), atomically: true, encoding: .utf8)
        let withBackslash = try VaultFolderListing.list(vault)
        try require(names(withBackslash, "skipped") == ["back\\slash.md", "pipe"], "a backslash in a name is named, not listed")
        let backslash = list(withBackslash, "skipped").first { $0["name"] as? String == "back\\slash.md" }
        try require(backslash?["kind"] as? String == "name", "…as a name the vault's paths cannot address: a backup fails on it")

        print("vault folder listing: all checks passed")
    }
}
