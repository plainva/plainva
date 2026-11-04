import Foundation

/// The phone's rules for signing in to a remote MCP server (plan KI-Harness
/// P4.5). The lists are those of packages/core/src/ai/mcp/oauthRules.test.ts
/// (`MCP_OAUTH_*_CASES`), which the desktop's `oauth.rs` and Android's
/// `AiMcpOAuthRulesTest.java` run too: a case added there is added here.
@main
struct AiMcpOAuthRulesTests {
    /// The condition may itself throw: a rule that refuses where the test expects an answer fails the test with the rule's own word.
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if !(try condition()) { throw NSError(domain: message, code: 1) }
    }

    static let issuer = "https://auth.example.org"
    static let server = "https://mcp.example.com/mcp"

    /// JSON is written with single quotes here, so that it can be read.
    static func q(_ json: String) -> String {
        return json.replacingOccurrences(of: "'", with: "\"")
    }

    /// [the server's registered address, an address it names, whether that may be asked]
    static let addressCases: [(String, String, Bool)] = [
        ("https://mcp.example.com/mcp", "https://auth.example.org/.well-known/oauth-authorization-server", true),
        ("https://mcp.example.com/mcp", "https://mcp.example.com:8443/token", true),
        ("https://mcp.example.com/mcp", "https://auth.example.org:8443/token", false),
        ("https://mcp.example.com/mcp", "http://auth.example.org/token", false),
        ("https://mcp.example.com/mcp", "https://192.168.1.1/token", false),
        ("https://mcp.example.com/mcp", "https://router.lan/token", false),
        ("https://mcp.example.com/mcp", "https://localhost/token", false),
        ("https://mcp.example.com/mcp", "https://user:pw@auth.example.org/token", false),
        ("https://mcp.example.com/mcp", "https://auth.example.org/token#x", false),
        ("https://mcp.example.com/mcp", "javascript:alert(1)", false),
        ("https://mcp.example.com/mcp", "", false),
        ("https://192.168.1.20/mcp", "https://192.168.1.20/oauth/token", true),
        ("https://192.168.1.20/mcp", "https://192.168.1.21/oauth/token", false),
        ("http://localhost:3000/mcp", "http://localhost:9000/token", true),
        ("http://localhost:3000/mcp", "http://127.0.0.1:9000/token", false),
        ("http://localhost:3000/mcp", "https://auth.example.org/token", true),
    ]

    static let issuerUrlCases: [(String, String, Bool)] = [
        ("https://auth.example.org", "https://auth.example.org/.well-known/oauth-authorization-server", true),
        ("https://auth.example.org/tenant1", "https://auth.example.org/.well-known/oauth-authorization-server/tenant1", true),
        ("https://auth.example.org/tenant1", "https://auth.example.org/tenant1/.well-known/openid-configuration", true),
        ("http://localhost:9000", "http://localhost:9000/.well-known/oauth-authorization-server", true),
        ("https://auth.example.org", "https://auth.example.org/metadata.json", false),
        ("https://auth.example.org", "https://evil.example.net/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org", "https://auth.example.org:8443/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org", "http://auth.example.org/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org?x=1", "https://auth.example.org/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org#x", "https://auth.example.org/.well-known/oauth-authorization-server", false),
    ]

    static let complete = q(
        "{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','response_types_supported':['code'],"
            + "'code_challenge_methods_supported':['S256','plain'],'registration_endpoint':'https://auth.example.org/register','client_id_metadata_document_supported':true,"
            + "'authorization_response_iss_parameter_supported':true,'scopes_supported':['read','write']}")

    /// [what the case is about, the metadata as it was served, "ok" or why it does not count]
    static let issuerDocCases: [(String, String, String)] = [
        ("complete", complete, "ok"),
        ("the token endpoint on another public host",
         q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://tokens.example.net/token','code_challenge_methods_supported':['S256']}"), "ok"),
        ("another issuer, by one character",
         q("{'issuer':'https://auth.example.org/','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-issuer"),
        ("no issuer", q("{'authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-issuer"),
        ("it does not say it does PKCE", q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token'}"), "oauth-no-pkce"),
        ("PKCE without SHA-256",
         q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['plain']}"), "oauth-no-pkce"),
        ("the token endpoint in the local network",
         q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://router.lan/token','code_challenge_methods_supported':['S256']}"), "oauth-endpoints"),
        ("no authorization endpoint", q("{'issuer':'https://auth.example.org','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-endpoints"),
        ("no code flow",
         q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','response_types_supported':['token'],'code_challenge_methods_supported':['S256']}"),
         "oauth-endpoints"),
        ("a page, not a document", "<html><body>Not found</body></html>", "oauth-no-metadata"),
        ("a list, not a document", "[]", "oauth-no-metadata"),
    ]

    static let resourceCases: [(String, String, Bool)] = [
        ("https://mcp.example.com/mcp", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com/", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com/mcp", "https://mcp.example.com/mcp/v1?x=1", true),
        ("https://MCP.Example.com/mcp", "https://mcp.example.com/mcp", true),
        ("http://localhost:3000/mcp", "http://localhost:3000/mcp", true),
        ("https://mcp.example.com/mc", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp/v1", "https://mcp.example.com/mcp", false),
        ("https://other.example.com/mcp", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com:8443/mcp", "https://mcp.example.com/mcp", false),
        ("http://mcp.example.com/mcp", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp?x=1", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp#x", "https://mcp.example.com/mcp", false),
        ("", "https://mcp.example.com/mcp", false),
    ]

    /// [the issuer promised to name itself, state, code, iss, error, "ok" or the problem] — begun with state "s1" at `issuer`.
    static let redirectCases: [(Bool, String, String?, String?, String?, String)] = [
        (false, "s1", "c", nil, nil, "ok"),
        (true, "s1", "c", "https://auth.example.org", nil, "ok"),
        (false, "s1", "c", "https://auth.example.org", nil, "ok"),
        (true, "s1", "c", nil, nil, "oauth-issuer"),
        (false, "s1", "c", "https://auth.example.org/", nil, "oauth-issuer"),
        (true, "s1", nil, "https://evil.example.net", "access_denied", "oauth-issuer"),
        (false, "s2", "c", nil, nil, "oauth-no-flow"),
        (false, "", "c", nil, nil, "oauth-no-flow"),
        (false, "s1", nil, nil, "access_denied", "oauth-denied"),
        (false, "s1", nil, nil, "server_error", "oauth-failed"),
        (false, "s1", nil, nil, nil, "oauth-failed"),
        (false, "s1", "", nil, nil, "oauth-failed"),
    ]

    static let tokenCases: [(Int, String, String)] = [
        (200, q("{'access_token':'at','token_type':'Bearer','expires_in':3600,'refresh_token':'rt','scope':'read write'}"), "ok"),
        (200, q("{'access_token':'at','token_type':'bearer'}"), "ok"),
        (200, q("{'access_token':'at','token_type':'mac'}"), "oauth-token"),
        (200, q("{'access_token':'','token_type':'Bearer'}"), "oauth-token"),
        (200, q("{'access_token':'a b','token_type':'Bearer'}"), "oauth-token"),
        (200, q("{'token_type':'Bearer'}"), "oauth-token"),
        (200, q("{'access_token':'at','token_type':'Bearer','refresh_token':7}"), "oauth-token"),
        (200, "not json", "oauth-token"),
        (400, q("{'error':'invalid_grant'}"), "oauth-grant"),
        (400, q("{'error':'invalid_client'}"), "oauth-token"),
        (401, q("{'error':'invalid_grant'}"), "oauth-token"),
        (500, "", "oauth-token"),
    ]

    /// [HTTP status, a registration's answer, how the client proves itself — or nil where the answer is none]
    static let registrationCases: [(Int, String, String?)] = [
        (201, q("{'client_id':'abc','token_endpoint_auth_method':'none'}"), "none"),
        (200, q("{'client_id':'abc'}"), "none"),
        (201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'client_secret_post'}"), "post"),
        (201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'client_secret_basic'}"), "basic"),
        (201, q("{'client_id':'abc','client_secret':'s3'}"), "basic"),
        (201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'none'}"), "none"),
        (201, q("{'client_id':'abc','token_endpoint_auth_method':'client_secret_post'}"), nil),
        (201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'private_key_jwt'}"), nil),
        (201, q("{'client_secret':'s3'}"), nil),
        (400, q("{'error':'invalid_redirect_uri'}"), nil),
        (201, "nope", nil),
    ]

    static func outcome(_ work: () throws -> Void) -> String {
        do {
            try work()
            return "ok"
        } catch let problem as AiMcpOAuthRules.Problem {
            return problem.word
        } catch {
            return "another error"
        }
    }

    static func flat(_ fields: [(String, String)]) -> [String] {
        return fields.map { $0.0 + "=" + $0.1 }
    }

    static func main() throws {
        for (own, named, accepted) in addressCases {
            try require((AiMcpOAuthRules.oauthAddress(named, serverUrl: own) != nil) == accepted, "address: \(own) -> \(named)")
        }
        try require(AiMcpOAuthRules.oauthAddress(" https://AUTH.example.org/token ", serverUrl: server) == "https://auth.example.org/token", "an address in one form")
        try require(AiMcpOAuthRules.oauthAddress("https://mcp.example.com:8443/token", serverUrl: server) == "https://mcp.example.com:8443/token", "any port of the server's own host")
        try require(AiMcpOAuthRules.oauthAddress(nil, serverUrl: server) == nil, "no address")

        for (named, url, accepted) in issuerUrlCases {
            try require(AiMcpOAuthRules.issuerDocumentUrlOk(issuer: named, url: url) == accepted, "metadata of \(named) at \(url)")
        }

        for (about, body, expected) in issuerDocCases {
            let found = outcome { _ = try AiMcpOAuthRules.readIssuerDocument(body, issuer: issuer, serverUrl: server) }
            try require(found == expected, "metadata: \(about) -> \(found)")
        }
        let endpoints = try AiMcpOAuthRules.readIssuerDocument(complete, issuer: issuer, serverUrl: server)
        try require(
            endpoints == AiMcpOAuthRules.Endpoints(
                issuer: issuer, authorization: "https://auth.example.org/authorize", token: "https://auth.example.org/token", registration: "https://auth.example.org/register", document: true, iss: true,
                scopes: ["read", "write"]),
            "the endpoints of a complete document")
        let plain = try AiMcpOAuthRules.readIssuerDocument(
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256'],'registration_endpoint':'http://auth.example.org/register'}"),
            issuer: issuer, serverUrl: server)
        try require(plain.registration == nil && !plain.document && !plain.iss && plain.scopes.isEmpty, "a registration endpoint that may not be asked is none")
        // A 1 is not a yes: only JSON's own true counts.
        let loose = try AiMcpOAuthRules.readIssuerDocument(
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256'],'client_id_metadata_document_supported':1,'authorization_response_iss_parameter_supported':'true'}"),
            issuer: issuer, serverUrl: server)
        try require(!loose.document && !loose.iss, "what only counts as true is not true")

        for (resource, own, covers) in resourceCases {
            try require(AiMcpOAuthRules.resourceCovers(resource, serverUrl: own) == covers, "resource: \(resource) for \(own)")
        }

        try require(AiMcpOAuthRules.redirectUri(appId: "com.plainva.app") == "com.plainva.app://mcp/oauth", "the app's own address")
        try require(AiMcpOAuthRules.redirectUri(appId: "com.plainva.app.labs") == "com.plainva.app.labs://mcp/oauth", "the Labs app's own address")
        try require(AiMcpOAuthRules.redirectUri(appId: "https") == nil, "a scheme is no app id")
        try require(AiMcpOAuthRules.redirectUri(appId: "") == nil, "an empty id")
        try require(AiMcpOAuthRules.redirectUri(appId: nil) == nil, "no id")

        for (promised, state, code, iss, error, expected) in redirectCases {
            let found = outcome { _ = try AiMcpOAuthRules.checkRedirect(pendingState: "s1", issuer: issuer, promised: promised, state: state, code: code, iss: iss, error: error) }
            try require(found == expected, "redirect: \(state) \(code ?? "-") \(iss ?? "-") \(error ?? "-") -> \(found)")
        }
        try require(outcome { _ = try AiMcpOAuthRules.checkRedirect(pendingState: nil, issuer: issuer, promised: false, state: "s1", code: "c", iss: nil, error: nil) } == "oauth-no-flow", "nothing was begun")
        try require(try AiMcpOAuthRules.checkRedirect(pendingState: "s1", issuer: issuer, promised: false, state: "s1", code: "c", iss: nil, error: nil) == "c", "the code of a good answer")

        let asked = AiMcpOAuthRules.authorizationUrl(
            endpoint: "https://auth.example.org/authorize?tenant=a", clientId: "https://plainva.com/oauth/client.json", redirect: "http://127.0.0.1:43117/callback",
            challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", state: "s1", scopes: ["read", "write"], resource: "https://mcp.example.com/mcp") ?? ""
        try require(asked.hasPrefix("https://auth.example.org/authorize?"), "the endpoint stays")
        try require(!asked.contains(" ") && !asked.contains("+"), "a scope list travels encoded")
        let pairs = (URLComponents(string: asked)?.queryItems ?? []).map { $0.name + "=" + ($0.value ?? "") }
        try require(
            pairs == [
                "tenant=a", "response_type=code", "client_id=https://plainva.com/oauth/client.json", "redirect_uri=http://127.0.0.1:43117/callback",
                "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "code_challenge_method=S256", "state=s1", "resource=https://mcp.example.com/mcp", "scope=read write",
            ],
            "the request for a sign-in: \(pairs)")
        let bare = AiMcpOAuthRules.authorizationUrl(endpoint: "https://auth.example.org/authorize", clientId: "c", redirect: "r", challenge: "x", state: "s", scopes: [], resource: "q") ?? ""
        try require(!bare.contains("scope="), "without scopes there is no scope")
        try require(AiMcpOAuthRules.authorizationUrl(endpoint: "not an address", clientId: "c", redirect: "r", challenge: "x", state: "s", scopes: [], resource: "q") == nil, "no endpoint, no address")

        // RFC 7636, appendix B.
        try require(AiMcpOAuthRules.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "the challenge of the RFC's verifier")
        let verifier = AiMcpOAuthRules.random(32)
        let urlSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        try require(verifier.count == 43 && verifier.unicodeScalars.allSatisfy(urlSafe.contains), "a verifier of 32 bytes")
        try require(AiMcpOAuthRules.random(32) != verifier, "another verifier each time")
        try require(AiMcpOAuthRules.random(16).count == 22, "a state of 16 bytes")
        try require(AiMcpOAuthRules.base64Url(Data([0xfb, 0xff])) == "-_8", "base64 for addresses")

        try require(AiMcpOAuthRules.clientId(document: false, " my-client 1 ") == "my-client 1", "a client id is trimmed")
        try require(AiMcpOAuthRules.clientId(document: false, "") == nil, "an empty client id")
        try require(AiMcpOAuthRules.clientId(document: false, "a\nb") == nil, "a client id with a line break")
        try require(AiMcpOAuthRules.clientId(document: false, String(repeating: "a", count: 513)) == nil, "a client id that is too long")
        try require(AiMcpOAuthRules.clientId(document: true, "https://plainva.com/oauth/client.json") == "https://plainva.com/oauth/client.json", "the address of a description")
        for bad in ["https://plainva.com/", "https://plainva.com", "http://plainva.com/oauth/client.json", "https://192.168.1.2/client.json", "https://plainva.com/oauth/client.json#x", "my-client"] {
            try require(AiMcpOAuthRules.clientId(document: true, bad) == nil, "not the address of a description: \(bad)")
        }

        let open = AiMcpOAuthRules.Client(id: "abc", auth: "none", secret: nil)
        let codeFields = AiMcpOAuthRules.codeForm(code: "c1", verifier: "v1", redirect: "http://127.0.0.1:43117/callback", client: open, resource: "https://mcp.example.com/mcp")
        try require(
            flat(codeFields) == ["grant_type=authorization_code", "code=c1", "redirect_uri=http://127.0.0.1:43117/callback", "code_verifier=v1", "client_id=abc", "resource=https://mcp.example.com/mcp"],
            "the fields that exchange a code")
        try require(
            AiMcpOAuthRules.formBody(codeFields)
                == "grant_type=authorization_code&code=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A43117%2Fcallback&code_verifier=v1&client_id=abc&resource=https%3A%2F%2Fmcp.example.com%2Fmcp",
            "the form that exchanges a code")
        let post = AiMcpOAuthRules.Client(id: "abc", auth: "post", secret: "s3")
        try require(
            flat(AiMcpOAuthRules.refreshForm(refresh: "rt", client: post, resource: "https://mcp.example.com"))
                == ["grant_type=refresh_token", "refresh_token=rt", "client_id=abc", "resource=https://mcp.example.com", "client_secret=s3"],
            "the fields that get the next token")
        let basic = AiMcpOAuthRules.Client(id: "abc", auth: "basic", secret: "s3")
        try require(!flat(AiMcpOAuthRules.refreshForm(refresh: "rt", client: basic, resource: "r")).contains { $0.hasPrefix("client_secret=") }, "a secret that is the request's own credential is not in the body")
        try require(AiMcpOAuthRules.formEncode("a b+c/d=e&f~") == "a+b%2Bc%2Fd%3De%26f%7E", "one value of a form")

        for (status, body, expected) in tokenCases {
            let found = outcome { _ = try AiMcpOAuthRules.readTokenResponse(status: status, body: body) }
            try require(found == expected, "token: \(status) \(body) -> \(found)")
        }
        try require(
            try AiMcpOAuthRules.readTokenResponse(status: 200, body: tokenCases[0].1) == AiMcpOAuthRules.Tokens(access: "at", refresh: "rt", expiresIn: 3600, scopes: ["read", "write"]),
            "everything a token endpoint may say")
        try require(
            try AiMcpOAuthRules.readTokenResponse(status: 200, body: q("{'access_token':'at','token_type':'Bearer','expires_in':-5,'refresh_token':null}"))
                == AiMcpOAuthRules.Tokens(access: "at", refresh: nil, expiresIn: nil, scopes: nil),
            "the least a token endpoint may say")
        try require(
            try AiMcpOAuthRules.readTokenResponse(status: 200, body: q("{'access_token':'at','token_type':'Bearer','expires_in':1e300}")).expiresIn == 10 * 365 * 24 * 3600,
            "a lifetime no whole number holds is capped")
        try require(
            outcome { _ = try AiMcpOAuthRules.readTokenResponse(status: 200, body: q("{'access_token':'" + String(repeating: "a", count: AiMcpOAuthRules.maxToken + 1) + "','token_type':'Bearer'}")) } == "oauth-token",
            "a token that long is none")

        let registration = AiMcpOAuthRules.registrationBody(clientName: "Plainva", redirect: "com.plainva.app://mcp/oauth")
        try require(registration.count == 6 && (registration["client_name"] as? String) == "Plainva" && (registration["redirect_uris"] as? [String]) == ["com.plainva.app://mcp/oauth"], "who registers, and for which way back")
        try require((registration["grant_types"] as? [String]) == ["authorization_code", "refresh_token"] && (registration["response_types"] as? [String]) == ["code"], "what is registered for")
        try require((registration["token_endpoint_auth_method"] as? String) == "none" && (registration["application_type"] as? String) == "native", "a native app without a secret")
        for (status, body, expected) in registrationCases {
            try require(AiMcpOAuthRules.readRegistration(status: status, body: body)?.auth == expected, "registration: \(status) \(body)")
        }
        try require(AiMcpOAuthRules.readRegistration(status: 201, body: registrationCases[2].1) == AiMcpOAuthRules.Client(id: "abc", auth: "post", secret: "s3"), "a secret the server insists on")
        try require(AiMcpOAuthRules.readRegistration(status: 201, body: registrationCases[5].1) == AiMcpOAuthRules.Client(id: "abc", auth: "none", secret: nil), "a secret that came with none is not used")

        try require(AiMcpOAuthRules.readScopes("read  wri\"te read ok") == ["read", "ok"], "scopes of a list in a string")
        try require(AiMcpOAuthRules.readScopes(["a", 7, "a", "b"] as [Any]) == ["a", "b"], "scopes of a list")
        try require(AiMcpOAuthRules.readScopes((0..<80).map { "s\($0)" }.joined(separator: " ")).count == AiMcpOAuthRules.maxScopes, "no more scopes than fit")
        try require(AiMcpOAuthRules.readScopes(nil).isEmpty, "no scopes")

        print("AI MCP sign-in rules: \(addressCases.count) addresses, \(issuerDocCases.count) documents, \(redirectCases.count) ways back, \(tokenCases.count) token answers passed.")
    }
}
