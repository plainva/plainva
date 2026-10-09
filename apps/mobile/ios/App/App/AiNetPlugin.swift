import Foundation
import Capacitor
import Security
import UIKit

/**
 * The native AI egress on iOS (ADR 0017) — twin of the desktop's `ai_http`
 * and Android's AiNetPlugin. The WebView builds the request specification but
 * never holds a provider key:
 *
 * 1. keys live in this plugin's own Keychain service (this device only, never
 *    synced); nothing returns them, and error texts are scrubbed of them;
 * 2. the URL must lie under a built-in provider or an endpoint the user
 *    confirmed in a native alert; redirects are refused, not followed;
 * 3. the answer streams back through a callback as it arrives; cancel stops it;
 * 4. the official OpenAI API always gets `store: false`.
 */
@objc(AiNetPlugin)
public class AiNetPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "AiNetPlugin"
    public let jsName = "AiNet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addEndpoint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeEndpoint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLocalOnly", returnType: CAPPluginReturnPromise),
    ]

    private static let keyService = "com.plainva.app.ai-provider-keys"
    private static let endpointsDefaultsKey = "plainva.ai.endpoints"
    private static let maxBodyBytes = 16 * 1024 * 1024
    private static let maxErrorBodyBytes = 64 * 1024
    private static let allowedHeaders: Set<String> = ["content-type", "accept", "anthropic-version", "anthropic-beta"]
    private let keyLock = NSLock()

    struct Endpoint {
        let base: URL
        let auth: String // "x-api-key", "x-goog-api-key", "bearer"
        let needsKey: Bool
        let officialOpenAi: Bool
    }

    static func builtin(_ id: String) -> Endpoint? {
        switch id {
        case "anthropic": return Endpoint(base: URL(string: "https://api.anthropic.com/")!, auth: "x-api-key", needsKey: true, officialOpenAi: false)
        case "openai": return Endpoint(base: URL(string: "https://api.openai.com/")!, auth: "bearer", needsKey: true, officialOpenAi: true)
        case "gemini": return Endpoint(base: URL(string: "https://generativelanguage.googleapis.com/")!, auth: "x-goog-api-key", needsKey: true, officialOpenAi: false)
        case "openrouter": return Endpoint(base: URL(string: "https://openrouter.ai/api/")!, auth: "bearer", needsKey: true, officialOpenAi: false)
        default: return nil
        }
    }

    private func resolve(_ id: String) -> Endpoint? {
        if let builtin = AiNetPlugin.builtin(id) { return builtin }
        let stored = UserDefaults.standard.dictionary(forKey: AiNetPlugin.endpointsDefaultsKey) as? [String: String]
        guard let base = stored?[id], let url = URL(string: base) else { return nil }
        return Endpoint(base: url, auth: "bearer", needsKey: false, officialOpenAi: false)
    }

    /** Same origin and path prefix on the parsed URL — no string prefix games. */
    /// A body of raw bytes — a recording to transcribe (plan KI-Harness P1.5) — only as multipart form
    /// data and only for a transcription endpoint: a raw JSON body anywhere else would slip past the rule
    /// that keeps OpenAI from storing requests. Mirrors `raw_body_allowed` (desktop) and `AiNetRules` (Android).
    static func rawBodyAllowed(_ url: URL, _ contentType: String) -> Bool {
        !contentType.contains("\r") && !contentType.contains("\n")
            && contentType.lowercased().hasPrefix("multipart/form-data; boundary=")
            && url.path.hasSuffix("/audio/transcriptions")
    }

    static func urlAllowed(_ endpoint: Endpoint, _ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let base = URLComponents(url: endpoint.base, resolvingAgainstBaseURL: false) else { return false }
        if parts.user != nil || parts.password != nil || parts.fragment != nil { return false }
        let port = parts.port ?? (parts.scheme == "https" ? 443 : 80)
        let basePort = base.port ?? (base.scheme == "https" ? 443 : 80)
        return parts.scheme == base.scheme && parts.host?.lowercased() == base.host?.lowercased() && port == basePort
            && parts.percentEncodedPath.hasPrefix(base.percentEncodedPath) && !parts.percentEncodedPath.contains("/../")
    }

    static func redact(_ text: String, _ key: String?) -> String {
        guard let key = key, key.count >= 8 else { return text }
        return text.replacingOccurrences(of: key, with: "[key]").replacingOccurrences(of: "****" + key.suffix(4), with: "****")
    }

    // MARK: keys

    private func keyQuery(_ endpointId: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: AiNetPlugin.keyService,
                kSecAttrAccount as String: endpointId]
    }

    private func readKey(_ endpointId: String) throws -> String? {
        var query = keyQuery(endpointId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "AiNet", code: Int(status))
        }
        return value
    }

    private func writeKey(_ endpointId: String, _ value: String?) throws {
        SecItemDelete(keyQuery(endpointId) as CFDictionary)
        guard let value = value else { return }
        var attributes = keyQuery(endpointId)
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: "AiNet", code: Int(status)) }
    }

    @objc func setKey(_ call: CAPPluginCall) {
        guard let endpointId = call.getString("endpointId"), let value = call.getString("value")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty, value.count <= 4096 else {
            call.reject("endpointId and a key required"); return
        }
        keyLock.lock(); defer { keyLock.unlock() }
        do { try writeKey(endpointId, value); call.resolve() } catch { call.reject("key store write failed") }
    }

    @objc func hasKey(_ call: CAPPluginCall) {
        guard let endpointId = call.getString("endpointId") else { call.reject("endpointId required"); return }
        keyLock.lock(); defer { keyLock.unlock() }
        do { call.resolve(["present": try readKey(endpointId) != nil]) } catch { call.reject("key store unavailable") }
    }

    @objc func deleteKey(_ call: CAPPluginCall) {
        guard let endpointId = call.getString("endpointId") else { call.reject("endpointId required"); return }
        keyLock.lock(); defer { keyLock.unlock() }
        do { try writeKey(endpointId, nil); call.resolve() } catch { call.reject("key store write failed") }
    }

    // MARK: streaming

    private final class Stream {
        let call: CAPPluginCall
        let key: String?
        var status = 0
        var retryAfter = ""
        var errorBody = Data()
        var pending = Data()
        init(call: CAPPluginCall, key: String?) { self.call = call; self.key = key }
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = AiLocalOnly.silence // silence between two packets
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var streams = [Int: Stream]()
    private var tasksByRequest = [String: URLSessionDataTask]()
    private let streamLock = NSLock()

    @objc func request(_ call: CAPPluginCall) {
        // GET is the model list of the connection test; every model call is a POST.
        let isGet = call.getString("method") == "GET"
        guard let requestId = call.getString("requestId"), let endpointId = call.getString("endpointId"),
              let urlText = call.getString("url"), let url = URL(string: urlText) else {
            call.reject("requestId, endpointId and url required"); return
        }
        guard let endpoint = resolve(endpointId) else {
            call.resolve(["type": "failed", "code": "unknown_endpoint", "message": "unknown AI endpoint"]); return
        }
        guard AiNetPlugin.urlAllowed(endpoint, url) else {
            call.resolve(["type": "failed", "code": "url_not_allowed", "message": "request URL is not under the endpoint"]); return
        }
        // Fully local (ADR 0030): a request for anyone but this device is answered here and sent nowhere.
        if AiLocalOnly.on && !AiLocalOnly.onThisDevice(url.host) {
            call.resolve(["type": "failed", "code": "local_only", "message": "fully local: the recipient is not this device"]); return
        }
        var payload: Data? = nil
        var rawType: String? = nil
        if !isGet, let raw = call.getObject("rawBody") {
            guard call.getObject("body") == nil, let encoded = raw["base64"] as? String, let type = raw["contentType"] as? String,
                  AiNetPlugin.rawBodyAllowed(url, type) else {
                call.resolve(["type": "failed", "code": "invalid_request", "message": "raw bodies go only to a transcription endpoint"]); return
            }
            guard let data = Data(base64Encoded: encoded), data.count <= AiNetPlugin.maxBodyBytes else {
                call.resolve(["type": "failed", "code": "too_large", "message": "request too large or not base64"]); return
            }
            payload = data
            rawType = type
        } else if !isGet {
            guard var body = call.getObject("body") else { call.reject("a model call needs a body"); return }
            if endpoint.officialOpenAi && (url.path.hasSuffix("/responses") || url.path.hasSuffix("/chat/completions")) {
                body["store"] = false
            }
            guard let data = try? JSONSerialization.data(withJSONObject: body), data.count <= AiNetPlugin.maxBodyBytes else {
                call.resolve(["type": "failed", "code": "too_large", "message": "request too large or not JSON"]); return
            }
            payload = data
        }
        let key: String?
        keyLock.lock()
        do { key = try readKey(endpointId) } catch { keyLock.unlock(); call.reject("key store unavailable"); return }
        keyLock.unlock()
        if endpoint.needsKey && key == nil {
            call.resolve(["type": "failed", "code": "no_key", "message": "no key stored for this provider"]); return
        }
        var request = URLRequest(url: url)
        // A model on this device may read for minutes before it says a word (ADR 0030): its request may be silent longer.
        if AiLocalOnly.onThisDevice(url.host) { request.timeoutInterval = AiLocalOnly.localSilence }
        request.httpMethod = isGet ? "GET" : "POST"
        request.httpBody = payload
        for (name, value) in (call.getObject("headers") ?? [:]) {
            guard let value = value as? String, !value.contains("\r"), !value.contains("\n") else { continue }
            let lower = name.lowercased()
            // A raw body names its own type (the multipart boundary is in it).
            if rawType != nil && lower == "content-type" { continue }
            if AiNetPlugin.allowedHeaders.contains(lower) { request.setValue(value, forHTTPHeaderField: lower) }
        }
        if let rawType = rawType { request.setValue(rawType, forHTTPHeaderField: "content-type") }
        if let key = key {
            switch endpoint.auth {
            case "x-api-key": request.setValue(key, forHTTPHeaderField: "x-api-key")
            case "x-goog-api-key": request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
            default: request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
            }
        }
        call.keepAlive = true
        let task = session.dataTask(with: request)
        streamLock.lock()
        streams[task.taskIdentifier] = Stream(call: call, key: key)
        tasksByRequest[requestId] = task
        streamLock.unlock()
        task.resume()
    }

    /// Tells this side whether the device is fully local (ADR 0030): the rule the web view holds, once more behind it.
    @objc func setLocalOnly(_ call: CAPPluginCall) {
        AiLocalOnly.set(call.getBool("on") ?? false)
        call.resolve()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else { call.reject("requestId required"); return }
        streamLock.lock()
        let task = tasksByRequest.removeValue(forKey: requestId)
        streamLock.unlock()
        task?.cancel()
        call.resolve(["cancelled": task != nil])
    }

    private func stream(for task: URLSessionTask) -> Stream? {
        streamLock.lock(); defer { streamLock.unlock() }
        return streams[task.taskIdentifier]
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // an AI provider does not redirect; a redirect is refused
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let stream = stream(for: dataTask) else { completionHandler(.cancel); return }
        stream.status = (response as? HTTPURLResponse)?.statusCode ?? 0
        stream.retryAfter = String(((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After") ?? "").prefix(64))
        if stream.status < 300 { stream.call.resolve(["type": "open", "status": stream.status]) }
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let stream = stream(for: dataTask) else { return }
        if stream.status >= 300 {
            if stream.errorBody.count < AiNetPlugin.maxErrorBodyBytes { stream.errorBody.append(data.prefix(AiNetPlugin.maxErrorBodyBytes - stream.errorBody.count)) }
            return
        }
        stream.pending.append(data)
        // Emit the longest valid UTF-8 prefix and keep a sequence split across
        // two packets (at most three bytes) for the next one. Bytes that are
        // invalid anywhere else are replaced rather than held back forever.
        let total = stream.pending.count
        var cut = total
        while cut > 0, total - cut < 3, String(data: stream.pending.prefix(cut), encoding: .utf8) == nil { cut -= 1 }
        let text: String
        if let valid = String(data: stream.pending.prefix(cut), encoding: .utf8), cut > 0 {
            text = valid
            stream.pending = Data(stream.pending.dropFirst(cut))
        } else if total >= 4 {
            text = String(decoding: stream.pending, as: UTF8.self)
            stream.pending = Data()
        } else {
            return
        }
        stream.call.resolve(["type": "data", "text": text])
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        streamLock.lock()
        let stream = streams.removeValue(forKey: task.taskIdentifier)
        tasksByRequest = tasksByRequest.filter { $0.value.taskIdentifier != task.taskIdentifier }
        streamLock.unlock()
        guard let stream = stream else { return }
        if let error = error as NSError? {
            if error.code == NSURLErrorCancelled {
                stream.call.resolve(["type": "cancelled"])
            } else {
                stream.call.resolve(["type": "failed", "code": "network", "message": AiNetPlugin.redact(error.localizedDescription, stream.key)])
            }
        } else if stream.status >= 300 {
            let text = String(data: stream.errorBody, encoding: .utf8) ?? ""
            stream.call.resolve(["type": "httpError", "status": stream.status, "body": AiNetPlugin.redact(text, stream.key), "retryAfter": stream.retryAfter])
        } else {
            if !stream.pending.isEmpty, let text = String(data: stream.pending, encoding: .utf8) {
                stream.call.resolve(["type": "data", "text": text])
            }
            stream.call.resolve(["type": "done"])
        }
        stream.call.keepAlive = false
        bridge?.releaseCall(stream.call)
    }

    // MARK: user endpoints

    @objc func addEndpoint(_ call: CAPPluginCall) {
        guard let endpointId = call.getString("endpointId"), endpointId.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil,
              AiNetPlugin.builtin(endpointId) == nil,
              let raw = call.getString("baseUrl"), var parts = URLComponents(string: raw.trimmingCharacters(in: .whitespaces)),
              let host = parts.host, parts.user == nil, parts.password == nil else {
            call.reject("invalid endpoint"); return
        }
        let local = ["localhost", "127.0.0.1", "::1"].contains(host.lowercased())
        guard parts.scheme == "https" || (parts.scheme == "http" && local) else {
            call.reject("https required for servers that are not on this device"); return
        }
        parts.query = nil
        parts.fragment = nil
        if !parts.path.hasSuffix("/") { parts.path += "/" }
        guard let base = parts.url?.absoluteString else { call.reject("invalid endpoint"); return }
        let title = call.getString("title") ?? "Add an AI server"
        let message = (call.getString("message") ?? "Plainva's assistant will send your request and the context you approve to this server.") + "\n\n" + base
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: call.getString("cancel") ?? "Cancel", style: .cancel) { _ in call.resolve(["added": false]) })
            alert.addAction(UIAlertAction(title: call.getString("confirm") ?? "Add", style: .default) { _ in
                var stored = UserDefaults.standard.dictionary(forKey: AiNetPlugin.endpointsDefaultsKey) as? [String: String] ?? [:]
                stored[endpointId] = base
                UserDefaults.standard.set(stored, forKey: AiNetPlugin.endpointsDefaultsKey)
                call.resolve(["added": true])
            })
            self.bridge?.viewController?.present(alert, animated: true)
        }
    }

    @objc func removeEndpoint(_ call: CAPPluginCall) {
        guard let endpointId = call.getString("endpointId") else { call.reject("endpointId required"); return }
        var stored = UserDefaults.standard.dictionary(forKey: AiNetPlugin.endpointsDefaultsKey) as? [String: String] ?? [:]
        stored.removeValue(forKey: endpointId)
        UserDefaults.standard.set(stored, forKey: AiNetPlugin.endpointsDefaultsKey)
        keyLock.lock(); try? writeKey(endpointId, nil); keyLock.unlock()
        call.resolve()
    }
}

/// "Fully local" as the native side holds it (plan KI-Harness P7, ADR 0030).
///
/// While the switch is on, nothing the assistant handles goes anywhere but this
/// device. The web view holds that promise first: its one egress answers every
/// request for anyone else itself. This flag is the same rule once more, behind
/// it — against a mistake in the web view's own code, not against a web view
/// that was taken over, which could switch it off the way it is switched on.
///
/// The web view tells it through `AiNet.setLocalOnly` when the settings are read
/// and whenever the switch changes; until then it is off, like the switch
/// itself. Every plugin that sends something for the assistant reads it first.
enum AiLocalOnly {
    private static let lock = NSLock()
    private static var value = false

    static var on: Bool {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    static func set(_ next: Bool) {
        lock.lock()
        value = next
        lock.unlock()
    }

    /// A host on this device: the names plain http is accepted for. A server in
    /// the home network is not this device, however near it stands.
    static func onThisDevice(_ host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return ["localhost", "127.0.0.1", "::1"].contains(host)
    }

    /// Seconds a recipient may be silent before its request counts as dead.
    static let silence: TimeInterval = 180
    /// A model on this device gets this long instead: it may read for minutes before its first word.
    static let localSilence: TimeInterval = 900
}
