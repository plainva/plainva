package com.plainva.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.TreeMap;
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

/**
 * Foreign MCP servers on Android (plan KI-Harness P4.5) — the phone's twin of
 * the desktop's {@code src-tauri/src/mcp_client}. The WebView speaks the
 * protocol; this plugin is everything it must not be able to do on its own:
 *
 * 1. the address of a server lives in this plugin's registry, which grows only
 *    through a native dialog that shows the address; a request names a server
 *    id, never a URL;
 * 2. a server's token lives in this plugin's own Keystore box and goes into
 *    the request here; nothing returns it;
 * 3. https (plain http only to this device), redirects are refused, the
 *    headers come from a fixed list, the answer is cut.
 *
 * A phone starts no programs: servers that are programs exist on the desktop only.
 */
@CapacitorPlugin(name = "AiMcp")
public class AiMcpPlugin extends Plugin {

    /** Shared with the sign-in ({@link AiMcpAuthPlugin}): it keeps its entries in the same box. */
    static final Object STORE_LOCK = new Object();
    static final String SERVERS_PREFS = "plainva_ai_mcp_servers";
    private static final int MAX_REQUEST_BYTES = 1024 * 1024;
    /** The protocol code in the WebView stops reading at four megabytes of text. */
    private static final int MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
    private static final int MAX_SECRET = 8192;
    private static final int MAX_HEADERS = 64;

    static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // Read timeout = silence between two bytes; the whole exchange has its own limit per call.
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build();

    private static final Map<String, Call> running = new ConcurrentHashMap<>();

    private KeystoreBox secrets() {
        return new KeystoreBox(getContext(), "plainva_ai_mcp_keys", "plainva_ai_mcp_keys");
    }

    private SharedPreferences servers() {
        return getContext().getSharedPreferences(SERVERS_PREFS, Context.MODE_PRIVATE);
    }

    private static JSObject chunk(String type) {
        JSObject o = new JSObject();
        o.put("type", type);
        return o;
    }

    /** A request that got no answer: one of a fixed set of words, and at most a sentence written in this file. */
    private static JSObject failed(String code, String message) {
        JSObject o = chunk("failed");
        o.put("code", code);
        if (message != null) o.put("message", message);
        return o;
    }

    /** The registry as it is, for the settings to show: what was confirmed, and whether a token is stored — never the token. */
    @PluginMethod
    public void servers(PluginCall call) {
        JSArray list = new JSArray();
        Map<String, ?> all = new TreeMap<>(servers().getAll());
        synchronized (STORE_LOCK) {
            for (Map.Entry<String, ?> entry : all.entrySet()) {
                if (!(entry.getValue() instanceof String)) continue;
                JSObject server = new JSObject();
                server.put("id", entry.getKey());
                server.put("kind", "http");
                server.put("url", (String) entry.getValue());
                server.put("args", new JSArray());
                server.put("env", new JSArray());
                server.put("sandbox", false);
                JSArray stored = new JSArray();
                boolean present;
                try {
                    present = secrets().read(entry.getKey()) != null;
                } catch (Exception e) {
                    present = false;
                }
                if (present) stored.put("");
                server.put("stored", stored);
                list.put(server);
            }
        }
        JSObject ret = new JSObject();
        ret.put("servers", list);
        call.resolve(ret);
    }

