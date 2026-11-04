package com.plainva.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/**
 * The rules of the assistant's page fetch (plan KI-Harness P4, threat T2). The
 * vectors are those of {@code web.test.ts} in the core and of the desktop's
 * {@code ai_web.rs}: a case added there is added here.
 */
public class AiWebRulesTest {

    private static final String UMLAUT = "b" + (char) 0xfc + "cher.de";

    /** [address, the normalised request or the problem]. */
    private static final String[][] WEB_URL_CASES = {
        { "https://example.org/a?b=c#frag", "https://example.org/a?b=c" },
        { "https://EXAMPLE.org:443/Path", "https://example.org/Path" },
        { "https://example.org./", "https://example.org/" },
        { "https://" + UMLAUT + "/", "https://xn--bcher-kva.de/" },
        { "  https://sub.example.co.uk/x  ", "https://sub.example.co.uk/x" },
        { "http://example.org/", "scheme" },
        { "ftp://example.org/", "scheme" },
        { "javascript:alert(1)", "scheme" },
        { "file:///etc/passwd", "scheme" },
        { "https://user:secret@example.org/", "credentials" },
        { "https://example.org:8443/", "port" },
        { "https://localhost/", "host" },
        { "https://intranet/", "host" },
        { "https://router.local/", "host" },
        { "https://nas.home.arpa/", "host" },
        { "https://build.internal/", "host" },
        { "https://hidden.onion/", "host" },
        { "https://127.0.0.1/", "host" },
        { "https://0x7f.0.0.1/", "host" },
        { "https://2130706433/", "host" },
        { "https://169.254.169.254/latest/meta-data/", "host" },
        { "https://[::1]/", "host" },
        { "https://[fd00::1]/", "host" },
        { "https://exa mple.org/", "not-a-url" },
        { "https://example.org/a\nb", "not-a-url" },
        { "example.org", "not-a-url" },
        { "", "not-a-url" },
    };

    /** Addresses a name may resolve to and still be asked. */
    private static final String[] PUBLIC = {
        "93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1",
        "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1",
    };

    /** Addresses behind the user's own door, or nobody's. */
    private static final String[] NOT_PUBLIC = {
        "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.2.1", "192.168.1.1",
        "198.18.0.1", "198.51.100.7", "203.0.113.7", "224.0.0.1", "255.255.255.255",
        "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::1", "2001:db8::1",
        "2001:0:4136:e378:8000:63bf:3fff:fdd2", "fe80::1", "fec0::1", "fc00::1", "fd12:3456:789a::1", "ff02::1", "4000::1",
    };

    @Test
    public void acceptsAPublicHttpsAddressAndNothingElse() {
        for (String[] row : WEB_URL_CASES) {
            AiWebRules.Check check = AiWebRules.checkWebUrl(row[0]);
            assertEquals(row[0], row[1], check.target != null ? check.target.url : check.problem);
        }
        StringBuilder path = new StringBuilder("https://example.org/");
        for (int i = 0; i < AiWebRules.URL_MAX; i++) path.append('a');
        assertEquals("too-long", AiWebRules.checkWebUrl(path.toString()).problem);
        assertEquals("docs.example.org", AiWebRules.checkWebUrl("https://Docs.Example.org/guide").target.host);
        assertEquals("not-a-url", AiWebRules.checkWebUrl(null).problem);
    }

    @Test
    public void tellsAPublicAddressFromOneBehindTheUsersOwnDoor() throws Exception {
        // An address literal is parsed, never looked up.
        for (String address : PUBLIC) assertTrue(address, AiWebRules.isPublicAddress(InetAddress.getByName(address)));
        for (String address : NOT_PUBLIC) assertFalse(address, AiWebRules.isPublicAddress(InetAddress.getByName(address)));
        assertFalse(AiWebRules.isPublicAddress(null));
    }

