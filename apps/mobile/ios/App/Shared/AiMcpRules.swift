import Foundation

/// The rules of the phone's side of foreign MCP servers that are plain
/// functions (plan KI-Harness P4.5), kept apart from the plugin so they compile
/// and run on their own (`tests/AiMcpRulesTests.swift`). They decide the same
/// as the desktop's `mcp_client/registry.rs` and `http.rs`, as Android's
/// `AiMcpRules` and as `checkMcpAddress` in packages/core — the address cases
/// of `MCP_ADDRESS_CASES` run on all four.
enum AiMcpRules {
    static let maxUrl = 2048
    static let maxHeaderValue = 8192
    private static let fixedHeaders: Set<String> = ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-session-id"]
    private static let tokenMarks = Set("!#$%&'*+-.^_`|~".utf8)

    /// The id is part of every tool name of a server: short, lower case, a letter first.
    static func validId(_ id: String?) -> Bool {
        guard let id = id, !id.isEmpty, id.utf8.count <= 16 else { return false }
        for (index, byte) in id.utf8.enumerated() {
            let letter = byte >= 0x61 && byte <= 0x7a
            let digit = byte >= 0x30 && byte <= 0x39
            if !(letter || (digit && index > 0)) { return false }
        }
        return true
    }

    private static func loopback(_ host: String) -> Bool {
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }

    /// The address of a remote server as it is stored and shown, or nil where it
    /// is none a server may have: printable ASCII — a name in another script is
    /// typed in its `xn--` form —, https or plain http to this device, no
    /// credentials in it; the fragment is dropped.
    static func normalizeAddress(_ raw: String?) -> String? {
        guard let raw = raw else { return nil }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.count <= maxUrl else { return nil }
        for byte in text.utf8 where byte < 0x21 || byte > 0x7e { return nil }
        guard var parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty else { return nil }
        guard scheme == "https" || (scheme == "http" && loopback(host)) else { return nil }
        guard parts.user == nil, parts.password == nil else { return nil }
        parts.scheme = scheme
        // A literal IPv6 host keeps the form the parser gave it; a name is written lower case.
        if !host.contains(":") { parts.host = host }
        parts.fragment = nil
        if (scheme == "https" && parts.port == 443) || (scheme == "http" && parts.port == 80) { parts.port = nil }
        if parts.percentEncodedPath.isEmpty { parts.percentEncodedPath = "/" }
        return parts.string
    }

    private static func tokenByte(_ byte: UInt8) -> Bool {
        let letter = (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x41 && byte <= 0x5a)
        let digit = byte >= 0x30 && byte <= 0x39
        return letter || digit || tokenMarks.contains(byte)
    }

    /// The name a request header is sent under, lower case — or nil where the
    /// WebView may not set it. The protocol's own headers and the ones a tool's
    /// arguments travel in; a credential, a cookie or a host is never among them.
    static func allowedHeader(_ name: String?) -> String? {
        guard let name = name else { return nil }
        let lower = name.lowercased()
        if fixedHeaders.contains(lower) { return lower }
        let prefix = "mcp-param-"
        guard lower.hasPrefix(prefix) else { return nil }
        let rest = lower.dropFirst(prefix.count)
        guard !rest.isEmpty, rest.utf8.count <= 64 else { return nil }
        for byte in rest.utf8 where !tokenByte(byte) { return nil }
        return lower
    }

    /// Visible ASCII, spaces and tabs: a line break never becomes part of a request.
    static func headerValueOk(_ value: String?) -> Bool {
        guard let value = value, value.utf8.count <= maxHeaderValue else { return false }
        for byte in value.utf8 where byte != 0x09 && (byte < 0x20 || byte > 0x7e) { return false }
        return true
    }

    /// A response header as the WebView gets it: printable and no longer than it needs to be; nil where there is none.
    static func responseHeader(_ value: String?, max: Int) -> String? {
        guard let value = value else { return nil }
        var out = ""
        for scalar in value.unicodeScalars {
            if out.unicodeScalars.count >= max { break }
            if scalar.properties.generalCategory != .control { out.unicodeScalars.append(scalar) }
        }
        return out.isEmpty ? nil : out
    }

    /// A failed request as one of the few words the protocol code knows.
    static func failureCode(_ code: Int) -> String {
        if code == NSURLErrorTimedOut { return "timeout" }
        // NSURLErrorSecureConnectionFailed (-1200) to NSURLErrorClientCertificateRequired (-1206).
        if code <= -1200 && code >= -1206 { return "tls" }
        return "offline"
    }
}
