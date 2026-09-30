package com.plainva.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

/**
 * The native AI egress on Android (ADR 0017) — the phone's twin of the
 * desktop's `ai_http` (src-tauri/src/ai_egress.rs). The WebView builds the
 * request specification but never holds a provider key:
 *
 * 1. the key lives in this plugin's own Keystore box and goes into the request
 *    here; nothing returns it, and error texts are scrubbed of it;
 * 2. the URL must lie under a built-in provider or under an endpoint the user
 *    confirmed in a native dialog; redirects are refused, not followed;
 * 3. the answer streams back through a callback as it arrives; cancel stops it;
 * 4. the official OpenAI API always gets {@code store: false}.
 */
@CapacitorPlugin(name = "AiNet")
public class AiNetPlugin extends Plugin {

    private static final Object STORE_LOCK = new Object();
    private static final String ENDPOINTS_PREFS = "plainva_ai_endpoints";
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;
    private static final int MAX_ERROR_BODY_BYTES = 64 * 1024;
    private static final String[] ALLOWED_HEADERS = { "content-type", "accept", "anthropic-version", "anthropic-beta" };

    static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // Read timeout = silence between two bytes: a live stream never trips it.
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build();

    private static final Map<String, Call> running = new ConcurrentHashMap<>();

    static final class Endpoint {
        final String base;
        final String auth; // "x-api-key", "x-goog-api-key" or "bearer"
        final boolean needsKey;
        final boolean officialOpenAi;

        Endpoint(String base, String auth, boolean needsKey, boolean officialOpenAi) {
            this.base = base;
            this.auth = auth;
            this.needsKey = needsKey;
            this.officialOpenAi = officialOpenAi;
        }
    }

    static Endpoint builtin(String id) {
        switch (id) {
            case "anthropic": return new Endpoint("https://api.anthropic.com/", "x-api-key", true, false);
            case "openai": return new Endpoint("https://api.openai.com/", "bearer", true, true);
            case "gemini": return new Endpoint("https://generativelanguage.googleapis.com/", "x-goog-api-key", true, false);
            case "openrouter": return new Endpoint("https://openrouter.ai/api/", "bearer", true, false);
            default: return null;
        }
    }

    private KeystoreBox keys() {
        return new KeystoreBox(getContext(), "plainva_ai_keys", "plainva_ai_keys");
    }

    private SharedPreferences endpoints() {
        return getContext().getSharedPreferences(ENDPOINTS_PREFS, Context.MODE_PRIVATE);
    }

    private Endpoint resolve(String id) {
        Endpoint builtin = builtin(id);
        if (builtin != null) return builtin;
        String base = endpoints().getString(id, null);
        return base == null ? null : new Endpoint(base, "bearer", false, false);
    }

    /** Same origin and path prefix, on the parsed URL — no string prefix games. */
    static boolean urlAllowed(Endpoint endpoint, HttpUrl url) {
        HttpUrl base = HttpUrl.parse(endpoint.base);
        if (base == null || url == null) return false;
        if (!url.username().isEmpty() || !url.password().isEmpty() || url.fragment() != null) return false;
        return url.scheme().equals(base.scheme())
            && url.host().equals(base.host())
            && url.port() == base.port()
            && url.encodedPath().startsWith(base.encodedPath())
            && !url.encodedPath().contains("/../");
    }

    static String redact(String text, String key) {
        if (text == null) return "";
        if (key == null || key.length() < 8) return text;
        return text.replace(key, "[key]").replace("****" + key.substring(key.length() - 4), "****");
    }

    private static JSObject chunk(String type) {
        JSObject o = new JSObject();
        o.put("type", type);
        return o;
    }

