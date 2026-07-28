import Foundation
import Capacitor
import Network

/**
 * Raw TCP/TLS sockets for the mail client (mail feinplan G2) — the iOS twin of
 * MailNetPlugin.java.
 *
 * Deliberately dumb: open, upgrade to TLS, write bytes, read bytes, close. The
 * IMAP and SMTP protocols live in shared TypeScript, so both platforms run the
 * identical protocol and this file stays small enough to audit.
 *
 * Certificates are validated by the platform default. One exception, mirroring
 * the desktop: a LOOPBACK address may present a self-signed certificate (the
 * Proton Mail Bridge), because a loopback socket cannot be intercepted.
 *
 * A mail server on the user's own network triggers the iOS local-network
 * prompt — `NSLocalNetworkUsageDescription` in Info.plist explains why.
 *
 * `CAPBridgedPlugin` is not optional. Since Capacitor 6 the bridge no longer
 * discovers a plugin's JS name and methods through the Objective-C runtime: it
 * reads them from `jsName` and `pluginMethods`. Without that this class was
 * registered, compiled and shipped — and every call still answered
 * `"MailNet" plugin is not implemented on ios`, because the bridge had no way
 * to connect `registerPlugin("MailNet")` in mailNet.ts to it. Mail was dead on
 * the whole platform (maintainer finding 2026-07-28).
 */
@objc(MailNetPlugin)
public class MailNetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MailNetPlugin"
    public let jsName = "MailNet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTls", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private final class Conn {
        let connection: NWConnection
        var buffer = Data()
        var closed = false
        init(_ connection: NWConnection) { self.connection = connection }
    }

    private var conns: [String: Conn] = [:]
    private var nextId = 1
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.plainva.app.mailnet")

    private static func isLoopback(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "localhost" || h == "127.0.0.1" || h == "::1"
    }

    private func tlsOptions(host: String) -> NWProtocolTLS.Options {
        let options = NWProtocolTLS.Options()
        if MailNetPlugin.isLoopback(host) {
            // Loopback only — see the class comment.
            sec_protocol_options_set_verify_block(
                options.securityProtocolOptions,
                { _, _, complete in complete(true) },
                queue
            )
        }
        return options
    }

    private func start(_ connection: NWConnection, _ call: CAPPluginCall, id: String) {
        var settled = false
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if !settled { settled = true; call.resolve(["id": id]) }
            case .failed(let error):
                if !settled { settled = true; call.reject("could not reach the mail server: \(error.localizedDescription)") }
            case .cancelled:
                if !settled { settled = true; call.reject("the connection was cancelled") }
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let port = call.getInt("port"), let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            call.reject("host and port are required")
            return
        }
        let tls = call.getBool("tls") ?? false
        let params: NWParameters = tls
            ? NWParameters(tls: tlsOptions(host: host), tcp: NWProtocolTCP.Options())
            : NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)

        lock.lock()
        let id = "c\(nextId)"
        nextId += 1
        conns[id] = Conn(connection)
        lock.unlock()

        start(connection, call, id: id)
    }

    /**
     * STARTTLS. Network.framework cannot upgrade a live NWConnection in place,
     * so the connection is replaced by a TLS one to the same endpoint. That is
     * sound for the mail protocols: the server has just answered "OK begin TLS"
     * and expects a fresh handshake, and both IMAP and SMTP re-issue their
     * capability exchange afterwards anyway.
     */
    @objc func startTls(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("unknown connection")
            return
        }
        lock.lock()
        let conn = conns[id]
        lock.unlock()
        guard let conn = conn, case let .hostPort(host, port) = conn.connection.endpoint else {
            call.reject("unknown connection")
            return
        }
        let hostString: String
        switch host {
        case .name(let n, _): hostString = n
        case .ipv4(let a): hostString = "\(a)"
        case .ipv6(let a): hostString = "\(a)"
        @unknown default: hostString = ""
        }
        conn.connection.cancel()
        let params = NWParameters(tls: tlsOptions(host: hostString), tcp: NWProtocolTCP.Options())
        let upgraded = NWConnection(host: host, port: port, using: params)
        let fresh = Conn(upgraded)
        lock.lock()
        conns[id] = fresh
        lock.unlock()
        var settled = false
        upgraded.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if !settled { settled = true; call.resolve() }
            case .failed(let error):
                if !settled { settled = true; call.reject("TLS handshake failed: \(error.localizedDescription)") }
            default:
                break
            }
        }
        upgraded.start(queue: queue)
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let data = call.getString("data"),
              let bytes = Data(base64Encoded: data) else {
            call.reject("unknown connection")
            return
        }
        lock.lock()
        let conn = conns[id]
        lock.unlock()
        guard let conn = conn else {
            call.reject("unknown connection")
            return
        }
        conn.connection.send(content: bytes, completion: .contentProcessed { error in
            if let error = error {
                call.reject("could not send to the mail server: \(error.localizedDescription)")
            } else {
                call.resolve()
            }
        })
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("unknown connection")
            return
        }
        lock.lock()
        let conn = conns[id]
        lock.unlock()
        guard let conn = conn else {
            call.reject("unknown connection")
            return
        }
        let timeoutMs = call.getInt("timeoutMs") ?? 30000
        var settled = false
        let finish: (String?, String?) -> Void = { payload, error in
            guard !settled else { return }
            settled = true
            if let error = error { call.reject(error) } else { call.resolve(["data": payload ?? ""]) }
        }
        queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
            finish(nil, "the mail server did not answer in time")
        }
        conn.connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { data, _, isComplete, error in
            if let error = error {
                finish(nil, "lost the connection to the mail server: \(error.localizedDescription)")
                return
            }
            if let data = data, !data.isEmpty {
                finish(data.base64EncodedString(), nil)
                return
            }
            // Empty payload means the peer closed — the shared layer reads that
            // as "connection closed" rather than as an error.
            if isComplete { finish("", nil) }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.resolve()
            return
        }
        lock.lock()
        let conn = conns.removeValue(forKey: id)
        lock.unlock()
        conn?.connection.cancel()
        call.resolve()
    }
}