    @Test
    public void followsARedirectInsideTheSiteAndStopsAtAnotherOne() {
        AiWebRules.Target from = AiWebRules.checkWebUrl("https://example.org/a/b").target;
        assertNotNull(from);
        AiWebRules.Redirect inside = AiWebRules.redirectDecision(from, "/c", 0);
        assertEquals("follow", inside.kind);
        assertEquals("https://example.org/c", inside.target.url);
        assertEquals("https://example.org/a/d?x=1", AiWebRules.redirectDecision(from, "d?x=1", 1).target.url);
        assertEquals("follow", AiWebRules.redirectDecision(from, "https://www.example.org/", 0).kind);
        assertEquals("follow", AiWebRules.redirectDecision(from, "https://docs.example.org/", 0).kind);

        AiWebRules.Redirect away = AiWebRules.redirectDecision(from, "https://other.example.net/landing?from=example", 0);
        assertEquals("elsewhere", away.kind);
        assertEquals("https://other.example.net/landing?from=example", away.target.url);
        assertEquals("elsewhere", AiWebRules.redirectDecision(from, "//other.example.net/x", 0).kind);

        // A redirect cannot lead where a request could not start.
        assertEquals("scheme", AiWebRules.redirectDecision(from, "http://example.org/c", 0).problem);
        assertEquals("scheme", AiWebRules.redirectDecision(from, "ftp://example.org/c", 0).problem);
        assertEquals("host", AiWebRules.redirectDecision(from, "https://10.0.0.1/", 0).problem);
        assertEquals("host", AiWebRules.redirectDecision(from, "https://localhost/admin", 0).problem);
        assertEquals("no-location", AiWebRules.redirectDecision(from, null, 0).problem);
        assertEquals("no-location", AiWebRules.redirectDecision(from, "  ", 0).problem);
        AiWebRules.Redirect tired = AiWebRules.redirectDecision(from, "/c", AiWebRules.MAX_REDIRECTS);
        assertEquals("refused", tired.kind);
        assertEquals("too-many", tired.problem);
        assertNull(tired.target);
    }

    @Test
    public void countsWwwAndNamesBelowEachOtherAsOneSite() {
        assertTrue(AiWebRules.sameSite("example.org", "www.example.org"));
        assertTrue(AiWebRules.sameSite("docs.example.org", "example.org"));
        assertFalse(AiWebRules.sameSite("example.org", "example.net"));
        assertFalse(AiWebRules.sameSite("badexample.org", "example.org"));
    }

    @Test
    public void readsABodyInTheCharsetItNames() {
        assertEquals("text/html", AiWebRules.mediaType("Text/HTML; charset=UTF-8"));
        assertEquals("", AiWebRules.mediaType(null));
        String greeting = "Gr" + (char) 0xfc + (char) 0xdf + "e";
        // The server names it.
        assertEquals(greeting, AiWebRules.decode(new byte[] { 0x47, 0x72, (byte) 0xfc, (byte) 0xdf, 0x65 }, "text/html; charset=\"ISO-8859-1\""));
        // The page names it.
        byte[] head = "<html><head><meta charset=\"windows-1252\"></head><body>".getBytes(StandardCharsets.US_ASCII);
        byte[] page = new byte[head.length + 2];
        System.arraycopy(head, 0, page, 0, head.length);
        page[head.length] = (byte) 0x80;
        page[head.length + 1] = 0x31;
        assertTrue(AiWebRules.decode(page, "text/html").endsWith((char) 0x20ac + "1"));
        // Nobody names it: UTF-8, without its byte order mark.
        assertEquals(greeting, AiWebRules.decode(greeting.getBytes(StandardCharsets.UTF_8), "text/plain"));
        assertEquals("A", AiWebRules.decode(new byte[] { (byte) 0xef, (byte) 0xbb, (byte) 0xbf, 0x41 }, ""));
        // A charset nobody knows is no reason to fail.
        assertEquals("A", AiWebRules.decode(new byte[] { 0x41 }, "text/html; charset=klingon"));
    }
}
