package com.plainva.app;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * The system's own model on Android (plan KI-Harness P2c, ADR 0021): Gemini
 * Nano through ML Kit's Prompt API, on the phones that have it. No key, no
 * download by Plainva — the system loads the model when asked —, nothing
 * leaves the device.
 *
 * It speaks the egress protocol of AiNet (the same callback chunks): GET
 * {@code platform://gemini-nano/models} answers with the model and its window
 * or why the phone has none, POST {@code platform://gemini-nano/generate}
 * streams the answer as {@code data: {"text": …}} deltas and a closing
 * {@code data: {"stop": …}}. ML Kit needs Android 8; the app runs from 7, so
 * nothing of ML Kit is touched before the version check.
 */
@CapacitorPlugin(name = "PlatformModel")
public class PlatformModelPlugin extends Plugin {

    private static final String BASE = "platform://gemini-nano/";
    private final Executor executor = Executors.newSingleThreadExecutor();
    private final Map<String, Future<?>> running = new ConcurrentHashMap<>();
    private PlatformModelRunner runner;

    private synchronized PlatformModelRunner runner() {
        if (runner == null) runner = new PlatformModelRunner(executor);
        return runner;
    }

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= PlatformModelRules.MIN_SDK;
    }

    private static JSObject chunk(String type) {
        JSObject o = new JSObject();
        o.put("type", type);
        return o;
    }

    private static JSObject failed(String code, String message) {
        JSObject o = chunk("failed");
        o.put("code", code);
        o.put("message", message);
        return o;
    }

    private static JSObject data(String text) {
        JSObject o = chunk("data");
        o.put("text", text);
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!supported()) {
            JSObject r = new JSObject();
            r.put("state", "unavailable");
            r.put("reason", "osTooOld");
            call.resolve(r);
            return;
        }
        runner().status(new PlatformModelRunner.Status() {
            @Override
            public void available(String name, int window) {
                JSObject r = new JSObject();
                r.put("state", "available");
                r.put("model", PlatformModelRules.MODEL_ID);
                r.put("name", name);
                r.put("contextTokens", window);
                call.resolve(r);
            }

            @Override
            public void unavailable(String reason) {
                JSObject r = new JSObject();
                r.put("state", "unavailable");
                r.put("reason", reason);
                call.resolve(r);
            }
        });
    }

    /** Asks the system to load its model; progress goes out as "platformDownload" events. */
    @PluginMethod
    public void download(PluginCall call) {
        if (!supported()) {
            call.reject("osTooOld");
            return;
        }
        runner().download(new PlatformModelRunner.Download() {
            @Override
            public void progress(String state, long bytes) {
                JSObject event = new JSObject();
                event.put("state", state);
                event.put("bytes", bytes);
                notifyListeners("platformDownload", event);
            }

            @Override
            public void finished(PlatformModelRules.Failure failure) {
                if (failure == null) {
                    JSObject r = new JSObject();
                    r.put("started", true);
                    call.resolve(r);
                } else {
                    call.reject(failure.message, failure.code);
                }
            }
        });
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void request(PluginCall call) {
        String requestId = call.getString("requestId");
        String url = call.getString("url");
        if (requestId == null || url == null || !url.startsWith(BASE)) {
            call.resolve(failed("unknown_endpoint", "not the system's model"));
            return;
        }
        if (!supported()) {
            call.resolve(failed("platform_unavailable", "osTooOld"));
            return;
        }
        if ("GET".equals(call.getString("method", "POST"))) {
            if (!url.equals(BASE + "models")) {
                call.resolve(failed("url_not_allowed", "unknown path"));
                return;
            }
            call.setKeepAlive(true);
            runner().status(new PlatformModelRunner.Status() {
                @Override
                public void available(String name, int window) {
                    JSObject open = chunk("open");
                    open.put("status", 200);
                    call.resolve(open);
                    call.resolve(data(PlatformModelRules.modelList(name, window)));
                    call.resolve(chunk("done"));
                    call.release(getBridge());
                }

                @Override
                public void unavailable(String reason) {
                    call.resolve(failed("platform_unavailable", reason));
                    call.release(getBridge());
                }
            });
            return;
        }
        JSObject body = call.getObject("body");
        String prompt = body == null ? null : body.getString("prompt");
        if (!url.equals(BASE + "generate") || prompt == null || prompt.isEmpty()) {
            call.resolve(failed("invalid_request", "a prompt is needed"));
            return;
        }
        String instructions = body.getString("instructions", "");
        Integer asked = body.has("maxOutputTokens") ? body.getInteger("maxOutputTokens") : null;
        call.setKeepAlive(true);
        JSObject open = chunk("open");
        open.put("status", 200);
        call.resolve(open);
        Future<?> future = runner().generate(instructions, prompt, PlatformModelRules.answerTokens(asked), new PlatformModelRunner.Answer() {
            @Override
            public void text(String delta) {
                call.resolve(data(PlatformModelRules.event("text", delta)));
            }

            @Override
            public void done() {
                running.remove(requestId);
                call.resolve(data(PlatformModelRules.event("stop", "end")));
                call.resolve(chunk("done"));
                call.release(getBridge());
            }

            @Override
            public void cancelled() {
                running.remove(requestId);
                call.resolve(chunk("cancelled"));
                call.release(getBridge());
            }

            @Override
            public void failed(PlatformModelRules.Failure failure) {
                running.remove(requestId);
                call.resolve(PlatformModelPlugin.failed(failure.code, failure.message));
                call.release(getBridge());
            }
        });
        running.put(requestId, future);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null) {
            call.reject("requestId required");
            return;
        }
        Future<?> future = running.remove(requestId);
        if (future != null) future.cancel(true);
        JSObject r = new JSObject();
        r.put("cancelled", future != null);
        call.resolve(r);
    }
}
