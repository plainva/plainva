package com.plainva.app;

import android.app.Activity;
import android.content.Intent;
import android.widget.Toast;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    // Intent staging and all bridge mutations are serial: a list cannot mark
    // a currently copying entry interrupted, or race an acknowledgement.
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    static void stage(Activity activity, Intent intent, String id) {
        IO.execute(() -> {
            try {
                boolean waiting = new ShareQueue(activity).accept(activity, intent, id);
                if (waiting) activity.runOnUiThread(() -> Toast.makeText(activity, activity.getString(R.string.share_saved), Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                String code = ShareQueue.code(error);
                int message = code.equals("SHARE_LIMIT") ? R.string.share_limit : code.equals("SHARE_QUEUE_FULL") ? R.string.share_full : R.string.share_failed;
                activity.runOnUiThread(() -> Toast.makeText(activity, activity.getString(message), Toast.LENGTH_LONG).show());
            }
            if (activity instanceof MainActivity) {
                MainActivity main = (MainActivity) activity;
                if (main.getBridge() != null) main.getBridge().triggerWindowJSEvent("m-poll-share");
            }
        });
    }
    private interface Work { JSObject run(ShareQueue store) throws Exception; }
    private void execute(PluginCall call, Work work) {
        IO.execute(() -> {
            try { call.resolve(work.run(new ShareQueue(getContext()))); }
            catch (Exception error) { call.reject(ShareQueue.code(error)); }
        });
    }
    @PluginMethod public void listPendingShares(PluginCall call) {
        execute(call, store -> { JSObject result = new JSObject(); result.put("entries", store.list()); return result; });
    }
    @PluginMethod public void readFileChunk(PluginCall call) {
        execute(call, store -> {
            Long offsetArg = JsNumbers.whole(call, "offset"), lengthArg = JsNumbers.whole(call, "length");
            Integer offset = offsetArg == null ? null : offsetArg.intValue(), length = lengthArg == null ? null : lengthArg.intValue();
            if (offset == null || length == null) throw new Exception("SHARE_INVALID");
            JSObject result = new JSObject(); result.put("data", store.chunk(call.getString("id"), call.getString("fileId"), offset, length)); return result;
        });
    }
    @PluginMethod public void beginImport(PluginCall call) {
        execute(call, store -> {
            JSObject plan = call.getObject("plan"); if (plan == null) throw new Exception("SHARE_INVALID");
            JSObject result = new JSObject(); result.put("entry", store.begin(call.getString("id"), plan)); return result;
        });
    }
    @PluginMethod public void markImported(PluginCall call) {
        execute(call, store -> { store.mark(call.getString("id"), call.getString("fileId"), Boolean.TRUE.equals(call.getBoolean("note"))); return new JSObject(); });
    }
    @PluginMethod public void finishShare(PluginCall call) {
        execute(call, store -> { store.finish(call.getString("id"), Boolean.TRUE.equals(call.getBoolean("discard"))); return new JSObject(); });
    }
}
