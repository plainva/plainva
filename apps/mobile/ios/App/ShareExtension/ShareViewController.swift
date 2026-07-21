import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroup = "group.com.plainva.app"
    private let payloadName = "pending-share.json"
    private let maximumAttachmentBytes = 25 * 1024 * 1024

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        collectAndOpenApp()
    }

    private func collectAndOpenApp() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let subject = items.compactMap { $0.attributedTitle?.string }.first ?? ""
        let group = DispatchGroup()
        let lock = NSLock()
        var texts: [String] = []
        var files: [[String: Any]] = []

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                    defer { group.leave() }
                    if let value = item as? URL { lock.lock(); texts.append(value.absoluteString); lock.unlock() }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.text.identifier) { item, _ in
                    defer { group.leave() }
                    let value = (item as? String) ?? (item as? NSAttributedString)?.string
                    if let value, !value.isEmpty { lock.lock(); texts.append(value); lock.unlock() }
                }
            } else if let typeId = provider.registeredTypeIdentifiers.first {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, _ in
                    defer { group.leave() }
                    guard let url,
                          let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                          size <= self.maximumAttachmentBytes,
                          let data = try? Data(contentsOf: url) else { return }
                    let entry: [String: Any] = [
                        "name": provider.suggestedName ?? url.lastPathComponent,
                        "mime": UTType(typeId)?.preferredMIMEType ?? "application/octet-stream",
                        "data": data.base64EncodedString()
                    ]
                    lock.lock(); files.append(entry); lock.unlock()
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            let payload: [String: Any] = ["text": texts.joined(separator: "\n"), "subject": subject, "files": files]
            if let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
               let data = try? JSONSerialization.data(withJSONObject: payload) {
                try? data.write(to: root.appendingPathComponent(payloadName), options: .atomic)
            }
            guard let url = URL(string: "com.plainva.app://shared") else {
                extensionContext?.completeRequest(returningItems: nil)
                return
            }
            extensionContext?.open(url) { _ in self.extensionContext?.completeRequest(returningItems: nil) }
        }
    }
}
