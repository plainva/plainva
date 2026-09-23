package com.plainva.app;

import android.content.Context;
import android.content.Intent;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Set;

/**
 * The rows of the "Today" widget (plan Widgets, W3).
 *
 * A `RemoteViewsFactory` is the only way an app widget gets a scrolling list,
 * and it runs in the app's process whenever the launcher asks. Everything it
 * needs is already on disk: it re-reads the snapshot on every refresh rather
 * than holding one, because the launcher may ask hours after the app last ran
 * and a stale field would draw a day that has gone.
 *
 * Dates and times are formatted with the DEVICE's locale and clock setting.
 * The app's language decides the handful of fixed words in the snapshot; how
 * a time is written is a property of the phone, and the rest of the home
 * screen already follows it.
 */
public class TodayWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private List<WidgetSnapshot.Row> rows = new ArrayList<WidgetSnapshot.Row>();
        private String pendingLabel = "";

        Factory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            WidgetSnapshot snapshot = WidgetSnapshot.parse(WidgetStore.readSnapshot(context));
            if (snapshot == null || snapshot.locked) {
                rows = new ArrayList<WidgetSnapshot.Row>();
                pendingLabel = "";
                return;
            }
            Set<Integer> pending = WidgetStore.pendingIndexes(context);
            rows = snapshot.rowsOf(WidgetSnapshot.today(), pending);
            pendingLabel = snapshot.labels.pending;
        }

        @Override
        public void onDestroy() {
            rows = new ArrayList<WidgetSnapshot.Row>();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= rows.size()) return null;
            WidgetSnapshot.Row row = rows.get(position);
            RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.widget_today_row);

            // A task carries a box to tick; an appointment carries a dot,
            // because an appointment is not something you tick off.
            view.setViewVisibility(R.id.row_check, row.task ? View.VISIBLE : View.GONE);
            view.setViewVisibility(R.id.row_dot, row.task ? View.GONE : View.VISIBLE);
            if (row.task) {
                view.setImageViewResource(R.id.row_check, row.pending ? R.drawable.widget_check_done : R.drawable.widget_check_open);
            }

            view.setTextViewText(R.id.row_title, row.title);
            view.setViewVisibility(R.id.row_time, row.minutes >= 0 ? View.VISIBLE : View.GONE);
            if (row.minutes >= 0) view.setTextViewText(R.id.row_time, clock(row.minutes));

            // Priority shows as a flag, and only when there is one to show.
            view.setViewVisibility(R.id.row_flag, row.task && row.priority > 0 ? View.VISIBLE : View.GONE);

            // The one line that explains a tick that has not been applied yet.
            view.setViewVisibility(R.id.row_pending, row.pending ? View.VISIBLE : View.GONE);
            if (row.pending) view.setTextViewText(R.id.row_pending, pendingLabel);

            // Two targets in one row: the box records an order, the rest opens
            // the note. Both travel as the row's INDEX - never a title, never
            // a path, because an intent is readable by the launcher.
            Intent open = new Intent();
            open.putExtra(WidgetTapReceiver.EXTRA_INDEX, row.index);
            open.putExtra(WidgetTapReceiver.EXTRA_ACTION, WidgetTapReceiver.OPEN);
            view.setOnClickFillInIntent(R.id.row_body, open);

            Intent tick = new Intent();
            tick.putExtra(WidgetTapReceiver.EXTRA_INDEX, row.index);
            tick.putExtra(WidgetTapReceiver.EXTRA_ACTION, WidgetTapReceiver.TICK);
            view.setOnClickFillInIntent(R.id.row_check, tick);

            return view;
        }

        /** The device's own 12/24-hour setting, not the app's. */
        private CharSequence clock(int minutes) {
            Calendar at = Calendar.getInstance();
            at.set(Calendar.HOUR_OF_DAY, minutes / 60);
            at.set(Calendar.MINUTE, minutes % 60);
            return DateFormat.getTimeFormat(context).format(at.getTime());
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position >= 0 && position < rows.size() ? rows.get(position).index : position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
