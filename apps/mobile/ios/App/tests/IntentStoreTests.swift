import Foundation

/**
 * The two files the system's assistant lives on, and what an intent makes of
 * them (AI harness P4.7).
 *
 * A standalone `swiftc` run, like the widgets' and the share queue's: the
 * Swift here carries real rules — what counts as a directory, which rows
 * somebody means by what they said, what an order may hold — and a simulator
 * build only proves that it compiles. The unit tests on the JavaScript side
 * prove the directory the app WRITES and what it does with an order; this
 * proves what an intent READS and what it LEAVES.
 *
 * `IntentStore` takes a root, so the test runs against a temporary directory
 * instead of an App Group container.
 */
@main
struct IntentStoreTests {
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if !(try condition()) { throw NSError(domain: message, code: 1) }
    }

    static func directory(writtenAt: Int64 = 1_759_831_200_000, version: Int = 1, rows: [String]) -> String {
        "{\"version\":\(version),\"writtenAt\":\(writtenAt),\"vault\":\"Studio\",\"notes\":[\(rows.joined(separator: ","))]}"
    }

    static func row(_ key: String, _ title: String, _ folder: String? = nil) -> String {
        folder == nil ? "{\"k\":\"\(key)\",\"t\":\"\(title)\"}" : "{\"k\":\"\(key)\",\"t\":\"\(title)\",\"f\":\"\(folder!)\"}"
    }

    static let plan = "00000000000000a1"
    static let planning = "00000000000000a2"
    static let shooting = "00000000000000a3"
    static let cafe = "00000000000000a4"
    static let budget = "00000000000000a5"

    static func main() throws {
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent("plainva-intent-tests-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }
        let store = try IntentStore(root: scratch.appendingPathComponent("intents"))

        // --- the directory -------------------------------------------------

        try require(store.readDirectory() == nil, "nothing was written: nothing is found")

        let rows = [
            row(planning, "Planning the shoot", "Projects"),
            row(plan, "Plan", "Projects"),
            row(shooting, "Shooting days"),
            row(cafe, "Café Müller", "Places"),
            row(budget, "Budget plan 2026", "Finance"),
        ]
        try store.writeDirectory(directory(rows: rows))
        let read = store.readDirectory()
        try require(read != nil, "a directory the app wrote is read")
        try require(read!.vault == "Studio" && read!.writtenAt == 1_759_831_200_000, "with its vault and its moment")
        try require(read!.notes.count == 5, "and every row")
        try require(read!.notes[1] == IntentNote(key: plan, title: "Plan", folder: "Projects"), "a row is a key, a title and a folder's name")
        try require(read!.notes[2].folder == nil, "a note at the vault's top has no folder")

        // Anything that is not a directory of this version is not kept: a
        // voice must never read something half-understood.
        for (bad, why) in [
            ("", "nothing"),
            ("{", "no JSON"),
            ("[]", "no object"),
            (directory(version: 2, rows: rows), "a newer version"),
            (directory(writtenAt: 0, rows: rows), "no moment"),
            (directory(rows: ["{\"k\":\"\(plan)\"}"]), "a row without a title"),
            (directory(rows: ["{\"k\":\"\(plan)\",\"t\":\"\"}"]), "an empty title"),
            (directory(rows: ["{\"t\":\"Plan\"}"]), "a row without a key"),
            (directory(rows: [row("Projects/Plan.md", "Plan")]), "a path where a key belongs"),
            (directory(rows: [row("00000000000000A1", "Plan")]), "a key in capitals"),
            (directory(rows: [row("00000000000000a", "Plan")]), "a key that is too short"),
            ("{\"version\":1,\"writtenAt\":5,\"vault\":\"Studio\"}", "no rows at all"),
        ] {
            try require(IntentStore.parseDirectory(bad) == nil, "not a directory: \(why)")
            var refused = false
            do { try store.writeDirectory(bad) } catch { refused = true }
            try require(refused, "and not written: \(why)")
        }
        try require(store.readDirectory()?.notes.count == 5, "a refused write leaves the directory as it was")

        // A store opened afresh reads the same file.
        let reopened = try IntentStore(root: scratch.appendingPathComponent("intents"))
        try require(reopened.readDirectory() == read, "the directory survives the process")

        // --- which rows somebody means --------------------------------------

        let notes = read!.notes
        func keys(_ query: String, limit: Int = 12) -> [String] { IntentSearch.matches(query, in: notes, limit: limit).map { $0.key } }

        try require(IntentSearch.fold("  Café   MÜLLER ") == "cafe muller", "compared without case, accents or extra spaces")
        // The title itself first, then titles that begin with the words, then
        // titles whose words begin with them, then titles that contain them.
        try require(keys("plan") == [plan, planning, budget], "the title itself, then a beginning, then a word's beginning")
        try require(keys("PLAN") == keys("plan"), "case does not matter")
        try require(keys("cafe muller") == [cafe], "accents do not matter")
        try require(keys("shoot plan") == [planning], "every word has to begin a word of the title")
        try require(keys("days") == [shooting], "a word in the middle")
        try require(keys("udget") == [budget], "a part of a word, last of all")
        try require(keys("invoice").isEmpty, "nothing that is not there")
        try require(keys("").isEmpty && keys("   ").isEmpty, "no words, no rows")
        try require(keys("plan", limit: 2) == [plan, planning], "no more than asked for, the best first")
        try require(keys("plan", limit: 0).isEmpty, "none where none are asked for")
        // Within one rank the directory's own order stays: the notes changed last come first.
        let twins = [IntentNote(key: "00000000000000b1", title: "Notes", folder: "A"), IntentNote(key: "00000000000000b2", title: "Notes", folder: "B")]
        try require(IntentSearch.matches("notes", in: twins).map { $0.folder ?? "" } == ["A", "B"], "two notes of one title, in the directory's order")

        // --- the orders ----------------------------------------------------

        let at: Int64 = 1_759_831_300_000
        try require(store.pendingOrders().isEmpty, "nothing was asked yet")
        let first = store.enqueue(kind: "journal", text: "  Called the dentist\u{200B}  ", at: at)
        try require(first > 0, "what was said is recorded")
        let second = store.enqueue(kind: "task", text: "Buy milk tomorrow", at: at + 10)
        let third = store.enqueue(kind: "open", text: "Plan", key: plan, at: at + 20)
        try require(second > first && third > second, "each order has an id of its own, in order")

        var pending = store.pendingOrders()
        try require(pending.count == 3, "all three wait")
        try require(pending[0]["kind"] as? String == "journal" && pending[0]["text"] as? String == "Called the dentist", "words without what is invisible, and without their edges")
        try require((pending[0]["at"] as? NSNumber)?.int64Value == at, "with the moment they were said")
        try require(pending[2]["key"] as? String == plan && pending[2]["text"] as? String == "Plan", "an order to open names a key and the title that was chosen")
        try require(pending[0]["key"] == nil && pending[1]["key"] == nil, "no other order carries a key")

        // Of the places somebody asked to be taken to, only the last counts:
        // a new one takes the place of the one before — and touches nothing
        // that was to be written.
        let fourth = store.enqueue(kind: "search", text: "shooting days", at: at + 30)
        pending = store.pendingOrders()
        try require(fourth > third && pending.count == 3, "the search took the place of the note to open")
        try require(pending[2]["kind"] as? String == "search" && pending[2]["key"] == nil, "and a search carries no key")
        try require(pending[0]["kind"] as? String == "journal" && pending[1]["kind"] as? String == "task", "what was to be written stays")

        // What is no order is not recorded.
        try require(store.enqueue(kind: "delete", text: "everything", at: at) == 0, "an unknown kind")
        try require(store.enqueue(kind: "journal", text: "   ", at: at) == 0, "a journal entry without words")
        try require(store.enqueue(kind: "task", text: "\u{200B}\u{200B}", at: at) == 0, "a task of nothing visible")
        try require(store.pendingOrders().count == 3, "nothing of that is in the queue")
        // An order to open keeps only a key that is one.
        let loose = store.enqueue(kind: "open", text: "Plan", key: "Projects/Plan.md", at: at + 40)
        try require(loose > 0 && store.pendingOrders().last?["key"] == nil, "a path is never recorded as a key")
        // A search may be for nothing: the app then opens its search empty.
        let empty = store.enqueue(kind: "search", text: "", at: at + 50)
        try require(empty > loose && store.pendingOrders().count == 3, "a search without words is still a search")

        // What somebody said keeps its line breaks and is bounded.
        try require(IntentStore.cleanText("one\ntwo\r\nthree") == "one\ntwo \nthree", "line breaks stay, other control characters become spaces")
        try require(IntentStore.cleanText(String(repeating: "x", count: 5000)).unicodeScalars.count == 2000, "no longer than a spoken sentence may be")

        // Clearing is by id, never wholesale.
        reopened.clearOrders(ids: [first, empty])
        let left = reopened.pendingOrders().compactMap { ($0["id"] as? NSNumber)?.int64Value }
        try require(left == [second], "clearing two leaves the third")
        // Ids are never used twice, also after a clearing.
        let next = reopened.enqueue(kind: "journal", text: "Later", at: at + 60)
        try require(next > empty, "a new order never takes an old id")

        // What somebody asked to have written is never dropped for its age:
        // more than a year later it still waits, with the moment it was said.
        let late = at + 400 * 24 * 60 * 60 * 1000
        _ = reopened.enqueue(kind: "journal", text: "Much later", at: late)
        let kept = reopened.pendingOrders()
        try require(kept.count == 3 && kept[0]["text"] as? String == "Buy milk tomorrow" && kept[2]["text"] as? String == "Much later", "the old words still wait")
        try require((kept[0]["at"] as? NSNumber)?.int64Value == at + 10, "with their own moment")

        // The queue is bounded: one that is full of words takes no more, and
        // the intent is told so — but there is always room for a place to go.
        for index in 0..<200 { _ = reopened.enqueue(kind: "journal", text: "Entry \(index)", at: late + Int64(index)) }
        try require(reopened.pendingOrders().count == 99, "no more than ninety-nine things to write wait")
        try require(reopened.enqueue(kind: "task", text: "One too many", at: late + 500) == 0, "and the intent is told so")
        try require(reopened.enqueue(kind: "open", text: "Plan", key: plan, at: late + 600) > 0, "a note can still be opened")
        try require(reopened.enqueue(kind: "search", text: "plan", at: late + 700) > 0 && reopened.pendingOrders().count == 100, "and the next place takes the place of that one")
        try require((reopened.pendingOrders().first?["text"] as? String) == "Buy milk tomorrow", "none of the words was pushed out for it")

        // --- wiping ----------------------------------------------------------

        try reopened.clearDirectory()
        try require(reopened.readDirectory() == nil && store.readDirectory() == nil, "switching off empties the file for everybody")
        try reopened.clearDirectory()
        try require(reopened.pendingOrders().count == 100, "the orders are not part of what is wiped")

        print("IntentStore and IntentSearch verified.")
    }
}