    /** Remembers a server after a NATIVE confirmation of its address, so a script in the WebView cannot add one on its own. */
    @PluginMethod
    public void addServer(PluginCall call) {
        String serverId = call.getString("serverId");
        String title = call.getString("title", "Add a server");
        String message = call.getString("message", "Plainva's assistant will be able to send requests to this address.");
        String confirm = call.getString("confirm", "Add");
        String dismiss = call.getString("cancel", "Cancel");
        String address = AiMcpRules.normalizeAddress(call.getString("url"));
        if (!AiMcpRules.validId(serverId) || address == null) {
            call.reject("invalid server");
            return;
        }
        getActivity().runOnUiThread(() ->
            new AlertDialog.Builder(getActivity())
                .setTitle(title)
                .setMessage(message + "\n\n" + address)
                .setPositiveButton(confirm, (d, w) -> {
                    // A new entry under an old id starts without the old one's token, and without its sign-in.
                    synchronized (STORE_LOCK) {
                        try { secrets().write(serverId, null); } catch (Exception ignored) { }
                        AiMcpAuthStore.forget(secrets(), serverId);
                    }
                    boolean ok = servers().edit().putString(serverId, address).commit();
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
    public void removeServer(PluginCall call) {
        String serverId = call.getString("serverId");
        if (serverId == null) { call.reject("serverId required"); return; }
        servers().edit().remove(serverId).commit();
        synchronized (STORE_LOCK) {
            try { secrets().write(serverId, null); } catch (Exception ignored) { }
            AiMcpAuthStore.forget(secrets(), serverId);
        }
        call.resolve();
    }

    /** Stores a server's token. Write-only: no method returns it. */
    @PluginMethod
    public void setSecret(PluginCall call) {
        String serverId = call.getString("serverId");
        String value = call.getString("value");
        String trimmed = value == null ? "" : value.trim();
        if (serverId == null || servers().getString(serverId, null) == null || trimmed.isEmpty() || trimmed.length() > MAX_SECRET || !AiMcpRules.headerValueOk(trimmed)) {
            call.reject("a registered server and a token required");
            return;
        }
        synchronized (STORE_LOCK) {
            try {
                // A fixed token takes the place of a sign-in: a server has one credential, not two.
                AiMcpAuthStore.forget(secrets(), serverId);
                secrets().write(serverId, trimmed);
                call.resolve();
            } catch (Exception e) {
                call.reject("key store write failed");
            }
        }
    }

    @PluginMethod
    public void hasSecret(PluginCall call) {
        String serverId = call.getString("serverId");
        if (serverId == null) { call.reject("serverId required"); return; }
        synchronized (STORE_LOCK) {
            try {
                JSObject ret = new JSObject();
                ret.put("present", secrets().read(serverId) != null);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("key store unavailable");
            }
        }
    }

    @PluginMethod
    public void deleteSecret(PluginCall call) {
        String serverId = call.getString("serverId");
        if (serverId == null) { call.reject("serverId required"); return; }
        synchronized (STORE_LOCK) {
            try {
                secrets().write(serverId, null);
                call.resolve();
            } catch (Exception e) {
                call.reject("key store write failed");
            }
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void request(PluginCall call) {
        String requestId = call.getString("requestId");
        String serverId = call.getString("serverId");
        boolean delete = "DELETE".equals(call.getString("method", "POST"));
        String body = call.getString("body", "");
        JSObject headers = call.getObject("headers", new JSObject());
        int timeoutMs = Math.max(1000, Math.min(300000, call.getInt("timeoutMs", 30000)));
        if (requestId == null || serverId == null) {
            call.reject("requestId and serverId required");
            return;
        }
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if (AiLocalOnly.on()) {
            call.reject("local_only");
            return;
        }
        String address = servers().getString(serverId, null);
        HttpUrl url = address == null ? null : HttpUrl.parse(address);
        if (url == null) {
            call.resolve(failed("refused", "no such server on this device"));
            return;
        }
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_REQUEST_BYTES) {
            call.resolve(failed("refused", "the request is too large"));
            return;
        }
        String token;
        synchronized (STORE_LOCK) {
            try {
                token = secrets().read(serverId);
            } catch (Exception e) {
                call.reject("key store unavailable");
                return;
            }
            // The server's one credential: the token the user stored, or the one a sign-in got.
            if (token == null) token = AiMcpAuthStore.bearer(secrets(), serverId);
        }

        Request.Builder builder = new Request.Builder().url(url);
        if (delete) builder.delete();
        else builder.post(RequestBody.create(payload, (MediaType) null));
        Iterator<String> names = headers.keys();
        int count = 0;
        while (names.hasNext() && count < MAX_HEADERS) {
            String name = names.next();
            String allowed = AiMcpRules.allowedHeader(name);
            String value = headers.optString(name, null);
            if (allowed == null || !AiMcpRules.headerValueOk(value)) continue;
            builder.header(allowed, value);
            count++;
        }
        if (token != null) builder.header("authorization", "Bearer " + token);

        call.setKeepAlive(true);
        Call http = client.newCall(builder.build());
        // One limit for the whole exchange, as the protocol code asked for it.
        http.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS);
        running.put(requestId, http);
        http.enqueue(new Callback() {
            private JSObject broken(Call c, IOException e) {
                if (c.isCanceled()) return chunk("cancelled");
                return failed(AiMcpRules.failureCode(HttpFailure.code(e), e instanceof InterruptedIOException), null);
            }

            @Override
            public void onFailure(Call c, IOException e) {
                running.remove(requestId);
                call.resolve(broken(c, e));
                call.release(getBridge());
            }

            @Override
            public void onResponse(Call c, Response response) {
                try (Response owned = response) {
                    JSObject open = chunk("open");
                    open.put("status", owned.code());
                    String contentType = AiMcpRules.responseHeader(owned.header("content-type"), 200);
                    open.put("contentType", contentType == null ? "" : contentType);
                    String session = AiMcpRules.responseHeader(owned.header("mcp-session-id"), 256);
                    if (session != null) open.put("session", session);
                    String challenge = AiMcpRules.responseHeader(owned.header("www-authenticate"), 2000);
                    if (challenge != null) open.put("challenge", challenge);
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
                    long total = 0;
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        total += read;
                        if (total > MAX_RESPONSE_BYTES) {
                            c.cancel();
                            call.resolve(failed("too-large", null));
                            return;
                        }
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
                    call.resolve(broken(c, e));
                } finally {
                    running.remove(requestId);
                    call.release(getBridge());
                }
            }
        });
    }

    /** Hangs up on an exchange: the protocol's way to stop a request over HTTP. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        Call http = requestId == null ? null : running.remove(requestId);
        if (http != null) http.cancel();
        JSObject ret = new JSObject();
        ret.put("cancelled", http != null);
        call.resolve(ret);
    }
}
