import Foundation
import Capacitor
import MetricKit

/**
 * Why the app ended, from the system's own diagnostics (release list F51) -
 * the iOS counterpart of the Android plugin of the same name.
 *
 * MetricKit hands the app its crash and hang diagnostics at the next start
 * (iOS 15+; this app needs 16.4), with no permission and no service of
 * anyone else's. What is kept of them, and nothing more:
 *  - a crash: exception type, code and signal, the system's termination
 *    reason (scrubbed again in JavaScript), the build;
 *  - a hang: its duration, the build (reason 100: Android has no hang);
 *  - for both, at most 12 frames of the attributed thread as binary name
 *    plus offset - never the raw call stack tree, never the exception's
 *    composed message (iOS 17, it can carry what the app was handling),
 *    never the memory region info;
 *  - a memory kill has no diagnostic of its own: the daily metric payloads
 *    count exits by cause, kept as daily counts without a time of day.
 * The callbacks arrive on a queue of the system's; every write goes through
 * one serial queue into one small file below Library, replaced atomically.
 * Nothing leaves the device: the JavaScript side shows it on the
 * diagnostics screen and puts it into the export the person shares.
 */
final class ExitDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = ExitDiagnostics()

    static let maxExits = 10
    static let maxDays = 7
    static let maxFrames = 12
    static let maxText = 200
    /** A hang: no Android reason code, so one of its own (`processExits.ts`, REASON_HANG). */
    static let hangReason = 100

    private let queue = DispatchQueue(label: "com.plainva.exit-diagnostics")
    private var started = false

    private var fileURL: URL? {
        ExitDiagnostics.folderURL?.appendingPathComponent("exits.json")
    }

    /**
     * The folder of the diagnostics (this record, and the page's own files of
     * exits and bridge peaks), kept out of the iCloud backup: what the system
     * said about a crash stays on this device and leaves it only in the export
     * the person shares.
     */
    static var folderURL: URL? {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appendingPathComponent("PlainvaDiagnostics", isDirectory: true)
    }

    private func excludeFromBackup() {
        guard var folder = ExitDiagnostics.folderURL else { return }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
        } catch {
            NSLog("[exit-diagnostics] not kept out of the backup: %@", error.localizedDescription)
        }
    }

    /** Called early at launch: subscribes, and takes in what the system delivered before. */
    func start() {
        queue.async {
            guard !self.started else { return }
            self.started = true
            self.excludeFromBackup()
            MXMetricManager.shared.add(self)
            self.take(diagnostics: MXMetricManager.shared.pastDiagnosticPayloads)
            self.take(metrics: MXMetricManager.shared.pastPayloads)
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        queue.async { self.take(diagnostics: payloads) }
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        queue.async { self.take(metrics: payloads) }
    }

    /** What is kept, as the plugin hands it out. */
    func read() -> [String: Any] {
        queue.sync { load() }
    }

    // MARK: - On the queue only

    private func load() -> [String: Any] {
        guard let url = fileURL, let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ["exits": [], "days": []]
        }
        return object
    }

    private func store(_ object: [String: Any]) {
        guard let url = fileURL, JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("[exit-diagnostics] not kept: %@", error.localizedDescription)
        }
    }

    private static func clip(_ text: String?) -> String? {
        guard let text = text, !text.isEmpty else { return nil }
        return text.count > maxText ? String(text.prefix(maxText)) : text
    }

    /** Binary name plus offset of the attributed thread's frames, from the root down. */
    private static func frames(of tree: MXCallStackTree) -> [String] {
        guard let json = try? JSONSerialization.jsonObject(with: tree.jsonRepresentation()) as? [String: Any],
              let stacks = json["callStacks"] as? [[String: Any]] else { return [] }
        let stack = stacks.first(where: { ($0["threadAttributed"] as? Bool) == true }) ?? stacks.first
        var frame = (stack?["callStackRootFrames"] as? [[String: Any]])?.first
        var out: [String] = []
        while let current = frame, out.count < maxFrames {
            let binary = (current["binaryName"] as? String) ?? "?"
            let offset = (current["offsetIntoBinaryTextSegment"] as? NSNumber)?.int64Value ?? -1
            out.append("\(binary) +\(offset)")
            frame = (current["subFrames"] as? [[String: Any]])?.first
        }
        return out
    }

    private func take(diagnostics payloads: [MXDiagnosticPayload]) {
        guard !payloads.isEmpty else { return }
        var object = load()
        var exits = (object["exits"] as? [[String: Any]]) ?? []
        var keys = Set(exits.compactMap { $0["key"] as? String })
        for payload in payloads {
            let at = Int64(payload.timeStampEnd.timeIntervalSince1970 * 1000)
            // One key per diagnosis: a payload can carry several, and the same payload comes again at every start.
            for (index, crash) in (payload.crashDiagnostics ?? []).enumerated() {
                let key = "\(at)|4|\(index)|\(crash.exceptionType ?? 0)|\(crash.signal ?? 0)"
                guard !keys.contains(key) else { continue }
                keys.insert(key)
                var entry: [String: Any] = ["reason": 4, "timestamp": at, "importance": 0, "key": key]
                let parts = [
                    crash.exceptionType.map { "type \($0)" },
                    crash.exceptionCode.map { "code \($0)" },
                    crash.signal.map { "signal \($0)" },
                ].compactMap { $0 }
                if !parts.isEmpty { entry["exception"] = parts.joined(separator: ", ") }
                if let reason = ExitDiagnostics.clip(crash.terminationReason) { entry["description"] = reason }
                if let build = ExitDiagnostics.clip(crash.metaData.applicationBuildVersion) { entry["build"] = build }
                let frames = ExitDiagnostics.frames(of: crash.callStackTree)
                if !frames.isEmpty { entry["frames"] = frames }
                exits.append(entry)
            }
            for (index, hang) in (payload.hangDiagnostics ?? []).enumerated() {
                let key = "\(at)|\(ExitDiagnostics.hangReason)|\(index)|\(Int(hang.hangDuration.converted(to: .milliseconds).value))"
                guard !keys.contains(key) else { continue }
                keys.insert(key)
                let seconds = hang.hangDuration.converted(to: .seconds).value
                var entry: [String: Any] = ["reason": ExitDiagnostics.hangReason, "timestamp": at, "importance": 0, "key": key,
                                            "description": String(format: "%.1f s", seconds)]
                if let build = ExitDiagnostics.clip(hang.metaData.applicationBuildVersion) { entry["build"] = build }
                let frames = ExitDiagnostics.frames(of: hang.callStackTree)
                if !frames.isEmpty { entry["frames"] = frames }
                exits.append(entry)
            }
        }
        exits.sort { (($0["timestamp"] as? Int64) ?? 0) > (($1["timestamp"] as? Int64) ?? 0) }
        object["exits"] = Array(exits.prefix(ExitDiagnostics.maxExits))
        store(object)
    }

    private func take(metrics payloads: [MXMetricPayload]) {
        guard !payloads.isEmpty else { return }
        var object = load()
        var days = (object["days"] as? [[String: Any]]) ?? []
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd"
        for payload in payloads {
            guard let exits = payload.applicationExitMetrics else { continue }
            let day = format.string(from: payload.timeStampBegin)
            let fg = exits.foregroundExitData
            let bg = exits.backgroundExitData
            let memory = fg.cumulativeMemoryResourceLimitExitCount + bg.cumulativeMemoryResourceLimitExitCount + bg.cumulativeMemoryPressureExitCount
            let other = fg.cumulativeAppWatchdogExitCount + fg.cumulativeBadAccessExitCount + fg.cumulativeAbnormalExitCount
                + fg.cumulativeIllegalInstructionExitCount + bg.cumulativeAppWatchdogExitCount + bg.cumulativeBadAccessExitCount
                + bg.cumulativeAbnormalExitCount + bg.cumulativeIllegalInstructionExitCount
            days.removeAll { ($0["day"] as? String) == day }
            days.append(["day": day, "memory": memory, "other": other])
        }
        days.sort { (($0["day"] as? String) ?? "") > (($1["day"] as? String) ?? "") }
        object["days"] = Array(days.prefix(ExitDiagnostics.maxDays))
        store(object)
    }
}

@objc(ProcessExitPlugin)
public class ProcessExitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ProcessExitPlugin"
    public let jsName = "ProcessExit"
    // A method missing from this list is invisible to the platform.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lastExits", returnType: CAPPluginReturnPromise)
    ]

    /** The kept exits, newest first, and the daily counts, newest first. */
    @objc func lastExits(_ call: CAPPluginCall) {
        let since = (call.options["since"] as? NSNumber)?.int64Value ?? 0
        let kept = ExitDiagnostics.shared.read()
        let exits = ((kept["exits"] as? [[String: Any]]) ?? []).filter { (($0["timestamp"] as? NSNumber)?.int64Value ?? 0) > since }
        call.resolve(["exits": exits, "days": kept["days"] ?? []])
    }
}
