import { guardedExternalOpener } from "@plainva/ui";

/**
 * The phone's ONE way to hand an address to the system (Sammelplan § 3.138),
 * registered as `openExternal` in `main.tsx`.
 *
 * Before it, every scheme but http(s) went to `window.open` inside the
 * WebView — a `javascript:` or `intent:` value from a synced vault included.
 * Now the shared rule decides first (`guardedExternalOpener`: web, mail and
 * phone addresses only, a toast for anything else), the same rule the
 * desktop's sink follows. `externalUrl.test.ts` keeps `Browser.open` and
 * `window.open` to this file and the sign-in.
 */
export function openExternalUrl(url: string): Promise<void> {
  // Wrapped per call, not at load: no work across a package boundary while the
  // module loads (moduleInitBoundary.test.ts).
  return guardedExternalOpener(async (allowed) => {
    // window.open doesn't reliably reach the system browser inside the
    // Capacitor WebView; web links open in the in-app browser instead.
    if (/^https?:/i.test(allowed)) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: allowed });
    } else {
      window.open(allowed, "_blank", "noopener");
    }
  })(url);
}
