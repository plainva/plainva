import CryptoKit
import Foundation

/// The rules of signing in to a remote MCP server on the phone (plan
/// KI-Harness P4.5): OAuth 2.1 with PKCE, as plain functions — no Capacitor, no
/// network, so they compile and run on their own
/// (`tests/AiMcpOAuthRulesTests.swift`). They decide the same as the desktop's
/// `mcp_client/oauth.rs`, as Android's `AiMcpOAuthRules` and as
/// `packages/core/src/ai/mcp/oauthRules.ts`; the test runs the lists of
/// `oauthRules.test.ts` (`MCP_OAUTH_*_CASES`) — a case added there is added here.
enum AiMcpOAuthRules {
    static let maxScopes = 50
    static let maxToken = 16384
    /// The longest a begun sign-in waits for its browser, in seconds.
    static let pendingSeconds: TimeInterval = 600
    private static let ourParams: Set<String> = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope"]

    /// Why a sign-in does not go on: one of a fixed set of words, the same in every shell.
    struct Problem: Error, Equatable {
        let word: String
        init(_ word: String) { self.word = word }
    }

    private static func parts(_ address: String?) -> URLComponents? {
        guard let address = address else { return nil }
        return URLComponents(string: address)
    }

    /// An address a server names for its sign-in — a document, an endpoint — as
    /// it may be asked, or nil. On the server's own host it follows the rule the
    /// server's address followed when the user confirmed it; everywhere else it
    /// is a public https address on the default port, like a page the assistant
    /// reads. Nothing after a `#`.
    static func oauthAddress(_ raw: String?, serverUrl: String?) -> String? {
        guard let raw = raw, !raw.contains("#") else { return nil }
        guard let own = AiMcpRules.normalizeAddress(serverUrl), let named = AiMcpRules.normalizeAddress(raw) else { return nil }
        guard let ownHost = parts(own)?.host, let namedHost = parts(named)?.host else { return nil }
        if namedHost == ownHost { return named }
        if case .ok(let target) = AiWebRules.checkWebUrl(raw) { return target.url.absoluteString }
        return nil
    }

    private static func sameOrigin(_ a: URLComponents, _ b: URLComponents) -> Bool {
        return a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }

    /// An authorization server's metadata is read from its own origin, under
    /// `/.well-known/` — where nobody but the one who runs that origin puts a
    /// document. That, and the issuer inside, ties the endpoints to the name.
    static func issuerDocumentUrlOk(issuer: String?, url: String?) -> Bool {
        guard let issuer = issuer, let url = url, !issuer.contains("#"), !issuer.contains("?"), !url.contains("#") else { return false }
        guard let named = parts(AiMcpRules.normalizeAddress(issuer)), let asked = parts(AiMcpRules.normalizeAddress(url)) else { return false }
        return sameOrigin(named, asked) && asked.percentEncodedPath.contains("/.well-known/")
    }

    /// A scope as RFC 6749 spells one: visible ASCII without the quote and the backslash.
    static func scopeOk(_ scope: String) -> Bool {
        if scope.isEmpty || scope.utf8.count > 200 { return false }
        return scope.utf8.allSatisfy { $0 == 0x21 || ($0 >= 0x23 && $0 <= 0x5b) || ($0 >= 0x5d && $0 <= 0x7e) }
    }

    /// The scopes of a space-separated list or of a list of strings: each once, in order.
    static func readScopes(_ value: Any?) -> [String] {
        var candidates: [String] = []
        if let text = value as? String {
            candidates = text.components(separatedBy: " ")
        } else if let list = value as? [Any] {
            candidates = list.compactMap { $0 as? String }
        }
        var out: [String] = []
        for candidate in candidates where scopeOk(candidate) && !out.contains(candidate) && out.count < maxScopes {
            out.append(candidate)
        }
        return out
    }

    /// An authorization server as it is kept for a sign-in.
    struct Endpoints: Equatable {
        var issuer: String
        var authorization: String
        var token: String
        /// Nil where clients cannot register themselves.
        var registration: String?
        var document: Bool
        var iss: Bool
        var scopes: [String]
    }

