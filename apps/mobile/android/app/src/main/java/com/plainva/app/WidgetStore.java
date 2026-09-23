package com.plainva.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * The two files a home-screen widget lives on (plan Widgets, W2).
 *
 * No JavaScript runs while Plainva is closed, so a widget can work nothing
 * out: it draws what the app wrote down the last time it ran. That file is
 * {@code snapshot.json}.
 *
 * The other direction is {@code actions.json}. Ticking a task off means
 * setting a status by the database's completion model, carrying a recurrence
 * forward and syncing the change to a provider — none of which exists in
 * Java, and rebuilding it here would be a second truth. So a tick on the home
 * screen is only an ORDER: the widget shows the tick at once, the app redeems
 * it the next time it opens.
 *
 * Both files live in the app's private storage. On Android that is enough for
 * a widget to read them, because an {@code AppWidgetProvider} runs in the
 * app's own process — unlike iOS, where the widget is a separate process and
 * the same two files have to live in the App Group container.
 *
 * Every write goes through a temp file and a rename, so a process killed
 * mid-write never leaves a half-file that the widget would then fail to parse
 * — and a widget that cannot parse its file has nothing else to show.
 */
public final class WidgetStore {
    private WidgetStore() {}

    private static final String DIR = "widget";
    private static final String SNAPSHOT = "snapshot.json";
    private static final String ACTIONS = "actions.json";

    /** A tick older than this was made against a snapshot nobody can resolve any more. */
    private static final long ACTION_TTL_MS = 7L * 24 * 60 * 60 * 1000;
    /** A bound on a file two processes read: taps accumulate only while the app is never opened. */
    private static final int MAX_ACTIONS = 200;
    /** The snapshot itself is capped at 60 rows by the writer; this is the file-level backstop. */
    private static final int MAX_SNAPSHOT_BYTES = 256 * 1024;

    /** One lock for both files: the provider and the bridge are in the same process. */
    private static final Object LOCK = new Object();

