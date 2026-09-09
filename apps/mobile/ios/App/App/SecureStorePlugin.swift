import Foundation
import Capacitor
import Security

/** OS-protected storage. Missing entries and failed reads are distinct. */
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compareAndSet", returnType: CAPPluginReturnPromise),
    ]

    private static let storeLock = NSLock()
    private let service = "com.plainva.app.securestore"

    private func baseQuery(_ key: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    private func readValue(_ key: String) throws -> String? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw NSError(domain: "SecureStore", code: Int(status))
        }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "SecureStore", code: Int(errSecDecode))
        }
        return value
    }

    private func writeValue(_ key: String, _ value: String?) throws {
        guard let value = value else {
            let status = SecItemDelete(baseQuery(key) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw NSError(domain: "SecureStore", code: Int(status))
            }
            return
        }
        let data = Data(value.utf8)
        var query = baseQuery(key)
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            // Background sync may access secrets after the first device unlock.
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(query as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw NSError(domain: "SecureStore", code: Int(status))
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key required"); return }
        Self.storeLock.lock()
        defer { Self.storeLock.unlock() }
        do {
            if let value = try readValue(key) { call.resolve(["value": value]) }
            else { call.resolve(["value": NSNull()]) }
        } catch { call.reject("secure store read failed") }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("key and value required"); return
        }
        Self.storeLock.lock()
        defer { Self.storeLock.unlock() }
        do { try writeValue(key, value); call.resolve() }
        catch { call.reject("secure store write failed") }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key required"); return }
        Self.storeLock.lock()
        defer { Self.storeLock.unlock() }
        do { try writeValue(key, nil); call.resolve() }
        catch { call.reject("secure store remove failed") }
    }

    @objc func compareAndSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), call.options["expected"] != nil, call.options["value"] != nil else {
            call.reject("key, expected and value required"); return
        }
        Self.storeLock.lock()
        defer { Self.storeLock.unlock() }
        do {
            let changed = try readValue(key) == call.getString("expected")
            if changed { try writeValue(key, call.getString("value")) }
            call.resolve(["changed": changed])
        } catch { call.reject("secure store conditional write failed") }
    }
}
