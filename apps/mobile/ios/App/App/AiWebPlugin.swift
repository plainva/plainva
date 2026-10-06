import Capacitor
import Foundation

/**
 * The assistant's page fetch on iOS (plan KI-Harness P4, threat T2) — the twin
 * of the desktop's `ai_web_fetch` (src-tauri/src/ai_web.rs) and of Android's
 * AiWebPlugin.
 *
 * A plugin of its own, apart from the AI egress (AiNetPlugin): it reads public
 * pages and has neither a key nor a way to one. The WebView names an address
 * and decides nothing; where a request may go, what it follows and how much
 * it reads is decided here, by `AiWebRules`: one GET over https to port 443,
 * without credentials, cookies or a body; only public addresses; redirects
 * inside the site only; at most five hops, two megabytes and twenty seconds.
 */
@objc(AiWebPlugin)
public class AiWebPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AiWebPlugin"
    public let jsName = "AiWeb"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "fetchPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private let lock = NSLock()
    private var fetches = [String: Task<Void, Never>]()

    private func forget(_ requestId: String) {
        lock.lock()
        fetches.removeValue(forKey: requestId)
        lock.unlock()
    }

    /// Reads one page; `cancel` with the same id stops it.
    @objc func fetchPage(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), let urlText = call.getString("url") else {
            call.reject("requestId and url required")
            return
        }
        let start: AiWebRules.Target
        switch AiWebRules.checkWebUrl(urlText) {
        case .refused(let problem):
            call.resolve(["kind": "refused", "problem": problem])
            return
        case .ok(let target):
            start = target
        }
        lock.lock()
        fetches[requestId] = Task { [weak self] in
            let result = await AiWebFetch.run(start)
            self?.forget(requestId)
            call.resolve(result)
        }
        lock.unlock()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else { call.reject("requestId required"); return }
        lock.lock()
        let fetch = fetches.removeValue(forKey: requestId)
        lock.unlock()
        fetch?.cancel()
        call.resolve(["cancelled": fetch != nil])
    }
}

/// One page fetch for the assistant.
///
/// The desktop and Android connect to exactly the addresses they checked.
/// URLSession gives no such handle, so the check stands on both sides of the
/// request here: the name is resolved and every address found public before
/// the request starts, and when it is done the far end the system actually
/// talked to is checked again — before the status, the place a redirect names
/// or the body is used. An answer from an address that is not public is
/// thrown away. A name server that answers twice differently can thus make
/// one GET without a body reach a private address; it cannot make its answer
/// reach a model.
final class AiWebFetch: NSObject, URLSessionTaskDelegate {
    private static let userAgent = "Mozilla/5.0 (compatible; Plainva; +https://plainva.com)"
    private static let accept = "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1"
    private static let deadlineSeconds: TimeInterval = 20

    struct FarEnd {
        let address: String?
        let proxied: Bool
    }

    private let lock = NSLock()
    private var settled = false
    private var farEnd: FarEnd?
    private var waiting: CheckedContinuation<FarEnd?, Never>?

