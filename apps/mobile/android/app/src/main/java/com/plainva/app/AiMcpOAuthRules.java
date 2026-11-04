package com.plainva.app;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The rules of signing in to a remote MCP server on the phone (plan
 * KI-Harness P4.5): OAuth 2.1 with PKCE, as plain functions a JUnit test
 * holds without a device. They decide the same as the desktop's
 * {@code mcp_client/oauth.rs} and as {@code packages/core/src/ai/mcp/oauthRules.ts};
 * {@code AiMcpOAuthRulesTest} runs the lists of {@code oauthRules.test.ts}
 * ({@code MCP_OAUTH_*_CASES}) — a case added there is added here.
 */
final class AiMcpOAuthRules {
    private AiMcpOAuthRules() {}

    static final int MAX_SCOPES = 50;
    static final int MAX_TOKEN = 16384;
    /** The longest a begun sign-in waits for its browser. */
    static final long PENDING_MS = 10 * 60 * 1000L;
    private static final List<String> OUR_PARAMS = Arrays.asList(
        "response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope");

    /** Why a sign-in does not go on: one of a fixed set of words, the same in every shell. */
    static final class Problem extends Exception {
        final String word;

        Problem(String word) {
            super(word);
            this.word = word;
        }
    }

    /**
     * An address a server names for its sign-in — a document, an endpoint —
     * as it may be asked, or null. On the server's own host it follows the
     * rule the server's address followed when the user confirmed it;
     * everywhere else it is a public https address on the default port, like
     * a page the assistant reads. Nothing after a {@code #}.
     */
    static String oauthAddress(String raw, String serverUrl) {
        if (raw == null || raw.indexOf('#') >= 0) return null;
        String own = AiMcpRules.normalizeAddress(serverUrl);
        String named = AiMcpRules.normalizeAddress(raw);
        if (own == null || named == null) return null;
        HttpUrl ownUrl = HttpUrl.parse(own);
        HttpUrl namedUrl = HttpUrl.parse(named);
        if (ownUrl == null || namedUrl == null) return null;
        if (namedUrl.host().equals(ownUrl.host())) return named;
        AiWebRules.Check web = AiWebRules.checkWebUrl(raw);
        return web.target == null ? null : web.target.url;
    }

    private static boolean sameOrigin(HttpUrl a, HttpUrl b) {
        return a.scheme().equals(b.scheme()) && a.host().equals(b.host()) && a.port() == b.port();
    }

    /**
     * An authorization server's metadata is read from its own origin, under
     * {@code /.well-known/} — where nobody but the one who runs that origin
     * puts a document. That, and the issuer inside, ties the endpoints to the name.
     */
    static boolean issuerDocumentUrlOk(String issuer, String url) {
        if (issuer == null || url == null || issuer.indexOf('#') >= 0 || issuer.indexOf('?') >= 0 || url.indexOf('#') >= 0) return false;
        String named = AiMcpRules.normalizeAddress(issuer);
        String asked = AiMcpRules.normalizeAddress(url);
        if (named == null || asked == null) return false;
        HttpUrl namedUrl = HttpUrl.parse(named);
        HttpUrl askedUrl = HttpUrl.parse(asked);
        return namedUrl != null && askedUrl != null && sameOrigin(namedUrl, askedUrl) && askedUrl.encodedPath().contains("/.well-known/");
    }

    /** A scope as RFC 6749 spells one: visible ASCII without the quote and the backslash. */
    static boolean scopeOk(String scope) {
        if (scope == null || scope.isEmpty() || scope.length() > 200) return false;
        for (int i = 0; i < scope.length(); i++) {
            char c = scope.charAt(i);
            if (!(c == 0x21 || (c >= 0x23 && c <= 0x5b) || (c >= 0x5d && c <= 0x7e))) return false;
        }
        return true;
    }

    /** The scopes of a space-separated list or of a list of strings: each once, in order. */
    static List<String> readScopes(Object value) {
        List<String> parts = new ArrayList<>();
        if (value instanceof String) {
            parts.addAll(Arrays.asList(((String) value).split(" ", -1)));
        } else if (value instanceof JSONArray) {
            JSONArray list = (JSONArray) value;
            for (int i = 0; i < list.length(); i++) {
                Object entry = list.opt(i);
                if (entry instanceof String) parts.add((String) entry);
            }
        }
        List<String> out = new ArrayList<>();
        for (String part : parts) {
            if (scopeOk(part) && !out.contains(part) && out.size() < MAX_SCOPES) out.add(part);
        }
        return out;
    }

