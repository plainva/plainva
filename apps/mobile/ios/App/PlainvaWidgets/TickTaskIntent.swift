import AppIntents
import WidgetKit

/**
 * Ticking a task off from the widget (plan Widgets, W4/E3).
 *
 * It records an ORDER and nothing more. Ticking a task off in Plainva means
 * setting a status by the database's completion model, carrying a recurrence
 * forward and syncing to a provider — none of which exists in Swift, and
 * rebuilding it here would be a second truth about what a checkbox does. So
 * the widget shows the tick at once and the app redeems it on its next run;
 * the row says so in the meantime.
 *
 * iOS 17 and up. Below that a widget cannot act at all, and the row opens the
 * task instead — a platform limit, stated in the plan.
 */
@available(iOS 17.0, *)
struct TickTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Tick off"
    /// The app stays closed: the point of the whole mechanism.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Row")
    var index: Int

    init() {}

    init(index: Int) {
        self.index = index
    }

    func perform() async throws -> some IntentResult {
        // `enqueue` reads the snapshot itself and stamps the order with it, so
        // an index tapped against a snapshot the app has already replaced is
        // refused where it is recorded rather than where it is applied.
        if let store = try? WidgetStore() {
            store.enqueue(index: index, at: Int64(Date().timeIntervalSince1970 * 1000))
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
