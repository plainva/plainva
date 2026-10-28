import { logDiagnostic } from "@plainva/ui";
import { APP_URL } from "./appScheme";
import { handleOAuthRedirect } from "./oauthService";
import { handlePimOAuthRedirect } from "./pim/pimOAuth";

/**
 * Where a URL on the app's own scheme goes (`com.plainva.app://…`, see
 * `appScheme.ts` for the Labs build).
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
  logDiagnostic("app-url", describeAppUrl(url));
  // Launcher shortcuts (package J) ride the app scheme.
  if (url.startsWith(`${APP_URL}shortcut/`)) {
    const which = url.split("/").pop();
    window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which } }));
    return;
  }
  // A tapped widget row (plan Widgets, W3). The URL carries a position, never
  // a path — resolving it belongs to the service that wrote the table.
  if (url.startsWith(`${APP_URL}widget/open/`)) {
    await import("./widgetService")
      .then((m) => m.routeWidgetOpen(url))
      .catch(() => {});
    return;
  }
  if (await handlePimOAuthRedirect(url)) return;
  void handleOAuthRedirect(url);
}

/**
 * What arrived, for the diagnostics export: the address without its query and
 * the names of the parameters (`code`, `state`, `error`), never their values -
 * a sign-in that "came back to the same screen" must show whether its answer
 * reached the app at all (device finding 2026-10-28).
 */
export function describeAppUrl(url: string): string {
  const [address, query = ""] = url.split(/[?#]/, 2);
  const names = [...new URLSearchParams(query).keys()];
  return names.length ? `${address} (${names.join(", ")})` : address;
}
