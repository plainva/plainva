import SwiftUI
import WidgetKit

/**
 * When a widget redraws, and what it draws with (plan Widgets, W4/E7).
 *
 * The timeline has one entry per midnight, which is the whole trick: WidgetKit
 * asks for entries in advance, so the widget turns the page at midnight with
 * no app run and no background work. The snapshot carries a week, so the week
 * is how far ahead the timeline goes; when the app writes a fresh one it calls
 * `reloadAllTimelines` and the entries are rebuilt from scratch.
 */
struct PlainvaEntry: TimelineEntry {
    let date: Date
    /// The day this entry is FOR, which is not necessarily today when WidgetKit renders ahead.
    let day: String
    let snapshot: WidgetSnapshot?
    let pending: Set<Int>
}

struct PlainvaProvider: TimelineProvider {
    /// What the widget gallery shows. Invented rows would misrepresent the
    /// product, so the placeholder is the real file if there is one.
    func placeholder(in context: Context) -> PlainvaEntry { current() }

    func getSnapshot(in context: Context, completion: @escaping (PlainvaEntry) -> Void) {
        completion(current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlainvaEntry>) -> Void) {
        let store = try? WidgetStore()
        let snapshot = WidgetSnapshot.parse(store?.readSnapshot())
        let pending = store?.pendingIndexes() ?? []
        let calendar = Calendar.current
        let now = Date()

        var entries = [PlainvaEntry(date: now, day: WidgetSnapshot.dayKey(now), snapshot: snapshot, pending: pending)]
        // One entry per following midnight, for as far as the snapshot reaches.
        var midnight = calendar.startOfDay(for: now)
        for _ in 0..<7 {
            guard let next = calendar.date(byAdding: .day, value: 1, to: midnight) else { break }
            midnight = next
            entries.append(PlainvaEntry(date: next, day: WidgetSnapshot.dayKey(next), snapshot: snapshot, pending: pending))
        }
        // `.atEnd` and not a date: after a week the snapshot is so old that the
        // widget shows its age anyway, and asking again then is the honest move.
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    private func current() -> PlainvaEntry {
        let store = try? WidgetStore()
        let now = Date()
        return PlainvaEntry(
            date: now,
            day: WidgetSnapshot.dayKey(now),
            snapshot: WidgetSnapshot.parse(store?.readSnapshot()),
            pending: store?.pendingIndexes() ?? []
        )
    }
}

/**
 * Plainva's petrol, light and dark (E6).
 *
 * Written out rather than taken from an asset catalog: a widget extension of
 * its own would need its own catalog, and two places to change one colour is
 * one too many. The values are the app's tokens.
 */
enum WidgetPalette {
    static let accent = dynamic(light: 0x0F766E, dark: 0x2DD4BF)
    static let text = dynamic(light: 0x1B2B29, dark: 0xD7E4E2)
    static let faint = dynamic(light: 0x5F6E6B, dark: 0x809390)
    static let warn = dynamic(light: 0xB4472F, dark: 0xF3A39B)

    private static func dynamic(light: Int, dark: Int) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? rgb(dark) : rgb(light)
        })
    }

    private static func rgb(_ value: Int) -> UIColor {
        UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}

/** The one place that formats a row's time, on the device's own clock. */
func widgetClock(_ minutes: Int) -> String {
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    var parts = DateComponents()
    parts.hour = minutes / 60
    parts.minute = minutes % 60
    let date = Calendar.current.date(from: parts) ?? Date()
    return formatter.string(from: date)
}

/**
 * The app's URL scheme: its bundle id, which the Labs build changes (Info.plist
 * `PlainvaURLScheme`, docs/engineering/Labs_Channel.md). A widget of Plainva Labs
 * must open Plainva Labs, not the store app next to it.
 */
let widgetURLScheme = Bundle.main.object(forInfoDictionaryKey: "PlainvaURLScheme") as? String ?? "com.plainva.app"

/** The app itself, where a widget has nothing more specific to open. */
func widgetAppURL() -> URL {
    URL(string: "\(widgetURLScheme)://")!
}

/** A tap travels as a POSITION on the app's scheme, never as a path. */
func widgetOpenURL(_ row: WidgetSnapshot.Row, writtenAt: Date?) -> URL? {
    let at = Int((writtenAt?.timeIntervalSince1970 ?? 0) * 1000)
    return URL(string: "\(widgetURLScheme)://widget/open/\(row.index)?at=\(at)")
}

func widgetShortcutURL(_ which: String) -> URL? {
    URL(string: "\(widgetURLScheme)://shortcut/\(which)")
}

/**
 * The widget's own background.
 *
 * `containerBackground(for: .widget)` is iOS 17, the deployment target is
 * 16.4 — so it cannot simply be called: availability is checked against the
 * target, and an unguarded call would not compile at all. On 16 the modifier
 * did not exist because the system drew the background itself; `background`
 * is the equivalent there.
 */
extension View {
    @ViewBuilder
    func widgetSurface(_ surface: some View) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { surface }
        } else {
            background(surface)
        }
    }
}
