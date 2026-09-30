import Foundation
import Capacitor
import CryptoKit
import PlainvaOrt

/**
 * Local model packages on iOS (plan KI-Harness P2a-3, ADR 0021) — the twin of
 * the desktop's model_store.rs and embedding.rs and the Android plugin: a
 * pinned package file from huggingface.co into Application Support, excluded
 * from backups, checked against its size and SHA-256; the model run in
 * Microsoft's ONNX Runtime (the official pod archive, through `PlainvaOrt`);
 * pooled vectors back to the WebView. Tokenizing stays in TypeScript.
 */
@objc(LocalModelPlugin)
public class LocalModelPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalModelPlugin"
    public let jsName = "LocalModels"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "freeSpace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise)
    ]

    private static let marker = ".sha256"
    private static let part = ".part"

    /// One batch at a time: the runtime uses the cores itself.
    private let inference = DispatchQueue(label: "com.plainva.localmodels.inference")
    private let files = DispatchQueue(label: "com.plainva.localmodels.files")
    private var sessions: [String: OpaquePointer] = [:]
    private var next = 0
    private var downloads: [String: ModelDownload] = [:]
    private let lock = NSLock()

    // MARK: rules (the same as model_store.rs and LocalModelRules.java)

    static func validModel(_ model: String) -> Bool {
        !model.isEmpty && model.count <= 64 && !model.hasPrefix(".")
            && model.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "." || $0 == "-" }
    }

    static func validName(_ name: String) -> Bool {
        guard !name.isEmpty, name.count <= 200 else { return false }
        return name.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { part in
            !part.isEmpty && part != "." && part != ".."
                && part.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "." || $0 == "_" || $0 == "-") }
        }
    }

    static func validSha256(_ sha: String) -> Bool {
        sha.count == 64 && sha.unicodeScalars.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    static func allowedHost(_ host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return host == "huggingface.co" || host.hasSuffix(".huggingface.co") || host.hasSuffix(".hf.co")
    }

    static func allowedUrl(_ url: String, name: String) -> URL? {
        guard let parsed = URL(string: url), parsed.scheme == "https", parsed.host == "huggingface.co", parsed.query == nil, parsed.port == nil,
              let range = parsed.path.range(of: "/resolve/") else { return nil }
        let tail = parsed.path[range.upperBound...]
        guard let slash = tail.firstIndex(of: "/") else { return nil }
        let revision = tail[..<slash]
        guard revision.count == 40, revision.allSatisfy({ $0.isHexDigit }), String(tail[tail.index(after: slash)...]) == name else { return nil }
        return parsed
    }

    // MARK: storage

    private func modelsDir() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var dir = base.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Hundreds of megabytes that can be fetched again: never in a backup.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }

    private func modelFile(_ model: String, _ name: String) throws -> URL {
        guard Self.validModel(model), Self.validName(name) else { throw PluginError("invalid model file") }
        return try modelsDir().appendingPathComponent(model, isDirectory: true).appendingPathComponent(name)
    }

    private static func withSuffix(_ url: URL, _ suffix: String) -> URL {
        URL(fileURLWithPath: url.path + suffix)
    }

    private static func verified(_ url: URL, bytes: Int64, sha256: String) -> Bool {
        guard let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber, size.int64Value == bytes,
              let mark = try? String(contentsOf: withSuffix(url, marker), encoding: .utf8) else { return false }
        return mark.trimmingCharacters(in: .whitespacesAndNewlines) == sha256
    }

    /// A checked file of a package: its marker says it passed its SHA-256.
    private func checked(_ model: String, _ name: String) throws -> URL {
        let url = try modelFile(model, name)
        guard FileManager.default.fileExists(atPath: url.path),
              let mark = try? String(contentsOf: Self.withSuffix(url, Self.marker), encoding: .utf8),
              Self.validSha256(mark.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw PluginError("model_unverified") }
        return url
    }

    // MARK: methods

    @objc func status(_ call: CAPPluginCall) {
        guard let model = call.getString("model"), let list = call.getArray("files", JSObject.self) else {
            call.reject("model and files required")
            return
        }
        do {
            let present = try list.map { file -> Bool in
                guard let name = file["name"] as? String, let bytes = (file["bytes"] as? NSNumber)?.int64Value, let sha = file["sha256"] as? String else { return false }
                return Self.verified(try self.modelFile(model, name), bytes: bytes, sha256: sha)
            }
            call.resolve(["present": present])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let model = call.getString("model"), let name = call.getString("name"), let url = call.getString("url"),
              let sha = call.getString("sha256"), let bytes = call.getInt("bytes").map(Int64.init),
              Self.validSha256(sha), bytes > 0, let source = Self.allowedUrl(url, name: name) else {
            call.reject("download_not_allowed")
            return
        }
        let target: URL
        do {
            target = try modelFile(model, name)
        } catch {
            call.reject(error.localizedDescription)
            return
        }
        if Self.verified(target, bytes: bytes, sha256: sha) {
            call.resolve()
            return
        }
        let job = ModelDownload(source: source, target: target, part: Self.withSuffix(target, Self.part), marker: Self.withSuffix(target, Self.marker),
                                bytes: bytes, sha256: sha) { [weak self] received in
            self?.notifyListeners("downloadProgress", data: ["model": model, "name": name, "received": received])
        }
        lock.lock()
        downloads[model] = job
        lock.unlock()
        job.start { [weak self] error in
            self?.lock.lock()
            if self?.downloads[model] === job { self?.downloads[model] = nil }
            self?.lock.unlock()
            if let error { call.reject(error) } else { call.resolve() }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        lock.lock()
        let job = downloads[call.getString("model") ?? ""]
        lock.unlock()
        job?.cancel()
        call.resolve()
    }

    /// Free space where packages go, so the load sheet can say whether one fits.
    @objc func freeSpace(_ call: CAPPluginCall) {
        do {
            let values = try modelsDir().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            call.resolve(["bytes": values.volumeAvailableCapacityForImportantUsage ?? 0])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let model = call.getString("model"), Self.validModel(model) else {
            call.reject("invalid model")
            return
        }
        lock.lock()
        let job = downloads[model]
        lock.unlock()
        job?.cancel()
        files.async {
            do {
                let dir = try self.modelsDir().appendingPathComponent(model, isDirectory: true)
                if FileManager.default.fileExists(atPath: dir.path) { try FileManager.default.removeItem(at: dir) }
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func readText(_ call: CAPPluginCall) {
        files.async {
            do {
                let url = try self.checked(call.getString("model") ?? "", call.getString("name") ?? "")
                call.resolve(["text": try String(contentsOf: url, encoding: .utf8)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        let relative = call.getString("model") ?? ""
        inference.async {
            guard let slash = relative.firstIndex(of: "/") else {
                call.reject("invalid model file")
                return
            }
            do {
                let url = try self.checked(String(relative[..<slash]), String(relative[relative.index(after: slash)...]))
                var error: UnsafeMutablePointer<CChar>?
                let threads = Int32(max(1, ProcessInfo.processInfo.activeProcessorCount / 2))
                guard let session = plainva_ort_load(url.path, threads, &error) else {
                    call.reject("model_load: " + Self.take(error))
                    return
                }
                self.next += 1
                let handle = "m\(self.next)"
                self.sessions[handle] = session
                call.resolve(["handle": handle])
            } catch {
                call.reject("model_load: " + error.localizedDescription)
            }
        }
    }

    @objc func unload(_ call: CAPPluginCall) {
        let handle = call.getString("handle") ?? ""
        inference.async {
            if let session = self.sessions.removeValue(forKey: handle) { plainva_ort_unload(session) }
            call.resolve()
        }
    }

    @objc func run(_ call: CAPPluginCall) {
        inference.async {
            guard let session = self.sessions[call.getString("handle") ?? ""] else {
                call.reject("model_not_loaded")
                return
            }
            let batch = call.getInt("batch") ?? 0
            let seq = call.getInt("seq") ?? 0
            guard batch > 0, seq > 0, let ids = Data(base64Encoded: call.getString("ids") ?? ""), let mask = Data(base64Encoded: call.getString("mask") ?? ""),
                  ids.count == batch * seq * 4, mask.count == batch * seq else {
                call.reject("batch shape")
                return
            }
            let pooling: Int32 = switch call.getString("pooling") {
            case "last": Int32(PLAINVA_POOL_LAST)
            case "mean": Int32(PLAINVA_POOL_MEAN)
            default: Int32(PLAINVA_POOL_CLS)
            }
            var vectors: UnsafeMutablePointer<Float>?
            var dim: Int64 = 0
            var error: UnsafeMutablePointer<CChar>?
            let ids32 = ids.withUnsafeBytes { raw in (0..<(batch * seq)).map { Int32(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 4, as: Int32.self)) } }
            let status = ids32.withUnsafeBufferPointer { idPointer in
                mask.withUnsafeBytes { maskRaw in
                    plainva_ort_run(session, idPointer.baseAddress, maskRaw.bindMemory(to: UInt8.self).baseAddress, Int64(batch), Int64(seq), pooling, &vectors, &dim, &error)
                }
            }
            guard status == 0, let vectors else {
                call.reject("model_run: " + Self.take(error))
                return
            }
            let count = batch * Int(dim)
            var out = Data(capacity: count * 4)
            for i in 0..<count { withUnsafeBytes(of: vectors[i].bitPattern.littleEndian) { out.append(contentsOf: $0) } }
            plainva_ort_free(vectors)
            call.resolve(["vectors": out.base64EncodedString(), "dim": Int(dim)])
        }
    }

    private static func take(_ error: UnsafeMutablePointer<CChar>?) -> String {
        guard let error else { return "unknown" }
        defer { plainva_ort_free(error) }
        return String(cString: error)
    }
}

private struct PluginError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/**
 * One file of a package: resumes a `.part`, streams to disk while hashing,
 * follows redirects only to the hub and its CDNs over https, and names the
 * file only after size and SHA-256 matched.
 */
private final class ModelDownload: NSObject, URLSessionDataDelegate {
    let source: URL, target: URL, part: URL, marker: URL, bytes: Int64, sha256: String
    let progress: (Int64) -> Void
    private var session: URLSession?
    private var handle: FileHandle?
    private var hasher = SHA256()
    private var received: Int64 = 0
    private var lastReport = Date.distantPast
    private var done: ((String?) -> Void)?
    private var failure: String?

    init(source: URL, target: URL, part: URL, marker: URL, bytes: Int64, sha256: String, progress: @escaping (Int64) -> Void) {
        self.source = source
        self.target = target
        self.part = part
        self.marker = marker
        self.bytes = bytes
        self.sha256 = sha256
        self.progress = progress
    }

    func start(_ completion: @escaping (String?) -> Void) {
        done = completion
        do {
            let fm = FileManager.default
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: marker)
            if fm.fileExists(atPath: part.path), let size = (try? fm.attributesOfItem(atPath: part.path))?[.size] as? NSNumber, size.int64Value <= bytes {
                let reader = try FileHandle(forReadingFrom: part)
                while let chunk = try reader.read(upToCount: 1 << 20), !chunk.isEmpty {
                    hasher.update(data: chunk)
                    received += Int64(chunk.count)
                }
                try reader.close()
            } else {
                try? fm.removeItem(at: part)
            }
        } catch {
            finish(error.localizedDescription)
            return
        }
        var request = URLRequest(url: source, timeoutInterval: 60)
        if received > 0 { request.setValue("bytes=\(received)-", forHTTPHeaderField: "Range") }
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session
        session.dataTask(with: request).resume()
    }

    func cancel() {
        failure = "download_cancelled"
        session?.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        if request.url?.scheme == "https" && LocalModelPlugin.allowedHost(request.url?.host) {
            completionHandler(request)
        } else {
            failure = "download_not_allowed"
            completionHandler(nil)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if received > 0 && status == 200 {
            hasher = SHA256()
            received = 0
        } else if !(status == 200 || (received > 0 && status == 206)) {
            failure = failure ?? "download_failed: HTTP \(status)"
            completionHandler(.cancel)
            return
        }
        do {
            if received == 0 {
                FileManager.default.createFile(atPath: part.path, contents: nil)
            }
            let writer = try FileHandle(forWritingTo: part)
            try writer.seekToEnd()
            if received == 0 { try writer.truncate(atOffset: 0) }
            handle = writer
            completionHandler(.allow)
        } catch {
            failure = error.localizedDescription
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard failure == nil, let handle else { return }
        received += Int64(data.count)
        if received > bytes {
            failure = "download_too_large"
            try? FileManager.default.removeItem(at: part)
            dataTask.cancel()
            return
        }
        hasher.update(data: data)
        do {
            try handle.write(contentsOf: data)
        } catch {
            failure = error.localizedDescription
            dataTask.cancel()
            return
        }
        if Date().timeIntervalSince(lastReport) >= 0.25 {
            lastReport = Date()
            progress(received)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.synchronize()
        try? handle?.close()
        handle = nil
        session.finishTasksAndInvalidate()
        if let failure {
            finish(failure)
            return
        }
        if let error {
            finish("download_failed: " + error.localizedDescription)
            return
        }
        progress(received)
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        guard received == bytes, digest == sha256 else {
            try? FileManager.default.removeItem(at: part)
            finish(received == bytes ? "checksum_mismatch" : "download_incomplete")
            return
        }
        do {
            let fm = FileManager.default
            if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
            try fm.moveItem(at: part, to: target)
            try Data(sha256.utf8).write(to: marker, options: .atomic)
            finish(nil)
        } catch {
            finish(error.localizedDescription)
        }
    }

    private func finish(_ error: String?) {
        let completion = done
        done = nil
        completion?(error)
    }
}
