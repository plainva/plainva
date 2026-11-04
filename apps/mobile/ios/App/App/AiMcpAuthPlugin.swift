import Foundation
import Capacitor
import Security

/// What the phone keeps of a sign-in to a remote MCP server (plan KI-Harness
/// P4.5), in the Keychain service of the MCP plugin: one entry per server with
/// who Plainva is to the authorization server, where its token endpoint is,
/// and the tokens — and one entry for a sign-in that was begun and waits for
/// its browser. A server's id has no `#`, so these names are nobody else's.
///
/// Nothing in here is handed to the WebView. `AiMcpPlugin` asks for the
/// credential of a request, `AiMcpAuthPlugin` for the rest.
enum AiMcpAuthStore {
    /// The sign-in that was begun and waits for its browser.
    static let pending = "#pending"
    private static let lock = NSLock()

    static func linkName(_ serverId: String) -> String {
        return serverId + "#oauth"
    }

    private static func query(_ name: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: AiMcpPlugin.secretService,
                kSecAttrAccount as String: name]
    }

    /// What is kept under a name; nil where there is nothing, or nothing that can be read.
    static func read(_ name: String) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        var query = self.query(name)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any]
    }

    /// Keeps an entry on this device only, never in a backup or on another device; nil removes it.
    @discardableResult
    static func keep(_ name: String, _ value: [String: Any]?) -> Bool {
        lock.lock(); defer { lock.unlock() }
        SecItemDelete(query(name) as CFDictionary)
        guard let value = value else { return true }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: []) else { return false }
        var attributes = query(name)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    /// The credential of a request to a server that is signed in to; nil where it is not.
    static func bearer(_ serverId: String) -> String? {
        return read(linkName(serverId))?["access"] as? String
    }

    /// The tokens go; who Plainva is to the authorization server stays.
    static func endSignIn(_ serverId: String) {
        guard var link = read(linkName(serverId)) else { return }
        link.removeValue(forKey: "access")
        link.removeValue(forKey: "refresh")
        link.removeValue(forKey: "expiresAt")
        keep(linkName(serverId), link)
    }

    /// Everything about a sign-in goes: the tokens, who Plainva was to the
    /// authorization server, a sign-in that was begun. Called when a server is
    /// removed or registered anew, when a fixed token takes its place, and when
    /// the user signs out.
    static func forget(_ serverId: String) {
        keep(linkName(serverId), nil)
        if (read(pending)?["serverId"] as? String) == serverId { keep(pending, nil) }
    }
}

/// One request of a sign-in, collected by hand: no redirect is followed, the
/// answer is cut, and where it really came from is kept.
private final class AiMcpAuthExchange: NSObject, URLSessionDataDelegate {
    var status = 0
    var body = Data()
    var tooLarge = false
    var failed = false
    var remote: String?
    var proxied = false
    let done = DispatchSemaphore(value: 0)

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // a redirect could carry a code or a token elsewhere: refused, and reported as the answer it is
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if body.count + data.count > AiMcpAuthPlugin.maxReplyBytes {
            tooLarge = true
            dataTask.cancel()
            return
        }
        body.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let last = metrics.transactionMetrics.last
        remote = last?.remoteAddress
        proxied = last?.isProxyConnection ?? false
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil { failed = true }
        done.signal()
    }
}

/**
 * Signing in to a remote MCP server on iOS (plan KI-Harness P4.5): OAuth 2.1
 * with PKCE — twin of the desktop's `mcp_client/oauth.rs` and Android's
 * AiMcpAuthPlugin.
 *
 * The WebView opens a browser and hands back what it returned with. That is
 * all it does: the verifier, the exchange of the code, the tokens and their
 * renewal stay in this plugin, and so does the choice of WHERE a code or a
 * token is sent — the endpoints come from a document this plugin fetched
 * itself, from an address on the authorization server's own origin, whose
 * issuer is the one that was asked for. A token is asked for the server's
 * registered address, kept under the server's id, and put into requests to
 * that address only (AiMcpPlugin).
 *
 * The decisions are `AiMcpOAuthRules`; what is kept, `AiMcpAuthStore`.
 */
