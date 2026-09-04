package com.plainva.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
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
 */
@CapacitorPlugin(name = "ProcessExit")
public class ProcessExitPlugin extends Plugin {

    /** The most recent exits of this package, newest first, at most eight. */
    @PluginMethod
    public void lastExits(PluginCall call) {
        JSArray out = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> infos = am.getHistoricalProcessExitReasons(null, 0, 8);
                for (ApplicationExitInfo info : infos) {
                    JSObject o = new JSObject();
                    o.put("reason", info.getReason());
                    o.put("description", info.getDescription());
                    o.put("timestamp", info.getTimestamp());
                    o.put("importance", info.getImportance());
                    out.put(o);
                }
            } catch (Exception e) {
                /* a diagnostic that cannot be read is an empty list, never a crash */
            }
        }
        JSObject result = new JSObject();
        result.put("exits", out);
        call.resolve(result);
    }
}
