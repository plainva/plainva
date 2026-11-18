import Foundation
import Capacitor

/**
 * URLSession-backed HTTP bridge (P7), mirroring the Android OkHttp plugin:
 * the shared sync targets need arbitrary methods (PROPFIND & friends) and
 * binary bodies, which the stock CapacitorHttp cannot carry. Contract:
 * request({url, method, headers, body?, bodyBase64?}) ->
 * {status, headers, bodyBase64}
 * allowOrigin({origin}) -> void
 *
 * Origin policy (H8b, 2026-07-26): Android has enforced an allowlist since the
 * hardening pass; iOS registered `request` only, so `allowOrigin` failed
 * silently in the TS wrapper and this side stayed open. A compromised WebView
 * could therefore reach any host through the native bridge on iOS but not on
 * Android. Both platforms now enforce the same two rules: user-configured
 * origins (WebDAV/S3, registered during sync setup) plus a fixed https-only
 * provider suffix list — checked again on every redirect hop.
 */
@objc(WebDavHttpPlugin)
public class WebDavHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebDavHttpPlugin"
    public let jsName = "WebDavHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "allowOrigin", returnType: CAPPluginReturnPromise)
    ]

    /** User-configured origins (scheme://host[:port]) — WebDAV servers, S3 endpoints. */
    private static var allowedOrigins = Set<String>()
    private static let originLock = NSLock()

    /** Fixed provider hosts (suffix match on the host, https only). Mirrors PROVIDER_HOST_SUFFIXES. */
    private static let providerHostSuffixes = [
        ".googleapis.com",
        ".google.com",
        "graph.microsoft.com",
        "login.microsoftonline.com",
        "login.live.com",
        ".dropboxapi.com",
        ".dropbox.com",
        ".amazonaws.com",
    ]

    /** Hard cap for buffered response bodies (the bridge is not a streamer yet). */
    private static let maxResponseBytes = 256 * 1024 * 1024
    /** A response body up to this size comes back in the answer; a larger one in a file (see `request`). */
    private static let inlineResponseBytes = 256 * 1024

    static func originOf(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        var origin = "\(scheme)://\(host)"
        let defaultPort = scheme == "https" ? 443 : (scheme == "http" ? 80 : -1)
        if let port = url.port, port != defaultPort {
            origin += ":\(port)"
        }
        return origin
    }

    static func isAllowed(_ url: URL) -> Bool {
        guard let origin = originOf(url), let host = url.host?.lowercased() else { return false }
        originLock.lock()
        let registered = allowedOrigins.contains(origin)
        originLock.unlock()
        if registered { return true }
        guard url.scheme?.lowercased() == "https" else { return false } // fixed providers are https-only
        for suffix in providerHostSuffixes {
            if suffix.hasPrefix(".") {
                if host.hasSuffix(suffix) || host == String(suffix.dropFirst()) { return true }
            } else if host == suffix {
                return true
            }
        }
        return false
    }

    private lazy var redirectGuard = RedirectGuard()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        // Time between two bytes, not a total: a live transfer never trips it,
        // a server that THINKS does. At 60 s this fired while the app was still
        // waiting for its own 120 s (MOBILE_REQUEST_TIMEOUT_MS in
        // syncService.ts) — the native side decided, and the user got a raw
        // "request failed" instead of the app's own answer (finding
        // 2026-08-21). Android carried the identical 60 s; both are lifted to
        // the app's bound, and mobileLint pins the hierarchy against drift.
        config.timeoutIntervalForRequest = 120
        // A 90 MB attachment over mobile data takes minutes; the resource
        // timeout bounds a DEAD transfer, it must not demand a speed (#48).
        config.timeoutIntervalForResource = 3600
        return URLSession(configuration: config, delegate: redirectGuard, delegateQueue: nil)
    }()

    /** Registers a user-configured server origin (called from the sync setup). */
    @objc func allowOrigin(_ call: CAPPluginCall) {
        guard let raw = call.getString("origin"),
              let url = URL(string: raw),
              let origin = WebDavHttpPlugin.originOf(url) else {
            call.reject("invalid origin")
            return
        }
        WebDavHttpPlugin.originLock.lock()
        WebDavHttpPlugin.allowedOrigins.insert(origin)
        WebDavHttpPlugin.originLock.unlock()
        call.resolve()
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("invalid url")
            return
        }
        guard WebDavHttpPlugin.isAllowed(url) else {
            call.reject("HTTP_ORIGIN_BLOCKED", "HTTP_ORIGIN_BLOCKED")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        if let headers = call.getObject("headers") {
            for (name, value) in headers {
                if let text = value as? String {
                    req.setValue(text, forHTTPHeaderField: name)
                }
            }
        }
        // Streamed upload (issue #48): the content stays on disk instead of
        // crossing the bridge as base64, which is what killed the app on a large
        // attachment. A byte RANGE is staged as a temp file first — URLSession
        // uploads a whole file, and a chunk session needs slices; the temp file
        // is one chunk (megabytes), never the whole attachment.
        var uploadFile: URL?
        var stagedTemp: URL?
        if let relPath = call.getString("bodyFilePath") {
            guard let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            else {
                call.reject("no documents directory")
                return
            }
            let rootStd = root.standardizedFileURL
            let source = URL(fileURLWithPath: relPath, relativeTo: rootStd).standardizedFileURL
            let rootPrefix = rootStd.path.hasSuffix("/") ? rootStd.path : rootStd.path + "/"
            guard source.path.hasPrefix(rootPrefix) else {
                call.reject("path escapes the sandbox")
                return
            }
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: source.path),
                  let fileLength = (attrs[.size] as? NSNumber)?.int64Value else {
                call.reject("file not found: \(relPath)")
                return
            }
            let offset = Int64(call.getInt("bodyOffset") ?? 0)
            let length = Int64(call.getInt("bodyLength") ?? Int(fileLength - offset))
            guard offset >= 0, length >= 0, offset + length <= fileLength else {
                call.reject("range \(offset)+\(length) exceeds the file (\(fileLength) bytes)")
                return
            }
            if offset == 0 && length == fileLength {
                uploadFile = source
            } else {
                do {
                    let handle = try FileHandle(forReadingFrom: source)
                    defer { try? handle.close() }
                    try handle.seek(toOffset: UInt64(offset))
                    let slice = try handle.read(upToCount: Int(length)) ?? Data()
                    let temp = FileManager.default.temporaryDirectory
                        .appendingPathComponent("plainva-upload-\(UUID().uuidString)")
                    try slice.write(to: temp, options: .atomic)
                    uploadFile = temp
                    stagedTemp = temp
                } catch {
                    call.reject("cannot stage the upload range: \(error.localizedDescription)")
                    return
                }
            }
        } else if let body = call.getString("body") {
            if call.getBool("bodyBase64") == true {
                guard let data = Data(base64Encoded: body) else {
                    call.reject("invalid base64 body")
                    return
                }
                req.httpBody = data
            } else {
                req.httpBody = body.data(using: .utf8)
            }
        }
        let completion: (Data?, URLResponse?, Error?) -> Void = { data, response, error in
            if let temp = stagedTemp { try? FileManager.default.removeItem(at: temp) }
            if let error = error {
                let code = WebDavHttpPlugin.failureCode(error)
                call.reject(code, code)
                return
            }
            guard let http = response as? HTTPURLResponse else {
                call.reject("no http response")
                return
            }
            if (300..<400).contains(http.statusCode),
               let location = http.value(forHTTPHeaderField: "Location"),
               let redirect = URL(string: location, relativeTo: http.url)?.absoluteURL,
               !WebDavHttpPlugin.isAllowed(redirect) {
                call.reject("HTTP_ORIGIN_BLOCKED", "HTTP_ORIGIN_BLOCKED")
                return
            }
            let payload = data ?? Data()
            if payload.count > WebDavHttpPlugin.maxResponseBytes {
                call.reject("response exceeds the size cap")
                return
            }
            var headers: [String: String] = [:]
            for (name, value) in http.allHeaderFields {
                if let nameText = name as? String, let valueText = value as? String {
                    headers[nameText] = valueText
                }
            }
            // A large body does not come back in the answer: every answer's text becomes a
            // JavaScript call, and a 3 MB picture as one base64 string froze the Android app
            // (17.11.; the same calls run here). It waits in a file below Library/Caches,
            // which the JS side reads in parts (AtomicFile.read) and removes.
            if payload.count > WebDavHttpPlugin.inlineResponseBytes {
                guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
                    call.reject("no library directory")
                    return
                }
                let rel = "Caches/plainva-http/.plainva-tmp-http-\(UUID().uuidString)"
                let file = library.appendingPathComponent(rel)
                do {
                    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try payload.write(to: file)
                } catch {
                    try? FileManager.default.removeItem(at: file)
                    call.reject("response could not be kept: \(error.localizedDescription)")
                    return
                }
                call.resolve([
                    "status": http.statusCode,
                    "headers": headers,
                    "bodyFile": rel,
                    "bodyDirectory": "LIBRARY",
                    "bodySize": payload.count,
                ])
                return
            }
            call.resolve([
                "status": http.statusCode,
                "headers": headers,
                "bodyBase64": payload.base64EncodedString(),
            ])
        }
        if let file = uploadFile {
            session.uploadTask(with: req, fromFile: file, completionHandler: completion).resume()
        } else {
            session.dataTask(with: req, completionHandler: completion).resume()
        }
    }

    /** URLSession retains platform trust evaluation; no authentication-challenge override. */
    static func failureCode(_ error: Error) -> String {
        let native = error as NSError
        guard native.domain == NSURLErrorDomain else { return "HTTP_REQUEST_FAILED" }
        switch native.code {
        case NSURLErrorServerCertificateHasBadDate: return "TLS_CERTIFICATE_EXPIRED"
        case NSURLErrorServerCertificateNotYetValid: return "TLS_CERTIFICATE_NOT_YET_VALID"
        case NSURLErrorServerCertificateHasUnknownRoot: return "TLS_CERTIFICATE_UNTRUSTED"
        // URLSession's untrusted result also covers name/policy failures. Do not
        // claim that installing a CA fixes a failure the OS did not distinguish.
        case NSURLErrorServerCertificateUntrusted, NSURLErrorSecureConnectionFailed: return "TLS_HANDSHAKE_FAILED"
        case NSURLErrorTimedOut: return "HTTP_TIMEOUT"
        case NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
             NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
             NSURLErrorDNSLookupFailed: return "HTTP_NETWORK_ERROR"
        default: return "HTTP_REQUEST_FAILED"
        }
    }
}

/**
 * Per-hop redirect check — the counterpart to the Android network interceptor:
 * following a redirect to a foreign host must be refused even though redirects
 * are allowed in principle.
 */
final class RedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, WebDavHttpPlugin.isAllowed(url) else {
            completionHandler(nil) // stop the redirect; the caller sees the 3xx
            return
        }
        completionHandler(request)
    }
}
