package com.plainva.app;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import okhttp3.Call;
import okhttp3.Callback;
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
 */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    private static final OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(true)
        .build();

    private static boolean methodRequiresBody(String method) {
        return method.equals("POST") || method.equals("PUT") || method.equals("PATCH");
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

        Request.Builder builder = new Request.Builder().url(url).method(method, requestBody);
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