    // Each hop is decided by AiWebRules, never by the session.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let last = metrics.transactionMetrics.last
        settle(FarEnd(address: last?.remoteAddress, proxied: last?.isProxyConnection ?? false))
    }

    private func settle(_ value: FarEnd?) {
        lock.lock()
        if settled { lock.unlock(); return }
        settled = true
        farEnd = value
        let continuation = waiting
        waiting = nil
        lock.unlock()
        continuation?.resume(returning: value)
    }

    private func wait(_ continuation: CheckedContinuation<FarEnd?, Never>) {
        lock.lock()
        if settled {
            let value = farEnd
            lock.unlock()
            continuation.resume(returning: value)
        } else {
            waiting = continuation
            lock.unlock()
        }
    }

    /// The far end of the finished request, or nil when the system does not say within two seconds.
    private func reportedFarEnd() async -> FarEnd? {
        let timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            self?.settle(nil)
        }
        defer { timeout.cancel() }
        return await withCheckedContinuation { self.wait($0) }
    }

    private static func refused(_ problem: String) -> [String: Any] { ["kind": "refused", "problem": problem] }
    private static func failed(_ code: String) -> [String: Any] { ["kind": "failed", "code": code] }
    private static func page(_ target: AiWebRules.Target, _ status: Int, _ contentType: String, _ body: String, _ truncated: Bool) -> [String: Any] {
        ["kind": "page", "url": target.url.absoluteString, "status": status, "contentType": contentType, "body": body, "truncated": truncated]
    }

    private static func failure(_ error: Error) -> [String: Any] {
        if error is CancellationError { return failed("cancelled") }
        guard let code = (error as? URLError)?.code else { return failed("error") }
        switch code {
        case .cancelled: return failed("cancelled")
        case .timedOut: return failed("timeout")
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed:
            return failed("offline")
        case .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid, .clientCertificateRejected, .clientCertificateRequired:
            return failed("tls")
        default: return failed("error")
        }
    }

    static func run(_ start: AiWebRules.Target) async -> [String: Any] {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = deadlineSeconds
        config.timeoutIntervalForResource = deadlineSeconds
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        var target = start
        let deadline = Date().addingTimeInterval(deadlineSeconds)
        for hops in 0...AiWebRules.maxRedirects {
            if Task.isCancelled { return failed("cancelled") }
            if Date() > deadline { return failed("timeout") }
            // A name that resolves to the router, another device at home or this phone is refused before a byte is sent.
            guard let addresses = AiWebRules.resolve(target.host) else { return failed("offline") }
            if addresses.contains(where: { !AiWebRules.isPublicAddress($0) }) { return refused("private-address") }

            var request = URLRequest(url: target.url)
            request.httpMethod = "GET"
            request.httpShouldHandleCookies = false
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue(accept, forHTTPHeaderField: "Accept")
            let watcher = AiWebFetch()
            do {
                let (stream, response) = try await session.bytes(for: request, delegate: watcher)
                guard let http = response as? HTTPURLResponse else { return failed("error") }
                let status = http.statusCode
                let contentType = String((http.value(forHTTPHeaderField: "Content-Type") ?? "").prefix(200))
                let media = AiWebRules.mediaType(contentType)
                // Only a page is read; a redirect, an error page and what is no text end with their head.
                let readable = (200..<300).contains(status) && (media.isEmpty || AiWebRules.contentTypes.contains(media))
                var body = Data()
                var truncated = false
                if readable {
                    body.reserveCapacity(64 * 1024)
                    for try await byte in stream {
                        if body.count >= AiWebRules.maxBytes {
                            truncated = true
                            break
                        }
                        body.append(byte)
                    }
                }
                stream.task.cancel()
                // The second half of the check, before anything of the answer is used — its status and the place a
                // redirect names included: where did it really come from?
                guard let end = await watcher.reportedFarEnd() else { return failed("error") }
                if !end.proxied {
                    guard let address = end.address, AiWebRules.isPublicAddress(address) else { return refused("private-address") }
                }
                if (300..<400).contains(status) {
                    switch AiWebRules.redirectDecision(from: target, location: http.value(forHTTPHeaderField: "Location"), hops: hops) {
                    case .follow(let next):
                        target = next
                        continue
                    case .elsewhere(let next):
                        return ["kind": "elsewhere", "url": next.url.absoluteString]
                    case .refused(let problem):
                        return refused(problem)
                    }
                }
                // An error page is not read: the status is the answer.
                if !(200..<300).contains(status) { return page(target, status, contentType, "", false) }
                if !readable { return refused("content-type") }
                return page(target, status, contentType, AiWebRules.decode(body, contentType: contentType), truncated)
            } catch {
                return failure(error)
            }
        }
        return refused("too-many")
    }
}
