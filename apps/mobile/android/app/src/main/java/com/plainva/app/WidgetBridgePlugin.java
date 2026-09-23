package com.plainva.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * The bridge between the app and its home-screen widgets (plan Widgets, W2).
 *
 * Four calls, and no judgement in any of them: the app decides what a widget
 * shows and when, {@link WidgetStore} holds the bytes, and this class only
 * carries them across. Everything it touches is the app's own private storage
 * — no permission, nothing another application can reach.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    /** What the widgets draw until the app next runs. */
    @PluginMethod
    public void writeSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json required");
            return;
        }
        WidgetStore.writeSnapshot(getContext(), json);
        WidgetStore.reload(getContext());
        call.resolve();
    }

    /**
     * What is on disk right now. The app reads its own snapshot back after a
     * cold start -- a tap on a widget can be the thing that started the
     * process, and then nothing is in memory to resolve the index against.
     */
    @PluginMethod
    public void readSnapshot(PluginCall call) {
        JSObject result = new JSObject();
        result.put("json", WidgetStore.readSnapshot(getContext()));
        call.resolve(result);
    }

    /** Wipes it — the vault was locked, changed or removed (W6). */
    @PluginMethod
    public void clearSnapshot(PluginCall call) {
        WidgetStore.clearSnapshot(getContext());
        WidgetStore.reload(getContext());
        call.resolve();
    }

    /** The ticks made on the home screen since the app last looked. */
    @PluginMethod
    public void readPendingActions(PluginCall call) {
        JSONArray actions = WidgetStore.pendingActions(getContext());
        JSArray out = new JSArray();
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action == null) continue;
            JSObject entry = new JSObject();
            entry.put("id", action.optLong("id"));
            entry.put("index", action.optInt("index", -1));
            entry.put("snapshotAt", action.optLong("snapshotAt"));
            entry.put("at", action.optLong("at"));
            out.put(entry);
        }
        JSObject result = new JSObject();
        result.put("actions", out);
        call.resolve(result);
    }

    /**
     * Drops the orders the app has redeemed — by id, never wholesale: a tap
     * that lands between the read and this call has to survive it.
     */
    @PluginMethod
    public void clearPendingActions(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<Long> set = new HashSet<Long>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                try {
                    set.add(Long.valueOf(ids.getLong(i)));
                } catch (Exception e) {
                    /* an id that is not a number names no order */
                }
            }
        }
        WidgetStore.clearActions(getContext(), set);
        call.resolve();
    }

    /** Asks every widget to redraw from what is on disk. */
    @PluginMethod
    public void reloadWidgets(PluginCall call) {
        WidgetStore.reload(getContext());
        call.resolve();
    }
}