    /** An authorization server as it is kept for a sign-in. */
    static final class Endpoints {
        String issuer;
        String authorization;
        String token;
        /** Null where clients cannot register themselves. */
        String registration;
        boolean document;
        boolean iss;
        List<String> scopes = new ArrayList<>();
    }

    private static JSONObject object(String body) {
        try {
            return new JSONObject(body == null ? "" : body);
        } catch (JSONException e) {
            return null;
        }
    }

    private static String text(JSONObject from, String name) {
        Object value = from.opt(name);
        return value instanceof String ? (String) value : null;
    }

    /** True, false, or null where the document has no such list. */
    private static Boolean lists(JSONObject from, String name, String wanted) {
        Object value = from.opt(name);
        if (!(value instanceof JSONArray)) return null;
        JSONArray list = (JSONArray) value;
        for (int i = 0; i < list.length(); i++) {
            if (wanted.equals(list.opt(i))) return true;
        }
        return false;
    }

    /**
     * Reads an authorization server's metadata (RFC 8414). It counts only
     * when it names the issuer it was asked as, letter for letter; its
     * endpoints are addresses under the rule above; and it says it does PKCE
     * with SHA-256.
     */
    static Endpoints readIssuerDocument(String body, String issuer, String serverUrl) throws Problem {
        JSONObject document = object(body);
        if (document == null) throw new Problem("oauth-no-metadata");
        if (issuer == null || !issuer.equals(text(document, "issuer"))) throw new Problem("oauth-issuer");
        Endpoints found = new Endpoints();
        found.issuer = issuer;
        found.authorization = oauthAddress(text(document, "authorization_endpoint"), serverUrl);
        found.token = oauthAddress(text(document, "token_endpoint"), serverUrl);
        if (found.authorization == null || found.token == null) throw new Problem("oauth-endpoints");
        if (Boolean.FALSE.equals(lists(document, "response_types_supported", "code"))) throw new Problem("oauth-endpoints");
        if (!Boolean.TRUE.equals(lists(document, "code_challenge_methods_supported", "S256"))) throw new Problem("oauth-no-pkce");
        found.registration = oauthAddress(text(document, "registration_endpoint"), serverUrl);
        found.document = Boolean.TRUE.equals(document.opt("client_id_metadata_document_supported"));
        found.iss = Boolean.TRUE.equals(document.opt("authorization_response_iss_parameter_supported"));
        found.scopes = readScopes(document.opt("scopes_supported"));
        return found;
    }

    private static String withoutSlashes(String path) {
        int end = path.length();
        while (end > 0 && path.charAt(end - 1) == '/') end--;
        return path.substring(0, end);
    }

    /**
     * Does what a server names as itself cover its registered address? The
     * same origin, and a path that is the address's own or a part of it that
     * ends where a segment ends. A token is asked for exactly this name.
     */
    static boolean resourceCovers(String resource, String serverUrl) {
        if (resource == null || serverUrl == null || resource.indexOf('#') >= 0) return false;
        int hash = serverUrl.indexOf('#');
        String named = AiMcpRules.normalizeAddress(resource);
        String own = AiMcpRules.normalizeAddress(hash >= 0 ? serverUrl.substring(0, hash) : serverUrl);
        if (named == null || own == null) return false;
        HttpUrl namedUrl = HttpUrl.parse(named);
        HttpUrl ownUrl = HttpUrl.parse(own);
        if (namedUrl == null || ownUrl == null) return false;
        String query = namedUrl.encodedQuery();
        if ((query != null && !query.isEmpty()) || !sameOrigin(namedUrl, ownUrl)) return false;
        String part = withoutSlashes(namedUrl.encodedPath());
        String whole = withoutSlashes(ownUrl.encodedPath());
        return whole.equals(part) || whole.startsWith(part + "/");
    }

    /** Where the browser comes back to: the app's own address. Null where the id is none an app has. */
    static String redirectUri(String appId) {
        if (appId == null || !appId.matches("^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$")) return null;
        return appId + "://mcp/oauth";
    }

