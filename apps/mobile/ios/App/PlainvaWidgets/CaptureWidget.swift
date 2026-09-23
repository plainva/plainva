import SwiftUI
import WidgetKit

/**
 * "Quick capture" (plan Widgets, W4/E1): two targets, nothing to read.
 *
 * It shows no content at all, on purpose — a capture surface that also
 * displayed the day would compete with "Today" for the same glance, and the
 * two are meant to sit side by side. The words come from the snapshot so they
 * follow the app's language; before Plainva has ever run there is no snapshot,
 * and the two symbols carry it alone.
 */
struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlainvaCapture", provider: PlainvaProvider()) { entry in
            CaptureWidgetView(entry: entry)
                .widgetSurface(Color(uiColor: .systemBackground))
        }
        .configurationDisplayName("Plainva")
        .description(Text(verbatim: "Quick capture"))
        .supportedFamilies([.systemSmall])
    }
}

struct CaptureWidgetView: View {
    let entry: PlainvaEntry

    var body: some View {
        VStack(spacing: 8) {
            target(symbol: "checklist", text: entry.snapshot?.labels.newTask ?? "", url: widgetShortcutURL("new-task"))
            target(symbol: "square.and.pencil", text: entry.snapshot?.labels.newJournal ?? "", url: widgetShortcutURL("journal"))
        }
    }

    private func target(symbol: String, text: String, url: URL?) -> some View {
        Link(destination: url ?? URL(string: "com.plainva.app://")!) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(WidgetPalette.accent)
                if !text.isEmpty {
                    Text(text)
                        .font(.caption)
                        .foregroundStyle(WidgetPalette.text)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WidgetPalette.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}
