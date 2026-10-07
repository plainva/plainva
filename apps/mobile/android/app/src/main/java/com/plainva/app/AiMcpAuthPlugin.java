package com.plainva.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Signing in to a remote MCP server on Android (plan KI-Harness P4.5): OAuth
 * 2.1 with PKCE — the phone's twin of the desktop's {@code mcp_client/oauth.rs}.
 *
 * The WebView opens a browser and hands back what it returned with. That is
 * all it does: the verifier, the exchange of the code, the tokens and their
 * renewal stay in this plugin, and so does the choice of WHERE a code or a
 * token is sent — the endpoints come from a document this plugin fetched
 * itself, from an address on the authorization server's own origin, whose
 * issuer is the one that was asked for. A token is asked for the server's
 * registered address, kept under the server's id, and put into requests to
 * that address only ({@link AiMcpPlugin}).
 *
 * The decisions are {@link AiMcpOAuthRules}; what is kept, {@link AiMcpAuthStore}.
 */
@CapacitorPlugin(name = "AiMcpAuth")
public class AiMcpAuthPlugin extends Plugin {

    /** A document of a sign-in is small; more than this is not one. */
    private static final int MAX_REPLY_BYTES = 256 * 1024;
    /** A renewal this fresh is not made again: a second request that was refused with the old token finds the new one. */
    private static final long RECENT_MS = 10_000;

    private static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build();

    /** One request of a sign-in at a time: a renewal never overtakes another, and a token for the next is used once. */
    private static final ExecutorService work = Executors.newSingleThreadExecutor();
    /** The authorization server each server was last asked about. */
    private static final Map<String, AiMcpOAuthRules.Endpoints> issuers = new ConcurrentHashMap<>();
    private static final Map<String, Long> renewed = new ConcurrentHashMap<>();

    private KeystoreBox box() {
        return new KeystoreBox(getContext(), "plainva_ai_mcp_keys", "plainva_ai_mcp_keys");
    }

    /** The registered address of a server; null where there is none. */
    private String address(String serverId) {
        if (serverId == null) return null;
        SharedPreferences servers = getContext().getSharedPreferences(AiMcpPlugin.SERVERS_PREFS, Context.MODE_PRIVATE);
        return servers.getString(serverId, null);
    }

    private static final class Reply {
        final int status;
        final String body;

