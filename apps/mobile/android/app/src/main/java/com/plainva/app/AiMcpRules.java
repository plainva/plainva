package com.plainva.app;

import java.util.Locale;
import okhttp3.HttpUrl;

/**
 * The rules of the phone's side of foreign MCP servers that are plain
 * functions (plan KI-Harness P4.5), kept apart from the plugin so a JUnit test
 * holds them without a device. They decide the same as the desktop's
 * {@code mcp_client/registry.rs} and {@code http.rs} and as
 * {@code checkMcpAddress} in packages/core; the address cases of
 * {@code MCP_ADDRESS_CASES} run in {@code AiMcpRulesTest}.
 */
final class AiMcpRules {
    private AiMcpRules() {}

    static final int MAX_URL = 2048;
    static final int MAX_HEADER_VALUE = 8192;
    private static final String[] FIXED_HEADERS = {
        "content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-session-id"
    };
    private static final String TOKEN_MARKS = "!#$%&'*+-.^_`|~";

    /** The id is part of every tool name of a server: short, lower case, a letter first. */
    static boolean validId(String id) {
        if (id == null || id.isEmpty() || id.length() > 16) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean letter = c >= 'a' && c <= 'z';
            boolean digit = c >= '0' && c <= '9';
            if (!(letter || (digit && i > 0))) return false;
        }
        return true;
    }

    private static boolean loopback(String host) {
        return "localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host);
    }

    /**
     * The address of a remote server as it is stored and shown, or null where
     * it is none a server may have: printable ASCII — a name in another script
     * is typed in its {@code xn--} form —, https or plain http to this device,
     * no credentials in it; the fragment is dropped.
     */
    static String normalizeAddress(String raw) {
        if (raw == null) return null;
        String text = raw.trim();
        if (text.isEmpty() || text.length() > MAX_URL) return null;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x21 || c > 0x7e) return null;
        }
        HttpUrl url = HttpUrl.parse(text);
        if (url == null) return null;
        if (!url.scheme().equals("https") && !loopback(url.host())) return null;
        if (!url.username().isEmpty() || !url.password().isEmpty()) return null;
        return url.newBuilder().fragment(null).build().toString();
    }

    private static boolean tokenChar(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || TOKEN_MARKS.indexOf(c) >= 0;
    }

    /**
     * The name a request header is sent under, lower case — or null where the
     * WebView may not set it. The protocol's own headers and the ones a tool's
     * arguments travel in; a credential, a cookie or a host is never among them.
     */
    static String allowedHeader(String name) {
        if (name == null) return null;
        String lower = name.toLowerCase(Locale.ROOT);
        for (String fixed : FIXED_HEADERS) {
            if (fixed.equals(lower)) return lower;
        }
        String prefix = "mcp-param-";
        if (!lower.startsWith(prefix)) return null;
        String rest = lower.substring(prefix.length());
        if (rest.isEmpty() || rest.length() > 64) return null;
        for (int i = 0; i < rest.length(); i++) {
            if (!tokenChar(rest.charAt(i))) return null;
        }
        return lower;
    }

    /** Visible ASCII, spaces and tabs: a line break never becomes part of a request. */
    static boolean headerValueOk(String value) {
        if (value == null || value.length() > MAX_HEADER_VALUE) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c != '\t' && (c < 0x20 || c > 0x7e)) return false;
        }
        return true;
    }

    /** A response header as the WebView gets it: printable and no longer than it needs to be; null where there is none. */
    static String responseHeader(String value, int max) {
        if (value == null) return null;
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < value.length() && out.length() < max; i++) {
            char c = value.charAt(i);
            if (!Character.isISOControl(c)) out.append(c);
        }
        return out.length() == 0 ? null : out.toString();
    }

    /** The bridge's failure code as one of the few words the protocol code knows. */
    static String failureCode(String httpFailure, boolean timedOut) {
        if (timedOut || "HTTP_TIMEOUT".equals(httpFailure)) return "timeout";
        if (httpFailure != null && httpFailure.startsWith("TLS_")) return "tls";
        return "offline";
    }
}
