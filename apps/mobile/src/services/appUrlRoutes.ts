import { handleOAuthRedirect } from "./oauthService";
import { handlePimOAuthRedirect } from "./pim/pimOAuth";

/**
 * Where a URL on the app's own scheme goes (`com.plainva.app://…`).
 *
 * Its own module because this is a LIST, and lists in `App.tsx` are what the
 * structure ratchet exists to stop — the shell's job is to hand the URL over,
 * not to know every kind there is. It moved out when the widgets added a
 * fourth kind (plan Widgets, W3) and the shell hit its budget, which is
 * exactly the moment the ratchet is for.
 *
 * The order matters in one place: the calendar's OAuth handler looks first,
 * and it only consumes a redirect that matches its own pending state — so
 * anything it does not recognise falls through to the sync handler.
 */
export async function routeAppUrl(url: string): Promise<void> {
  // Launcher shortcuts (package J) ride the app scheme.
  if (url.startsWith("com.plainva.app://shortcut/")) {
    const which = url.split("/").pop();
    window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which } }));
    return;
  }
  // A tapped widget row (plan Widgets, W3). The URL carries a position, never
  // a path — resolving it belongs to the service that wrote the table.
  if (url.startsWith("com.plainva.app://widget/open/")) {
    await import("./widgetService")
      .then((m) => m.routeWidgetOpen(url))
      .catch(() => {});
    return;
  }
  if (await handlePimOAuthRedirect(url)) return;
  void handleOAuthRedirect(url);
}
