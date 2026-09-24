package com.plainva.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Calendar;

/**
 * The "Today" widget (plan Widgets, W3).
 *
 * It draws the snapshot and nothing else: overdue as a count, then the
 * appointments and tasks of the day, in the order the app sorted them. Which
 * day that is, the widget works out itself — so it turns the page at midnight
 * without Plainva having run, and `updatePeriodMillis` gives it half an hour's
 * grace to notice.
 *
 * Every tap travels as the row's INDEX on the app's own scheme. A title or a
 * path in an intent would be readable by the launcher, and a home screen is a
 * place other people look at.
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(context, manager, id);
    }

    /** Redraws every instance, list included. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        manager.notifyAppWidgetViewDataChanged(ids, R.id.today_list);
        for (int id : ids) draw(context, manager, id);
    }

    private static void draw(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        WidgetSnapshot snapshot = WidgetSnapshot.parse(WidgetStore.readSnapshot(context));
        String today = WidgetSnapshot.today();

        // The head is the way back into the app, always - even when there is
        // nothing to show, which is exactly when someone taps it.
        views.setOnClickPendingIntent(R.id.today_head, deepLink(context, "shortcut/today", 1));
        views.setOnClickPendingIntent(R.id.today_add, deepLink(context, "shortcut/new-task", 2));

        if (snapshot == null) {
            // No file yet, or one from a newer Plainva: say so instead of
            // drawing an empty day that looks like good news.
            views.setTextViewText(R.id.today_title, context.getString(R.string.app_name));
            views.setTextViewText(R.id.today_sub, "");
            views.setViewVisibility(R.id.today_overdue, View.GONE);
            views.setViewVisibility(R.id.today_add, View.GONE);
            views.setViewVisibility(R.id.today_list, View.GONE);
            views.setViewVisibility(R.id.today_empty, View.VISIBLE);
            views.setTextViewText(R.id.today_empty, context.getString(R.string.widget_open_app));
            manager.updateAppWidget(id, views);
            return;
        }

        views.setTextViewText(R.id.today_title, snapshot.labels.today);
        views.setTextViewText(R.id.today_sub, subtitle(context, snapshot, today));

        if (snapshot.locked) {
            // A sealed vault shows the lock, not a list it is trusted to hide.
            views.setViewVisibility(R.id.today_overdue, View.GONE);
            views.setViewVisibility(R.id.today_add, View.GONE);
            views.setViewVisibility(R.id.today_list, View.GONE);
            views.setViewVisibility(R.id.today_empty, View.VISIBLE);
            views.setTextViewText(R.id.today_empty, snapshot.labels.locked);
            manager.updateAppWidget(id, views);
            return;
        }

        views.setViewVisibility(R.id.today_add, View.VISIBLE);
        int overdue = snapshot.overdueOn(today);
        views.setViewVisibility(R.id.today_overdue, overdue > 0 ? View.VISIBLE : View.GONE);
        if (overdue > 0) views.setTextViewText(R.id.today_overdue, overdue + " " + snapshot.labels.overdue);

        boolean any = !snapshot.rowsOf(today, null).isEmpty();
        views.setViewVisibility(R.id.today_list, any ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.today_empty, any ? View.GONE : View.VISIBLE);
        if (!any) views.setTextViewText(R.id.today_empty, snapshot.labels.empty);

        Intent service = new Intent(context, TodayWidgetService.class);
        service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        // The data URI makes the intent unique per widget instance; without it
        // every instance would share one adapter.
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.today_list, service);
        views.setEmptyView(R.id.today_list, R.id.today_empty);

        // Aimed at WidgetTapReceiver, which is NOT exported: a provider has to
        // be, and this template ticks tasks off.
        Intent row = new Intent(context, WidgetTapReceiver.class);
        row.setAction(WidgetTapReceiver.ACTION);
        row.setData(Uri.parse("plainva://widget/" + id));
        views.setPendingIntentTemplate(R.id.today_list, PendingIntent.getBroadcast(context, id, row, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));

        manager.updateAppWidget(id, views);
    }

    /**
     * The day, the vault — and, once the snapshot is from an earlier day, when
     * it is from. Someone who has not opened Plainva since Monday should be
     * told that, not left to trust a Wednesday that was written on Monday.
     */
    private static CharSequence subtitle(Context context, WidgetSnapshot snapshot, String today) {
        CharSequence day = DateFormat.format(DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "EEEdMMM"), Calendar.getInstance());
        StringBuilder out = new StringBuilder(day);
        if (snapshot.vaultName != null && snapshot.vaultName.length() > 0) out.append(" · ").append(snapshot.vaultName);
        if (snapshot.staleOn(today)) {
            Calendar written = Calendar.getInstance();
            written.setTimeInMillis(snapshot.writtenAt);
            out.append(" · ").append(context.getString(R.string.widget_as_of, DateFormat.getDateFormat(context).format(written.getTime())));
        }
        return out.toString();
    }

    private static PendingIntent deepLink(Context context, String path, int request) {
        // The scheme is the application id, so a Labs build (com.plainva.app.labs)
        // opens itself, not the store app next to it.
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(context.getPackageName() + "://" + path));
        intent.setClass(context, MainActivity.class);
        return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
