import Foundation

/**
 * What the widget makes of the file the app left it (plan Widgets, W4).
 *
 * The counterpart of `WidgetSnapshot.java`, and the same arithmetic — which is
 * the part that has to keep being right while Plainva is closed. The widget
 * works out which day it is itself, so it turns the page at midnight without
 * the app having run; it follows that "overdue" is two numbers added together,
 * the count the app wrote plus the task rows that have slipped into the past
 * since.
 *
 * A file this reader cannot vouch for answers `nil`, and the widget then says
 * "open Plainva" rather than drawing a day it invented.
 */
struct WidgetSnapshot {
    static let version = 1

    struct Row: Identifiable {
        /// Position in this snapshot — what a tap sends back. Never a path.
        let index: Int
        let isTask: Bool
        /// Empty when the device asked for counters only.
        let title: String
        /// `YYYY-MM-DD`.
        let day: String
        /// Minutes after midnight, or nil for something with no time of day.
        let minutes: Int?
        /// 0 = none, 3 = highest.
        let priority: Int
        /// Ticked on the home screen, waiting for the app to redeem it.
        var pending = false

        var id: Int { index }
    }

    struct Labels {
        let today: String, overdue: String, empty: String, locked: String
        let pending: String, newTask: String, newJournal: String

        init(_ raw: [String: Any]) {
            func pick(_ key: String, _ fallback: String) -> String { (raw[key] as? String) ?? fallback }
            today = pick("today", "Today")
            overdue = pick("overdue", "Overdue")
            empty = pick("empty", "")
            locked = pick("locked", "")
            pending = pick("pending", "")
            newTask = pick("newTask", "")
            newJournal = pick("newJournal", "")
        }
    }

    let writtenAt: Date?
    let vaultName: String
    let locked: Bool
    /// Tasks that were already overdue when the app wrote this.
    let overdueAtWrite: Int
    let rows: [Row]
    let labels: Labels

    static func parse(_ json: String?) -> WidgetSnapshot? {
        guard let json, let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (root["version"] as? Int) == version,
              let rawRows = root["rows"] as? [[String: Any]] else { return nil }

        var rows: [Row] = []
        for (position, raw) in rawRows.enumerated() {
            guard let day = raw["day"] as? String, day.count == 10 else { continue }
            rows.append(Row(
                index: (raw["index"] as? Int) ?? position,
                isTask: (raw["kind"] as? String) == "task",
                title: (raw["title"] as? String) ?? "",
                day: day,
                minutes: raw["minutes"] as? Int,
                priority: min(3, max(0, (raw["priority"] as? Int) ?? 0))
            ))
        }

        let written = (root["writtenAt"] as? NSNumber)?.doubleValue ?? 0
        return WidgetSnapshot(
            writtenAt: written > 0 ? Date(timeIntervalSince1970: written / 1000) : nil,
            vaultName: (root["vaultName"] as? String) ?? "",
            locked: (root["locked"] as? Bool) ?? false,
            overdueAtWrite: max(0, (root["overdue"] as? Int) ?? 0),
            rows: rows,
            labels: Labels((root["labels"] as? [String: Any]) ?? [:])
        )
    }

    // MARK: - what the widget works out for itself

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func dayKey(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// The rows of one day, in the order the app sorted them.
    func rows(on day: String, pending: Set<Int>) -> [Row] {
        rows.filter { $0.day == day }.map { row in
            var copy = row
            copy.pending = pending.contains(row.index)
            return copy
        }
    }

    /**
     * How many tasks are overdue AS OF this day: what the app counted, plus the
     * task rows that have gone by since it ran. An appointment that has passed
     * is not overdue — it simply happened.
     */
    func overdue(on day: String) -> Int {
        overdueAtWrite + rows.filter { $0.isTask && $0.day < day }.count
    }

    /// True once the snapshot is from an earlier day — then the widget says when it is from.
    func isStale(on day: String) -> Bool {
        guard let writtenAt else { return false }
        return WidgetSnapshot.dayKey(writtenAt) < day
    }

    /// The next task with a day, for the lock screen's one line.
    func nextTask(from day: String) -> Row? {
        rows.first { $0.isTask && $0.day >= day }
    }
}
