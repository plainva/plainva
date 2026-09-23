import SwiftUI
import WidgetKit

/**
 * The two lock-screen widgets (plan Widgets, W4/E1).
 *
 * A lock screen is the most exposed surface Plainva can put anything on, and
 * that decides what each one may say. The circular one shows a NUMBER, which
 * carries no content at all. The rectangular one shows the next task's title —
 * so it obeys the same device switch as the home screen, and a sealed vault
 * shows neither.
 *
 * These are `accessory` families, which means iOS 16 and up; the app's
 * deployment target is 16.4, so there is nothing to guard.
 */
struct DueCountWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlainvaDueCount", provider: PlainvaProvider()) { entry in
            DueCountView(entry: entry).widgetSurface(Color.clear)
        }
        .configurationDisplayName("Plainva")
        .description(Text(verbatim: "Due today"))
        .supportedFamilies([.accessoryCircular])
    }
}

struct DueCountView: View {
    let entry: PlainvaEntry

    var body: some View {
        // A count and nothing else: the one thing that is safe on a lock screen
        // whatever the vault holds.
        let count = entry.snapshot.map { $0.locked ? 0 : $0.rows(on: entry.day, pending: []).count } ?? 0
        Link(destination: widgetShortcutURL("today") ?? URL(string: "com.plainva.app://")!) {
            VStack(spacing: 0) {
                Image(systemName: "checklist").font(.system(size: 11))
                Text("\(count)").font(.system(size: 17, weight: .semibold, design: .rounded))
            }
        }
    }
}

struct NextTaskWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlainvaNextTask", provider: PlainvaProvider()) { entry in
            NextTaskView(entry: entry).widgetSurface(Color.clear)
        }
        .configurationDisplayName("Plainva")
        .description(Text(verbatim: "Next task"))
        .supportedFamilies([.accessoryRectangular])
    }
}

struct NextTaskView: View {
    let entry: PlainvaEntry

    var body: some View {
        Link(destination: destination) {
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.snapshot?.labels.today ?? "Plainva")
                    .font(.caption2)
                    .widgetAccentable()
                Text(line)
                    .font(.caption)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var line: String {
        guard let snapshot = entry.snapshot else { return "Plainva" }
        // A sealed vault says it is sealed; it does not go quiet, which would
        // look like "nothing to do".
        if snapshot.locked { return snapshot.labels.locked }
        guard let next = snapshot.nextTask(from: entry.day) else { return snapshot.labels.empty }
        // Titles off means titles off here too - the lock screen is not an
        // exception to the switch, it is the reason for it.
        return next.title.isEmpty ? snapshot.labels.today : next.title
    }

    private var destination: URL {
        if let snapshot = entry.snapshot, !snapshot.locked,
           let next = snapshot.nextTask(from: entry.day),
           let url = widgetOpenURL(next, writtenAt: snapshot.writtenAt) {
            return url
        }
        return widgetShortcutURL("today") ?? URL(string: "com.plainva.app://")!
    }
}
