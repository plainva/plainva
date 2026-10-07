import Foundation
import Capacitor
import Security
import UIKit

/**
 * Foreign MCP servers on iOS (plan KI-Harness P4.5) — twin of the desktop's
 * `src-tauri/src/mcp_client` and Android's AiMcpPlugin. The WebView speaks the
 * protocol; this plugin is everything it must not be able to do on its own:
 *
 * 1. the address of a server lives in this plugin's registry, which grows only
 *    through a native alert that shows the address; a request names a server
 *    id, never a URL;
 * 2. a server's token lives in this plugin's own Keychain service (this device
 *    only, never synced) and goes into the request here; nothing returns it;
 * 3. https (plain http only to this device), redirects are refused, the
 *    headers come from a fixed list, the answer is cut.
 *
 * A phone starts no programs: servers that are programs exist on the desktop only.
 */
@objc(AiMcpPlugin)
public class AiMcpPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "AiMcpPlugin"
    public let jsName = "AiMcp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "servers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    /// Shared with the sign-in (AiMcpAuthPlugin): it keeps its entries in the same Keychain service.
    static let secretService = "com.plainva.app.ai-mcp-secrets"
    static let serversDefaultsKey = "plainva.ai.mcp.servers"
    private static let maxRequestBytes = 1024 * 1024
    /// The protocol code in the WebView stops reading at four megabytes of text.
    private static let maxResponseBytes = 5 * 1024 * 1024
    private static let maxSecret = 8192
    private static let maxHeaders = 64
    private let secretLock = NSLock()

    private func registry() -> [String: String] {
        return UserDefaults.standard.dictionary(forKey: AiMcpPlugin.serversDefaultsKey) as? [String: String] ?? [:]
    }

    // MARK: secrets

    private func secretQuery(_ serverId: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: AiMcpPlugin.secretService,
                kSecAttrAccount as String: serverId]
    }

    private func readSecret(_ serverId: String) throws -> String? {
        var query = secretQuery(serverId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "AiMcp", code: Int(status))
        }
        return value
    }

    private func writeSecret(_ serverId: String, _ value: String?) throws {
        SecItemDelete(secretQuery(serverId) as CFDictionary)
        guard let value = value else { return }
        var attributes = secretQuery(serverId)
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: "AiMcp", code: Int(status)) }
    }

    /// A sign-in takes the place of a fixed token: a server has one credential, not two.
    static func forgetToken(_ serverId: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                       kSecAttrService as String: AiMcpPlugin.secretService,
                       kSecAttrAccount as String: serverId] as CFDictionary)
    }

    /// Stores a server's token. Write-only: no method returns it.
    @objc func setSecret(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId"), registry()[serverId] != nil,
              let value = call.getString("value")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty, value.utf8.count <= AiMcpPlugin.maxSecret, AiMcpRules.headerValueOk(value) else {
            call.reject("a registered server and a token required"); return
        }
        secretLock.lock(); defer { secretLock.unlock() }
        // A fixed token takes the place of a sign-in.
        AiMcpAuthStore.forget(serverId)
        do { try writeSecret(serverId, value); call.resolve() } catch { call.reject("key store write failed") }
    }

    @objc func hasSecret(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId") else { call.reject("serverId required"); return }
        secretLock.lock(); defer { secretLock.unlock() }
        do { call.resolve(["present": try readSecret(serverId) != nil]) } catch { call.reject("key store unavailable") }
    }

    @objc func deleteSecret(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId") else { call.reject("serverId required"); return }
        secretLock.lock(); defer { secretLock.unlock() }
        do { try writeSecret(serverId, nil); call.resolve() } catch { call.reject("key store write failed") }
    }

    // MARK: the registry

    /// The registry as it is, for the settings to show: what was confirmed, and whether a token is stored — never the token.
    @objc func servers(_ call: CAPPluginCall) {
        secretLock.lock(); defer { secretLock.unlock() }
        var list: [[String: Any]] = []
        for (serverId, address) in registry().sorted(by: { $0.key < $1.key }) {
            var present = false
            if let found = try? readSecret(serverId) { present = !found.isEmpty }
            let stored: [String] = present ? [""] : []
            let args: [String] = []
            list.append(["id": serverId, "kind": "http", "url": address, "args": args, "env": args, "sandbox": false, "stored": stored])
        }
        call.resolve(["servers": list])
    }

    /// Remembers a server after a NATIVE confirmation of its address, so a script in the WebView cannot add one on its own.
    @objc func addServer(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId"), AiMcpRules.validId(serverId),
              let address = AiMcpRules.normalizeAddress(call.getString("url")) else {
            call.reject("invalid server"); return
        }
        let title = call.getString("title") ?? "Add a server"
        let message = (call.getString("message") ?? "Plainva's assistant will be able to send requests to this address.") + "\n\n" + address
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: call.getString("cancel") ?? "Cancel", style: .cancel) { _ in call.resolve(["added": false]) })
            alert.addAction(UIAlertAction(title: call.getString("confirm") ?? "Add", style: .default) { _ in
                // A new entry under an old id starts without the old one's token, and without its sign-in.
                self.secretLock.lock(); try? self.writeSecret(serverId, nil); self.secretLock.unlock()
                AiMcpAuthStore.forget(serverId)
                var stored = self.registry()
                stored[serverId] = address
                UserDefaults.standard.set(stored, forKey: AiMcpPlugin.serversDefaultsKey)
                call.resolve(["added": true])
            })
            self.bridge?.viewController?.present(alert, animated: true)
        }
    }

    @objc func removeServer(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId") else { call.reject("serverId required"); return }
        var stored = registry()
        stored.removeValue(forKey: serverId)
        UserDefaults.standard.set(stored, forKey: AiMcpPlugin.serversDefaultsKey)
        secretLock.lock(); try? writeSecret(serverId, nil); secretLock.unlock()
        AiMcpAuthStore.forget(serverId)
        call.resolve()
    }

    // MARK: one exchange

    private final class Exchange {
        let call: CAPPluginCall
        var total = 0
        var pending = Data()
        var timedOut = false
        var tooLarge = false
        var deadline: DispatchWorkItem?
        init(call: CAPPluginCall) { self.call = call }
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 180 // silence between two packets; the whole exchange has its own limit
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var exchanges = [Int: Exchange]()
    private var tasksByRequest = [String: URLSessionDataTask]()
    private let exchangeLock = NSLock()

    private static func failed(_ code: String, _ message: String? = nil) -> [String: Any] {
        var out: [String: Any] = ["type": "failed", "code": code]
        if let message = message { out["message"] = message }
        return out
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), let serverId = call.getString("serverId") else {
            call.reject("requestId and serverId required"); return
        }
        guard let address = registry()[serverId], let url = URL(string: address) else {
            call.resolve(AiMcpPlugin.failed("refused", "no such server on this device")); return
        }
        let body = Data((call.getString("body") ?? "").utf8)
        guard body.count <= AiMcpPlugin.maxRequestBytes else {
            call.resolve(AiMcpPlugin.failed("refused", "the request is too large")); return
        }
        let stored: String?
        secretLock.lock()
        do { stored = try readSecret(serverId) } catch { secretLock.unlock(); call.reject("key store unavailable"); return }
        secretLock.unlock()
        // The server's one credential: the token the user stored, or the one a sign-in got.
        let token = stored ?? AiMcpAuthStore.bearer(serverId)

        var request = URLRequest(url: url)
        let isDelete = call.getString("method") == "DELETE"
        request.httpMethod = isDelete ? "DELETE" : "POST"
        if !isDelete { request.httpBody = body }
        var count = 0
        for (name, value) in (call.getObject("headers") ?? [:]) {
            guard count < AiMcpPlugin.maxHeaders, let allowed = AiMcpRules.allowedHeader(name), let text = value as? String, AiMcpRules.headerValueOk(text) else { continue }
            request.setValue(text, forHTTPHeaderField: allowed)
            count += 1
        }
        if let token = token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }

        call.keepAlive = true
        let task = session.dataTask(with: request)
        let exchange = Exchange(call: call)
        // One limit for the whole exchange, as the protocol code asked for it.
        let millis = max(1000, min(300_000, call.getInt("timeoutMs") ?? 30_000))
        let deadline = DispatchWorkItem { [weak self, weak task] in
            guard let self = self, let task = task else { return }
            self.exchangeLock.lock()
            self.exchanges[task.taskIdentifier]?.timedOut = true
            self.exchangeLock.unlock()
            task.cancel()
        }
        exchange.deadline = deadline
        exchangeLock.lock()
        exchanges[task.taskIdentifier] = exchange
        tasksByRequest[requestId] = task
        exchangeLock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(millis), execute: deadline)
        task.resume()
    }

    /// Hangs up on an exchange: the protocol's way to stop a request over HTTP.
    @objc func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else { call.reject("requestId required"); return }
        exchangeLock.lock()
        let task = tasksByRequest.removeValue(forKey: requestId)
        exchangeLock.unlock()
        task?.cancel()
        call.resolve(["cancelled": task != nil])
    }

    private func exchange(for task: URLSessionTask) -> Exchange? {
        exchangeLock.lock(); defer { exchangeLock.unlock() }
        return exchanges[task.taskIdentifier]
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // a redirect could carry the token and the arguments of a call elsewhere: refused, and reported as the answer it is
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let exchange = exchange(for: dataTask) else { completionHandler(.cancel); return }
        let http = response as? HTTPURLResponse
        var open: [String: Any] = ["type": "open", "status": http?.statusCode ?? 0]
        open["contentType"] = AiMcpRules.responseHeader(http?.value(forHTTPHeaderField: "Content-Type"), max: 200) ?? ""
        if let session = AiMcpRules.responseHeader(http?.value(forHTTPHeaderField: "Mcp-Session-Id"), max: 256) { open["session"] = session }
        if let challenge = AiMcpRules.responseHeader(http?.value(forHTTPHeaderField: "WWW-Authenticate"), max: 2000) { open["challenge"] = challenge }
        exchange.call.resolve(open)
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let exchange = exchange(for: dataTask), !exchange.tooLarge else { return }
        exchange.total += data.count
        if exchange.total > AiMcpPlugin.maxResponseBytes {
            exchange.tooLarge = true
            dataTask.cancel()
            return
        }
        exchange.pending.append(data)
        // Emit the longest valid UTF-8 prefix and keep a sequence split across
        // two packets (at most three bytes) for the next one. Bytes that are
        // invalid anywhere else are replaced rather than held back forever.
        let total = exchange.pending.count
        var cut = total
        while cut > 0, total - cut < 3, String(data: exchange.pending.prefix(cut), encoding: .utf8) == nil { cut -= 1 }
        let text: String
        if let valid = String(data: exchange.pending.prefix(cut), encoding: .utf8), cut > 0 {
            text = valid
            exchange.pending = Data(exchange.pending.dropFirst(cut))
        } else if total >= 4 {
            text = String(decoding: exchange.pending, as: UTF8.self)
            exchange.pending = Data()
        } else {
            return
        }
        exchange.call.resolve(["type": "data", "text": text])
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        exchangeLock.lock()
        let exchange = exchanges.removeValue(forKey: task.taskIdentifier)
        tasksByRequest = tasksByRequest.filter { $0.value.taskIdentifier != task.taskIdentifier }
        exchangeLock.unlock()
        guard let exchange = exchange else { return }
        exchange.deadline?.cancel()
        if exchange.tooLarge {
            exchange.call.resolve(AiMcpPlugin.failed("too-large"))
        } else if exchange.timedOut {
            exchange.call.resolve(AiMcpPlugin.failed("timeout"))
        } else if let error = error as NSError? {
            if error.code == NSURLErrorCancelled {
                exchange.call.resolve(["type": "cancelled"])
            } else {
                exchange.call.resolve(AiMcpPlugin.failed(AiMcpRules.failureCode(error.code)))
            }
        } else {
            if !exchange.pending.isEmpty {
                exchange.call.resolve(["type": "data", "text": String(decoding: exchange.pending, as: UTF8.self)])
            }
            exchange.call.resolve(["type": "done"])
        }
        exchange.call.keepAlive = false
        bridge?.releaseCall(exchange.call)
    }
}
