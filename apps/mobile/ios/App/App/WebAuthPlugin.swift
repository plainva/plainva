import Foundation
import Capacitor
import AuthenticationServices

/**
 * Browser sign-ins on the iPhone through the system's own sign-in window
 * (ASWebAuthenticationSession) instead of an in-app Safari view.
 *
 * Device finding 2026-10-28 (TestFlight 150): Microsoft's sign-in hung in the
 * Safari view after the password. An in-app Safari view follows a redirect to
 * the app's own scheme only when it comes straight from a tap; Microsoft
 * reaches the app's address through pages that submit themselves, so the
 * last hop was dropped and the page stayed. Google's last hop follows a tap,
 * which is why it worked. The system window takes the answer at its scheme
 * however the page gets there - the way Apple asks sign-ins to be done.
 *
 * `start` resolves with the address the provider sent the person back to;
 * the app hands it to the same handler a redirect on the app's scheme goes
 * to. Closing the window rejects with the code CANCELLED.
 */
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    /** The running session: the system lets it go once it is no longer held. */
    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("url and callbackScheme required")
            return
        }
        DispatchQueue.main.async {
            // One sign-in at a time: a new one replaces one left open.
            self.session?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.session = nil
                if let callback = callback {
                    call.resolve(["url": callback.absoluteString])
                    return
                }
                if let failure = error as? ASWebAuthenticationSessionError, failure.code == .canceledLogin {
                    call.reject("the sign-in window was closed", "CANCELLED")
                    return
                }
                call.reject(error?.localizedDescription ?? "the sign-in did not complete", "FAILED")
            }
            session.presentationContextProvider = self
            // The browser's own sign-ins stay usable, so a person signed in at
            // the provider is not asked for the password again.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("the sign-in window could not open", "FAILED")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