@objc(AiMcpAuthPlugin)
public class AiMcpAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AiMcpAuthPlugin"
    public let jsName = "AiMcpAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "document", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "issuer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renew", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
    ]

    /// A document of a sign-in is small; more than this is not one.
    static let maxReplyBytes = 256 * 1024
    /// A renewal this fresh is not made again: a second request that was refused with the old token finds the new one.
    private static let recentSeconds: TimeInterval = 10
    /// One request of a sign-in at a time: a renewal never overtakes another, and a token for the next is used once.
    private static let work = DispatchQueue(label: "com.plainva.ai-mcp-auth")
    /// The authorization server each server was last asked about. Read and written on `work` only.
    private static var issuers = [String: AiMcpOAuthRules.Endpoints]()
    private static var renewed = [String: Date]()

    private struct Reply {
        let status: Int
        let body: String
    }

    /// The registered address of a server; nil where there is none.
    private func address(_ serverId: String?) -> String? {
        guard let serverId = serverId else { return nil }
        return (UserDefaults.standard.dictionary(forKey: AiMcpPlugin.serversDefaultsKey) as? [String: String])?[serverId]
    }

    /// The app's own address, as the system knows it: where the browser comes back to.
    private static func appId() -> String? {
        let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]]
        let schemes = types?.first?["CFBundleURLSchemes"] as? [String]
        return schemes?.first ?? Bundle.main.bundleIdentifier
    }

    /// One request of a sign-in. An address on the server's own host is the
    /// one the user confirmed. Every other one must resolve to public addresses
    /// before the request starts — and because URLSession gives no way to
    /// connect to exactly those, the far end the system reports afterwards is
    /// checked again before anything of the answer is used. No redirect is
    /// followed; the answer is cut. `body` nil is a GET.
    private static func ask(_ url: String?, serverUrl: String, contentType: String? = nil, body: String? = nil, basic: String? = nil) throws -> Reply {
        guard let url = url, let target = URL(string: url), let host = URLComponents(string: url)?.host else { throw AiMcpOAuthRules.Problem("oauth-address") }
        let foreign = host != URLComponents(string: serverUrl)?.host
        if foreign {
            guard target.scheme == "https" else { throw AiMcpOAuthRules.Problem("oauth-address") }
            guard let addresses = AiWebRules.resolve(host) else { throw AiMcpOAuthRules.Problem("oauth-unreachable") }
            if addresses.contains(where: { !AiWebRules.isPublicAddress($0) }) { throw AiMcpOAuthRules.Problem("oauth-address") }
        }
        var request = URLRequest(url: target)
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body = body {
            request.httpMethod = "POST"
            request.httpBody = Data(body.utf8)
            request.setValue(contentType ?? "application/json", forHTTPHeaderField: "content-type")
        }
        if let basic = basic { request.setValue("Basic " + basic, forHTTPHeaderField: "authorization") }

        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 20
        let exchange = AiMcpAuthExchange()
        let session = URLSession(configuration: config, delegate: exchange, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        session.dataTask(with: request).resume()
        exchange.done.wait()
        if exchange.failed || exchange.tooLarge { throw AiMcpOAuthRules.Problem("oauth-unreachable") }
        if foreign && !exchange.proxied {
            guard let remote = exchange.remote, AiWebRules.isPublicAddress(remote) else { throw AiMcpOAuthRules.Problem("oauth-address") }
        }
        return Reply(status: exchange.status, body: String(decoding: exchange.body, as: UTF8.self))
    }

    /// The request's own credential of a client that proves itself that way: id and secret, form-encoded before they are joined (RFC 6749, section 2.3.1).
    private static func basicOf(_ who: AiMcpOAuthRules.Client) -> String? {
        guard who.auth == "basic", let secret = who.secret else { return nil }
        return Data((AiMcpOAuthRules.formEncode(who.id) + ":" + AiMcpOAuthRules.formEncode(secret)).utf8).base64EncodedString()
    }

    private static func clientOf(_ from: [String: Any]?) -> AiMcpOAuthRules.Client? {
        guard let id = from?["clientId"] as? String else { return nil }
        return AiMcpOAuthRules.Client(id: id, auth: (from?["auth"] as? String) ?? "none", secret: from?["clientSecret"] as? String)
    }

    private static func word(_ error: Error) -> String {
        return (error as? AiMcpOAuthRules.Problem)?.word ?? "oauth-failed"
    }

    /// A document a server names for its sign-in (its resource metadata, RFC 9728). No secret, and none is sent.
    @objc func document(_ call: CAPPluginCall) {
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if AiLocalOnly.on { call.reject("local_only"); return }
        guard let serverUrl = address(call.getString("serverId")), let target = AiMcpOAuthRules.oauthAddress(call.getString("url"), serverUrl: serverUrl) else {
            call.reject("oauth-address"); return
        }
        AiMcpAuthPlugin.work.async {
            do {
                let reply = try AiMcpAuthPlugin.ask(target, serverUrl: serverUrl)
                call.resolve(["status": reply.status, "body": reply.body])
            } catch {
                call.reject(AiMcpAuthPlugin.word(error))
            }
        }
    }

    /// Reads an authorization server's metadata from an address on its own origin and keeps it for the sign-in.
    @objc func issuer(_ call: CAPPluginCall) {
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if AiLocalOnly.on { call.reject("local_only"); return }
        let issuer = call.getString("issuer")
        let url = call.getString("url")
        guard let serverId = call.getString("serverId"), let serverUrl = address(serverId), let named = issuer,
              AiMcpOAuthRules.issuerDocumentUrlOk(issuer: named, url: url), let target = AiMcpOAuthRules.oauthAddress(url, serverUrl: serverUrl) else {
            call.reject("oauth-address"); return
        }
        AiMcpAuthPlugin.work.async {
            do {
                let reply = try AiMcpAuthPlugin.ask(target, serverUrl: serverUrl)
                if reply.status != 200 { throw AiMcpOAuthRules.Problem("oauth-no-metadata") }
                let found = try AiMcpOAuthRules.readIssuerDocument(reply.body, issuer: named, serverUrl: serverUrl)
                AiMcpAuthPlugin.issuers[serverId] = found
                // What the WebView is told: what the authorization server offers, not where its endpoints are.
                let info: [String: Any] = ["issuer": found.issuer, "document": found.document, "dynamic": found.registration != nil, "iss": found.iss, "scopes": found.scopes]
                call.resolve(["issuer": info])
            } catch {
                call.reject(AiMcpAuthPlugin.word(error))
            }
        }
    }

    /// Begins a sign-in: decides who Plainva is to the authorization server,
    /// makes the verifier and the state, and answers with the address to open.
    /// The verifier stays here.
    @objc func begin(_ call: CAPPluginCall) {
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if AiLocalOnly.on { call.reject("local_only"); return }
        let kind = call.getString("clientKind") ?? ""
        let givenId = call.getString("clientId") ?? ""
        let clientName = call.getString("clientName") ?? "Plainva"
        let asked = (call.getArray("scopes") ?? []).compactMap { $0 as? String }
        let scopes = Array(asked.filter { AiMcpOAuthRules.scopeOk($0) }.prefix(AiMcpOAuthRules.maxScopes))
        guard let serverId = call.getString("serverId"), let serverUrl = address(serverId) else { call.reject("oauth-address"); return }
        guard let resource = call.getString("resource"), AiMcpOAuthRules.resourceCovers(resource, serverUrl: serverUrl) else { call.reject("oauth-resource"); return }
        guard let redirect = AiMcpOAuthRules.redirectUri(appId: AiMcpAuthPlugin.appId()) else { call.reject("oauth-address"); return }
        let issuer = call.getString("issuer")
        AiMcpAuthPlugin.work.async {
            do {
                guard let endpoints = AiMcpAuthPlugin.issuers[serverId], endpoints.issuer == issuer else { throw AiMcpOAuthRules.Problem("oauth-no-metadata") }
                var kept = AiMcpAuthStore.read(AiMcpAuthStore.linkName(serverId))
                if (kept?["issuer"] as? String) != endpoints.issuer { kept = nil }
                let who: AiMcpOAuthRules.Client
                let whoKind: String
                if kind == "document" {
                    guard endpoints.document, let id = AiMcpOAuthRules.clientId(document: true, givenId) else { throw AiMcpOAuthRules.Problem("oauth-client") }
                    who = AiMcpOAuthRules.Client(id: id, auth: "none", secret: nil)
                    whoKind = "document"
                } else if kind == "manual" {
                    guard let id = AiMcpOAuthRules.clientId(document: false, givenId) else { throw AiMcpOAuthRules.Problem("oauth-client") }
                    who = AiMcpOAuthRules.Client(id: id, auth: "none", secret: nil)
                    whoKind = "manual"
                } else if let known = AiMcpAuthPlugin.clientOf(kept), let knownKind = kept?["kind"] as? String, knownKind != "dynamic" || (kept?["redirectUri"] as? String) == redirect {
                    who = known
                    whoKind = knownKind
                } else if kind == "stored" && kept == nil {
                    throw AiMcpOAuthRules.Problem("oauth-client")
                } else {
                    // A registration is for one way back: another one is another registration.
                    guard let registration = endpoints.registration else { throw AiMcpOAuthRules.Problem("oauth-client") }
                    let body = try JSONSerialization.data(withJSONObject: AiMcpOAuthRules.registrationBody(clientName: clientName, redirect: redirect), options: [])
                    let reply = try AiMcpAuthPlugin.ask(registration, serverUrl: serverUrl, contentType: "application/json", body: String(decoding: body, as: UTF8.self))
                    guard let registered = AiMcpOAuthRules.readRegistration(status: reply.status, body: reply.body) else { throw AiMcpOAuthRules.Problem("oauth-registration") }
                    who = registered
                    whoKind = "dynamic"
                }
                let verifier = AiMcpOAuthRules.random(32)
                let state = AiMcpOAuthRules.random(16)
                guard let url = AiMcpOAuthRules.authorizationUrl(
                    endpoint: endpoints.authorization, clientId: who.id, redirect: redirect, challenge: AiMcpOAuthRules.pkceChallenge(verifier), state: state, scopes: scopes, resource: resource)
                else { throw AiMcpOAuthRules.Problem("oauth-endpoints") }
                var pending: [String: Any] = [
                    "serverId": serverId, "serverUrl": serverUrl, "issuer": endpoints.issuer, "iss": endpoints.iss, "tokenEndpoint": endpoints.token,
                    "clientId": who.id, "auth": who.auth, "kind": whoKind, "verifier": verifier, "state": state, "redirectUri": redirect,
                    "scopes": scopes, "resource": resource, "begun": Date().timeIntervalSince1970,
                ]
                if let secret = who.secret { pending["clientSecret"] = secret }
                guard AiMcpAuthStore.keep(AiMcpAuthStore.pending, pending) else { throw AiMcpOAuthRules.Problem("oauth-failed") }
                call.resolve(["url": url])
            } catch {
                call.reject(AiMcpAuthPlugin.word(error))
            }
        }
    }

    /// Ends a sign-in with what the browser came back with: checks it against
    /// what was begun, exchanges the code and keeps the tokens. Answers with
    /// the id of the server that is signed in to now — and with nothing else.
    @objc func finish(_ call: CAPPluginCall) {
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if AiLocalOnly.on { call.reject("local_only"); return }
        let state = call.getString("state")
        let code = call.getString("code")
        let iss = call.getString("iss")
        let error = call.getString("error")
        AiMcpAuthPlugin.work.async {
            do {
                let flow = AiMcpAuthStore.read(AiMcpAuthStore.pending)
                let begun = (flow?["begun"] as? NSNumber)?.doubleValue ?? 0
                let live = flow != nil && Date().timeIntervalSince1970 - begun < AiMcpOAuthRules.pendingSeconds
                let granted: String
                do {
                    granted = try AiMcpOAuthRules.checkRedirect(
                        pendingState: live ? flow?["state"] as? String : nil, issuer: flow?["issuer"] as? String, promised: (flow?["iss"] as? NSNumber)?.boolValue ?? false,
                        state: state, code: code, iss: iss, error: error)
                } catch let problem as AiMcpOAuthRules.Problem {
                    // An answer to nothing that was begun leaves what was begun alone: the real one may still come.
                    if problem.word != "oauth-no-flow" { AiMcpAuthStore.keep(AiMcpAuthStore.pending, nil) }
                    throw problem
                }
                AiMcpAuthStore.keep(AiMcpAuthStore.pending, nil)
                // The server may have gone, or become another one, while the browser was open.
                guard let serverId = flow?["serverId"] as? String, let serverUrl = flow?["serverUrl"] as? String, self.address(serverId) == serverUrl,
                      let who = AiMcpAuthPlugin.clientOf(flow), let resource = flow?["resource"] as? String,
                      let verifier = flow?["verifier"] as? String, let redirect = flow?["redirectUri"] as? String
                else { throw AiMcpOAuthRules.Problem("oauth-no-flow") }
                let form = AiMcpOAuthRules.formBody(AiMcpOAuthRules.codeForm(code: granted, verifier: verifier, redirect: redirect, client: who, resource: resource))
                let reply = try AiMcpAuthPlugin.ask(flow?["tokenEndpoint"] as? String, serverUrl: serverUrl, contentType: "application/x-www-form-urlencoded", body: form, basic: AiMcpAuthPlugin.basicOf(who))
                let tokens = try AiMcpOAuthRules.readTokenResponse(status: reply.status, body: reply.body)
                var link: [String: Any] = ["access": tokens.access, "scopes": tokens.scopes ?? (flow?["scopes"] as? [String]) ?? []]
                for name in ["issuer", "tokenEndpoint", "clientId", "auth", "clientSecret", "kind", "redirectUri", "resource"] {
                    if let value = flow?[name] as? String { link[name] = value }
                }
                if let refresh = tokens.refresh { link["refresh"] = refresh }
                if let seconds = tokens.expiresIn { link["expiresAt"] = Int(Date().timeIntervalSince1970) + seconds }
                guard AiMcpAuthStore.keep(AiMcpAuthStore.linkName(serverId), link) else { throw AiMcpOAuthRules.Problem("oauth-failed") }
                // A sign-in and a fixed token exclude each other.
                AiMcpPlugin.forgetToken(serverId)
                call.resolve(["serverId": serverId])
            } catch {
                call.reject(AiMcpAuthPlugin.word(error))
            }
        }
    }

    /// Forgets a sign-in that was begun and will not be finished.
    @objc func cancel(_ call: CAPPluginCall) {
        AiMcpAuthStore.keep(AiMcpAuthStore.pending, nil)
        call.resolve()
    }

    /// Gets a new token with the one kept for that. False where there is none, or it was refused.
    @objc func renew(_ call: CAPPluginCall) {
        // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
        if AiLocalOnly.on { call.reject("local_only"); return }
        guard let serverId = call.getString("serverId"), let serverUrl = address(serverId) else { call.resolve(["renewed": false]); return }
        AiMcpAuthPlugin.work.async {
            if let last = AiMcpAuthPlugin.renewed[serverId], Date().timeIntervalSince(last) < AiMcpAuthPlugin.recentSeconds {
                call.resolve(["renewed": true]); return
            }
            var done = false
            // The endpoint was read from the authorization server's own document when the sign-in was made; the rule is asked again.
            if var link = AiMcpAuthStore.read(AiMcpAuthStore.linkName(serverId)), let refresh = link["refresh"] as? String, let who = AiMcpAuthPlugin.clientOf(link),
               let resource = link["resource"] as? String, let endpoint = AiMcpOAuthRules.oauthAddress(link["tokenEndpoint"] as? String, serverUrl: serverUrl) {
                let form = AiMcpOAuthRules.formBody(AiMcpOAuthRules.refreshForm(refresh: refresh, client: who, resource: resource))
                if let reply = try? AiMcpAuthPlugin.ask(endpoint, serverUrl: serverUrl, contentType: "application/x-www-form-urlencoded", body: form, basic: AiMcpAuthPlugin.basicOf(who)) {
                    do {
                        let tokens = try AiMcpOAuthRules.readTokenResponse(status: reply.status, body: reply.body)
                        link["access"] = tokens.access
                        if let next = tokens.refresh { link["refresh"] = next }
                        if let seconds = tokens.expiresIn { link["expiresAt"] = Int(Date().timeIntervalSince1970) + seconds } else { link.removeValue(forKey: "expiresAt") }
                        if let scopes = tokens.scopes { link["scopes"] = scopes }
                        if AiMcpAuthStore.keep(AiMcpAuthStore.linkName(serverId), link) {
                            AiMcpAuthPlugin.renewed[serverId] = Date()
                            done = true
                        }
                    } catch {
                        // Refused for good: the sign-in is over; who Plainva is to this authorization server stays.
                        if AiMcpAuthPlugin.word(error) == "oauth-grant" { AiMcpAuthStore.endSignIn(serverId) }
                    }
                }
            }
            call.resolve(["renewed": done])
        }
    }

    /// A sign-in as the settings may show it: where, for what, until when — never a token.
    @objc func status(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId"), let link = AiMcpAuthStore.read(AiMcpAuthStore.linkName(serverId)), let issuer = link["issuer"] as? String else {
            call.resolve(["status": NSNull()]); return
        }
        var shown: [String: Any] = [
            "issuer": issuer,
            "scopes": (link["scopes"] as? [String]) ?? [],
            "signedIn": link["access"] is String,
            "renewable": link["refresh"] is String,
            "client": true,
        ]
        if let expires = link["expiresAt"] as? NSNumber { shown["expiresAt"] = expires } else { shown["expiresAt"] = NSNull() }
        call.resolve(["status": shown])
    }

    @objc func signOut(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId") else { call.reject("serverId required"); return }
        AiMcpAuthStore.forget(serverId)
        AiMcpAuthPlugin.work.async {
            AiMcpAuthPlugin.issuers.removeValue(forKey: serverId)
            AiMcpAuthPlugin.renewed.removeValue(forKey: serverId)
            call.resolve()
        }
    }
}
