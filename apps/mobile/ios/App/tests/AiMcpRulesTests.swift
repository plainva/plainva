import Foundation

/// The phone's rules for foreign MCP servers (plan KI-Harness P4.5). The address
/// cases are the list of `MCP_ADDRESS_CASES` in
/// packages/core/src/ai/mcp/native.test.ts, which the desktop's registry and
/// Android's `AiMcpRulesTest.java` run too: a case added there is added here.
@main
struct AiMcpRulesTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }

    /// Letters outside ASCII are built here, so that this file holds none.
    static let cyrillicA = String(UnicodeScalar(0x430)!)
    static let eAcute = String(UnicodeScalar(0xe9)!)
    static let aUmlaut = String(UnicodeScalar(0xe4)!)
    static let nul = String(UnicodeScalar(UInt8(0)))
    static let del = String(UnicodeScalar(UInt8(0x7f)))

    /// [what the user typed, whether it is an address a server may have]
    static let addressCases: [(String, Bool)] = [
        (" https://MCP.Example.com/mcp ", true),
        ("https://mcp.example.com/mcp?toolsets=issues#top", true),
        ("https://mcp.example.com:8443", true),
        ("https://192.168.1.20/mcp", true),
        ("https://xn--bcher-kva.example/mcp", true),
        ("http://localhost:3000/mcp", true),
        ("http://127.0.0.1:3000/mcp", true),
        ("http://[::1]:3000/mcp", true),
        ("", false),
        ("   ", false),
        ("mcp.example.com/mcp", false),
        ("http://mcp.example.com/mcp", false),
        ("http://192.168.1.20:3000/mcp", false),
        ("http://localhost.evil.test/mcp", false),
        ("https://user:secret@mcp.example.com/mcp", false),
        ("https://user@mcp.example.com/mcp", false),
        ("ftp://mcp.example.com/", false),
        ("file:///etc/passwd", false),
        ("javascript:alert(1)", false),
        ("https://", false),
        ("https://mcp.example.com/a b", false),
        // A Cyrillic letter in the host: what only looks like a name is not one.
        ("https://ex" + cyrillicA + "mple.com/mcp", false),
        ("https://mcp.example.com/caf" + eAcute, false),
    ]

    static func main() throws {
        for (typed, accepted) in addressCases {
            try require((AiMcpRules.normalizeAddress(typed) != nil) == accepted, "address: \(typed)")
        }
        try require(AiMcpRules.normalizeAddress("https://mcp.example.com/" + String(repeating: "a", count: 3000)) == nil, "an address that is too long")
        try require(AiMcpRules.normalizeAddress(nil) == nil, "no address")

        try require(AiMcpRules.normalizeAddress(" https://MCP.Example.com/mcp ") == "https://mcp.example.com/mcp", "scheme and host in lower case")
        try require(AiMcpRules.normalizeAddress("https://mcp.example.com/mcp?toolsets=issues#top") == "https://mcp.example.com/mcp?toolsets=issues", "without the fragment")
        try require(AiMcpRules.normalizeAddress("https://mcp.example.com:8443") == "https://mcp.example.com:8443/", "a path where there was none")
        try require(AiMcpRules.normalizeAddress("https://mcp.example.com:443/mcp") == "https://mcp.example.com/mcp", "without the usual port")
        try require(AiMcpRules.normalizeAddress("http://[::1]:3000/mcp") == "http://[::1]:3000/mcp", "a literal IPv6 host as it is")

        for good in ["a", "tracker", "github2", "abcdefghijklmnop"] {
            try require(AiMcpRules.validId(good), "id: \(good)")
        }
        for bad in ["", "2go", "Tracker", "my-server", "my_server", "abcdefghijklmnopq", "tr" + aUmlaut + "cker", "a b", "a:b", "../x"] {
            try require(!AiMcpRules.validId(bad), "not an id: \(bad)")
        }
        try require(!AiMcpRules.validId(nil), "no id")

        let allowed: [(String, String)] = [
            ("Content-Type", "content-type"),
            ("Accept", "accept"),
            ("MCP-Protocol-Version", "mcp-protocol-version"),
            ("Mcp-Method", "mcp-method"),
            ("Mcp-Name", "mcp-name"),
            ("Mcp-Session-Id", "mcp-session-id"),
            ("Mcp-Param-Region", "mcp-param-region"),
            ("mcp-param-x_y.z", "mcp-param-x_y.z"),
        ]
        for (name, lower) in allowed {
            try require(AiMcpRules.allowedHeader(name) == lower, "header: \(name)")
        }
        let refused = [
            "Authorization", "Cookie", "Host", "Origin", "X-Api-Key", "Proxy-Authorization", "Mcp-Param-", "Mcp-Param-Bad Name", "Mcp-Param-a:b",
            "Mcp-Param-a\r\nAuthorization", "Mcp-Other", "",
        ]
        for name in refused {
            try require(AiMcpRules.allowedHeader(name) == nil, "not a header: \(name)")
        }
        try require(AiMcpRules.allowedHeader("Mcp-Param-" + String(repeating: "a", count: 65)) == nil, "a header name that is too long")
        try require(AiMcpRules.allowedHeader(nil) == nil, "no header")

        try require(AiMcpRules.headerValueOk("application/json, text/event-stream"), "a plain value")
        try require(AiMcpRules.headerValueOk("=?base64?SGVsbG8sIOS4lueVjA==?="), "an encoded value")
        try require(AiMcpRules.headerValueOk("a\tb"), "a tab inside")
        try require(AiMcpRules.headerValueOk(""), "an empty value")
        for bad in ["a\r\nb", "a\nb", "a" + nul + "b", "caf" + eAcute, "a" + del + "b"] {
            try require(!AiMcpRules.headerValueOk(bad), "not a header value")
        }
        try require(!AiMcpRules.headerValueOk(String(repeating: "a", count: AiMcpRules.maxHeaderValue + 1)), "a value that is too long")
        try require(!AiMcpRules.headerValueOk(nil), "no value")

        try require(AiMcpRules.responseHeader("a" + nul + "b\r\nc", max: 10) == "abc", "a response header without control characters")
        try require(AiMcpRules.responseHeader("abcdefgh", max: 5) == "abcde", "a response header is cut")
        try require(AiMcpRules.responseHeader("\r\n", max: 10) == nil, "nothing left is no header")
        try require(AiMcpRules.responseHeader(nil, max: 10) == nil, "no header")

        try require(AiMcpRules.failureCode(NSURLErrorTimedOut) == "timeout", "a timeout")
        try require(AiMcpRules.failureCode(NSURLErrorSecureConnectionFailed) == "tls", "a failed secure connection")
        try require(AiMcpRules.failureCode(NSURLErrorServerCertificateUntrusted) == "tls", "a certificate that is not trusted")
        try require(AiMcpRules.failureCode(NSURLErrorNotConnectedToInternet) == "offline", "no connection")
        try require(AiMcpRules.failureCode(NSURLErrorCannotFindHost) == "offline", "no such host")

        print("AI MCP rules: \(addressCases.count) addresses, ids, headers and failures passed.")
    }
}
