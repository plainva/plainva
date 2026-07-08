/**
 * Prints the read view of a note (P3.10) — "print / save as PDF" via the OS
 * print dialog, no bundled PDF engine.
 *
 * The reader lives inside a nested overflow container; printing it in place
 * cuts everything after the first page (the classic scroll-container trap).
 * The view is therefore CLONED into a body-level host that @media print rules
 * in App.css swap in for #root.
 */
export function printElement(source: HTMLElement): void {
  const host = document.createElement("div");
  host.className = "pv-print-host";
  host.appendChild(source.cloneNode(true));
  document.body.appendChild(host);
  document.body.setAttribute("data-printing", "");

  const cleanup = () => {
    document.body.removeAttribute("data-printing");
    host.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  try {
    // Blocks until the dialog closes in WebView2; afterprint is the fallback
    // for engines that return earlier.
    window.print();
  } finally {
    // If afterprint never fires (headless/test), clean up on the next tick.
    window.setTimeout(() => {
      if (document.body.hasAttribute("data-printing")) cleanup();
    }, 1000);
  }
}
