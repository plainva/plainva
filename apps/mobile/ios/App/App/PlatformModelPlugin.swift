import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

/**
 * The system's own model on the iPhone (plan KI-Harness P2c, ADR 0021):
 * Apple's on-device foundation model through the FoundationModels framework.
 * No key, no download by Plainva, nothing leaves the device.
 *
 * It speaks the egress protocol of AiNet — the same callback chunks — so a
 * conversation reaches it like any provider: GET `platform://apple/models`
 * answers with the model and its window (or why the system has none), POST
 * `platform://apple/generate` streams the answer in Plainva's small dialect,
 * `data: {"text": …}` deltas and a closing `data: {"stop": …}`.
 *
 * The framework exists from iOS 26; the app runs from 16.4 and links it
 * weakly (`-weak_framework FoundationModels`), every use stays behind
 * `#available`.
 */
@objc(PlatformModelPlugin)
public class PlatformModelPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlatformModelPlugin"
    public let jsName = "PlatformModel"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
    ]

    private static let modelId = "on-device"
    private static let fallbackWindow = 4096
    private let lock = NSLock()
    private var running = [String: Task<Void, Never>]()

    /// Why the model is not there, in the reasons the settings know; nil when it is.
    static func unavailableReason() -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return nil
            case .unavailable(.deviceNotEligible):
                return "deviceNotEligible"
            case .unavailable(.appleIntelligenceNotEnabled):
                return "appleIntelligenceNotEnabled"
            case .unavailable(.modelNotReady):
                return "modelNotReady"
            case .unavailable:
                return "unavailable"
            @unknown default:
                return "unavailable"
            }
        }
        #endif
        return "osTooOld"
    }

    /// The model's whole window — prompt and answer together.
    static func window() -> Int {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), unavailableReason() == nil {
            return SystemLanguageModel.default.contextSize
        }
        #endif
        return fallbackWindow
    }

    /// The languages the model speaks, as BCP 47 identifiers.
    static func languages() -> [String] {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), unavailableReason() == nil {
            return SystemLanguageModel.default.supportedLanguages.map { $0.minimalIdentifier }.sorted()
        }
        #endif
        return []
    }

    @objc func status(_ call: CAPPluginCall) {
        if let reason = PlatformModelPlugin.unavailableReason() {
            call.resolve(["state": "unavailable", "reason": reason])
            return
        }
        call.resolve([
            "state": "available",
            "model": PlatformModelPlugin.modelId,
            "contextTokens": PlatformModelPlugin.window(),
            "languages": PlatformModelPlugin.languages(),
        ])
    }

    /// The system loads its model itself; there is nothing for an app to start.
    @objc func download(_ call: CAPPluginCall) {
        call.resolve(["started": false])
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), let url = call.getString("url"), url.hasPrefix("platform://apple/") else {
            call.resolve(["type": "failed", "code": "unknown_endpoint", "message": "not the system's model"])
            return
        }
        if let reason = PlatformModelPlugin.unavailableReason() {
            call.resolve(["type": "failed", "code": "platform_unavailable", "message": reason])
            return
        }
        if call.getString("method") == "GET" {
            guard url.hasSuffix("/models") else {
                call.resolve(["type": "failed", "code": "url_not_allowed", "message": "unknown path"])
                return
            }
            let list: [String: Any] = ["data": [["id": PlatformModelPlugin.modelId, "name": "Apple on-device model", "context_length": PlatformModelPlugin.window()]]]
            guard let data = try? JSONSerialization.data(withJSONObject: list), let text = String(data: data, encoding: .utf8) else {
                call.resolve(["type": "failed", "code": "platform_error", "message": "model list"])
                return
            }
            call.keepAlive = true
            call.resolve(["type": "open", "status": 200])
            call.resolve(["type": "data", "text": text])
            call.resolve(["type": "done"])
            call.keepAlive = false
            bridge?.releaseCall(call)
            return
        }
        guard url.hasSuffix("/generate"), let body = call.getObject("body"), let prompt = body["prompt"] as? String, !prompt.isEmpty else {
            call.resolve(["type": "failed", "code": "invalid_request", "message": "a prompt is needed"])
            return
        }
        let instructions = body["instructions"] as? String ?? ""
        let answerTokens = max(64, min((body["maxOutputTokens"] as? Int) ?? 700, 4096))
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            call.keepAlive = true
            call.resolve(["type": "open", "status": 200])
            let task = Task { [weak self] in
                await PlatformModelPlugin.generate(call: call, instructions: instructions, prompt: prompt, answerTokens: answerTokens)
                self?.finish(requestId, call)
            }
            lock.lock()
            running[requestId] = task
            lock.unlock()
            return
        }
        #endif
        call.resolve(["type": "failed", "code": "platform_unavailable", "message": "osTooOld"])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else { call.reject("requestId required"); return }
        lock.lock()
        let task = running[requestId]
        lock.unlock()
        task?.cancel()
        call.resolve(["cancelled": task != nil])
    }

    private func finish(_ requestId: String, _ call: CAPPluginCall) {
        lock.lock()
        running.removeValue(forKey: requestId)
        lock.unlock()
        call.keepAlive = false
        bridge?.releaseCall(call)
    }

    /// One server-sent event of Plainva's dialect.
    static func event(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data: data, encoding: .utf8) else { return "" }
        return "data: \(json)\n\n"
    }

    /**
     * Why a generation failed, in the egress codes the core maps. The
     * framework's error type changes between SDKs (deprecated in 27), so the
     * case is read from its description rather than switched on.
     */
    static func failure(_ error: Error) -> (code: String, message: String) {
        let text = String(describing: error)
        if text.contains("exceededContextWindowSize") { return ("context_too_long", "context window") }
        if text.contains("rateLimited") || text.contains("concurrentRequests") { return ("rate_limited", "busy") }
        if text.contains("guardrailViolation") || text.contains("refusal") { return ("platform_refused", "The model declined this request.") }
        if text.contains("unsupportedLanguageOrLocale") { return ("platform_unavailable", "unsupportedLanguage") }
        if text.contains("assetsUnavailable") { return ("platform_unavailable", "modelNotReady") }
        return ("platform_error", String(text.prefix(300)))
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    static func generate(call: CAPPluginCall, instructions: String, prompt: String, answerTokens: Int) async {
        // A new session per request: the core sends the conversation it wants the model to see.
        let session = LanguageModelSession(instructions: instructions)
        let options = GenerationOptions(maximumResponseTokens: answerTokens)
        var sent = ""
        do {
            let stream = session.streamResponse(to: prompt, options: options)
            for try await snapshot in stream {
                // Snapshots are cumulative: only what is new goes out.
                let whole = snapshot.content
                guard whole.count > sent.count, whole.hasPrefix(sent) else { sent = whole; continue }
                let delta = String(whole.dropFirst(sent.count))
                sent = whole
                call.resolve(["type": "data", "text": PlatformModelPlugin.event(["text": delta])])
            }
            call.resolve(["type": "data", "text": PlatformModelPlugin.event(["stop": "end"])])
            call.resolve(["type": "done"])
        } catch is CancellationError {
            call.resolve(["type": "cancelled"])
        } catch {
            if Task.isCancelled {
                call.resolve(["type": "cancelled"])
                return
            }
            let mapped = PlatformModelPlugin.failure(error)
            call.resolve(["type": "failed", "code": mapped.code, "message": mapped.message])
        }
    }
    #endif
}
