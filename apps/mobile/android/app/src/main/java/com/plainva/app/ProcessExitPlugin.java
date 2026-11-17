package com.plainva.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Why the app was last killed, from the system's own record (Android 11+).
 *
 * Android 17 enforces a per-app memory limit (AOSP "Memory Limiter"): an app
 * over its budget is first squeezed into zRAM, then killed. The kill leaves a
 * trace in ApplicationExitInfo with the description "MemoryLimiter:AnonSwap".
 * Reading it on the next start is the only way the app can say "the system
 * ended me over memory" instead of the user guessing (plan 2026-09-04, P1).
 * Read-only: no permission, no user-visible side effect.
 *
 * What goes with an exit (release list F51: an ANR every minute left nothing
 * in the export):
 *  - the build that ran, stored with the process as its state summary
 *    (`setProcessStateSummary`), so an exit names its own build;
 *  - for an ANR, the frames of the main thread and of "CapacitorPlugins"
 *    from the system's thread dump (`getTraceInputStream`), a fixed number
 *    each - frame lines only, never a lock owner or a message;
 *  - for a Java crash, which the system keeps no dump of, the class of the
 *    exception and its frames, written by this plugin's handler into one small
 *    file before the previous handler ends the process as before. The
 *    exception's message is never written: it often carries a path.
 * Everything stays on the device; the JavaScript side scrubs it again and
 * only the export the person shares carries it.
 */
@CapacitorPlugin(name = "ProcessExit")
public class ProcessExitPlugin extends Plugin {

    /** Frames kept per thread or per exception. */
    private static final int MAX_FRAMES = 16;
    /** The crash file: class and frames of the last Java crash. */
    private static final String CRASH_FILE = "diagnostics/last-crash.txt";
    /** Room for the crash record; the handler writes into it without allocating. */
    private static final int CRASH_BYTES = 8 * 1024;

    private static volatile boolean handlerInstalled = false;

    @Override
    public void load() {
        rememberBuild();
        installCrashHandler(getContext());
    }

    /** The build that runs, kept with the process so its exit names it (Android 11+). */
    private void rememberBuild() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        try {
            Context context = getContext();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            String build = info.versionName + " (" + code + ")";
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            am.setProcessStateSummary(build.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            /* a diagnostic that cannot be prepared is left out, never a crash */
        }
    }

