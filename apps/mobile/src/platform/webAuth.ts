import { Browser } from "@capacitor/browser";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { logDiagnostic, toast } from "@plainva/ui";
import { connectionFailureToast } from "../services/connectionToast";
import { APP_ID } from "../services/appScheme";

/**
 * Where a browser sign-in opens (device finding 2026-10-28).
 *
 * On the iPhone, the system's sign-in window (`WebAuthPlugin.swift`): an
 * in-app Safari view dropped Microsoft's way back to the app, because the
 * last hop does not follow a tap, and the page hung. The system window takes
 * the answer at the app's scheme however the page gets there, and hands it
 * back here; it goes to the same handler a redirect on the app's scheme goes
 * to (`appUrlRoutes.ts`), so nothing after this differs from Android.
 *
 * On Android the custom tab stays: there the answer arrives as an intent on
 * the app's scheme. A shell without the native plugin opens the browser too.
 * The desktop signs in through the system browser and a loopback address,
 * which takes the answer however the page gets there - nothing to bring along.
 */
interface WebAuthNative {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

const WebAuth = registerPlugin<WebAuthNative>("WebAuth");

export async function openSignInPage(url: string): Promise<void> {
  if (Capacitor.getPlatform() !== "ios" || typeof WebAuth.start !== "function") {
    await Browser.open({ url });
    return;
  }
  // The call ends when the sign-in does, not when the window opens: the
  // caller goes on at once, as with the browser, and the answer arrives later.
  void WebAuth.start({ url, callbackScheme: APP_ID }).then(
    async ({ url: answer }) => {
      const { routeAppUrl } = await import("../services/appUrlRoutes");
      await routeAppUrl(answer);
    },
    async (error: unknown) => {
      const code = (error as { code?: string } | null)?.code;
      if (code === "UNIMPLEMENTED") {
        await Browser.open({ url });
        return;
      }
      if (code === "CANCELLED") {
        logDiagnostic("sign-in", "the sign-in window was closed without an answer from the provider");
        return;
      }
      toast.error(...connectionFailureToast(error));
    },
  );
}
