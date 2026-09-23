package com.plainva.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The snapshot as the widget reads it (plan Widgets, W3).
 *
 * The app writes this file; nothing here ever writes it back. A version it
 * does not understand, a file that does not parse, a file that is not there —
 * all three answer the same way, with null, and the widget then says "open
 * Plainva" rather than drawing something invented.
 *
 * The one thing the widget DOES work out for itself is which day it is. That
 * is why the snapshot carries a week: at midnight the widget moves on without
 * the app having run, and a phone nobody opened for two days still shows the
 * right day's rows on Wednesday. It follows that "overdue" is two numbers
 * added together — the count the app wrote (tasks due before the day it ran)
 * plus the task rows that have fallen into the past since.
 */
public final class WidgetSnapshot {

    /** A file from a newer app is refused rather than half-read. */
    public static final int VERSION = 1;

    public final long writtenAt;
    public final String vaultName;
    public final boolean locked;
    /** Tasks that were already overdue when the app wrote this. */
    public final int overdueAtWrite;
    public final List<Row> rows;
    public final Labels labels;

    /** One line of the list. Never a path, never note text. */
    public static final class Row {
        /** Position in this snapshot — what a tap sends back. */
        public final int index;
        public final boolean task;
        /** Empty when the device asked for counters only. */
        public final String title;
        /** `YYYY-MM-DD`. */
        public final String day;
        /** Minutes after midnight, or -1 for something with no time of day. */
        public final int minutes;
        /** 0 = none, 3 = highest. */
        public final int priority;
        /** Ticked on the home screen, waiting for the app to redeem it. */
        public boolean pending;

        Row(int index, boolean task, String title, String day, int minutes, int priority) {
            this.index = index;
            this.task = task;
            this.title = title;
            this.day = day;
            this.minutes = minutes;
            this.priority = priority;
        }
    }

    /** The handful of fixed words, in the app's language — dates are formatted natively. */
    public static final class Labels {
        public final String today, overdue, empty, locked, pending, newTask, newJournal;

        Labels(JSONObject o) {
            today = o.optString("today", "Today");
            overdue = o.optString("overdue", "Overdue");
            empty = o.optString("empty", "");
            locked = o.optString("locked", "");
            pending = o.optString("pending", "");
            newTask = o.optString("newTask", "");
            newJournal = o.optString("newJournal", "");
        }
    }

    private WidgetSnapshot(long writtenAt, String vaultName, boolean locked, int overdueAtWrite, List<Row> rows, Labels labels) {
        this.writtenAt = writtenAt;
        this.vaultName = vaultName;
        this.locked = locked;
        this.overdueAtWrite = overdueAtWrite;
        this.rows = rows;
        this.labels = labels;
    }

    /** Null for anything this reader cannot vouch for. */
    public static WidgetSnapshot parse(String json) {
        if (json == null) return null;
        try {
            JSONObject root = new JSONObject(json);
            if (root.optInt("version", 0) != VERSION) return null;
            JSONArray raw = root.optJSONArray("rows");
            if (raw == null) return null;
            List<Row> rows = new ArrayList<Row>();
            for (int i = 0; i < raw.length(); i++) {
                JSONObject o = raw.optJSONObject(i);
                if (o == null) continue;
                String day = o.optString("day", "");
                if (day.length() != 10) continue;
                rows.add(new Row(
                        o.optInt("index", i),
                        "task".equals(o.optString("kind", "")),
                        o.optString("title", ""),
                        day,
                        o.isNull("minutes") ? -1 : o.optInt("minutes", -1),
                        Math.max(0, Math.min(3, o.optInt("priority", 0)))));
            }
            JSONObject labels = root.optJSONObject("labels");
            return new WidgetSnapshot(
                    root.optLong("writtenAt", 0L),
                    root.optString("vaultName", ""),
                    root.optBoolean("locked", false),
                    Math.max(0, root.optInt("overdue", 0)),
                    rows,
                    new Labels(labels == null ? new JSONObject() : labels));
        } catch (Exception e) {
            return null;
        }
    }

    /** `YYYY-MM-DD` on the device's own clock, which is what "today" means here. */
    public static String today() {
        return dayOf(Calendar.getInstance());
    }

    static String dayOf(Calendar at) {
        return String.format(Locale.US, "%04d-%02d-%02d", at.get(Calendar.YEAR), at.get(Calendar.MONTH) + 1, at.get(Calendar.DAY_OF_MONTH));
    }

    /** The rows of one day, in the order the app sorted them. */
    public List<Row> rowsOf(String day, Set<Integer> pending) {
        List<Row> out = new ArrayList<Row>();
        for (Row row : rows) {
            if (!row.day.equals(day)) continue;
            row.pending = pending != null && pending.contains(Integer.valueOf(row.index));
            out.add(row);
        }
        return out;
    }

    /**
     * How many tasks are overdue AS OF this day: what the app counted, plus
     * the task rows that have slipped into the past since it ran. An
     * appointment that has passed is not overdue — it simply happened.
     */
    public int overdueOn(String day) {
        int extra = 0;
        for (Row row : rows) {
            if (row.task && row.day.compareTo(day) < 0) extra++;
        }
        return overdueAtWrite + extra;
    }

    /** True once the snapshot is from an earlier day — then the widget says when it is from. */
    public boolean staleOn(String day) {
        if (writtenAt <= 0L) return false;
        Calendar written = Calendar.getInstance();
        written.setTimeInMillis(writtenAt);
        return dayOf(written).compareTo(day) < 0;
    }
}
