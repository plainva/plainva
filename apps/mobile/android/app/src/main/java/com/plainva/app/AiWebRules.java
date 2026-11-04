package com.plainva.app;

import java.net.InetAddress;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.HttpUrl;

/**
 * The rules of the assistant's page fetch (plan KI-Harness P4, threat T2), as
 * plain functions a JUnit test holds without a device. They mirror
 * {@code packages/core/src/ai/web/rules.ts} and the desktop's
 * {@code src-tauri/src/ai_web.rs}; the test runs the same vectors
 * ({@code WEB_URL_CASES}, {@code ADDRESS_CASES}) — a case added there is
 * added here.
 */
final class AiWebRules {
    private AiWebRules() {}

    static final int URL_MAX = 2048;
    static final int MAX_REDIRECTS = 5;
    static final int MAX_BYTES = 2_000_000;

    /** What is accepted as a page: text a reader can take down. */
    static final List<String> CONTENT_TYPES = Arrays.asList(
        "text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml");

    /** Names that never leave the local network or are reserved for it. */
    private static final String[] LOCAL_SUFFIXES = {
        "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "home.arpa", "test", "example", "invalid", "onion", "arpa",
    };

    private static final Pattern SCHEME = Pattern.compile("^([A-Za-z][A-Za-z0-9+.-]*):");
    private static final Pattern LABEL = Pattern.compile("^[a-z0-9-]+$");
    private static final Pattern TLD = Pattern.compile("^(?:[a-z]{2,}|xn--[a-z0-9-]+)$");

    static final class Target {
        final String url;
        final String host;

        Target(String url, String host) {
            this.url = url;
            this.host = host;
        }
    }

    /** Either a target or the name of the problem, as the TypeScript side names it. */
    static final class Check {
        final Target target;
        final String problem;

        private Check(Target target, String problem) {
            this.target = target;
            this.problem = problem;
        }

        static Check ok(Target target) {
            return new Check(target, null);
        }

        static Check refused(String problem) {
            return new Check(null, problem);
        }
    }

