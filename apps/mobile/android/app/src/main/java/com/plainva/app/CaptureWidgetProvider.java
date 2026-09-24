package com.plainva.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * The "Quick capture" widget (plan Widgets, W3): two targets, nothing to read.
 *
 * It shows no content at all, which is the point — a capture surface that also
 * displayed something would compete with "Today" for the same glance. It draws
 * the two words from the snapshot when there is one, so the buttons speak the
 * app's language, and falls back to the launcher shortcut labels otherwise:
 * the widget can be placed before Plainva has ever run.
 */
public class CaptureWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetSnapshot snapshot = WidgetSnapshot.parse(WidgetStore.readSnapshot(context));
        String task = snapshot == null || snapshot.labels.newTask.isEmpty()
                ? context.getString(R.string.shortcut_new_task)
                : snapshot.labels.newTask;
        String journal = snapshot == null || snapshot.labels.newJournal.isEmpty()
                ? context.getString(R.string.shortcut_journal)
                : snapshot.labels.newJournal;

        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_capture);
            views.setTextViewText(R.id.capture_task_label, task);
            views.setTextViewText(R.id.capture_journal_label, journal);
            views.setOnClickPendingIntent(R.id.capture_task, deepLink(context, "shortcut/new-task", id * 2));
            views.setOnClickPendingIntent(R.id.capture_journal, deepLink(context, "shortcut/journal", id * 2 + 1));
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent deepLink(Context context, String path, int request) {
        // The scheme is the application id, so a Labs build (com.plainva.app.labs)
        // opens itself, not the store app next to it.
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(context.getPackageName() + "://" + path));
        intent.setClass(context, MainActivity.class);
        return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
