import createDOMPurify from "dompurify";

// The package's default export is a FACTORY in module environments — bind it
// lazily to the window (desktop + jsdom tests both have one at call time).
let purifierInstance: ReturnType<typeof createDOMPurify> | null = null;
function purifier(): ReturnType<typeof createDOMPurify> {
  purifierInstance ??= createDOMPurify(window);
  return purifierInstance;
}

/**
 * E-mail HTML sanitizer (PIM stage 5): the sandbox viewer renders FOREIGN,
 * attacker-controlled HTML — the single largest new attack surface of the
 * PIM expansion. Defense in depth:
 *
 *   1. DOMPurify strips scripts/event handlers/forms entirely.
 *   2. REMOTE CONTENT IS HARD-BLOCKED (tracking pixels, remote images, css
 *      url() loaders): every fetching attribute with a remote target is
 *      removed and counted; only self-contained data: images survive.
 *      Links lose their href (shown as text) — a sandboxed iframe cannot
 *      open them safely anyway; opening in the system browser is a later,
 *      explicit affordance.
 *   3. The caller renders the result into <iframe sandbox=""> with a
 *      default-src 'none' CSP meta — belt and braces should 1+2 ever miss.
 */

export interface SanitizedEmail {
  html: string;
  /** Number of removed remote references (shown as a "blocked" hint). */
  blockedRemote: number;
}

const FETCHING_ATTRS = new Set(["src", "srcset", "poster", "background", "xlink:href", "action", "formaction", "ping"]);
const DATA_IMAGE = /^\s*data:image\//i;

export function sanitizeEmailHtml(raw: string): SanitizedEmail {
  let blockedRemote = 0;

  const hook = (_node: unknown, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue ?? "";
    if (FETCHING_ATTRS.has(name)) {
      // Only self-contained data: images may load; everything else is a
      // network fetch (tracking) or a foreign scheme — cut and count.
      if (name === "src" && DATA_IMAGE.test(value)) return;
      blockedRemote++;
      data.keepAttr = false;
      return;
    }
    if (name === "href") {
      // Links render as plain text — no navigation surface in the sandbox.
      data.keepAttr = false;
      return;
    }
    if (name === "style" && /url\s*\(/i.test(value)) {
      // css url() is a fetch too (background-image tracking pixels et al.).
      blockedRemote++;
      data.keepAttr = false;
    }
  };

  const dp = purifier();
  dp.addHook("uponSanitizeAttribute", hook);
  let html: string;
  try {
    html = dp.sanitize(raw, {
      // <style> blocks can url()-fetch; forms/meta/base have no business in
      // a read-only viewer.
      FORBID_TAGS: ["style", "link", "form", "input", "button", "select", "textarea", "meta", "base"],
      USE_PROFILES: { html: true },
    });
  } finally {
    dp.removeHook("uponSanitizeAttribute");
  }
  return { html, blockedRemote };
}

/** Full srcdoc for the sandboxed iframe: hardened CSP + readable defaults. */
export function buildMailFrameDoc(sanitizedHtml: string): string {
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
    `<style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:12px;word-break:break-word;color:#222;background:#fff}` +
    `img{max-width:100%;height:auto}table{max-width:100%}a{text-decoration:underline}</style>` +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
