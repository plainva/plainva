import SwiftUI
import WidgetKit

/**
 * The "Today" widget on iOS (plan Widgets, W4).
 *
 * Same content and same rules as the Android one — overdue as a count, then
 * the day's appointments and tasks in the order the app sorted them — drawn
 * with SwiftUI instead of RemoteViews, which is why this one can carry the
 * app's own type and spacing where Android cannot.
 *
 * Ticking off is an `AppIntent`, and only from iOS 17: below that the platform
 * gives a widget no way to act without opening the app, so there the row is
 * one big tap target that opens the task. That is a platform limit stated in
 * the plan, not a gap.
 */
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlainvaToday", provider: PlainvaProvider()) { entry in
            TodayWidgetView(entry: entry)
                .widgetSurface(Color(uiColor: .systemBackground))
        }
        .configurationDisplayName("Plainva")
        .description(Text(verbatim: "Today"))
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct TodayWidgetView: View {
    let entry: PlainvaEntry

    private var rowLimit: Int { 6 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            head
            content
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var head: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.snapshot?.labels.today ?? "Plainva")
                    .font(.headline)
                    .foregroundStyle(WidgetPalette.text)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(WidgetPalette.faint)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let snapshot = entry.snapshot, !snapshot.locked {
                let overdue = snapshot.overdue(on: entry.day)
                if overdue > 0 {
                    Text("\(overdue) \(snapshot.labels.overdue)")
                        .font(.caption2)
                        .foregroundStyle(WidgetPalette.warn)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(WidgetPalette.warn.opacity(0.14), in: Capsule())
                }
                Link(destination: widgetShortcutURL("new-task") ?? widgetAppURL()) {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WidgetPalette.accent)
                }
            }
        }
    }

    /// The day, the vault — and, once the snapshot is from an earlier day, when
    /// it is from. Someone who has not opened Plainva since Monday should be
    /// told that rather than left to trust a Wednesday written on Monday.
    private var subtitle: String {
        guard let snapshot = entry.snapshot else { return "" }
        var parts: [String] = [entry.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))]
        if !snapshot.vaultName.isEmpty { parts.append(snapshot.vaultName) }
        if snapshot.isStale(on: entry.day), let written = snapshot.writtenAt {
            parts.append(written.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    @ViewBuilder private var content: some View {
        if let snapshot = entry.snapshot {
            if snapshot.locked {
                // A sealed vault shows the lock, never a list it is trusted to hide.
                empty(snapshot.labels.locked)
            } else {
                let rows = snapshot.rows(on: entry.day, pending: entry.pending)
                if rows.isEmpty {
                    empty(snapshot.labels.empty)
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(rows.prefix(rowLimit)) { row in
                            TodayRow(row: row, snapshot: snapshot, writtenAt: snapshot.writtenAt)
                        }
                    }
                }
            }
        } else {
            // No file yet, or one from a newer Plainva: say so rather than draw
            // an empty day, which would look like good news.
            empty("Plainva")
        }
    }

    private func empty(_ text: String) -> some View {
        Link(destination: widgetShortcutURL("today") ?? widgetAppURL()) {
            HStack {
                Spacer()
                Text(text).font(.caption).foregroundStyle(WidgetPalette.faint)
                Spacer()
            }
            .padding(.top, 10)
        }
    }
}

struct TodayRow: View {
    let row: WidgetSnapshot.Row
    let snapshot: WidgetSnapshot
    let writtenAt: Date?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            mark
            if let minutes = row.minutes {
                Text(widgetClock(minutes))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(WidgetPalette.faint)
            }
            if row.isTask && row.priority > 0 {
                Image(systemName: "flag.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(WidgetPalette.warn)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(row.title)
                    .font(.caption)
                    .foregroundStyle(WidgetPalette.text)
                    .lineLimit(1)
                // The line that keeps the widget honest: the note is unchanged
                // until the app runs, and its reminder still arrives.
                if row.pending && !snapshot.labels.pending.isEmpty {
                    Text(snapshot.labels.pending)
                        .font(.system(size: 9))
                        .foregroundStyle(WidgetPalette.faint)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .modifier(OpenRow(url: widgetOpenURL(row, writtenAt: writtenAt)))
    }

    @ViewBuilder private var mark: some View {
        if !row.isTask {
            // An appointment is not something you tick off.
            Circle().fill(WidgetPalette.accent).frame(width: 7, height: 7)
        } else if #available(iOS 17.0, *) {
            Button(intent: TickTaskIntent(index: row.index)) {
                Image(systemName: row.pending ? "checkmark.square.fill" : "square")
                    .font(.system(size: 13))
                    .foregroundStyle(row.pending ? WidgetPalette.accent : WidgetPalette.faint)
            }
            .buttonStyle(.plain)
        } else {
            // Below iOS 17 a widget cannot act at all, so the box is a picture
            // and the row opens the task instead (plan risk, E3).
            Image(systemName: "square")
                .font(.system(size: 13))
                .foregroundStyle(WidgetPalette.faint)
        }
    }
}

/** A row opens its note; the whole row, not just the words. */
private struct OpenRow: ViewModifier {
    let url: URL?

    func body(content: Content) -> some View {
        if let url {
            Link(destination: url) { content }
        } else {
            content
        }
    }
}
