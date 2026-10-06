package com.plainva.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The phone's rules for foreign MCP servers (plan KI-Harness P4.5). The
 * address cases are the list of {@code MCP_ADDRESS_CASES} in
 * packages/core/src/ai/mcp/native.test.ts, which the desktop's registry and
 * iOS run too: a case added there is added here.
 */
public class AiMcpRulesTest {

    /** Letters outside ASCII are built here, so that this file holds none. */
    private static final String CYRILLIC_A = String.valueOf((char) 0x430);
    private static final String E_ACUTE = String.valueOf((char) 0xe9);
    private static final String A_UMLAUT = String.valueOf((char) 0xe4);

    /** [what the user typed, whether it is an address a server may have] */
    private static final Object[][] MCP_ADDRESS_CASES = {
        { " https://MCP.Example.com/mcp ", true },
        { "https://mcp.example.com/mcp?toolsets=issues#top", true },
        { "https://mcp.example.com:8443", true },
        { "https://192.168.1.20/mcp", true },
        { "https://xn--bcher-kva.example/mcp", true },
        { "http://localhost:3000/mcp", true },
        { "http://127.0.0.1:3000/mcp", true },
        { "http://[::1]:3000/mcp", true },
        { "", false },
        { "   ", false },
        { "mcp.example.com/mcp", false },
        { "http://mcp.example.com/mcp", false },
        { "http://192.168.1.20:3000/mcp", false },
        { "http://localhost.evil.test/mcp", false },
        { "https://user:secret@mcp.example.com/mcp", false },
        { "https://user@mcp.example.com/mcp", false },
        { "ftp://mcp.example.com/", false },
        { "file:///etc/passwd", false },
        { "javascript:alert(1)", false },
        { "https://", false },
        { "https://mcp.example.com/a b", false },
        // A Cyrillic letter in the host: what only looks like a name is not one.
        { "https://ex" + CYRILLIC_A + "mple.com/mcp", false },
        { "https://mcp.example.com/caf" + E_ACUTE, false },
    };

    @Test
    public void anAddressIsAsciiHttpsOrThisDevice() {
        for (Object[] row : MCP_ADDRESS_CASES) {
            assertEquals((String) row[0], row[1], AiMcpRules.normalizeAddress((String) row[0]) != null);
        }
        StringBuilder longPath = new StringBuilder("https://mcp.example.com/");
        for (int i = 0; i < 3000; i++) longPath.append('a');
        assertNull(AiMcpRules.normalizeAddress(longPath.toString()));
        assertNull(AiMcpRules.normalizeAddress(null));
    }

    @Test
    public void anAddressIsStoredInOneFormWithoutItsFragment() {
        assertEquals("https://mcp.example.com/mcp", AiMcpRules.normalizeAddress(" https://MCP.Example.com/mcp "));
        assertEquals("https://mcp.example.com/mcp?toolsets=issues", AiMcpRules.normalizeAddress("https://mcp.example.com/mcp?toolsets=issues#top"));
        assertEquals("https://mcp.example.com:8443/", AiMcpRules.normalizeAddress("https://mcp.example.com:8443"));
        assertEquals("https://mcp.example.com/mcp", AiMcpRules.normalizeAddress("https://mcp.example.com:443/mcp"));
        assertEquals("http://[::1]:3000/mcp", AiMcpRules.normalizeAddress("http://[::1]:3000/mcp"));
    }

    @Test
    public void anIdIsShortLowerCaseAndStartsWithALetter() {
        for (String good : new String[] { "a", "tracker", "github2", "abcdefghijklmnop" }) assertTrue(good, AiMcpRules.validId(good));
        for (String bad : new String[] { "", "2go", "Tracker", "my-server", "my_server", "abcdefghijklmnopq", "tr" + A_UMLAUT + "cker", "a b", "a:b", "../x" }) {
            assertFalse(bad, AiMcpRules.validId(bad));
        }
        assertFalse(AiMcpRules.validId(null));
    }

    @Test
    public void onlyProtocolHeadersPass() {
        String[][] good = {
            { "Content-Type", "content-type" },
            { "Accept", "accept" },
            { "MCP-Protocol-Version", "mcp-protocol-version" },
            { "Mcp-Method", "mcp-method" },
            { "Mcp-Name", "mcp-name" },
            { "Mcp-Session-Id", "mcp-session-id" },
            { "Mcp-Param-Region", "mcp-param-region" },
            { "mcp-param-x_y.z", "mcp-param-x_y.z" },
        };
        for (String[] row : good) assertEquals(row[0], row[1], AiMcpRules.allowedHeader(row[0]));
        String[] bad = {
            "Authorization", "Cookie", "Host", "Origin", "X-Api-Key", "Proxy-Authorization", "Mcp-Param-", "Mcp-Param-Bad Name", "Mcp-Param-a:b",
            "Mcp-Param-a\r\nAuthorization", "Mcp-Other", "",
        };
        for (String name : bad) assertNull(name, AiMcpRules.allowedHeader(name));
        StringBuilder longName = new StringBuilder("Mcp-Param-");
        for (int i = 0; i < 65; i++) longName.append('a');
        assertNull(AiMcpRules.allowedHeader(longName.toString()));
        assertNull(AiMcpRules.allowedHeader(null));
    }

    @Test
    public void aHeaderValueIsVisibleAscii() {
        assertTrue(AiMcpRules.headerValueOk("application/json, text/event-stream"));
        assertTrue(AiMcpRules.headerValueOk("=?base64?SGVsbG8sIOS4lueVjA==?="));
        assertTrue(AiMcpRules.headerValueOk("a\tb"));
        assertTrue(AiMcpRules.headerValueOk(""));
        for (String bad : new String[] { "a\r\nb", "a\nb", "a" + (char) 0 + "b", "caf" + E_ACUTE, "a" + (char) 0x7f + "b" }) assertFalse(AiMcpRules.headerValueOk(bad));
        StringBuilder longValue = new StringBuilder();
        for (int i = 0; i <= AiMcpRules.MAX_HEADER_VALUE; i++) longValue.append('a');
        assertFalse(AiMcpRules.headerValueOk(longValue.toString()));
        assertFalse(AiMcpRules.headerValueOk(null));
    }

    @Test
    public void aResponseHeaderIsPrintableAndCut() {
        assertEquals("abc", AiMcpRules.responseHeader("a" + (char) 0 + "b\r\nc", 10));
        assertEquals("abcde", AiMcpRules.responseHeader("abcdefgh", 5));
        assertNull(AiMcpRules.responseHeader("\r\n", 10));
        assertNull(AiMcpRules.responseHeader(null, 10));
    }

    @Test
    public void aFailureIsOneOfAFewWords() {
        assertEquals("timeout", AiMcpRules.failureCode("HTTP_TIMEOUT", false));
        assertEquals("timeout", AiMcpRules.failureCode("HTTP_NETWORK_ERROR", true));
        assertEquals("tls", AiMcpRules.failureCode("TLS_CERTIFICATE_EXPIRED", false));
        assertEquals("tls", AiMcpRules.failureCode("TLS_HOSTNAME_MISMATCH", false));
        assertEquals("offline", AiMcpRules.failureCode("HTTP_NETWORK_ERROR", false));
        assertEquals("offline", AiMcpRules.failureCode(null, false));
    }
}