    /**
     * Writes the class and frames of an uncaught exception into the crash file,
     * then hands it on to the handler that was there before - the app ends as
     * it always did. The file is opened and the buffer made at start, so the
     * write itself needs no memory; turning the time and the line numbers into
     * text and copying the frames (`getStackTrace`) still allocate a little.
     * Under a real shortage of memory the record can therefore be missing - it
     * is best effort. What never fails is the hand-over: it is in `finally`,
     * after anything that may throw.
     */
    private static synchronized void installCrashHandler(Context context) {
        if (handlerInstalled) return;
        handlerInstalled = true;
        try {
            File file = new File(context.getFilesDir(), CRASH_FILE);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.exists()) return;
            final RandomAccessFile out = new RandomAccessFile(file, "rw");
            final byte[] buffer = new byte[CRASH_BYTES];
            final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
                try {
                    int n = 0;
                    n = put(buffer, n, Long.toString(System.currentTimeMillis()));
                    n = put(buffer, n, "\n");
                    n = put(buffer, n, error.getClass().getName());
                    n = put(buffer, n, "\n");
                    StackTraceElement[] frames;
                    try {
                        frames = error.getStackTrace();
                    } catch (Throwable none) {
                        frames = null;
                    }
                    if (frames != null) {
                        for (int i = 0; i < frames.length && i < MAX_FRAMES; i++) {
                            StackTraceElement frame = frames[i];
                            n = put(buffer, n, "at ");
                            n = put(buffer, n, frame.getClassName());
                            n = put(buffer, n, ".");
                            n = put(buffer, n, frame.getMethodName());
                            n = put(buffer, n, ":");
                            n = put(buffer, n, frame.getLineNumber() >= 0 ? Integer.toString(frame.getLineNumber()) : "?");
                            n = put(buffer, n, "\n");
                        }
                    }
                    out.seek(0);
                    out.write(buffer, 0, n);
                    out.setLength(n);
                    out.getFD().sync();
                } catch (Throwable ignored) {
                    /* the record is best effort; the crash itself must go on to the previous handler */
                } finally {
                    if (previous != null) previous.uncaughtException(thread, error);
                }
            });
        } catch (Exception e) {
            /* without a crash file the exit is still listed, only without frames */
        }
    }

    /** Copies the characters of `text` into `buffer` as ASCII (anything else as '?'), as far as it holds them. */
    private static int put(byte[] buffer, int at, String text) {
        if (text == null) return at;
        for (int i = 0; i < text.length() && at < buffer.length; i++) {
            char c = text.charAt(i);
            buffer[at++] = (byte) (c >= 0x20 && c < 0x7f || c == '\n' ? c : '?');
        }
        return at;
    }

    /**
     * The most recent exits of this package, newest first, at most eight - only
     * those after `since` (ms; what the app has seen already is not read again).
     * Off the plugin thread: an ANR's dump is unpacked and read, and every other
     * plugin call waits on that thread.
     */
    @PluginMethod
    public void lastExits(PluginCall call) {
        final long since = JsNumbers.wholeOr(call, "since", 0L);
        new Thread(() -> call.resolve(readExits(since)), "plainva-exits").start();
    }

    private JSObject readExits(long since) {
        JSArray out = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> infos = am.getHistoricalProcessExitReasons(null, 0, 8);
                String[] crash = readCrashFile();
                boolean crashUsed = false;
                for (ApplicationExitInfo info : infos) {
                    // Seen before: neither listed nor its dump read again.
                    if (info.getTimestamp() <= since) continue;
                    JSObject o = new JSObject();
                    o.put("reason", info.getReason());
                    o.put("description", info.getDescription());
                    o.put("timestamp", info.getTimestamp());
                    o.put("importance", info.getImportance());
                    byte[] summary = info.getProcessStateSummary();
                    if (summary != null && summary.length > 0 && summary.length <= 64) {
                        o.put("build", new String(summary, StandardCharsets.UTF_8));
                    }
                    if (info.getReason() == ApplicationExitInfo.REASON_ANR) {
                        JSArray frames = anrFrames(info);
                        if (frames.length() > 0) o.put("frames", frames);
                    } else if (info.getReason() == ApplicationExitInfo.REASON_CRASH && crash != null && !crashUsed
                            && Math.abs(info.getTimestamp() - Long.parseLong(crash[0])) < 60_000) {
                        // The newest crash the file speaks of; the system's timestamp lags the handler by moments.
                        crashUsed = true;
                        o.put("exception", crash[1]);
                        JSArray frames = new JSArray();
                        for (int i = 2; i < crash.length; i++) frames.put(crash[i]);
                        o.put("frames", frames);
                    }
                    out.put(o);
                }
            } catch (Exception e) {
                /* a diagnostic that cannot be read is an empty list, never a crash */
            }
        }
        JSObject result = new JSObject();
        result.put("exits", out);
        return result;
    }

    /** The crash file's lines (time, class, frames), or null when there is none. */
    private String[] readCrashFile() {
        File file = new File(getContext().getFilesDir(), CRASH_FILE);
        if (!file.isFile() || file.length() == 0 || file.length() > CRASH_BYTES) return null;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.US_ASCII))) {
            List<String> lines = new ArrayList<>();
            String line;
            while ((line = reader.readLine()) != null) lines.add(line);
            if (lines.size() < 2) return null;
            Long.parseLong(lines.get(0));
            return lines.toArray(new String[0]);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The frames of the main thread and of "CapacitorPlugins" in an ANR's
     * thread dump, `MAX_FRAMES` each, each prefixed with its thread. Only
     * frame lines ("at …", "native: …") are taken.
     */
    private static JSArray anrFrames(ApplicationExitInfo info) {
        JSArray frames = new JSArray();
        try (InputStream trace = info.getTraceInputStream()) {
            if (trace == null) return frames;
            BufferedReader reader = new BufferedReader(new InputStreamReader(trace, StandardCharsets.UTF_8));
            String thread = null;
            int taken = 0;
            String line;
            int read = 0;
            while ((line = reader.readLine()) != null && read++ < 20_000) {
                if (line.startsWith("\"")) {
                    String name = line.substring(1, Math.max(1, line.indexOf('"', 1)));
                    thread = "main".equals(name) || "CapacitorPlugins".equals(name) ? name : null;
                    taken = 0;
                    continue;
                }
                if (thread == null || taken >= MAX_FRAMES) continue;
                String frame = line.trim();
                if (frame.startsWith("at ") || frame.startsWith("native: ")) {
                    frames.put(thread + ": " + (frame.length() > 200 ? frame.substring(0, 200) : frame));
                    taken += 1;
                }
            }
        } catch (Exception e) {
            /* no dump, no frames */
        }
        return frames;
    }
}
