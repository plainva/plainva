import Foundation
import Capacitor

/**
 * URLSession-backed HTTP bridge (P7), mirroring the Android OkHttp plugin:
 * the shared sync targets need arbitrary methods (PROPFIND & friends) and
 * binary bodies, which the stock CapacitorHttp cannot carry. Contract:
 * request({url, method, headers, body?, bodyBase64?}) ->
 * {status, headers, bodyBase64}.
 */
@objc(WebDavHttpPlugin)
public class WebDavHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebDavHttpPlugin"
    public let jsName = "WebDavHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("invalid url")
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
        if let body = call.getString("body") {
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
        session.dataTask(with: req) { data, response, error in
            if let error = error {
                call.reject("request failed: \(error.localizedDescription)")
                return
            }
            guard let http = response as? HTTPURLResponse else {
                call.reject("no http response")
                return
            }
            var headers: [String: String] = [:]
            for (name, value) in http.allHeaderFields {
                if let nameText = name as? String, let valueText = value as? String {
                    headers[nameText] = valueText
                }
            }
            call.resolve([
                "status": http.statusCode,
                "headers": headers,
                "bodyBase64": (data ?? Data()).base64EncodedString(),
            ])
        }.resume()
    }
}
