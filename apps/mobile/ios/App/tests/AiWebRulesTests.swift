import Foundation

/// The rules of the assistant's page fetch (plan KI-Harness P4, threat T2). The
/// vectors are those of `web.test.ts` in the core, of the desktop's `ai_web.rs`
/// and of Android's `AiWebRulesTest.java`: a case added there is added here.
@main
struct AiWebRulesTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }

    /// [address, the normalised request or the problem].
    static let webUrlCases: [(String, String)] = [
        ("https://example.org/a?b=c#frag", "https://example.org/a?b=c"),
        ("https://EXAMPLE.org:443/Path", "https://example.org/Path"),
        ("https://example.org./", "https://example.org/"),
        ("https://b\u{fc}cher.de/", "https://xn--bcher-kva.de/"),
        ("  https://sub.example.co.uk/x  ", "https://sub.example.co.uk/x"),
        ("http://example.org/", "scheme"),
        ("ftp://example.org/", "scheme"),
        ("javascript:alert(1)", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("https://user:secret@example.org/", "credentials"),
        ("https://example.org:8443/", "port"),
        ("https://localhost/", "host"),
        ("https://intranet/", "host"),
        ("https://router.local/", "host"),
        ("https://nas.home.arpa/", "host"),
        ("https://build.internal/", "host"),
        ("https://hidden.onion/", "host"),
        ("https://127.0.0.1/", "host"),
        ("https://0x7f.0.0.1/", "host"),
        ("https://2130706433/", "host"),
        ("https://169.254.169.254/latest/meta-data/", "host"),
        ("https://[::1]/", "host"),
        ("https://[fd00::1]/", "host"),
        ("https://exa mple.org/", "not-a-url"),
        ("https://example.org/a\nb", "not-a-url"),
        ("example.org", "not-a-url"),
        ("", "not-a-url"),
    ]

    /// [address a name resolved to, whether a request may go there].
    static let addressCases: [(String, Bool)] = [
        ("93.184.216.34", true), ("8.8.8.8", true), ("172.15.0.1", true), ("172.32.0.1", true), ("100.63.255.255", true), ("100.128.0.1", true),
        ("2606:4700:4700::1111", true), ("2001:4860:4860::8888", true), ("::ffff:8.8.8.8", true), ("64:ff9b::808:808", true), ("2002:808:808::1", true),
        ("0.0.0.0", false), ("10.0.0.1", false), ("100.64.0.1", false), ("127.0.0.1", false), ("169.254.169.254", false), ("172.16.0.1", false),
        ("172.31.255.255", false), ("192.0.2.1", false), ("192.168.1.1", false), ("198.18.0.1", false), ("198.51.100.7", false), ("203.0.113.7", false),
        ("224.0.0.1", false), ("255.255.255.255", false),
        ("::", false), ("::1", false), ("::127.0.0.1", false), ("::ffff:127.0.0.1", false), ("::ffff:10.0.0.1", false), ("64:ff9b::a00:1", false),
        ("2002:7f00:1::1", false), ("2001:db8::1", false), ("2001:0:4136:e378:8000:63bf:3fff:fdd2", false), ("fe80::1", false), ("fe80::1%eth0", false),
        ("fec0::1", false), ("fc00::1", false), ("fd12:3456:789a::1", false), ("ff02::1", false), ("4000::1", false),
        ("1.2.3", false), ("1.2.3.256", false), ("12345::", false), (":::", false), ("1:2:3:4:5:6:7:8:9", false), ("example.org", false), ("", false),
    ]

    static func outcome(_ check: AiWebRules.Check) -> String {
        switch check {
        case .ok(let target): return target.url.absoluteString
        case .refused(let problem): return problem
        }
    }

    static func target(_ url: String) throws -> AiWebRules.Target {
        guard case .ok(let target) = AiWebRules.checkWebUrl(url) else { throw NSError(domain: "not an address: \(url)", code: 1) }
        return target
    }

    static func main() throws {
        for (raw, expected) in webUrlCases {
            let got = outcome(AiWebRules.checkWebUrl(raw))
            try require(got == expected, "checkWebUrl(\(raw)) = \(got), expected \(expected)")
        }
        let long = "https://example.org/" + String(repeating: "a", count: AiWebRules.urlMax)
        try require(AiWebRules.checkWebUrl(long) == .refused("too-long"), "an overlong address is refused")
        let docs = try target("https://Docs.Example.org/guide")
        try require(docs.host == "docs.example.org", "the host is lowercase")

        for (address, expected) in addressCases {
            try require(AiWebRules.isPublicAddress(address) == expected, "isPublicAddress(\(address)) should be \(expected)")
        }
        try require(AiWebRules.isPublicAddress("[2606:4700:4700::1111]"), "brackets as a URL writes them")
        try require(!AiWebRules.isPublicAddress("[::1]"), "the loopback in brackets")

        let from = try target("https://example.org/a/b")
        let inside = try target("https://example.org/c")
        let relative = try target("https://example.org/a/d?x=1")
        let other = try target("https://other.example.net/landing?from=example")
        try require(AiWebRules.redirectDecision(from: from, location: "/c", hops: 0) == .follow(inside), "a redirect inside the site is followed")
        try require(AiWebRules.redirectDecision(from: from, location: "d?x=1", hops: 1) == .follow(relative), "a relative redirect")
        if case .follow = AiWebRules.redirectDecision(from: from, location: "https://www.example.org/", hops: 0) {} else { throw NSError(domain: "www is the same site", code: 1) }
        if case .follow = AiWebRules.redirectDecision(from: from, location: "https://docs.example.org/", hops: 0) {} else { throw NSError(domain: "a name below is the same site", code: 1) }
        try require(AiWebRules.redirectDecision(from: from, location: "https://other.example.net/landing?from=example", hops: 0) == .elsewhere(other), "a redirect to another site stops and says where")
        if case .elsewhere = AiWebRules.redirectDecision(from: from, location: "//other.example.net/x", hops: 0) {} else { throw NSError(domain: "a scheme-relative redirect to another site", code: 1) }
        // A redirect cannot lead where a request could not start.
        try require(AiWebRules.redirectDecision(from: from, location: "http://example.org/c", hops: 0) == .refused("scheme"), "a redirect to plain http")
        try require(AiWebRules.redirectDecision(from: from, location: "https://10.0.0.1/", hops: 0) == .refused("host"), "a redirect to a private address")
        try require(AiWebRules.redirectDecision(from: from, location: "https://localhost/admin", hops: 0) == .refused("host"), "a redirect to a local name")
        try require(AiWebRules.redirectDecision(from: from, location: nil, hops: 0) == .refused("no-location"), "a redirect without a place")
        try require(AiWebRules.redirectDecision(from: from, location: "  ", hops: 0) == .refused("no-location"), "a redirect to nothing")
        try require(AiWebRules.redirectDecision(from: from, location: "/c", hops: AiWebRules.maxRedirects) == .refused("too-many"), "too many redirects")

        try require(AiWebRules.sameSite("example.org", "www.example.org"), "www is the same site")
        try require(AiWebRules.sameSite("docs.example.org", "example.org"), "a name below is the same site")
        try require(!AiWebRules.sameSite("example.org", "example.net"), "another name is another site")
        try require(!AiWebRules.sameSite("badexample.org", "example.org"), "a longer name is another site")

        try require(AiWebRules.mediaType("Text/HTML; charset=UTF-8") == "text/html", "the media type without its parameters")
        try require(AiWebRules.mediaType(nil) == "", "no header, no type")
        let greeting = "Gr\u{fc}\u{df}e"
        try require(AiWebRules.decode(Data([0x47, 0x72, 0xfc, 0xdf, 0x65]), contentType: "text/html; charset=\"ISO-8859-1\"") == greeting, "the charset the server names")
        var page = Data("<html><head><meta charset=\"windows-1252\"></head><body>".utf8)
        page.append(contentsOf: [0x80, 0x31])
        try require(AiWebRules.decode(page, contentType: "text/html").hasSuffix("\u{20ac}1"), "the charset the page names")
        try require(AiWebRules.decode(Data(greeting.utf8), contentType: "text/plain") == greeting, "UTF-8 when nobody names one")
        try require(AiWebRules.decode(Data([0xef, 0xbb, 0xbf, 0x41]), contentType: "") == "A", "without the byte order mark")
        try require(AiWebRules.decode(Data([0x41, 0xff, 0x42]), contentType: nil) == "A\u{fffd}B", "what is no text becomes the replacement character")
        try require(AiWebRules.decode(Data([0x41]), contentType: "text/html; charset=klingon") == "A", "an unknown charset is no reason to fail")

        // An address literal resolves to itself, without a network.
        try require(AiWebRules.resolve("127.0.0.1") == ["127.0.0.1"], "a literal resolves to itself")

        print("AI web rules: \(webUrlCases.count) addresses, \(addressCases.count) resolved addresses, redirects, sites and charsets passed.")
    }
}
