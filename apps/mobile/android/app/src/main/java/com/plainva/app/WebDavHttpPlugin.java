package com.plainva.app;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Minimal HTTP bridge for WebDAV (M3). CapacitorHttp sits on
 * HttpURLConnection, which rejects non-standard methods (PROPFIND, MKCOL,
 * MOVE, COPY) with "Expected one of [OPTIONS, GET, ...]". OkHttp accepts
 * arbitrary methods, so the shared sync targets get a real fetch. Bodies
 * cross the bridge as UTF-8 strings or base64 (bodyBase64), responses
 * always as base64 so text and binary downloads both work.
 *
 * Origin policy (hardening P4.3, finding M8): the bridge used to accept ANY
 * url from the WebView. Now every request — INCLUDING every redirect hop,
 * enforced via a network interceptor — must target either a fixed provider
 * endpoint (Google/Microsoft/Dropbox APIs and token hosts) or an origin the
 * JS side registered through allowOrigin() when the user configured that
 * server (WebDAV/S3, deliberately including private-network targets the user
 * chose). Responses are capped so a rogue server cannot balloon app memory.
 */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    /** User-configured origins (scheme://host[:port]) — WebDAV servers, S3 endpoints. */
    private static final Set<String> allowedOrigins = Collections.synchronizedSet(new HashSet<>());

    /** Fixed provider hosts (suffix match on the host, https only). */
    private static final String[] PROVIDER_HOST_SUFFIXES = new String[] {
        ".googleapis.com",
        ".google.com",
        "graph.microsoft.com",
        "login.microsoftonline.com",
        "login.live.com",
        ".dropboxapi.com",
        ".dropbox.com",
        ".amazonaws.com",
    };

    /** Hard cap for buffered response bodies (the bridge is not a streamer yet). */
    private static final long MAX_RESPONSE_BYTES = 256L * 1024 * 1024;

    private static String originOf(HttpUrl url) {
        String origin = url.scheme() + "://" + url.host();
        if (url.port() != HttpUrl.defaultPort(url.scheme())) origin += ":" + url.port();
        return origin;
    }

    private static boolean isAllowed(HttpUrl url) {
        if (allowedOrigins.contains(originOf(url))) return true;
        if (!"https".equals(url.scheme())) return false; // fixed providers are https-only
        String host = url.host();
        for (String suffix : PROVIDER_HOST_SUFFIXES) {
            if (suffix.startsWith(".")) {
                if (host.endsWith(suffix) || host.equals(suffix.substring(1))) return true;
            } else if (host.equals(suffix)) {
                return true;
            }
        }
        return false;
    }

    private static final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(true)
        // Network interceptor: runs per HOP, so a redirect to a foreign host
        // is rejected even though followRedirects is on.
        .addNetworkInterceptor(chain -> {
            if (!isAllowed(chain.request().url())) {
                throw new IOException("blocked by origin policy: " + originOf(chain.request().url()));
            }
            Response response = chain.proceed(chain.request());
            long len = response.body() != null ? response.body().contentLength() : -1;
            if (len > MAX_RESPONSE_BYTES) {
                response.close();
                throw new IOException("response exceeds the size cap");
            }
            return response;
        })
        .build();

    private static boolean methodRequiresBody(String method) {
        return method.equals("POST") || method.equals("PUT") || method.equals("PATCH");
    }

    /** Registers a user-configured server origin (called from the sync setup). */
    @PluginMethod
    public void allowOrigin(PluginCall call) {
        String origin = call.getString("origin");
        if (origin == null) {
            call.reject("origin required");
            return;
        }
        HttpUrl parsed = HttpUrl.parse(origin.endsWith("/") ? origin : origin + "/");
        if (parsed == null) {
            call.reject("not a valid origin");
            return;
        }
        allowedOrigins.add(originOf(parsed));
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET").toUpperCase();
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        boolean bodyBase64 = Boolean.TRUE.equals(call.getBoolean("bodyBase64", false));
        if (url == null) {
            call.reject("url required");
            return;
        }
        HttpUrl parsed = HttpUrl.parse(url);
        if (parsed == null) {
            call.reject("invalid url");
            return;
        }
        if (!isAllowed(parsed)) {
            call.reject("blocked by origin policy: " + originOf(parsed));
            return;
        }

        RequestBody requestBody = null;
        if (body != null) {
            byte[] bytes = bodyBase64
                ? Base64.decode(body, Base64.NO_WRAP)
                : body.getBytes(StandardCharsets.UTF_8);
            String contentType = headers.getString("Content-Type");
            if (contentType == null) contentType = headers.getString("content-type");
            requestBody = RequestBody.create(bytes, contentType != null ? MediaType.parse(contentType) : null);
        } else if (methodRequiresBody(method)) {
            requestBody = RequestBody.create(new byte[0], null);
        }

        Request.Builder builder = new Request.Builder().url(parsed).method(method, requestBody);
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (value != null) builder.header(key, value);
        }

        client.newCall(builder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call c, IOException e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "network error");
            }

            @Override
            public void onResponse(Call c, Response response) throws IOException {
                byte[] bytes = response.body() != null ? response.body().bytes() : new byte[0];
                if (bytes.length > MAX_RESPONSE_BYTES) {
                    call.reject("response exceeds the size cap");
                    return;
                }
                JSObject responseHeaders = new JSObject();
                for (String name : response.headers().names()) {
                    responseHeaders.put(name.toLowerCase(), response.headers().get(name));
                }
                JSObject ret = new JSObject();
                ret.put("status", response.code());
                ret.put("headers", responseHeaders);
                ret.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(ret);
            }
        });
    }
}