    private static func object(_ body: String?) -> [String: Any]? {
        guard let body = body, let data = body.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any]
    }

    /// JSON's `true`, and nothing that only counts as true (a 1, a "true").
    private static func isTrue(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID() && number.boolValue
    }

    /// True, false, or nil where the document has no such list.
    private static func lists(_ document: [String: Any], _ name: String, _ wanted: String) -> Bool? {
        guard let list = document[name] as? [Any] else { return nil }
        return list.contains { ($0 as? String) == wanted }
    }

    /// Reads an authorization server's metadata (RFC 8414). It counts only when
    /// it names the issuer it was asked as, letter for letter; its endpoints are
    /// addresses under the rule above; and it says it does PKCE with SHA-256.
    static func readIssuerDocument(_ body: String?, issuer: String, serverUrl: String) throws -> Endpoints {
        guard let document = object(body) else { throw Problem("oauth-no-metadata") }
        guard (document["issuer"] as? String) == issuer else { throw Problem("oauth-issuer") }
        guard let authorization = oauthAddress(document["authorization_endpoint"] as? String, serverUrl: serverUrl),
              let token = oauthAddress(document["token_endpoint"] as? String, serverUrl: serverUrl) else { throw Problem("oauth-endpoints") }
        if lists(document, "response_types_supported", "code") == false { throw Problem("oauth-endpoints") }
        if lists(document, "code_challenge_methods_supported", "S256") != true { throw Problem("oauth-no-pkce") }
        return Endpoints(
            issuer: issuer,
            authorization: authorization,
            token: token,
            registration: oauthAddress(document["registration_endpoint"] as? String, serverUrl: serverUrl),
            document: isTrue(document["client_id_metadata_document_supported"]),
            iss: isTrue(document["authorization_response_iss_parameter_supported"]),
            scopes: readScopes(document["scopes_supported"]))
    }

    private static func withoutSlashes(_ path: String) -> String {
        var out = path
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }

    /// Does what a server names as itself cover its registered address? The same
    /// origin, and a path that is the address's own or a part of it that ends
    /// where a segment ends. A token is asked for exactly this name.
    static func resourceCovers(_ resource: String?, serverUrl: String?) -> Bool {
        guard let resource = resource, let serverUrl = serverUrl, !resource.contains("#") else { return false }
        let ownText = serverUrl.components(separatedBy: "#").first ?? ""
        guard let named = parts(AiMcpRules.normalizeAddress(resource)), let own = parts(AiMcpRules.normalizeAddress(ownText)) else { return false }
        if !(named.percentEncodedQuery ?? "").isEmpty || !sameOrigin(named, own) { return false }
        let part = withoutSlashes(named.percentEncodedPath)
        let whole = withoutSlashes(own.percentEncodedPath)
        return whole == part || whole.hasPrefix(part + "/")
    }

    private static func lowerOrDigit(_ byte: UInt8, digits: Bool) -> Bool {
        return (byte >= 0x61 && byte <= 0x7a) || (digits && byte >= 0x30 && byte <= 0x39)
    }

    /// Where the browser comes back to: the app's own address. Nil where the id is none an app has.
    static func redirectUri(appId: String?) -> String? {
        guard let appId = appId else { return nil }
        let labels = appId.components(separatedBy: ".")
        guard labels.count >= 2 else { return nil }
        for label in labels {
            let bytes = Array(label.utf8)
            guard let first = bytes.first, lowerOrDigit(first, digits: false), bytes.allSatisfy({ lowerOrDigit($0, digits: true) }) else { return nil }
        }
        return appId + "://mcp/oauth"
    }

    /// A client id: printable ASCII, at most 512 characters. As the address of
    /// Plainva's own description it is a public https address with a path.
    static func clientId(document: Bool, _ id: String?) -> String? {
        let value = (id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty || value.utf8.count > 512 || !value.utf8.allSatisfy({ $0 >= 0x20 && $0 <= 0x7e }) { return nil }
        if document {
            guard !value.contains("#"), case .ok(let target) = AiWebRules.checkWebUrl(value) else { return nil }
            let path = URLComponents(url: target.url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "/"
            if path == "/" || path.isEmpty { return nil }
        }
        return value
    }

    /// One part of an address, with everything encoded that is not a letter, a digit or one of `-._~`.
    static func urlEncode(_ value: String) -> String {
        var out = ""
        for byte in value.utf8 {
            let plain = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2d || byte == 0x2e || byte == 0x5f || byte == 0x7e
            if plain {
                out.unicodeScalars.append(Unicode.Scalar(byte))
            } else {
                out += String(format: "%%%02X", Int(byte))
            }
        }
        return out
    }

    /// The address the browser is sent to, or nil. What the endpoint already carries in its query stays.
    static func authorizationUrl(endpoint: String?, clientId: String, redirect: String, challenge: String, state: String, scopes: [String], resource: String) -> String? {
        guard let endpoint = endpoint, var url = URLComponents(string: endpoint), url.host != nil else { return nil }
        var pairs: [(String, String)] = []
        for item in url.queryItems ?? [] where !ourParams.contains(item.name) {
            pairs.append((item.name, item.value ?? ""))
        }
        pairs.append(("response_type", "code"))
        pairs.append(("client_id", clientId))
        pairs.append(("redirect_uri", redirect))
        pairs.append(("code_challenge", challenge))
        pairs.append(("code_challenge_method", "S256"))
        pairs.append(("state", state))
        pairs.append(("resource", resource))
        if !scopes.isEmpty { pairs.append(("scope", scopes.joined(separator: " "))) }
        url.percentEncodedQuery = pairs.map { urlEncode($0.0) + "=" + urlEncode($0.1) }.joined(separator: "&")
        return url.string
    }

    /// Base64 for addresses, without padding.
    static func base64Url(_ data: Data) -> String {
        return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// The challenge of a verifier (RFC 7636, section 4.2).
    static func pkceChallenge(_ verifier: String) -> String {
        return base64Url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// A fresh secret of this many random bytes: a verifier (32) or a state (16).
    static func random(_ bytes: Int) -> String {
        var generator = SystemRandomNumberGenerator()
        return base64Url(Data((0..<bytes).map { _ in UInt8.random(in: 0...255, using: &generator) }))
    }

    /// What the browser came back with, against what was begun. Who answered
    /// must be who was asked (RFC 9207) — before anything of the answer is used,
    /// an error included. Answers the code.
    static func checkRedirect(pendingState: String?, issuer: String?, promised: Bool, state: String?, code: String?, iss: String?, error: String?) throws -> String {
        guard let pendingState = pendingState, let state = state, !state.isEmpty, state == pendingState else { throw Problem("oauth-no-flow") }
        let named = iss != nil ? iss == issuer : !promised
        if !named { throw Problem("oauth-issuer") }
        if let error = error { throw Problem(error == "access_denied" ? "oauth-denied" : "oauth-failed") }
        guard let code = code, !code.isEmpty else { throw Problem("oauth-failed") }
        return code
    }

    /// Who Plainva is to an authorization server, and how it proves it: not at all ("none"), or with a secret ("post", "basic").
    struct Client: Equatable {
        let id: String
        let auth: String
        let secret: String?
    }

    private static func withClient(_ fields: [(String, String)], _ client: Client, _ resource: String) -> [(String, String)] {
        var out = fields
        out.append(("client_id", client.id))
        out.append(("resource", resource))
        if client.auth == "post", let secret = client.secret { out.append(("client_secret", secret)) }
        return out
    }

    /// The fields of the request that exchanges a code. A secret travels in the body only where the registration said so.
    static func codeForm(code: String, verifier: String, redirect: String, client: Client, resource: String) -> [(String, String)] {
        return withClient([("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirect), ("code_verifier", verifier)], client, resource)
    }

    /// The fields of the request that gets the next token.
    static func refreshForm(refresh: String, client: Client, resource: String) -> [(String, String)] {
        return withClient([("grant_type", "refresh_token"), ("refresh_token", refresh)], client, resource)
    }

    /// One value of a form (application/x-www-form-urlencoded).
    static func formEncode(_ value: String) -> String {
        var out = ""
        for byte in value.utf8 {
            let plain = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2a || byte == 0x2d || byte == 0x2e || byte == 0x5f
            if plain {
                out.unicodeScalars.append(Unicode.Scalar(byte))
            } else if byte == 0x20 {
                out += "+"
            } else {
                out += String(format: "%%%02X", Int(byte))
            }
        }
        return out
    }

    static func formBody(_ fields: [(String, String)]) -> String {
        return fields.map { $0.0 + "=" + formEncode($0.1) }.joined(separator: "&")
    }

    /// A token is visible ASCII without a space: anything else would end the header it travels in.
    static func tokenOk(_ value: Any?) -> Bool {
        guard let token = value as? String, !token.isEmpty, token.utf8.count <= maxToken else { return false }
        return token.utf8.allSatisfy { $0 >= 0x21 && $0 <= 0x7e }
    }

    struct Tokens: Equatable {
        var access: String
        /// Nil where the server handed out none.
        var refresh: String?
        /// Seconds from now; nil where the server did not say.
        var expiresIn: Int?
        /// Nil where the server did not say: then what was asked for was granted.
        var scopes: [String]?
    }

    private static func absent(_ value: Any?) -> Bool {
        return value == nil || value is NSNull
    }

    /// Reads a token endpoint's answer. Only a bearer token is one; a refresh
    /// token that was refused for good (`invalid_grant`) says so.
    static func readTokenResponse(status: Int, body: String?) throws -> Tokens {
        guard let answer = object(body) else { throw Problem("oauth-token") }
        if status != 200 { throw Problem(status == 400 && (answer["error"] as? String) == "invalid_grant" ? "oauth-grant" : "oauth-token") }
        guard let kind = answer["token_type"] as? String, kind.lowercased() == "bearer", tokenOk(answer["access_token"]), let access = answer["access_token"] as? String else { throw Problem("oauth-token") }
        var tokens = Tokens(access: access, refresh: nil, expiresIn: nil, scopes: nil)
        if !absent(answer["refresh_token"]) {
            guard tokenOk(answer["refresh_token"]), let refresh = answer["refresh_token"] as? String else { throw Problem("oauth-token") }
            tokens.refresh = refresh
        }
        if let number = answer["expires_in"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            let seconds = number.doubleValue
            // Capped before it becomes a whole number: a value no whole number holds would end the app.
            if seconds.isFinite && seconds >= 1 { tokens.expiresIn = Int(min(seconds, Double(10 * 365 * 24 * 3600)).rounded(.down)) }
        }
        if let scope = answer["scope"] as? String { tokens.scopes = readScopes(scope) }
        return tokens
    }

    /// What a client that registers itself says about itself (RFC 7591): a native app, without a secret.
    static func registrationBody(clientName: String, redirect: String) -> [String: Any] {
        return [
            "client_name": String(clientName.prefix(80)),
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "application_type": "native",
        ]
    }

    /// Reads a registration's answer: the id, and a secret where the server insists on one. Nil where the answer is none.
    static func readRegistration(status: Int, body: String?) -> Client? {
        guard status == 200 || status == 201, let answer = object(body) else { return nil }
        guard let id = clientId(document: false, answer["client_id"] as? String) else { return nil }
        var secret: String?
        if !absent(answer["client_secret"]) {
            guard tokenOk(answer["client_secret"]) else { return nil }
            secret = answer["client_secret"] as? String
        }
        var method: String?
        if !absent(answer["token_endpoint_auth_method"]) {
            guard let named = answer["token_endpoint_auth_method"] as? String else { return nil }
            method = named
        }
        guard let kept = secret else {
            return method == nil || method == "none" ? Client(id: id, auth: "none", secret: nil) : nil
        }
        if method == "client_secret_post" { return Client(id: id, auth: "post", secret: kept) }
        // The default of a client with a secret (RFC 7591, section 2).
        if method == nil || method == "client_secret_basic" { return Client(id: id, auth: "basic", secret: kept) }
        // A secret that came with "none" is not used: the client stays a public one.
        return method == "none" ? Client(id: id, auth: "none", secret: nil) : nil
    }
}
