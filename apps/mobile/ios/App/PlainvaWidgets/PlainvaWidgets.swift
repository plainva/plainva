import SwiftUI
import WidgetKit

/**
 * The widget bundle (plan Widgets, W4): four widgets, one extension.
 *
 * Two for the home screen and two for the lock screen. They share a timeline
 * provider because they share a source — the one snapshot the app writes — and
 * a second provider would be a second chance to disagree about what day it is.
 */
@main
struct PlainvaWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        CaptureWidget()
        DueCountWidget()
        NextTaskWidget()
    }
}
