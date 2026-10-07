package com.plainva.app;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the phone keeps of a sign-in to a remote MCP server (plan KI-Harness
 * P4.5), in the Keystore box of the MCP plugin: one entry per server with who
 * Plainva is to the authorization server, where its token endpoint is, and
 * the tokens — and one entry for a sign-in that was begun and waits for its
 * browser. A server's id has no {@code #}, so these names are nobody else's.
 *
 * Nothing in here is handed to the WebView. {@link AiMcpPlugin} asks for the
 * credential of a request, {@link AiMcpAuthPlugin} for the rest.
 */
final class AiMcpAuthStore {
    private AiMcpAuthStore() {}

    /** The sign-in that was begun and waits for its browser. It survives the system ending the app meanwhile. */
    static final String PENDING = "#pending";

    static String linkName(String serverId) {
        return serverId + "#oauth";
    }

    private static JSONObject read(KeystoreBox box, String name) {
        try {
            String stored = box.read(name);
            return stored == null ? null : new JSONObject(stored);
        } catch (Exception e) {
            // What cannot be read is no sign-in: the user signs in again.
            return null;
        }
    }

    static JSONObject link(KeystoreBox box, String serverId) {
        return read(box, linkName(serverId));
    }

    static void keepLink(KeystoreBox box, String serverId, JSONObject link) throws Exception {
        box.write(linkName(serverId), link == null ? null : link.toString());
    }

    static JSONObject pending(KeystoreBox box) {
        return read(box, PENDING);
    }

    static void keepPending(KeystoreBox box, JSONObject pending) throws Exception {
        box.write(PENDING, pending == null ? null : pending.toString());
    }

    static String text(JSONObject from, String name) {
        Object value = from == null ? null : from.opt(name);
        return value instanceof String ? (String) value : null;
    }

    /** The credential of a request to a server that is signed in to; null where it is not. */
    static String bearer(KeystoreBox box, String serverId) {
        return text(link(box, serverId), "access");
    }

    /** The tokens go; who Plainva is to the authorization server stays. */
    static void endSignIn(KeystoreBox box, String serverId) throws Exception {
        JSONObject link = link(box, serverId);
        if (link == null) return;
        link.remove("access");
        link.remove("refresh");
        link.remove("expiresAt");
        keepLink(box, serverId, link);
    }

    /**
     * Everything about a sign-in goes: the tokens, who Plainva was to the
     * authorization server, a sign-in that was begun. Called when a server is
     * removed or registered anew, when a fixed token takes its place, and
     * when the user signs out.
     */
    static void forget(KeystoreBox box, String serverId) {
        try {
            box.write(linkName(serverId), null);
            JSONObject begun = pending(box);
            if (begun != null && serverId.equals(text(begun, "serverId"))) box.write(PENDING, null);
        } catch (Exception ignored) {
            // The entry is gone or the store is not there: either way nothing is left to use.
        }
    }

    static JSONObject put(JSONObject into, String name, Object value) {
        try {
            if (value == null) into.remove(name);
            else into.put(name, value);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return into;
    }
}
