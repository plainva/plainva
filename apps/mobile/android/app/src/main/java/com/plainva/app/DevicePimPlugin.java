package com.plainva.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Instances;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * The device's calendars for the JS shell (plan EventKit K3) — Android's
 * CalendarContract provider. Android has no system task store, so every
 * reminder method answers "unsupported"; the shell knows and lists no task
 * lists for this account.
 *
 * Versions: the provider carries no modification date a client may read, so
 * each record's version is a hash of the fields a person can see (title,
 * start, end, notes, location). A change that leaves every visible field
 * alone is invisible to the conflict check — the one place this provider is
 * honestly weaker (parity catalog, `device-pim-accounts`).
 *
 * Occurrences: the Instances table expands series; an occurrence is addressed
 * by its event id plus its own begin time. Editing or deleting ONE occurrence
 * writes an exception row (Events.CONTENT_EXCEPTION_URI), which is how the
 * platform itself models it.
 */
@CapacitorPlugin(
    name = "DevicePim",
    permissions = {
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
    }
)
public class DevicePimPlugin extends Plugin {
    private ContentObserver observer;

    @Override
    public void load() {
        observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                notifyListeners("changed", new JSObject());
            }
        };
        try {
            getContext().getContentResolver().registerContentObserver(CalendarContract.CONTENT_URI, true, observer);
        } catch (SecurityException e) {
            /* without the permission there is nothing to observe yet; the account creation asks for it */
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) getContext().getContentResolver().unregisterContentObserver(observer);
    }

    // ---------------------------------------------------------------- permission

    private String stateName(PermissionState s) {
        if (s == PermissionState.GRANTED) return "fullAccess";
        if (s == PermissionState.DENIED) return "denied";
        return "notDetermined";
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("events", stateName(getPermissionState("calendar")));
        o.put("reminders", "unsupported");
        return o;
    }

    @PluginMethod
    public void authorizationStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("calendar", call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED && observer != null) {
            try {
                getContext().getContentResolver().registerContentObserver(CalendarContract.CONTENT_URI, true, observer);
            } catch (SecurityException e) {
                /* keep going without the trigger */
            }
        }
        call.resolve(status());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ---------------------------------------------------------------- collections

    private static final String[] CAL_PROJECTION = {
        Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.CALENDAR_COLOR,
        Calendars.CALENDAR_ACCESS_LEVEL, Calendars.VISIBLE,
    };

    @PluginMethod
    public void listCollections(PluginCall call) {
        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(Calendars.CONTENT_URI, CAL_PROJECTION, null, null, Calendars.CALENDAR_DISPLAY_NAME)) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(5) == 0) continue; // hidden in the system calendar
                JSObject o = new JSObject();
                o.put("id", String.valueOf(c.getLong(0)));
                o.put("title", c.getString(1) == null ? "" : c.getString(1));
                String account = c.getString(2);
                if (account != null && !account.isEmpty()) o.put("source", account);
                o.put("color", String.format("#%06x", c.getInt(3) & 0xffffff));
                o.put("writable", c.getInt(4) >= Calendars.CAL_ACCESS_CONTRIBUTOR);
                o.put("kind", "event");
                out.put(o);
            }
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("collections", out);
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- events

    private static final String[] INSTANCE_PROJECTION = {
        Instances.EVENT_ID, Instances.TITLE, Instances.BEGIN, Instances.END, Instances.ALL_DAY,
        Instances.EVENT_LOCATION, Instances.DESCRIPTION, Instances.RRULE, Instances.STATUS,
    };

    /** FNV-1a over the visible fields — the version of a record without a modification date. */
    static String fieldVersion(String title, long start, long end, String notes, String location) {
        String text = (title == null ? "" : title) + start + end + (notes == null ? "" : notes) + (location == null ? "" : location);
        int h = 0x811c9dc5;
        for (int i = 0; i < text.length(); i++) {
            h ^= text.charAt(i);
            h *= 0x01000193;
        }
        return "f" + Integer.toHexString(h);
    }

    private JSObject instanceJSON(Cursor c) {
        JSObject o = new JSObject();
        String id = String.valueOf(c.getLong(0));
        String title = c.getString(1);
        long begin = c.getLong(2);
        long end = c.getLong(3);
        String location = c.getString(5);
        String notes = c.getString(6);
        String rrule = c.getString(7);
        o.put("id", id);
        o.put("title", title == null ? "" : title);
        o.put("startTs", begin);
        o.put("endTs", end);
        o.put("allDay", c.getInt(4) == 1);
        if (location != null && !location.isEmpty()) o.put("location", location);
        if (notes != null && !notes.isEmpty()) o.put("notes", notes);
        if (rrule != null && !rrule.isEmpty()) {
            o.put("seriesId", id);
            o.put("rrule", rrule);
        }
        int status = c.getInt(8);
        o.put("status", status == Events.STATUS_CANCELED ? "cancelled" : status == Events.STATUS_TENTATIVE ? "tentative" : "confirmed");
        o.put("version", fieldVersion(title, begin, end, notes, location));
        return o;
    }

    private Cursor queryInstances(long from, long to, String selection, String[] args) {
        Uri.Builder b = Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, from);
        ContentUris.appendId(b, to);
        return getContext().getContentResolver().query(b.build(), INSTANCE_PROJECTION, selection, args, Instances.BEGIN);
    }

    @PluginMethod
    public void events(PluginCall call) {
        String calendarId = call.getString("calendarId");
        long from = call.getDouble("fromTs", 0d).longValue();
        long to = call.getDouble("toTs", 0d).longValue();
        JSArray out = new JSArray();
        try (Cursor c = queryInstances(from, to, Instances.CALENDAR_ID + " = ?", new String[] { calendarId })) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(8) == Events.STATUS_CANCELED) continue; // a cancelled exception is a hole in the series
                out.put(instanceJSON(c));
            }
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("events", out);
        call.resolve(ret);
    }

    private JSObject findInstance(String id, Long occurrenceStartTs) {
        long from, to;
        if (occurrenceStartTs != null) {
            from = occurrenceStartTs - 60_000;
            to = occurrenceStartTs + 60_000;
        } else {
            // A single event: its own DTSTART/DTEND window, read from the Events row.
            try (Cursor e = getContext().getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, Long.parseLong(id)),
                    new String[] { Events.DTSTART, Events.DTEND, Events.LAST_DATE }, null, null, null)) {
                if (e == null || !e.moveToFirst()) return null;
                from = e.getLong(0) - 1;
                to = Math.max(e.getLong(0) + 1, e.isNull(1) ? e.getLong(2) : e.getLong(1));
            }
        }
        try (Cursor c = queryInstances(from, to + 1, Instances.EVENT_ID + " = ?", new String[] { id })) {
            while (c != null && c.moveToNext()) {
                if (occurrenceStartTs == null || Math.abs(c.getLong(2) - occurrenceStartTs) < 60_000) return instanceJSON(c);
            }
        }
        return null;
    }

    @PluginMethod
    public void event(PluginCall call) {
        String id = call.getString("id");
        Double ts = call.getDouble("occurrenceStartTs");
        JSObject ret = new JSObject();
        try {
            JSObject found = findInstance(id, ts == null ? null : ts.longValue());
            ret.put("event", found == null ? JSONObject.NULL : found);
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
            return;
        }
        call.resolve(ret);
    }

    private ContentValues valuesOf(JSObject draft, boolean forInsert) {
        ContentValues v = new ContentValues();
        v.put(Events.TITLE, draft.getString("title", ""));
        long start = draft.optLong("startTs", 0);
        long end = draft.optLong("endTs", 0);
        boolean allDay = draft.optBoolean("allDay", false);
        v.put(Events.DTSTART, start);
        v.put(Events.ALL_DAY, allDay ? 1 : 0);
        v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
        v.put(Events.EVENT_LOCATION, draft.optString("location", ""));
        v.put(Events.DESCRIPTION, draft.optString("notes", ""));
        // A recurring event carries DURATION instead of DTEND — the provider insists.
        String rrule = draft.has("rrule") && !draft.isNull("rrule") ? draft.optString("rrule", "") : null;
        if (draft.has("rrule")) {
            if (rrule != null && !rrule.isEmpty()) {
                v.put(Events.RRULE, rrule);
                v.putNull(Events.DTEND);
                v.put(Events.DURATION, "P" + Math.max(0, (end - start) / 1000) + "S");
            } else {
                v.putNull(Events.RRULE);
                v.putNull(Events.DURATION);
                v.put(Events.DTEND, end);
            }
        } else if (forInsert) {
            v.put(Events.DTEND, end);
        } else {
            v.put(Events.DTEND, end);
        }
        return v;
    }

    @PluginMethod
    public void createEvent(PluginCall call) {
        String calendarId = call.getString("calendarId");
        JSObject draft = call.getObject("draft");
        if (calendarId == null || draft == null) { call.reject("calendarId or draft missing"); return; }
        ContentValues v = valuesOf(draft, true);
        v.put(Events.CALENDAR_ID, Long.parseLong(calendarId));
        try {
            Uri uri = getContext().getContentResolver().insert(Events.CONTENT_URI, v);
            if (uri == null) { call.reject("insert failed"); return; }
            String id = String.valueOf(ContentUris.parseId(uri));
            JSObject rec = findInstance(id, draft.has("rrule") && !draft.isNull("rrule") ? draft.optLong("startTs", 0) : null);
            if (rec == null) rec = draftRecord(id, draft);
            JSObject ret = new JSObject();
            ret.put("event", rec);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
        }
    }

    /** What the row will look like when the Instances view has not caught up yet. */
    private JSObject draftRecord(String id, JSObject draft) {
        JSObject o = new JSObject();
        long start = draft.optLong("startTs", 0);
        long end = draft.optLong("endTs", 0);
        o.put("id", id);
        o.put("title", draft.getString("title", ""));
        o.put("startTs", start);
        o.put("endTs", end);
        o.put("allDay", draft.optBoolean("allDay", false));
        String rrule = draft.has("rrule") && !draft.isNull("rrule") ? draft.optString("rrule", "") : null;
        if (rrule != null && !rrule.isEmpty()) { o.put("seriesId", id); o.put("rrule", rrule); }
        o.put("version", fieldVersion(draft.getString("title", ""), start, end, draft.optString("notes", null), draft.optString("location", null)));
        return o;
    }

    @PluginMethod
    public void updateEvent(PluginCall call) {
        JSObject handle = call.getObject("handle");
        JSObject draft = call.getObject("draft");
        if (handle == null || draft == null) { call.reject("handle or draft missing"); return; }
        String id = handle.getString("id");
        boolean occurrence = handle.has("occurrenceStartTs") && !handle.isNull("occurrenceStartTs") && !draft.has("rrule");
        ContentResolver cr = getContext().getContentResolver();
        try {
            if (occurrence) {
                // One occurrence: an exception row, the platform's own model.
                long original = handle.optLong("occurrenceStartTs", 0);
                ContentValues v = valuesOf(draft, true);
                v.put(Events.ORIGINAL_INSTANCE_TIME, original);
                v.put(Events.STATUS, Events.STATUS_CONFIRMED);
                Uri uri = cr.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, Long.parseLong(id)), v);
                if (uri == null) { call.reject("update failed"); return; }
                String newId = String.valueOf(ContentUris.parseId(uri));
                JSObject rec = findInstance(newId, null);
                if (rec == null) rec = draftRecord(newId, draft);
                JSObject ret = new JSObject();
                ret.put("event", rec);
                call.resolve(ret);
                return;
            }
            ContentValues v = valuesOf(draft, false);
            cr.update(ContentUris.withAppendedId(Events.CONTENT_URI, Long.parseLong(id)), v, null, null);
            JSObject rec = findInstance(id, draft.has("rrule") && !draft.isNull("rrule") ? draft.optLong("startTs", 0) : null);
            if (rec == null) rec = draftRecord(id, draft);
            JSObject ret = new JSObject();
            ret.put("event", rec);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
        }
    }

    @PluginMethod
    public void deleteEvent(PluginCall call) {
        String id = call.getString("id");
        Double ts = call.getDouble("occurrenceStartTs");
        ContentResolver cr = getContext().getContentResolver();
        try {
            if (ts != null) {
                // Cancelling one occurrence is an exception with STATUS_CANCELED.
                ContentValues v = new ContentValues();
                v.put(Events.ORIGINAL_INSTANCE_TIME, ts.longValue());
                v.put(Events.STATUS, Events.STATUS_CANCELED);
                cr.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, Long.parseLong(id)), v);
            } else {
                cr.delete(ContentUris.withAppendedId(Events.CONTENT_URI, Long.parseLong(id)), null, null);
            }
            call.resolve(); // already gone is the goal reached
        } catch (SecurityException e) {
            call.reject("calendar permission missing");
        } catch (Exception e) {
            call.resolve();
        }
    }

    // ---------------------------------------------------------------- reminders (none on Android)

    private void unsupported(PluginCall call) {
        call.reject("unsupported: Android has no system reminder store", "unsupported");
    }

    @PluginMethod public void reminders(PluginCall call) { unsupported(call); }
    @PluginMethod public void reminder(PluginCall call) { unsupported(call); }
    @PluginMethod public void createReminder(PluginCall call) { unsupported(call); }
    @PluginMethod public void updateReminder(PluginCall call) { unsupported(call); }
    @PluginMethod public void deleteReminder(PluginCall call) { unsupported(call); }
}
