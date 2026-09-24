package com.plainva.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * What happens when a row of the "Today" widget is tapped (plan Widgets, W3).
 *
 * A separate receiver rather than the provider's own `onReceive`, and the
 * reason is the manifest: an `AppWidgetProvider` HAS to be exported, because
 * the system sends it the widget broadcasts. Exported means any app on the
 * device can send it an explicit intent — and this one ticks tasks off. So the
 * taps land here instead, with `exported="false"`, which the app's own
 * PendingIntents reach and nothing else does.
 *
 * Both actions travel as the row's INDEX and nothing more. A title or a path
 * in an intent would be readable by the launcher.
 */
public class WidgetTapReceiver extends BroadcastReceiver {

    static final String ACTION = "com.plainva.app.WIDGET_ROW";
    static final String EXTRA_INDEX = "com.plainva.app.EXTRA_INDEX";
    static final String EXTRA_ACTION = "com.plainva.app.EXTRA_ACTION";
    static final String OPEN = "open";
    static final String TICK = "tick";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        int index = intent.getIntExtra(EXTRA_INDEX, -1);
        if (index < 0) return;

        if (TICK.equals(intent.getStringExtra(EXTRA_ACTION))) {
            // A tick is an ORDER, not a change: ticking a task off means the
            // database's completion model, the recurrence and the provider
            // sync, and rebuilding that in Java would be a second truth. The
            // widget shows the tick at once; the app redeems it on its next
            // run.
            WidgetStore.enqueue(context, index, System.currentTimeMillis());
            TodayWidgetProvider.refresh(context);
            return;
        }

        // The snapshot travels with the index, for the same reason a tick
        // carries it: an index only means a row within ONE snapshot. If the
        // app has written a newer one since the widget was drawn, this index
        // would now name a different row, and opening the wrong note is worse
        // than opening the day.
        long at = WidgetStore.snapshotWrittenAt(context);
        // The scheme is the application id - see CaptureWidgetProvider.deepLink.
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(context.getPackageName() + "://widget/open/" + index + "?at=" + at));
        open.setClass(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(open);
    }
}