        Reply(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private static AiMcpOAuthRules.Problem problem(String word) {
        return new AiMcpOAuthRules.Problem(word);
    }

    /**
     * One request of a sign-in. An address on the server's own host is the
     * one the user confirmed; every other one must resolve to public
     * addresses, and the connection goes to exactly those. No redirect is
     * followed; the answer is cut. {@code body} null is a GET.
     */
    private static Reply ask(String url, String serverUrl, String contentType, String body, String basic) throws AiMcpOAuthRules.Problem {
        HttpUrl target = url == null ? null : HttpUrl.parse(url);
        HttpUrl own = serverUrl == null ? null : HttpUrl.parse(serverUrl);
        if (target == null) throw problem("oauth-address");
        OkHttpClient http = client;
        if (own == null || !target.host().equals(own.host())) {
            if (!target.isHttps()) throw problem("oauth-address");
            final String host = target.host();
            final List<InetAddress> found;
            try {
                found = Dns.SYSTEM.lookup(host);
            } catch (IOException e) {
                throw problem("oauth-unreachable");
            }
            if (found.isEmpty()) throw problem("oauth-unreachable");
            for (InetAddress candidate : found) {
                if (!AiWebRules.isPublicAddress(candidate)) throw problem("oauth-address");
            }
            http = client.newBuilder().dns(name -> name.equalsIgnoreCase(host) ? found : Dns.SYSTEM.lookup(name)).build();
        }
        Request.Builder request = new Request.Builder().url(target).header("accept", "application/json");
        if (body != null) request.post(RequestBody.create(body.getBytes(StandardCharsets.UTF_8), MediaType.parse(contentType)));
        if (basic != null) request.header("authorization", "Basic " + basic);
        try (Response response = http.newCall(request.build()).execute()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (response.body() != null) {
                InputStream in = response.body().byteStream();
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (bytes.size() + read > MAX_REPLY_BYTES) throw problem("oauth-unreachable");
                    bytes.write(buffer, 0, read);
                }
            }
            return new Reply(response.code(), new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw problem("oauth-unreachable");
        }
    }

    /** The request's own credential of a client that proves itself that way: id and secret, form-encoded before they are joined (RFC 6749, section 2.3.1). */
    private static String basicOf(AiMcpOAuthRules.Client who) {
        if (!"basic".equals(who.auth) || who.secret == null) return null;
        String joined = AiMcpOAuthRules.formEncode(who.id) + ":" + AiMcpOAuthRules.formEncode(who.secret);
        return Base64.encodeToString(joined.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private static AiMcpOAuthRules.Client clientOf(JSONObject from) {
        String id = AiMcpAuthStore.text(from, "clientId");
        String auth = AiMcpAuthStore.text(from, "auth");
        return id == null ? null : new AiMcpOAuthRules.Client(id, auth == null ? "none" : auth, AiMcpAuthStore.text(from, "clientSecret"));
    }

    private static List<String> strings(JSONArray list) {
        List<String> out = new ArrayList<>();
        for (int i = 0; list != null && i < list.length(); i++) {
            Object entry = list.opt(i);
            if (entry instanceof String) out.add((String) entry);
        }
        return out;
    }

    /** A document a server names for its sign-in (its resource metadata, RFC 9728). No secret, and none is sent. */
    @PluginMethod
    public void document(PluginCall call) {
        String serverUrl = address(call.getString("serverId"));
        String target = serverUrl == null ? null : AiMcpOAuthRules.oauthAddress(call.getString("url"), serverUrl);
        if (target == null) {
            call.reject("oauth-address");
            return;
        }
        work.execute(() -> {
            try {
                Reply reply = ask(target, serverUrl, null, null, null);
                JSObject ret = new JSObject();
                ret.put("status", reply.status);
                ret.put("body", reply.body);
                call.resolve(ret);
            } catch (AiMcpOAuthRules.Problem e) {
                call.reject(e.word);
            }
        });
    }

    /** Reads an authorization server's metadata from an address on its own origin and keeps it for the sign-in. */
    @PluginMethod
    public void issuer(PluginCall call) {
        String serverId = call.getString("serverId");
        String issuer = call.getString("issuer");
        String url = call.getString("url");
        String serverUrl = address(serverId);
        String target = serverUrl == null || !AiMcpOAuthRules.issuerDocumentUrlOk(issuer, url) ? null : AiMcpOAuthRules.oauthAddress(url, serverUrl);
        if (target == null) {
            call.reject("oauth-address");
            return;
        }
        work.execute(() -> {
            try {
                Reply reply = ask(target, serverUrl, null, null, null);
                if (reply.status != 200) throw problem("oauth-no-metadata");
                AiMcpOAuthRules.Endpoints found = AiMcpOAuthRules.readIssuerDocument(reply.body, issuer, serverUrl);
                issuers.put(serverId, found);
                // What the WebView is told: what the authorization server offers, not where its endpoints are.
                JSObject info = new JSObject();
                info.put("issuer", found.issuer);
                info.put("document", found.document);
                info.put("dynamic", found.registration != null);
                info.put("iss", found.iss);
                info.put("scopes", new JSArray(found.scopes));
                JSObject ret = new JSObject();
                ret.put("issuer", info);
                call.resolve(ret);
            } catch (AiMcpOAuthRules.Problem e) {
                call.reject(e.word);
            }
        });
    }

    /**
     * Begins a sign-in: decides who Plainva is to the authorization server,
     * makes the verifier and the state, and answers with the address to
     * open. The verifier stays here.
     */
    @PluginMethod
    public void begin(PluginCall call) {
        String serverId = call.getString("serverId");
        String issuer = call.getString("issuer");
        String resource = call.getString("resource");
        String kind = call.getString("clientKind", "");
        String givenId = call.getString("clientId", "");
        String clientName = call.getString("clientName", "Plainva");
        List<String> scopes = new ArrayList<>();
        for (String scope : strings(call.getArray("scopes", new JSArray()))) {
            if (AiMcpOAuthRules.scopeOk(scope) && scopes.size() < AiMcpOAuthRules.MAX_SCOPES) scopes.add(scope);
        }
        String serverUrl = address(serverId);
        if (serverUrl == null) {
            call.reject("oauth-address");
            return;
        }
        AiMcpOAuthRules.Endpoints endpoints = issuers.get(serverId);
        if (endpoints == null || !endpoints.issuer.equals(issuer)) {
            call.reject("oauth-no-metadata");
            return;
        }
        if (!AiMcpOAuthRules.resourceCovers(resource, serverUrl)) {
            call.reject("oauth-resource");
            return;
        }
        String redirect = AiMcpOAuthRules.redirectUri(getContext().getPackageName());
        if (redirect == null) {
            call.reject("oauth-address");
            return;
        }
        work.execute(() -> {
            try {
                JSONObject kept;
                synchronized (AiMcpPlugin.STORE_LOCK) {
                    kept = AiMcpAuthStore.link(box(), serverId);
                }
                if (kept != null && !endpoints.issuer.equals(AiMcpAuthStore.text(kept, "issuer"))) kept = null;
                AiMcpOAuthRules.Client who;
                String whoKind;
                if ("document".equals(kind)) {
                    String id = endpoints.document ? AiMcpOAuthRules.clientId(true, givenId) : null;
                    if (id == null) throw problem("oauth-client");
                    who = new AiMcpOAuthRules.Client(id, "none", null);
                    whoKind = "document";
                } else if ("manual".equals(kind)) {
                    String id = AiMcpOAuthRules.clientId(false, givenId);
                    if (id == null) throw problem("oauth-client");
                    who = new AiMcpOAuthRules.Client(id, "none", null);
                    whoKind = "manual";
                } else if (kept != null && clientOf(kept) != null && (!"dynamic".equals(AiMcpAuthStore.text(kept, "kind")) || redirect.equals(AiMcpAuthStore.text(kept, "redirectUri")))) {
                    who = clientOf(kept);
                    whoKind = AiMcpAuthStore.text(kept, "kind");
                } else if ("stored".equals(kind) && kept == null) {
                    throw problem("oauth-client");
                } else {
                    // A registration is for one way back: another one is another registration.
                    if (endpoints.registration == null) throw problem("oauth-client");
                    Reply reply = ask(endpoints.registration, serverUrl, "application/json", AiMcpOAuthRules.registrationBody(clientName, redirect), null);
                    who = AiMcpOAuthRules.readRegistration(reply.status, reply.body);
                    if (who == null) throw problem("oauth-registration");
                    whoKind = "dynamic";
                }
                String verifier = AiMcpOAuthRules.random(32);
                String state = AiMcpOAuthRules.random(16);
                String url = AiMcpOAuthRules.authorizationUrl(endpoints.authorization, who.id, redirect, AiMcpOAuthRules.pkceChallenge(verifier), state, scopes, resource);
                if (url == null) throw problem("oauth-endpoints");
                JSONObject pending = new JSONObject();
                AiMcpAuthStore.put(pending, "serverId", serverId);
                AiMcpAuthStore.put(pending, "serverUrl", serverUrl);
                AiMcpAuthStore.put(pending, "issuer", endpoints.issuer);
                AiMcpAuthStore.put(pending, "iss", endpoints.iss);
                AiMcpAuthStore.put(pending, "tokenEndpoint", endpoints.token);
                AiMcpAuthStore.put(pending, "clientId", who.id);
                AiMcpAuthStore.put(pending, "auth", who.auth);
                AiMcpAuthStore.put(pending, "clientSecret", who.secret);
                AiMcpAuthStore.put(pending, "kind", whoKind);
                AiMcpAuthStore.put(pending, "verifier", verifier);
                AiMcpAuthStore.put(pending, "state", state);
                AiMcpAuthStore.put(pending, "redirectUri", redirect);
                AiMcpAuthStore.put(pending, "scopes", new JSONArray(scopes));
                AiMcpAuthStore.put(pending, "resource", resource);
                AiMcpAuthStore.put(pending, "begun", System.currentTimeMillis());
                synchronized (AiMcpPlugin.STORE_LOCK) {
                    AiMcpAuthStore.keepPending(box(), pending);
                }
                JSObject ret = new JSObject();
                ret.put("url", url);
                call.resolve(ret);
            } catch (AiMcpOAuthRules.Problem e) {
                call.reject(e.word);
            } catch (Exception e) {
                call.reject("oauth-failed");
            }
        });
    }

    /**
     * Ends a sign-in with what the browser came back with: checks it against
     * what was begun, exchanges the code and keeps the tokens. Answers with
     * the id of the server that is signed in to now — and with nothing else.
     */
    @PluginMethod
    public void finish(PluginCall call) {
        String state = call.getString("state");
        String code = call.getString("code");
        String iss = call.getString("iss");
        String error = call.getString("error");
        work.execute(() -> {
            try {
                JSONObject flow;
                String refused = null;
                synchronized (AiMcpPlugin.STORE_LOCK) {
                    flow = AiMcpAuthStore.pending(box());
                    boolean live = flow != null && System.currentTimeMillis() - flow.optLong("begun", 0) < AiMcpOAuthRules.PENDING_MS;
                    try {
                        AiMcpOAuthRules.checkRedirect(live ? AiMcpAuthStore.text(flow, "state") : null, AiMcpAuthStore.text(flow, "issuer"), flow != null && flow.optBoolean("iss", false), state, code, iss, error);
                    } catch (AiMcpOAuthRules.Problem e) {
                        refused = e.word;
                    }
                    // An answer to nothing that was begun leaves what was begun alone: the real one may still come.
                    if (!"oauth-no-flow".equals(refused)) AiMcpAuthStore.keepPending(box(), null);
                }
                if (refused != null) throw problem(refused);
                String serverId = AiMcpAuthStore.text(flow, "serverId");
                String serverUrl = AiMcpAuthStore.text(flow, "serverUrl");
                // The server may have gone, or become another one, while the browser was open.
                if (serverId == null || serverUrl == null || !serverUrl.equals(address(serverId))) throw problem("oauth-no-flow");
                AiMcpOAuthRules.Client who = clientOf(flow);
                String resource = AiMcpAuthStore.text(flow, "resource");
                String form = AiMcpOAuthRules.formBody(AiMcpOAuthRules.codeForm(code, AiMcpAuthStore.text(flow, "verifier"), AiMcpAuthStore.text(flow, "redirectUri"), who, resource));
                Reply reply = ask(AiMcpAuthStore.text(flow, "tokenEndpoint"), serverUrl, "application/x-www-form-urlencoded", form, basicOf(who));
                AiMcpOAuthRules.Tokens tokens = AiMcpOAuthRules.readTokenResponse(reply.status, reply.body);
                JSONObject link = new JSONObject();
                for (String name : new String[] { "issuer", "tokenEndpoint", "clientId", "auth", "clientSecret", "kind", "redirectUri", "resource" }) {
                    AiMcpAuthStore.put(link, name, AiMcpAuthStore.text(flow, name));
                }
                AiMcpAuthStore.put(link, "scopes", new JSONArray(tokens.scopes != null ? tokens.scopes : strings(flow.optJSONArray("scopes"))));
                AiMcpAuthStore.put(link, "access", tokens.access);
                AiMcpAuthStore.put(link, "refresh", tokens.refresh);
                AiMcpAuthStore.put(link, "expiresAt", tokens.expiresIn < 0 ? null : (Long) (System.currentTimeMillis() / 1000 + tokens.expiresIn));
                synchronized (AiMcpPlugin.STORE_LOCK) {
                    KeystoreBox box = box();
                    AiMcpAuthStore.keepLink(box, serverId, link);
                    // A sign-in and a fixed token exclude each other.
                    box.write(serverId, null);
                }
                JSObject ret = new JSObject();
                ret.put("serverId", serverId);
                call.resolve(ret);
            } catch (AiMcpOAuthRules.Problem e) {
                call.reject(e.word);
            } catch (Exception e) {
                call.reject("oauth-failed");
            }
        });
    }

    /** Forgets a sign-in that was begun and will not be finished. */
    @PluginMethod
    public void cancel(PluginCall call) {
        synchronized (AiMcpPlugin.STORE_LOCK) {
            try {
                AiMcpAuthStore.keepPending(box(), null);
            } catch (Exception ignored) {
                // Nothing was begun, or the store is not there: nothing is left to finish either way.
            }
        }
        call.resolve();
    }

    /** Gets a new token with the one kept for that. False where there is none, or it was refused. */
    @PluginMethod
    public void renew(PluginCall call) {
        String serverId = call.getString("serverId");
        String serverUrl = address(serverId);
        work.execute(() -> {
            boolean done = false;
            try {
                Long last = renewed.get(serverId == null ? "" : serverId);
                if (serverUrl != null && last != null && System.currentTimeMillis() - last < RECENT_MS) {
                    done = true;
                } else if (serverUrl != null) {
                    JSONObject link;
                    synchronized (AiMcpPlugin.STORE_LOCK) {
                        link = AiMcpAuthStore.link(box(), serverId);
                    }
                    String refresh = AiMcpAuthStore.text(link, "refresh");
                    AiMcpOAuthRules.Client who = clientOf(link);
                    // The endpoint was read from the authorization server's own document when the sign-in was made; the rule is asked again.
                    String endpoint = link == null ? null : AiMcpOAuthRules.oauthAddress(AiMcpAuthStore.text(link, "tokenEndpoint"), serverUrl);
                    if (refresh != null && who != null && endpoint != null) {
                        String form = AiMcpOAuthRules.formBody(AiMcpOAuthRules.refreshForm(refresh, who, AiMcpAuthStore.text(link, "resource")));
                        Reply reply = ask(endpoint, serverUrl, "application/x-www-form-urlencoded", form, basicOf(who));
                        try {
                            AiMcpOAuthRules.Tokens tokens = AiMcpOAuthRules.readTokenResponse(reply.status, reply.body);
                            AiMcpAuthStore.put(link, "access", tokens.access);
                            if (tokens.refresh != null) AiMcpAuthStore.put(link, "refresh", tokens.refresh);
                            AiMcpAuthStore.put(link, "expiresAt", tokens.expiresIn < 0 ? null : (Long) (System.currentTimeMillis() / 1000 + tokens.expiresIn));
                            if (tokens.scopes != null) AiMcpAuthStore.put(link, "scopes", new JSONArray(tokens.scopes));
                            synchronized (AiMcpPlugin.STORE_LOCK) {
                                AiMcpAuthStore.keepLink(box(), serverId, link);
                            }
                            renewed.put(serverId, System.currentTimeMillis());
                            done = true;
                        } catch (AiMcpOAuthRules.Problem refused) {
                            // Refused for good: the sign-in is over; who Plainva is to this authorization server stays.
                            if ("oauth-grant".equals(refused.word)) {
                                synchronized (AiMcpPlugin.STORE_LOCK) {
                                    AiMcpAuthStore.endSignIn(box(), serverId);
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
                // Not reachable, not readable: nothing was renewed, and what is kept stays.
            }
            JSObject ret = new JSObject();
            ret.put("renewed", done);
            call.resolve(ret);
        });
    }

    /** A sign-in as the settings may show it: where, for what, until when — never a token. */
    @PluginMethod
    public void status(PluginCall call) {
        String serverId = call.getString("serverId");
        JSONObject link;
        synchronized (AiMcpPlugin.STORE_LOCK) {
            link = serverId == null ? null : AiMcpAuthStore.link(box(), serverId);
        }
        JSObject ret = new JSObject();
        if (link == null || AiMcpAuthStore.text(link, "issuer") == null) {
            ret.put("status", JSONObject.NULL);
        } else {
            JSObject shown = new JSObject();
            shown.put("issuer", AiMcpAuthStore.text(link, "issuer"));
            shown.put("scopes", new JSArray(strings(link.optJSONArray("scopes"))));
            shown.put("expiresAt", link.has("expiresAt") ? (Object) link.optLong("expiresAt") : JSONObject.NULL);
            shown.put("signedIn", AiMcpAuthStore.text(link, "access") != null);
            shown.put("renewable", AiMcpAuthStore.text(link, "refresh") != null);
            shown.put("client", true);
            ret.put("status", shown);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        String serverId = call.getString("serverId");
        if (serverId == null) {
            call.reject("serverId required");
            return;
        }
        synchronized (AiMcpPlugin.STORE_LOCK) {
            AiMcpAuthStore.forget(box(), serverId);
        }
        issuers.remove(serverId);
        renewed.remove(serverId);
        call.resolve();
    }
}
