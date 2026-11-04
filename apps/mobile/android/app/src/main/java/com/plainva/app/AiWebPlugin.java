package com.plainva.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * The assistant's page fetch on Android (plan KI-Harness P4, threat T2) — the
 * phone's twin of the desktop's {@code ai_web_fetch} (src-tauri/src/ai_web.rs).
 *
 * A plugin of its own, apart from the AI egress (AiNetPlugin): it reads public
 * pages and has neither a key nor a way to one. The WebView names an address
 * and decides nothing; where a request may go, what it follows and how much
 * it reads is decided here, by AiWebRules:
 *
 * 1. one GET over https to port 443, without credentials, cookies or a body;
 * 2. the name is looked up first, and nothing is sent unless every address of
 *    it is public; the connection then goes to exactly those addresses;
 * 3. no redirect is followed by the client — inside the site the next hop is
 *    checked like the first, to another site the fetch stops and says where;
 * 4. at most five hops, two megabytes and twenty seconds; only text is read.
 */
@CapacitorPlugin(name = "AiWeb")
public class AiWebPlugin extends Plugin {

    private static final String PRIVATE_ADDRESS = "private-address";
    private static final String ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1";
    /** Says who is asking, as the app that it is — the same words in every shell, without a version to tell devices apart by. */
    private static final String USER_AGENT = "Mozilla/5.0 (compatible; Plainva; +https://plainva.com)";
    private static final long DEADLINE_SECONDS = 20;

    /** Redirects stay off: each hop is decided in readPage. OkHttp keeps no cookies and no cache unless given one. */
    private static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .callTimeout(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build();

    /** One fetch under way: the call of its current hop, and whether it was stopped — between two hops too. */
    private static final class Fetch {
        volatile Call call;
        volatile boolean stopped;
    }

    private static final Map<String, Fetch> fetches = new ConcurrentHashMap<>();

    /**
     * The client for one hop. The name was looked up and every address of it
     * found public before this is called; the connection then goes to exactly
     * those addresses — no second lookup that could answer differently (the
     * rebinding trick). Other names (a proxy's) resolve as they always do.
     */
    private static OkHttpClient pinned(String host, List<InetAddress> addresses) {
        return client.newBuilder().dns(name -> name.equalsIgnoreCase(host) ? addresses : Dns.SYSTEM.lookup(name)).build();
    }

    private static JSObject result(String kind) {
        JSObject o = new JSObject();
        o.put("kind", kind);
        return o;
    }

    private static JSObject refused(String problem) {
        JSObject o = result("refused");
        o.put("problem", problem);
        return o;
    }

    private static JSObject failed(String code) {
        JSObject o = result("failed");
        o.put("code", code);
        return o;
    }

    private static JSObject page(String url, int status, String contentType, String body, boolean truncated) {
        JSObject o = result("page");
        o.put("url", url);
        o.put("status", status);
        o.put("contentType", contentType);
        o.put("body", body);
        o.put("truncated", truncated);
        return o;
    }

    /** Reads one page; {@code cancel} with the same id stops it. */
    @PluginMethod
    public void fetchPage(PluginCall call) {
        String requestId = call.getString("requestId");
        String urlText = call.getString("url");
        if (requestId == null || urlText == null) {
            call.reject("requestId and url required");
            return;
        }
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if (AiLocalOnly.on()) {
            call.reject("local_only");
            return;
        }
        AiWebRules.Check start = AiWebRules.checkWebUrl(urlText);
        if (start.target == null) {
            call.resolve(refused(start.problem));
            return;
        }
        Fetch fetch = new Fetch();
        fetches.put(requestId, fetch);
        client.dispatcher().executorService().execute(() -> {
            JSObject answer;
            try {
                answer = readPage(fetch, start.target);
            } finally {
                fetches.remove(requestId, fetch);
            }
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        Fetch fetch = requestId == null ? null : fetches.get(requestId);
        if (fetch != null) {
            fetch.stopped = true;
            Call running = fetch.call;
            if (running != null) running.cancel();
        }
        JSObject out = new JSObject();
        out.put("cancelled", fetch != null);
        call.resolve(out);
    }

    private static JSObject readPage(Fetch fetch, AiWebRules.Target start) {
        AiWebRules.Target target = start;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLINE_SECONDS);
        for (int hops = 0; hops <= AiWebRules.MAX_REDIRECTS; hops++) {
            if (fetch.stopped) return failed("cancelled");
            if (System.nanoTime() > deadline) return failed("timeout");
            // A name that resolves to the router, another device at home or this phone is refused before a byte is sent.
            List<InetAddress> addresses;
            try {
                addresses = Dns.SYSTEM.lookup(target.host);
            } catch (UnknownHostException unknown) {
                return failed("offline");
            }
            if (addresses.isEmpty()) return failed("offline");
            for (InetAddress address : addresses) {
                if (!AiWebRules.isPublicAddress(address)) return refused(PRIVATE_ADDRESS);
            }
            Call http = pinned(target.host, addresses).newCall(new Request.Builder().url(target.url).header("accept", ACCEPT).header("user-agent", USER_AGENT).build());
            fetch.call = http;
            // Stopped while the name was looked up: the hop does not start.
            if (fetch.stopped) return failed("cancelled");
            try (Response response = http.execute()) {
                int status = response.code();
                if (status >= 300 && status < 400) {
                    AiWebRules.Redirect next = AiWebRules.redirectDecision(target, response.header("location"), hops);
                    if ("follow".equals(next.kind)) {
                        target = next.target;
                        continue;
                    }
                    if ("elsewhere".equals(next.kind)) {
                        JSObject out = result("elsewhere");
                        out.put("url", next.target.url);
                        return out;
                    }
                    return refused(next.problem);
                }
                String header = response.header("content-type", "");
                String contentType = header.length() > 200 ? header.substring(0, 200) : header;
                // An error page is not read: the status is the answer.
                if (status < 200 || status >= 300) return page(target.url, status, contentType, "", false);
                String media = AiWebRules.mediaType(contentType);
                if (!media.isEmpty() && !AiWebRules.CONTENT_TYPES.contains(media)) return refused("content-type");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                boolean truncated = false;
                if (response.body() != null) {
                    InputStream in = response.body().byteStream();
                    byte[] buffer = new byte[16 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        int room = AiWebRules.MAX_BYTES - bytes.size();
                        if (read > room) {
                            bytes.write(buffer, 0, room);
                            truncated = true;
                            break;
                        }
                        bytes.write(buffer, 0, read);
                    }
                }
                return page(target.url, status, contentType, AiWebRules.decode(bytes.toByteArray(), contentType), truncated);
            } catch (IOException e) {
                if (http.isCanceled() || fetch.stopped) return failed("cancelled");
                if (e instanceof UnknownHostException) return failed("offline");
                if (e instanceof InterruptedIOException) return failed("timeout");
                return failed(HttpFailure.code(e).startsWith("TLS_") ? "tls" : "offline");
            }
        }
        return refused("too-many");
    }
}
