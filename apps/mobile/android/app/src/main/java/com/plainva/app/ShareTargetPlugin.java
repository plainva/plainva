package com.plainva.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * Receiving side of the Android share sheet (M3E package J): MainActivity
 * stashes ACTION_SEND / ACTION_SEND_MULTIPLE here — plain text as text+subject,
 * images and arbitrary files as base64 payloads. The JS shell polls on boot and
 * on every resume (a warm share foregrounds the app, so appStateChange covers
 * it — no bridge event needed). Single-consumer: reading clears the slot.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    static String pendingText = null;
    static String pendingSubject = null;
    /** Shared file payloads: [{ name, mime, data(base64) }]. */
    static JSONArray pendingFiles = new JSONArray();

    @PluginMethod
    public void consumePendingShare(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", pendingText);
        ret.put("subject", pendingSubject);
        ret.put("files", pendingFiles);
        pendingText = null;
        pendingSubject = null;
        pendingFiles = new JSONArray();
        call.resolve(ret);
    }
}
