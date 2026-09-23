import Foundation

/**
 * The widget's two files and what the widget makes of them (plan Widgets, W4).
 *
 * A standalone `swiftc` run, like the share queue's, and for the same reason:
 * the Swift here carries real rules — which day it is, how much is overdue by
 * now, whether an order still names a row — and none of it would otherwise be
 * exercised anywhere. The unit tests on the JavaScript side prove the snapshot
 * the app WRITES; this proves what the widget READS.
 *
 * `WidgetStore` takes a root, so the test runs against a temporary directory
 * instead of an App Group container; `WidgetSnapshot` needs nothing at all.
 */
@main
struct WidgetStoreTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }

    static func snapshot(writtenAt: Int64, locked: Bool = false, overdue: Int = 0, rows: [String] = []) -> String {
        """
        {"version":1,"writtenAt":\(writtenAt),"vaultName":"Notizen","locked":\(locked),"overdue":\(overdue),\
        "rows":[\(rows.joined(separator: ","))],\
        "labels":{"today":"Heute","overdue":"Überfällig","empty":"Nichts fällig","locked":"Gesperrt",\
        "pending":"wird übernommen","newTask":"Aufgabe","newJournal":"Journal"}}
        """
    }

    static func row(_ index: Int, _ kind: String, _ title: String, _ day: String, _ minutes: String = "null", _ priority: Int = 0) -> String {
        "{\"index\":\(index),\"kind\":\"\(kind)\",\"title\":\"\(title)\",\"day\":\"\(day)\",\"minutes\":\(minutes),\"priority\":\(priority)}"
    }

    static func main() throws {
        let fm = FileManager.default
        let scratch = fm.temporaryDirectory.appendingPathComponent("plainva-widget-tests-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }
        let store = try WidgetStore(root: scratch.appendingPathComponent("widget"))

        // --- the model -----------------------------------------------------

        let at: Int64 = 1_758_400_000_000
        let parsed = WidgetSnapshot.parse(snapshot(writtenAt: at, overdue: 2, rows: [
            row(0, "event", "Zahnarzt", "2026-09-21", "540"),
            row(1, "task", "Montag", "2026-09-21"),
            row(2, "task", "Mittwoch", "2026-09-23", "null", 2),
        ]))
        try require(parsed != nil, "a well-formed snapshot parses")
        let s = parsed!
        try require(s.rows(on: "2026-09-21", pending: []).count == 2, "one day's rows")
        try require(s.rows(on: "2026-09-23", pending: [2]).first?.pending == true, "a pending tick marks its row")
        // What the app counted, plus the task that has gone by since. The
        // appointment on Monday is not overdue on Wednesday - it happened.
        try require(s.overdue(on: "2026-09-21") == 2, "overdue as written")
        try require(s.overdue(on: "2026-09-23") == 3, "overdue grows with the day, and only for tasks")
        try require(s.nextTask(from: "2026-09-22")?.title == "Mittwoch", "the next task the lock screen shows")

        // Anything this reader cannot vouch for answers the same way.
        try require(WidgetSnapshot.parse(nil) == nil, "no file")
        try require(WidgetSnapshot.parse("nicht json") == nil, "not json")
        try require(WidgetSnapshot.parse("{\"version\":2,\"rows\":[]}") == nil, "a newer version is refused, not half-read")
        try require(WidgetSnapshot.parse("{\"version\":1}") == nil, "no rows at all")
        let broken = WidgetSnapshot.parse(snapshot(writtenAt: at, rows: [row(0, "task", "Gut", "2026-09-23"), row(1, "task", "Kaputt", "23.09.")]))
        try require(broken?.rows.count == 1, "a row without a usable day is dropped")

        // --- the store -----------------------------------------------------

        try require(store.readSnapshot() == nil, "nothing on disk yet")
        try require(store.enqueue(index: 0, at: at) == 0, "an order needs a snapshot to name")

        try store.writeSnapshot(snapshot(writtenAt: at, rows: [row(0, "task", "Eine", "2026-09-23"), row(1, "task", "Zwei", "2026-09-23")]))
        try require(store.snapshotWrittenAt() == at, "the snapshot's own stamp")

        let first = store.enqueue(index: 0, at: at + 10)
        try require(first > 0, "a tick is recorded")
        // The same row tapped twice is one tick, not two.
        try require(store.enqueue(index: 0, at: at + 20) == first, "a second tap on the same row is the same order")
        _ = store.enqueue(index: 1, at: at + 30)
        try require(store.pendingIndexes() == [0, 1], "both rows show their tick at once")

        // A store opened afresh reads the same file - the widget is its own
        // process on iOS, so this is the case that actually happens.
        let reopened = try WidgetStore(root: scratch.appendingPathComponent("widget"))
        try require(reopened.pendingActions().count == 2, "the queue survives the process")
        reopened.clearActions(ids: [first])
        try require(reopened.pendingActions().count == 1, "clearing by id leaves the others")
        try require(reopened.pendingIndexes() == [1], "...and the widget stops showing that tick")

        // A newer snapshot makes every older index meaningless: the app is
        // what drops them, but the widget must not go on marking rows.
        try reopened.writeSnapshot(snapshot(writtenAt: at + 1000, rows: [row(0, "task", "Neu", "2026-09-23")]))
        try require(reopened.pendingIndexes().isEmpty, "orders of an older snapshot mark nothing")

        reopened.clearSnapshot()
        try require(reopened.readSnapshot() == nil, "locking empties the file")

        print("WidgetStore and WidgetSnapshot verified.")
    }
}