    private static boolean hostProblem(String host) {
        if (host.isEmpty() || host.length() > 253) return true;
        String[] labels = host.split("\\.", -1);
        if (labels.length < 2) return true;
        for (String label : labels) {
            if (label.isEmpty() || label.length() > 63 || !LABEL.matcher(label).matches() || label.startsWith("-") || label.endsWith("-")) return true;
        }
        // A top-level name is letters or punycode — never digits, which would be an address in disguise.
        if (!TLD.matcher(labels[labels.length - 1]).matches()) return true;
        for (String suffix : LOCAL_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }

    /** Whether a request may go to this address at all. */
    static Check checkWebUrl(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) return Check.refused("not-a-url");
        // Control characters and whitespace inside an address are how a parser is made to disagree with a reader.
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c <= 32 || c == 127) return Check.refused("not-a-url");
        }
        if (text.length() > URL_MAX) return Check.refused("too-long");
        Matcher scheme = SCHEME.matcher(text);
        if (!scheme.find()) return Check.refused("not-a-url");
        if (!scheme.group(1).equalsIgnoreCase("https")) return Check.refused("scheme");
        HttpUrl url = HttpUrl.parse(text);
        if (url == null) return Check.refused("not-a-url");
        if (!url.username().isEmpty() || !url.password().isEmpty()) return Check.refused("credentials");
        if (url.port() != 443) return Check.refused("port");
        String host = url.host().toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (hostProblem(host)) return Check.refused("host");
        String normalised = url.newBuilder().host(host).fragment(null).build().toString();
        if (normalised.length() > URL_MAX) return Check.refused("too-long");
        return Check.ok(new Target(normalised, host));
    }

    private static boolean publicIpv4(int a, int b, int c) {
        if (a == 0 || a == 10 || a == 127) return false; // "this" network, private, loopback
        if (a == 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
        if (a == 169 && b == 254) return false; // link-local, cloud metadata
        if (a == 172 && b >= 16 && b <= 31) return false; // private
        if (a == 192 && b == 0 && (c == 0 || c == 2)) return false; // protocol assignments, documentation
        if (a == 192 && b == 88 && c == 99) return false; // 6to4 relay
        if (a == 192 && b == 168) return false; // private
        if (a == 198 && (b == 18 || b == 19)) return false; // benchmarking
        if (a == 198 && b == 51 && c == 100) return false; // documentation
        if (a == 203 && b == 0 && c == 113) return false; // documentation
        return a < 224; // multicast, reserved, broadcast
    }

    private static boolean publicIpv6(int[] g) {
        if (g[0] == 0 && g[1] == 0 && g[2] == 0 && g[3] == 0 && g[4] == 0) {
            // IPv4-mapped is only as public as the address inside; "::", "::1" and the IPv4-compatible form are not public.
            return g[5] == 0xffff && publicIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8);
        }
        if (g[0] == 0x64 && g[1] == 0xff9b && g[2] == 0 && g[3] == 0 && g[4] == 0 && g[5] == 0) return publicIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8); // NAT64
        if (g[0] == 0x2002) return publicIpv4(g[1] >> 8, g[1] & 0xff, g[2] >> 8); // 6to4
        if (g[0] == 0x2001 && g[1] == 0x0db8) return false; // documentation
        if (g[0] == 0x2001 && g[1] == 0) return false; // Teredo
        if ((g[0] & 0xfe00) == 0xfc00) return false; // unique local
        if ((g[0] & 0xffc0) == 0xfe80) return false; // link-local
        if ((g[0] & 0xffc0) == 0xfec0) return false; // site-local (deprecated)
        if ((g[0] & 0xff00) == 0xff00) return false; // multicast
        return (g[0] & 0xe000) == 0x2000; // global unicast is 2000::/3
    }

    /** Whether an address a host name resolved to lies on the public internet. */
    static boolean isPublicAddress(InetAddress address) {
        if (address == null) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) return publicIpv4(bytes[0] & 0xff, bytes[1] & 0xff, bytes[2] & 0xff);
        if (bytes.length != 16) return false;
        int[] groups = new int[8];
        for (int i = 0; i < 8; i++) groups[i] = ((bytes[2 * i] & 0xff) << 8) | (bytes[2 * i + 1] & 0xff);
        return publicIpv6(groups);
    }

    private static String withoutWww(String host) {
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    /** One site for a redirect: the same host, "www." or not, or one name below the other. */
    static boolean sameSite(String a, String b) {
        String x = withoutWww(a.toLowerCase(Locale.ROOT));
        String y = withoutWww(b.toLowerCase(Locale.ROOT));
        return x.equals(y) || x.endsWith("." + y) || y.endsWith("." + x);
    }

    /** {@code kind} is "follow", "elsewhere" (another site: stop and say where) or "refused" (with the problem). */
    static final class Redirect {
        final String kind;
        final Target target;
        final String problem;

        private Redirect(String kind, Target target, String problem) {
            this.kind = kind;
            this.target = target;
            this.problem = problem;
        }
    }

    static Redirect redirectDecision(Target from, String location, int hops) {
        if (hops >= MAX_REDIRECTS) return new Redirect("refused", null, "too-many");
        String where = location == null ? "" : location.trim();
        if (where.isEmpty()) return new Redirect("refused", null, "no-location");
        Matcher scheme = SCHEME.matcher(where);
        if (scheme.find() && !scheme.group(1).equalsIgnoreCase("https") && !scheme.group(1).equalsIgnoreCase("http")) return new Redirect("refused", null, "scheme");
        HttpUrl base = HttpUrl.parse(from.url);
        HttpUrl next = base == null ? null : base.resolve(where);
        if (next == null) return new Redirect("refused", null, "not-a-url");
        Check checked = checkWebUrl(next.toString());
        if (checked.target == null) return new Redirect("refused", null, checked.problem);
        return new Redirect(sameSite(from.host, checked.target.host) ? "follow" : "elsewhere", checked.target, null);
    }

    /** The media type of a Content-Type header, lowercase, without its parameters. */
    static String mediaType(String header) {
        if (header == null) return "";
        int cut = header.indexOf(';');
        return (cut < 0 ? header : header.substring(0, cut)).trim().toLowerCase(Locale.ROOT);
    }

    private static final Pattern HEADER_CHARSET = Pattern.compile("charset\\s*=\\s*\"?([A-Za-z0-9._-]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern META_CHARSET = Pattern.compile("charset=[\"' ]*([a-z0-9._-]+)");

    private static Charset named(String label) {
        try {
            return label == null ? null : Charset.forName(label);
        } catch (RuntimeException unknown) {
            return null;
        }
    }

    /** The charset of a body: the one the server names, else the one the page declares in its first bytes, else UTF-8. */
    static Charset charsetOf(String contentType, byte[] body) {
        if (contentType != null) {
            Matcher header = HEADER_CHARSET.matcher(contentType);
            if (header.find()) {
                Charset found = named(header.group(1));
                if (found != null) return found;
            }
        }
        String head = new String(body, 0, Math.min(body.length, 2048), StandardCharsets.ISO_8859_1).toLowerCase(Locale.ROOT);
        Matcher meta = META_CHARSET.matcher(head);
        if (meta.find()) {
            Charset found = named(meta.group(1));
            if (found != null) return found;
        }
        return StandardCharsets.UTF_8;
    }

    /** A body as text. A UTF-8 byte order mark is not part of the text. */
    static String decode(byte[] body, String contentType) {
        Charset charset = charsetOf(contentType, body);
        int skip = charset.equals(StandardCharsets.UTF_8) && body.length >= 3 && (body[0] & 0xff) == 0xef && (body[1] & 0xff) == 0xbb && (body[2] & 0xff) == 0xbf ? 3 : 0;
        return new String(body, skip, body.length - skip, charset);
    }
}