    /** A request that never reached a provider — a chunk, like the desktop sends it. */
    private static JSObject failed(String code, String message) {
        JSObject o = chunk("failed");
        o.put("code", code);
        o.put("message", message);
        return o;
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void request(PluginCall call) {
        String requestId = call.getString("requestId");
        String endpointId = call.getString("endpointId");
        String urlText = call.getString("url");
        // GET is the model list of the connection test; every model call is a POST.
        boolean get = "GET".equals(call.getString("method", "POST"));
        JSObject body = call.getObject("body");
        // Instead of a JSON body: raw bytes, a recording to transcribe (AiNetRules).
        JSObject raw = call.getObject("rawBody");
        JSObject headers = call.getObject("headers", new JSObject());
        if (requestId == null || endpointId == null || urlText == null || (!get && body == null && raw == null)) {
            call.reject("requestId, endpointId, url and body required");
            return;
        }
        Endpoint endpoint = resolve(endpointId);
        if (endpoint == null) {
            call.resolve(failed("unknown_endpoint", "unknown AI endpoint"));
            return;
        }
        HttpUrl url = HttpUrl.parse(urlText);
        if (!urlAllowed(endpoint, url)) {
            call.resolve(failed("url_not_allowed", "request URL is not under the endpoint"));
            return;
        }
        byte[] payload = null;
        String rawType = null;
        if (!get && raw != null && body == null) {
            String type = raw.getString("contentType");
            String encoded = raw.getString("base64");
            if (encoded == null || !AiNetRules.rawBodyAllowed(url.encodedPath(), type)) {
                call.resolve(failed("invalid_request", "raw bodies go only to a transcription endpoint"));
                return;
            }
            try {
                payload = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                call.resolve(failed("invalid_request", "the body is not base64"));
                return;
            }
            rawType = type;
            if (payload.length > MAX_BODY_BYTES) {
                call.resolve(failed("too_large", "request too large"));
                return;
            }
        } else if (!get) {
            if (raw != null) {
                call.resolve(failed("invalid_request", "a model call needs exactly one body"));
                return;
            }
            if (endpoint.officialOpenAi && (url.encodedPath().endsWith("/responses") || url.encodedPath().endsWith("/chat/completions"))) {
                body.put("store", false);
            }
            payload = body.toString().getBytes(StandardCharsets.UTF_8);
            if (payload.length > MAX_BODY_BYTES) {
                call.resolve(failed("too_large", "request too large"));
                return;
            }
        }
        String key;
        synchronized (STORE_LOCK) {
            try {
                key = keys().read(endpointId);
            } catch (Exception e) {
                call.reject("key store unavailable");
                return;
            }
        }
        if (endpoint.needsKey && key == null) {
            call.resolve(failed("no_key", "no key stored for this provider"));
            return;
        }

        Request.Builder builder = new Request.Builder().url(url);
        if (payload == null) builder.get();
        else builder.post(RequestBody.create(payload, MediaType.parse(rawType != null ? rawType : "application/json")));
        Iterator<String> names = headers.keys();
        while (names.hasNext()) {
            String name = names.next();
            String value = headers.optString(name, null);
            String lower = name.toLowerCase(Locale.ROOT);
            if (value == null || value.contains("\r") || value.contains("\n")) continue;
            // A raw body names its own type (the multipart boundary is in it).
            if (rawType != null && "content-type".equals(lower)) continue;
            for (String allowed : ALLOWED_HEADERS) {
                if (allowed.equals(lower)) builder.header(lower, value);
            }
        }
        if (key != null) {
            switch (endpoint.auth) {
                case "x-api-key": builder.header("x-api-key", key); break;
                case "x-goog-api-key": builder.header("x-goog-api-key", key); break;
                default: builder.header("authorization", "Bearer " + key);
            }
        }

        call.setKeepAlive(true);
        final String scrubKey = key;
        Call http = client.newCall(builder.build());
        running.put(requestId, http);
        http.enqueue(new Callback() {
            @Override
            public void onFailure(Call c, IOException e) {
                running.remove(requestId);
                JSObject out = chunk(c.isCanceled() ? "cancelled" : "failed");
                if (!c.isCanceled()) {
                    out.put("code", HttpFailure.code(e));
                    out.put("message", redact(e.getMessage(), scrubKey));
                }
                call.resolve(out);
                call.release(getBridge());
            }

            @Override
            public void onResponse(Call c, Response response) {
                try (Response owned = response) {
                    int status = owned.code();
                    if (status >= 300) {
                        String text = owned.body() != null ? owned.peekBody(MAX_ERROR_BODY_BYTES).string() : "";
                        JSObject out = chunk("httpError");
                        out.put("status", status);
                        out.put("body", redact(text, scrubKey));
                        out.put("retryAfter", owned.header("retry-after", ""));
                        call.resolve(out);
                        return;
                    }
                    JSObject open = chunk("open");
                    open.put("status", status);
                    call.resolve(open);
                    if (owned.body() == null) {
                        call.resolve(chunk("done"));
                        return;
                    }
                    CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPLACE)
                        .onUnmappableCharacter(CodingErrorAction.REPLACE);
                    ByteBuffer pending = ByteBuffer.allocate(64 * 1024);
                    CharBuffer chars = CharBuffer.allocate(64 * 1024);
                    byte[] buffer = new byte[16 * 1024];
                    InputStream in = owned.body().byteStream();
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (pending.remaining() < read) {
                            ByteBuffer bigger = ByteBuffer.allocate(pending.capacity() + read * 2);
                            pending.flip();
                            bigger.put(pending);
                            pending = bigger;
                        }
                        pending.put(buffer, 0, read);
                        pending.flip();
                        chars.clear();
                        // Leaves an incomplete UTF-8 sequence in `pending` for the next read.
                        decoder.decode(pending, chars, false);
                        pending.compact();
                        chars.flip();
                        if (chars.hasRemaining()) {
                            JSObject data = chunk("data");
                            data.put("text", chars.toString());
                            call.resolve(data);
                        }
                    }
                    call.resolve(chunk("done"));
                } catch (IOException e) {
                    JSObject out = chunk(c.isCanceled() ? "cancelled" : "failed");
                    if (!c.isCanceled()) {
                        out.put("code", HttpFailure.code(e));
                        out.put("message", redact(e.getMessage(), scrubKey));
                    }
                    call.resolve(out);
                } finally {
                    running.remove(requestId);
                    call.release(getBridge());
                }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        Call http = requestId == null ? null : running.remove(requestId);
        if (http != null) http.cancel();
        JSObject ret = new JSObject();
        ret.put("cancelled", http != null);
        call.resolve(ret);
    }

    /** Stores a provider key. Write-only: no method returns it. */
    @PluginMethod
    public void setKey(PluginCall call) {
        String endpointId = call.getString("endpointId");
        String value = call.getString("value");
        if (endpointId == null || value == null || value.trim().isEmpty() || value.length() > 4096) {
            call.reject("endpointId and a key required");
            return;
        }
        synchronized (STORE_LOCK) {
            try {
                keys().write(endpointId, value.trim());
                call.resolve();
            } catch (Exception e) {
                call.reject("key store write failed");
            }
        }
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("endpointId required"); return; }
        synchronized (STORE_LOCK) {
            try {
                JSObject ret = new JSObject();
                ret.put("present", keys().read(endpointId) != null);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("key store unavailable");
            }
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("endpointId required"); return; }
        synchronized (STORE_LOCK) {
            try {
                keys().write(endpointId, null);
                call.resolve();
            } catch (Exception e) {
                call.reject("key store write failed");
            }
        }
    }

    /**
     * Adds a user endpoint after a NATIVE confirmation, so a script in the
     * WebView cannot add a recipient on its own. Plain http only for this device.
     */
    @PluginMethod
    public void addEndpoint(PluginCall call) {
        String endpointId = call.getString("endpointId");
        String baseUrl = call.getString("baseUrl");
        String title = call.getString("title", "Add an AI server");
        String message = call.getString("message", "Plainva's assistant will send your request and the context you approve to this server.");
        String confirm = call.getString("confirm", "Add");
        String dismiss = call.getString("cancel", "Cancel");
        HttpUrl url = baseUrl == null ? null : HttpUrl.parse(baseUrl.trim());
        if (endpointId == null || !endpointId.matches("[A-Za-z0-9_-]{1,64}") || builtin(endpointId) != null || url == null) {
            call.reject("invalid endpoint");
            return;
        }
        boolean local = url.host().equals("localhost") || url.host().equals("127.0.0.1") || url.host().equals("::1");
        if ((!url.scheme().equals("https") && !local) || !url.username().isEmpty() || !url.password().isEmpty()) {
            call.reject("https required for servers that are not on this device");
            return;
        }
        String path = url.encodedPath().endsWith("/") ? url.encodedPath() : url.encodedPath() + "/";
        // Rebuilt from its parts: no query, no fragment, IPv6 hosts keep their brackets.
        String base = new HttpUrl.Builder().scheme(url.scheme()).host(url.host()).port(url.port()).encodedPath(path).build().toString();
        getActivity().runOnUiThread(() ->
            new AlertDialog.Builder(getActivity())
                .setTitle(title)
                .setMessage(message + "\n\n" + base)
                .setPositiveButton(confirm, (d, w) -> {
                    boolean ok = endpoints().edit().putString(endpointId, base).commit();
                    JSObject ret = new JSObject();
                    ret.put("added", ok);
                    call.resolve(ret);
                })
                .setNegativeButton(dismiss, (d, w) -> {
                    JSObject ret = new JSObject();
                    ret.put("added", false);
                    call.resolve(ret);
                })
                .setOnCancelListener(d -> {
                    JSObject ret = new JSObject();
                    ret.put("added", false);
                    call.resolve(ret);
                })
                .show()
        );
    }

    @PluginMethod
    public void removeEndpoint(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("endpointId required"); return; }
        endpoints().edit().remove(endpointId).commit();
        synchronized (STORE_LOCK) {
            try { keys().write(endpointId, null); } catch (Exception ignored) { }
        }
        call.resolve();
    }
}