    /**
     * A client id: printable ASCII, at most 512 characters. As the address of
     * Plainva's own description it is a public https address with a path.
     */
    static String clientId(boolean document, String id) {
        String value = id == null ? "" : id.trim();
        if (value.isEmpty() || value.length() > 512) return null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c > 0x7e) return null;
        }
        if (document) {
            AiWebRules.Check web = AiWebRules.checkWebUrl(value);
            if (value.indexOf('#') >= 0 || web.target == null) return null;
            HttpUrl url = HttpUrl.parse(web.target.url);
            if (url == null || "/".equals(url.encodedPath())) return null;
        }
        return value;
    }

    /** The address the browser is sent to, or null. What the endpoint already carries in its query stays. */
    static String authorizationUrl(String endpoint, String clientId, String redirect, String challenge, String state, List<String> scopes, String resource) {
        HttpUrl base = endpoint == null ? null : HttpUrl.parse(endpoint);
        if (base == null) return null;
        HttpUrl.Builder url = base.newBuilder();
        for (String ours : OUR_PARAMS) url.removeAllQueryParameters(ours);
        url.addQueryParameter("response_type", "code");
        url.addQueryParameter("client_id", clientId);
        url.addQueryParameter("redirect_uri", redirect);
        url.addQueryParameter("code_challenge", challenge);
        url.addQueryParameter("code_challenge_method", "S256");
        url.addQueryParameter("state", state);
        url.addQueryParameter("resource", resource);
        if (scopes != null && !scopes.isEmpty()) url.addQueryParameter("scope", joined(scopes));
        return url.build().toString();
    }

    /** A list of scopes as one value: separated by single spaces. */
    static String joined(List<String> scopes) {
        StringBuilder out = new StringBuilder();
        for (String scope : scopes) {
            if (out.length() > 0) out.append(' ');
            out.append(scope);
        }
        return out.toString();
    }

    private static final char[] BASE64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();

    /** Base64 for addresses, without padding. Written out: the platform's own encoder is not there in a unit test. */
    static String base64Url(byte[] bytes) {
        StringBuilder out = new StringBuilder((bytes.length * 4 + 2) / 3);
        for (int i = 0; i < bytes.length; i += 3) {
            int a = bytes[i] & 0xff;
            int b = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
            int c = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
            out.append(BASE64_URL[a >> 2]);
            out.append(BASE64_URL[((a & 0x03) << 4) | (b >> 4)]);
            if (i + 1 < bytes.length) out.append(BASE64_URL[((b & 0x0f) << 2) | (c >> 6)]);
            if (i + 2 < bytes.length) out.append(BASE64_URL[c & 0x3f]);
        }
        return out.toString();
    }

    /** The challenge of a verifier (RFC 7636, section 4.2). */
    static String pkceChallenge(String verifier) {
        try {
            return base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A fresh secret of this many random bytes: a verifier (32) or a state (16). */
    static String random(int bytes) {
        byte[] buffer = new byte[bytes];
        new SecureRandom().nextBytes(buffer);
        return base64Url(buffer);
    }

    /**
     * What the browser came back with, against what was begun. Who answered
     * must be who was asked (RFC 9207) — before anything of the answer is
     * used, an error included. Answers the code.
     */
    static String checkRedirect(String pendingState, String issuer, boolean promised, String state, String code, String iss, String error) throws Problem {
        if (pendingState == null || state == null || state.isEmpty() || !state.equals(pendingState)) throw new Problem("oauth-no-flow");
        boolean named = iss != null ? iss.equals(issuer) : !promised;
        if (!named) throw new Problem("oauth-issuer");
        if (error != null) throw new Problem("access_denied".equals(error) ? "oauth-denied" : "oauth-failed");
        if (code == null || code.isEmpty()) throw new Problem("oauth-failed");
        return code;
    }

    /** Who Plainva is to an authorization server, and how it proves it: not at all ("none"), or with a secret ("post", "basic"). */
    static final class Client {
        final String id;
        final String auth;
        final String secret;

        Client(String id, String auth, String secret) {
            this.id = id;
            this.auth = auth;
            this.secret = secret;
        }
    }

    private static String[] pair(String name, String value) {
        return new String[] { name, value };
    }

    /** The fields of the request that exchanges a code. A secret travels in the body only where the registration said so. */
    static List<String[]> codeForm(String code, String verifier, String redirect, Client client, String resource) {
        List<String[]> fields = new ArrayList<>();
        fields.add(pair("grant_type", "authorization_code"));
        fields.add(pair("code", code));
        fields.add(pair("redirect_uri", redirect));
        fields.add(pair("code_verifier", verifier));
        return withClient(fields, client, resource);
    }

    /** The fields of the request that gets the next token. */
    static List<String[]> refreshForm(String refresh, Client client, String resource) {
        List<String[]> fields = new ArrayList<>();
        fields.add(pair("grant_type", "refresh_token"));
        fields.add(pair("refresh_token", refresh));
        return withClient(fields, client, resource);
    }

    private static List<String[]> withClient(List<String[]> fields, Client client, String resource) {
        fields.add(pair("client_id", client.id));
        fields.add(pair("resource", resource));
        if ("post".equals(client.auth) && client.secret != null) fields.add(pair("client_secret", client.secret));
        return fields;
    }

    /** One value of a form (application/x-www-form-urlencoded). */
    static String formEncode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    static String formBody(List<String[]> fields) {
        StringBuilder out = new StringBuilder();
        for (String[] field : fields) {
            if (out.length() > 0) out.append('&');
            out.append(field[0]).append('=').append(formEncode(field[1]));
        }
        return out.toString();
    }

    /** A token is visible ASCII without a space: anything else would end the header it travels in. */
    static boolean tokenOk(Object value) {
        if (!(value instanceof String)) return false;
        String token = (String) value;
        if (token.isEmpty() || token.length() > MAX_TOKEN) return false;
        for (int i = 0; i < token.length(); i++) {
            char c = token.charAt(i);
            if (c < 0x21 || c > 0x7e) return false;
        }
        return true;
    }

    static final class Tokens {
        String access;
        /** Null where the server handed out none. */
        String refresh;
        /** Seconds from now; -1 where the server did not say. */
        long expiresIn = -1;
        /** Null where the server did not say: then what was asked for was granted. */
        List<String> scopes;
    }

    private static boolean absent(Object value) {
        return value == null || value == JSONObject.NULL;
    }

    /**
     * Reads a token endpoint's answer. Only a bearer token is one; a refresh
     * token that was refused for good ({@code invalid_grant}) says so.
     */
    static Tokens readTokenResponse(int status, String body) throws Problem {
        JSONObject answer = object(body);
        if (answer == null) throw new Problem("oauth-token");
        if (status != 200) throw new Problem(status == 400 && "invalid_grant".equals(answer.opt("error")) ? "oauth-grant" : "oauth-token");
        String kind = text(answer, "token_type");
        if (kind == null || !kind.toLowerCase(Locale.ROOT).equals("bearer") || !tokenOk(answer.opt("access_token"))) throw new Problem("oauth-token");
        Tokens tokens = new Tokens();
        tokens.access = (String) answer.opt("access_token");
        Object refresh = answer.opt("refresh_token");
        if (!absent(refresh)) {
            if (!tokenOk(refresh)) throw new Problem("oauth-token");
            tokens.refresh = (String) refresh;
        }
        Object expires = answer.opt("expires_in");
        if (expires instanceof Number) {
            double seconds = ((Number) expires).doubleValue();
            if (!Double.isNaN(seconds) && !Double.isInfinite(seconds) && seconds >= 1) tokens.expiresIn = Math.min((long) Math.floor(seconds), 10L * 365 * 24 * 3600);
        }
        if (answer.opt("scope") instanceof String) tokens.scopes = readScopes(answer.opt("scope"));
        return tokens;
    }

    /** What a client that registers itself says about itself (RFC 7591): a native app, without a secret. */
    static String registrationBody(String clientName, String redirect) {
        try {
            JSONObject body = new JSONObject();
            String name = clientName == null ? "" : clientName;
            body.put("client_name", name.length() > 80 ? name.substring(0, 80) : name);
            body.put("redirect_uris", new JSONArray().put(redirect));
            body.put("grant_types", new JSONArray().put("authorization_code").put("refresh_token"));
            body.put("response_types", new JSONArray().put("code"));
            body.put("token_endpoint_auth_method", "none");
            body.put("application_type", "native");
            return body.toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Reads a registration's answer: the id, and a secret where the server insists on one. Null where the answer is none. */
    static Client readRegistration(int status, String body) {
        JSONObject answer = object(body);
        if ((status != 200 && status != 201) || answer == null) return null;
        String id = clientId(false, text(answer, "client_id"));
        if (id == null) return null;
        Object rawSecret = answer.opt("client_secret");
        String secret = null;
        if (!absent(rawSecret)) {
            if (!tokenOk(rawSecret)) return null;
            secret = (String) rawSecret;
        }
        Object rawMethod = answer.opt("token_endpoint_auth_method");
        String method = null;
        if (!absent(rawMethod)) {
            if (!(rawMethod instanceof String)) return null;
            method = (String) rawMethod;
        }
        if (secret == null) return method == null || method.equals("none") ? new Client(id, "none", null) : null;
        if ("client_secret_post".equals(method)) return new Client(id, "post", secret);
        // The default of a client with a secret (RFC 7591, section 2).
        if (method == null || method.equals("client_secret_basic")) return new Client(id, "basic", secret);
        // A secret that came with "none" is not used: the client stays a public one.
        return method.equals("none") ? new Client(id, "none", null) : null;
    }
}
