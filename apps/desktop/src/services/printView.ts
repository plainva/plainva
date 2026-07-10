import { invoke } from "@tauri-apps/api/core";

/**
 * Prints the read view of a note (P3.10) — "print / save as PDF" via the OS
 * print dialog, no bundled PDF engine.
 *
 * The reader lives inside a nested overflow container; printing it in place
 * cuts everything after the first page (the classic scroll-container trap).
 * The view is therefore CLONED into a body-level host that @media print rules
 * in App.css swap in for #root.
 *
 * Platform split (GitHub issue #6): WKWebView on macOS silently ignores
 * `window.print()`, so macOS goes through the native `print_webview` command;
 * Windows (WebView2) and Linux (WebKitGTK) keep `window.print()`, which works
 * there — and wry's native print is macOS-only anyway.
 */

/** True on macOS — the only platform routed through the native print command. */
export function isMacPlatform(ua: string = navigator.userAgent): boolean {
  return ua.includes("Macintosh") || ua.includes("Mac OS X");
}

export async function printElement(source: HTMLElement): Promise<void> {
  // A previous invocation may still be inside its (generous) cleanup window
  // on the native path — replace it, never stack hosts.
  document.querySelectorAll(".pv-print-host").forEach((n) => n.remove());

  const host = document.createElement("div");
  host.className = "pv-print-host";
  host.appendChild(source.cloneNode(true));
  document.body.appendChild(host);
  document.body.setAttribute("data-printing", "");

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    // A newer print run may already own data-printing — only tear down our
    // own host (stale timers from a replaced run become no-ops).
    if (!host.isConnected) return;
    document.body.removeAttribute("data-printing");
    host.remove();
  };
  window.addEventListener("afterprint", cleanup);

  if (isMacPlatform()) {
    // The native command can return BEFORE macOS has rendered the print
    // preview, so the clone must outlive the call — it is display:none on
    // screen, keeping it around is free. afterprint stays the primary
    // cleanup; the long timer is only the backstop.
    try {
      await invoke("print_webview");
    } catch (err) {
      console.warn("[printView] native print failed, falling back to window.print()", err);
      window.print();
    }
    window.setTimeout(cleanup, 60_000);
  } else {
    try {
      // Blocks until the dialog closes in WebView2; afterprint is the
      // fallback for engines that return earlier.
      window.print();
    } finally {
      // If afterprint never fires (headless/test), clean up shortly after.
      window.setTimeout(cleanup, 1000);
    }
  }
}
