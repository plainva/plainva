import Foundation

/// The rules of the assistant's page fetch (plan KI-Harness P4, threat T2), as
/// plain functions: no Capacitor, no network, so a stand-alone test holds them
/// (`tests/AiWebRulesTests.swift`, run with swiftc in CI).
///
/// They mirror `packages/core/src/ai/web/rules.ts`, the desktop's
/// `src-tauri/src/ai_web.rs` and Android's `AiWebRules.java`; the test runs the
/// same vectors (`WEB_URL_CASES`, `ADDRESS_CASES`) — a case added there is
/// added here.
enum AiWebRules {
    static let urlMax = 2048
    static let maxRedirects = 5
    static let maxBytes = 2_000_000

    /// What is accepted as a page: text a reader can take down.
    static let contentTypes: Set<String> = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"]

    /// Names that never leave the local network or are reserved for it.
    private static let localSuffixes = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "home.arpa", "test", "example", "invalid", "onion", "arpa"]

    struct Target: Equatable {
        let url: URL
        let host: String
    }

    enum Check: Equatable {
        case ok(Target)
        /// The name of the problem, as the TypeScript side names it.
        case refused(String)
    }

    private static func isLabel(_ label: Substring) -> Bool {
        if label.isEmpty || label.utf8.count > 63 || label.hasPrefix("-") || label.hasSuffix("-") { return false }
        return label.utf8.allSatisfy { ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 }
    }

    private static func hostProblem(_ host: String) -> Bool {
        if host.isEmpty || host.utf8.count > 253 { return true }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        if labels.count < 2 || !labels.allSatisfy(isLabel) { return true }
        // A top-level name is letters or punycode — never digits, which would be an address in disguise.
        let tld = labels[labels.count - 1]
        let letters = tld.utf8.count >= 2 && tld.utf8.allSatisfy { $0 >= 97 && $0 <= 122 }
        if !letters && !tld.hasPrefix("xn--") { return true }
        return localSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// The scheme an address names, lowercase; nil when it names none.
    private static func scheme(of text: String) -> String? {
        guard let colon = text.firstIndex(of: ":") else { return nil }
        let name = text[text.startIndex..<colon]
        guard let first = name.unicodeScalars.first, first.isASCII, CharacterSet.letters.contains(first) else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+.-")
        return name.unicodeScalars.allSatisfy(allowed.contains) ? name.lowercased() : nil
    }

    /// Whether a request may go to this address at all.
    static func checkWebUrl(_ raw: String) -> Check {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Control characters and whitespace inside an address are how a parser is made to disagree with a reader.
        if text.isEmpty || text.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }) { return .refused("not-a-url") }
        if text.utf16.count > urlMax { return .refused("too-long") }
        guard let named = scheme(of: text) else { return .refused("not-a-url") }
        if named != "https" { return .refused("scheme") }
        guard var parts = URLComponents(string: text) else { return .refused("not-a-url") }
        if parts.user != nil || parts.password != nil { return .refused("credentials") }
        if let port = parts.port, port != 443 { return .refused("port") }
        // `encodedHost` is the name as it goes onto the wire: punycode for an international name.
        var host = (parts.encodedHost ?? "").lowercased()
        while host.hasSuffix(".") { host.removeLast() }
        if hostProblem(host) { return .refused("host") }
        parts.scheme = "https"
        parts.encodedHost = host
        parts.port = nil
        parts.fragment = nil
        if parts.path.isEmpty { parts.path = "/" }
        guard let url = parts.url?.standardized, url.absoluteString.utf16.count <= urlMax else { return .refused("too-long") }
        return .ok(Target(url: url, host: host))
    }

    private static func publicIpv4(_ a: Int, _ b: Int, _ c: Int) -> Bool {
        if a == 0 || a == 10 || a == 127 { return false } // "this" network, private, loopback
        if a == 100 && (64...127).contains(b) { return false } // carrier-grade NAT
        if a == 169 && b == 254 { return false } // link-local, cloud metadata
        if a == 172 && (16...31).contains(b) { return false } // private
        if a == 192 && b == 0 && (c == 0 || c == 2) { return false } // protocol assignments, documentation
        if a == 192 && b == 88 && c == 99 { return false } // 6to4 relay
        if a == 192 && b == 168 { return false } // private
        if a == 198 && (b == 18 || b == 19) { return false } // benchmarking
        if a == 198 && b == 51 && c == 100 { return false } // documentation
        if a == 203 && b == 0 && c == 113 { return false } // documentation
        return a < 224 // multicast, reserved, broadcast
    }

    private static func publicIpv6(_ g: [Int]) -> Bool {
        if g[0] == 0 && g[1] == 0 && g[2] == 0 && g[3] == 0 && g[4] == 0 {
            // IPv4-mapped is only as public as the address inside; "::", "::1" and the IPv4-compatible form are not public.
            return g[5] == 0xffff && publicIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8)
        }
        if g[0] == 0x64 && g[1] == 0xff9b && g[2] == 0 && g[3] == 0 && g[4] == 0 && g[5] == 0 { return publicIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8) } // NAT64
        if g[0] == 0x2002 { return publicIpv4(g[1] >> 8, g[1] & 0xff, g[2] >> 8) } // 6to4
        if g[0] == 0x2001 && g[1] == 0x0db8 { return false } // documentation
        if g[0] == 0x2001 && g[1] == 0 { return false } // Teredo
        if (g[0] & 0xfe00) == 0xfc00 { return false } // unique local
        if (g[0] & 0xffc0) == 0xfe80 { return false } // link-local
        if (g[0] & 0xffc0) == 0xfec0 { return false } // site-local (deprecated)
        if (g[0] & 0xff00) == 0xff00 { return false } // multicast
        return (g[0] & 0xe000) == 0x2000 // global unicast is 2000::/3
    }

    /// Whether an address a host name resolved to lies on the public internet. `address` is the numeric form
    /// (`93.184.216.34`, `2606:4700::1111`, with or without a zone); anything else is not public.
    static func isPublicAddress(_ address: String) -> Bool {
        var text = address.trimmingCharacters(in: CharacterSet(charactersIn: "[] "))
        if let zone = text.firstIndex(of: "%") { text = String(text[text.startIndex..<zone]) }
        var v4 = in_addr()
        if inet_pton(AF_INET, text, &v4) == 1 {
            let bytes = withUnsafeBytes(of: &v4) { Array($0) }
            return publicIpv4(Int(bytes[0]), Int(bytes[1]), Int(bytes[2]))
        }
        var v6 = in6_addr()
        if inet_pton(AF_INET6, text, &v6) == 1 {
            let bytes = withUnsafeBytes(of: &v6) { Array($0) }
            return publicIpv6((0..<8).map { (Int(bytes[2 * $0]) << 8) | Int(bytes[2 * $0 + 1]) })
        }
        return false
    }

    private static func withoutWww(_ host: String) -> String {
        host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// One site for a redirect: the same host, "www." or not, or one name below the other.
    static func sameSite(_ a: String, _ b: String) -> Bool {
        let x = withoutWww(a.lowercased())
        let y = withoutWww(b.lowercased())
        return x == y || x.hasSuffix("." + y) || y.hasSuffix("." + x)
    }

    enum Redirect: Equatable {
        case follow(Target)
        /// Another site: the request stops and says where it wanted to go.
        case elsewhere(Target)
        case refused(String)
    }

    static func redirectDecision(from: Target, location: String?, hops: Int) -> Redirect {
        if hops >= maxRedirects { return .refused("too-many") }
        let place = (location ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if place.isEmpty { return .refused("no-location") }
        guard let next = URL(string: place, relativeTo: from.url)?.absoluteURL else { return .refused("not-a-url") }
        switch checkWebUrl(next.absoluteString) {
        case .refused(let problem): return .refused(problem)
        case .ok(let target): return sameSite(from.host, target.host) ? .follow(target) : .elsewhere(target)
        }
    }

    /// The media type of a Content-Type header, lowercase, without its parameters.
    static func mediaType(_ header: String?) -> String {
        (header ?? "").split(separator: ";", omittingEmptySubsequences: false).first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
    }

    private static func encoding(named label: String) -> String.Encoding? {
        let converted = CFStringConvertIANACharSetNameToEncoding(label as CFString)
        if converted == kCFStringEncodingInvalidId { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(converted))
    }

    private static func charsetLabel(after marker: String, in text: String) -> String? {
        guard let at = text.range(of: marker, options: .caseInsensitive) else { return nil }
        let name = text[at.upperBound...].drop { $0 == "\"" || $0 == "'" || $0 == " " }.prefix { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == ".") }
        return name.isEmpty ? nil : String(name)
    }

    /// A body as text: the charset the server names, else the one the page declares in its first bytes, else UTF-8.
    /// Bytes that are not text in that charset become the replacement character rather than an error.
    static func decode(_ body: Data, contentType: String?) -> String {
        let head = String(decoding: body.prefix(2048), as: UTF8.self)
        let label = charsetLabel(after: "charset=", in: contentType ?? "") ?? charsetLabel(after: "charset=", in: head)
        if let label, let named = encoding(named: label), named != .utf8, let text = String(data: body, encoding: named) { return text }
        var bytes = body
        // A UTF-8 byte order mark is not part of the text.
        if bytes.count >= 3 && bytes[bytes.startIndex] == 0xef && bytes[bytes.startIndex + 1] == 0xbb && bytes[bytes.startIndex + 2] == 0xbf { bytes = bytes.dropFirst(3) }
        return String(decoding: bytes, as: UTF8.self)
    }

    /// The addresses a host name resolves to, in numeric form; nil when it does not resolve.
    static func resolve(_ host: String) -> [String]? {
        var hints = addrinfo()
        hints.ai_socktype = SOCK_STREAM
        var list: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, "443", &hints, &list) == 0, let first = list else { return nil }
        defer { freeaddrinfo(first) }
        var found: [String] = []
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let entry = cursor {
            var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(entry.pointee.ai_addr, entry.pointee.ai_addrlen, &name, socklen_t(name.count), nil, 0, NI_NUMERICHOST) == 0 {
                found.append(name.withUnsafeBufferPointer { String(cString: $0.baseAddress!) })
            }
            cursor = entry.pointee.ai_next
        }
        return found.isEmpty ? nil : found
    }
}