    private static File directory(Context context) {
        File dir = new File(context.getFilesDir(), DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    // ---------------------------------------------------------------- files

    /**
     * Temp file plus rename. {@code File.renameTo} is {@code rename(2)} on the
     * same filesystem, which is atomic — and available on every API level this
     * app supports, unlike {@code java.nio.file.Files}.
     */
    private static void writeAtomically(File target, String content) {
        File dir = target.getParentFile();
        File temp = new File(dir, "." + target.getName() + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(temp);
            try {
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            } finally {
                out.close();
            }
            if (!temp.renameTo(target)) {
                // A failed rename must not leave the stale temp file behind.
                temp.delete();
            }
        } catch (Exception e) {
            temp.delete();
        }
    }

    private static String readFile(File file) {
        if (!file.isFile() || file.length() > MAX_SNAPSHOT_BYTES) return null;
        try {
            FileInputStream in = new FileInputStream(file);
            try {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int read;
                while ((read = in.read(chunk)) > 0) buffer.write(chunk, 0, read);
                return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------- snapshot

    /** What the app last worked out, as the bytes the widget draws. */
    public static void writeSnapshot(Context context, String json) {
        synchronized (LOCK) {
            writeAtomically(new File(directory(context), SNAPSHOT), json);
        }
    }

    /** The snapshot as written, or null when there is none yet or it is unreadable. */
    public static String readSnapshot(Context context) {
        synchronized (LOCK) {
            return readFile(new File(directory(context), SNAPSHOT));
        }
    }

    /** Wipes the snapshot — used when the vault is locked, changed or removed (W6). */
    public static void clearSnapshot(Context context) {
        synchronized (LOCK) {
            new File(directory(context), SNAPSHOT).delete();
        }
    }

    /**
     * When the app wrote the current snapshot. An index only means a row
     * within ONE snapshot, so this is what an order has to name.
     */
    public static long snapshotWrittenAt(Context context) {
        String raw = readSnapshot(context);
        if (raw == null) return 0L;
        try {
            return new JSONObject(raw).optLong("writtenAt", 0L);
        } catch (Exception e) {
            return 0L;
        }
    }

    // --------------------------------------------------------------- orders

    private static JSONArray readActions(Context context) {
        String raw = readFile(new File(directory(context), ACTIONS));
        if (raw == null) return new JSONArray();
        try {
            JSONObject root = new JSONObject(raw);
            if (root.optInt("version", 0) != 1) return new JSONArray();
            JSONArray actions = root.optJSONArray("actions");
            return actions == null ? new JSONArray() : actions;
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void saveActions(Context context, JSONArray actions, long nextId) {
        try {
            JSONObject root = new JSONObject();
            root.put("version", 1);
            root.put("nextId", nextId);
            root.put("actions", actions);
            writeAtomically(new File(directory(context), ACTIONS), root.toString());
        } catch (Exception e) {
            /* an order that cannot be written is one the app never sees — better than a crash on a home screen */
        }
    }

    private static long nextId(Context context) {
        String raw = readFile(new File(directory(context), ACTIONS));
        if (raw == null) return 1L;
        try {
            return Math.max(1L, new JSONObject(raw).optLong("nextId", 1L));
        } catch (Exception e) {
            return 1L;
        }
    }

    /**
     * Records a tick made on the home screen against the snapshot currently on
     * disk. Returns the order's id, or 0 when there was nothing to record.
     */
    public static long enqueue(Context context, int index, long at) {
        synchronized (LOCK) {
            long snapshotAt = snapshotWrittenAt(context);
            if (snapshotAt == 0L || index < 0) return 0L;
            JSONArray existing = readActions(context);
            JSONArray kept = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject action = existing.optJSONObject(i);
                if (action == null) continue;
                // The same row tapped twice is one tick, and an order whose
                // snapshot is long gone can no longer name a row.
                if (action.optLong("snapshotAt") == snapshotAt && action.optInt("index", -1) == index) return action.optLong("id");
                if (at - action.optLong("at") > ACTION_TTL_MS) continue;
                kept.put(action);
            }
            if (kept.length() >= MAX_ACTIONS) return 0L;
            long id = nextId(context);
            try {
                JSONObject action = new JSONObject();
                action.put("id", id);
                action.put("index", index);
                action.put("snapshotAt", snapshotAt);
                action.put("at", at);
                kept.put(action);
            } catch (Exception e) {
                return 0L;
            }
            saveActions(context, kept, id + 1);
            return id;
        }
    }

    /** Every order still waiting, as the bridge hands it to JavaScript. */
    public static JSONArray pendingActions(Context context) {
        synchronized (LOCK) {
            return readActions(context);
        }
    }

    /** Drops the orders the app has redeemed. Clearing by id, never "all". */
    public static void clearActions(Context context, Set<Long> ids) {
        synchronized (LOCK) {
            JSONArray existing = readActions(context);
            JSONArray kept = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject action = existing.optJSONObject(i);
                // A tap that lands between the app READING the queue and
                // clearing it must survive, so only the named ids go.
                if (action != null && !ids.contains(action.optLong("id"))) kept.put(action);
            }
            saveActions(context, kept, nextId(context));
        }
    }

    /**
     * Which rows of the CURRENT snapshot carry a tick that the app has not
     * redeemed yet — what lets the widget show the tick the moment it is made.
     */
    public static Set<Integer> pendingIndexes(Context context) {
        Set<Integer> out = new HashSet<Integer>();
        synchronized (LOCK) {
            long snapshotAt = snapshotWrittenAt(context);
            if (snapshotAt == 0L) return out;
            JSONArray actions = readActions(context);
            for (int i = 0; i < actions.length(); i++) {
                JSONObject action = actions.optJSONObject(i);
                if (action == null || action.optLong("snapshotAt") != snapshotAt) continue;
                int index = action.optInt("index", -1);
                if (index >= 0) out.add(Integer.valueOf(index));
            }
        }
        return out;
    }

    // --------------------------------------------------------------- redraw

    /**
     * Asks every widget of this package to redraw.
     *
     * Two steps, because an update broadcast redraws a widget's own views but
     * does NOT tell a list adapter that its data changed — the rows would keep
     * showing the previous snapshot until the launcher happened to rebind.
     * The package-scoped broadcast reaches whatever providers exist; the
     * explicit call reaches the one that has a list.
     */
    public static void reload(Context context) {
        try {
            Intent intent = new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.setPackage(context.getPackageName());
            context.sendBroadcast(intent);
        } catch (Exception e) {
            /* a redraw that does not happen costs a stale widget, never a crash */
        }
        try {
            TodayWidgetProvider.refresh(context);
        } catch (Exception e) {
            /* same */
        }
    }
}
